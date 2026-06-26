import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { Config } from "../config.js";
import { toFiniteNumber, type Currency } from "./currency.js";

export type OrderRecord = {
  date: string; // KST calendar date the order was placed, YYYY-MM-DD (the daily bucket)
  account: number;
  symbol: string;
  side: "BUY" | "SELL";
  orderType: "LIMIT" | "MARKET";
  currency: Currency;
  estimatedAmount: number; // committed notional estimated at placement; used as a fallback
  orderId?: string;
  clientOrderId?: string;
  timestamp: string; // ISO 8601

  // Reconciliation cache, refreshed by reconcileToday() from the live order.
  status?: string; // last-seen OrderStatus
  filledAmount?: number; // actual filled notional (native currency)
  committedAmount?: number; // last-computed contribution = filled + open remaining
  terminal?: boolean; // true once the order reached a terminal status (freeze, stop polling)
};

const STATE_DIR_NAME = "tossinvest-mcp";
const STATE_FILE_NAME = "guard-state.json";

// Terminal order statuses: the order can no longer change, so its contribution
// is frozen at the filled portion (any unfilled quantity is released). All other
// statuses — including unknown ones the spec says to tolerate — are treated as
// still open and re-polled. See OrderStatus in the Toss OpenAPI spec.
const TERMINAL_STATUSES = new Set(["FILLED", "CANCELED", "REJECTED", "REPLACED"]);

/** Resolve the guard state file path, honoring an explicit override or the OS data directory. */
export function resolveStatePath(config: Config): string {
  if (config.guardStatePath) {
    return config.guardStatePath;
  }
  return join(defaultDataDir(), STATE_DIR_NAME, STATE_FILE_NAME);
}

function defaultDataDir(): string {
  const home = homedir();

  if (process.platform === "win32") {
    return process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
  }
  if (process.platform === "darwin") {
    return join(home, "Library", "Application Support");
  }
  return process.env.XDG_DATA_HOME ?? join(home, ".local", "share");
}

/**
 * Read guard state records. A missing file is treated as an empty history. Any
 * other failure (unreadable file, malformed JSON, wrong shape) throws so the
 * caller blocks the order instead of silently ignoring daily limits.
 */
export function readState(path: string): OrderRecord[] {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw new Error(`Order blocked: cannot read guard state file at ${path}: ${asMessage(error)}`);
  }

  if (raw.trim() === "") {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Order blocked: guard state file at ${path} is not valid JSON: ${asMessage(error)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Order blocked: guard state file at ${path} must contain a JSON array of order records.`);
  }

  return parsed as OrderRecord[];
}

/**
 * Append a record after a successful order. Daily limits only ever consult
 * today's (KST) records, so older records are dropped here to keep the ledger
 * bounded — they carry no information any check uses.
 */
export function recordOrder(path: string, record: OrderRecord): void {
  const today = kstDate();
  const existing = readState(path).filter((existingRecord) => existingRecord.date === today);
  existing.push(record);
  writeState(path, existing);
}

/**
 * Today's (KST) records without any live reconciliation. The daily count limit
 * depends only on how many orders were placed today, which reconciliation never
 * changes, so a count-only check reads the ledger directly and avoids both the
 * per-order GETs and the fail-safe block a failed fetch would otherwise cause.
 */
export function readTodayRecords(path: string): OrderRecord[] {
  const today = kstDate();
  return readState(path).filter((record) => record.date === today);
}

let tmpCounter = 0;

/**
 * Persist records atomically: write a temp file then rename, so a concurrent
 * reader never sees a half-written file (rename is atomic on the same filesystem).
 */
export function writeState(path: string, records: OrderRecord[]): void {
  mkdirSync(dirname(path), { recursive: true });
  tmpCounter += 1;
  const tmp = `${path}.${process.pid}.${tmpCounter}.tmp`;
  writeFileSync(tmp, JSON.stringify(records, null, 2), "utf8");
  renameSync(tmp, path);
}

/** A record's current contribution: its reconciled amount, or the placement estimate. */
export function contributionOf(record: OrderRecord): number {
  return record.committedAmount ?? record.estimatedAmount;
}

export function isTerminalStatus(status: unknown): boolean {
  return typeof status === "string" && TERMINAL_STATUSES.has(status);
}

export type Contribution = {
  status?: string;
  currency?: Currency;
  filled: number; // actual filled notional
  committed: number; // filled + open remaining (filled only when terminal)
  terminal: boolean;
};

/**
 * Compute an order's contribution from its live detail (GET /orders/{id}).
 *
 * filled is the actual executed notional (execution.filledAmount, or
 * averageFilledPrice * filledQuantity as a fallback). When terminal, the
 * contribution is exactly the filled portion — unfilled quantity is released.
 * When still open, the open remaining ((quantity - filled) * price) is added; if
 * the remaining cannot be priced (e.g. an open MARKET order with no price), we
 * fall back to the larger of the placement estimate and the filled amount so the
 * limit is never under-counted.
 */
export function contributionFromDetail(detail: unknown, record: OrderRecord): Contribution {
  const root = unwrap(detail);
  const status = readString(root, "status");
  const terminal = isTerminalStatus(status);
  const currency = readCurrency(root);

  const execution = unwrap(readKey(root, "execution"));
  const filledQuantity = toFiniteNumber(readKey(execution, "filledQuantity")) ?? 0;
  const filledAmountField = toFiniteNumber(readKey(execution, "filledAmount"));
  const averageFilledPrice = toFiniteNumber(readKey(execution, "averageFilledPrice"));
  const filled =
    filledAmountField ?? (averageFilledPrice !== undefined ? averageFilledPrice * filledQuantity : 0);

  if (terminal) {
    return { status, currency, filled, committed: filled, terminal: true };
  }

  const quantity = toFiniteNumber(readKey(root, "quantity"));
  const price = toFiniteNumber(readKey(root, "price"));
  let committed: number;
  if (quantity !== undefined && price !== undefined) {
    const remaining = Math.max(0, quantity - filledQuantity) * price;
    committed = filled + remaining;
  } else {
    committed = Math.max(record.estimatedAmount, filled);
  }

  return { status, currency, filled, committed, terminal: false };
}

/** Current calendar date in the Asia/Seoul timezone, formatted YYYY-MM-DD. */
export function kstDate(timestampMs: number = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(timestampMs));
}

function unwrap(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const obj = value as Record<string, unknown>;
  const inner = obj.result;
  if (inner !== null && typeof inner === "object" && !Array.isArray(inner)) {
    return inner as Record<string, unknown>;
  }
  return obj;
}

function readKey(obj: Record<string, unknown> | undefined, key: string): unknown {
  return obj === undefined ? undefined : obj[key];
}

function readString(obj: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = readKey(obj, key);
  return typeof value === "string" ? value : undefined;
}

function readCurrency(obj: Record<string, unknown> | undefined): Currency | undefined {
  const value = readKey(obj, "currency");
  return value === "KRW" || value === "USD" ? value : undefined;
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
