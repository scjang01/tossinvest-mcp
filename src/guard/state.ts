import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { Config } from "../config.js";
import type { Currency } from "./currency.js";

export type OrderRecord = {
  date: string; // KST calendar date, YYYY-MM-DD
  account: number;
  symbol: string;
  side: "BUY" | "SELL";
  orderType: "LIMIT" | "MARKET";
  currency: Currency;
  estimatedAmount: number;
  orderId?: string;
  clientOrderId?: string;
  timestamp: string; // ISO 8601
};

export type DailyTotals = {
  count: number;
  amountByCurrency: Record<Currency, number>;
};

const STATE_DIR_NAME = "tossinvest-mcp";
const STATE_FILE_NAME = "guard-state.json";

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

/** Append a record after a successful order. Creates the directory and file as needed. */
export function recordOrder(path: string, record: OrderRecord): void {
  const existing = readState(path);
  existing.push(record);
  mkdirSync(dirname(path), { recursive: true });
  // Write to a temp file then rename so a concurrent reader never sees a
  // half-written file (rename is atomic on the same filesystem).
  writeStateAtomic(path, existing);
}

let tmpCounter = 0;

function writeStateAtomic(path: string, records: OrderRecord[]): void {
  tmpCounter += 1;
  const tmp = `${path}.${process.pid}.${tmpCounter}.tmp`;
  writeFileSync(tmp, JSON.stringify(records, null, 2), "utf8");
  renameSync(tmp, path);
}

/** Aggregate today's (KST) records into count and per-currency amount totals. */
export function dailyTotals(records: OrderRecord[], today: string): DailyTotals {
  const totals: DailyTotals = { count: 0, amountByCurrency: { KRW: 0, USD: 0 } };

  for (const record of records) {
    if (record.date !== today) {
      continue;
    }
    totals.count += 1;
    if (record.currency === "KRW" || record.currency === "USD") {
      totals.amountByCurrency[record.currency] += record.estimatedAmount;
    }
  }

  return totals;
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

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
