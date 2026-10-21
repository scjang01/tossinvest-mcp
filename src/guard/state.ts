import { readFileSync, copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { Decimal } from "decimal.js";
import type { Config } from "../config.js";
import { atomicWrite, credentialId, runtimeDir } from "../utils/storage.js";

const nonnegative = z.string().regex(/^\d+(\.\d+)?$/);
const legSchema = z.object({
  amount: nonnegative,
  unitPrice: nonnegative.optional(),
  quantity: nonnegative.optional(),
  currency: z.enum(["KRW", "USD"]),
  referencePrice: nonnegative.optional(),
  bufferPct: z.number().min(0).lt(100).optional(),
});
const bookedSchema = z.object({
  id: z.string(),
  kind: z.enum(["order", "conditional"]),
  date: z.iso.date(),
  account: z.number().int().positive(),
  currency: z.enum(["KRW", "USD"]),
  amount: nonnegative,
  legs: z.array(legSchema).min(1).max(2),
  symbol: z.string(),
  side: z.enum(["BUY", "SELL"]).optional(),
  orderType: z.enum(["LIMIT", "MARKET"]),
  group: z.enum(["SINGLE", "OCO", "OTO"]).optional(),
  closed: z.boolean().optional(),
});
const operationSchema = z.object({
  id: z.string(),
  date: z.iso.date(),
  account: z.number().int().positive(),
  kind: z.enum(["order", "conditional"]),
  action: z.enum(["create", "modify", "cancel"]),
  fingerprint: z.string(),
  body: z.record(z.string(), z.unknown()),
  clientOrderId: z.string().optional(),
  started: z.number(),
  currency: z.enum(["KRW", "USD"]).optional(),
  reserved: nonnegative,
  delta: z.string().regex(/^-?\d+(\.\d+)?$/),
  targetId: z.string().optional(),
  targetBefore: z.unknown().optional(),
  replacement: bookedSchema.optional(),
  response: z.unknown().optional(),
  status: z.enum(["pending", "complete"]),
  counted: z.boolean(),
  dispatching: z.boolean().optional(),
});
const bucketSchema = z.object({
  amount: nonnegative,
  count: z.number().int().nonnegative(),
});
const stateSchema = z.object({
  version: z.literal(4),
  namespace: z.string(),
  buckets: z.record(
    z.string().regex(/^\d{4}-\d{2}-\d{2}:[1-9]\d*:(KRW|USD)$/),
    bucketSchema,
  ),
  orders: z.record(z.string(), bookedSchema),
  operations: z.record(z.string(), operationSchema),
  warnings: z.array(z.string()),
  legacyCounts: z.array(
    z.object({
      account: z.number().int().positive(),
      count: z.number().int().nonnegative(),
      until: z.number().finite(),
    }),
  ),
});
const v3Schema = stateSchema.omit({ legacyCounts: true }).extend({
  version: z.literal(3),
  buckets: z.record(
    z.string().regex(/^\d{4}-\d{2}-\d{2}:[1-9]\d*:(KRW|USD|COUNT)$/),
    bucketSchema,
  ),
});
export type Currency = "KRW" | "USD";
export type BookedOrder = z.infer<typeof bookedSchema>;
export type Operation = z.infer<typeof operationSchema>;
export type GuardState = z.infer<typeof stateSchema>;
const kstDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export function kstDate(ms = Date.now()): string {
  return kstDateFormatter.format(new Date(ms));
}
const resetMinutes: Record<Currency, number> = {
  KRW: 20 * 60 + 1,
  USD: 10 * 60 + 1,
};
/** Label a budget window with the KST date on which that window started. */
export function budgetDate(currency: Currency, ms = Date.now()): string {
  return kstDate(ms - resetMinutes[currency] * 60_000);
}
export function nextReset(currency: Currency, ms = Date.now()): number {
  const time = currency === "KRW" ? "20:01" : "10:01";
  return (
    Date.parse(`${budgetDate(currency, ms)}T${time}:00+09:00`) + 86_400_000
  );
}
function statePath(c: Config, version: number): string {
  return c.guardStatePath
    ? `${c.guardStatePath}.v${version}-${credentialId(c)}.json`
    : join(runtimeDir(c), `guard-v${version}-${credentialId(c)}.json`);
}
export function resolveStatePath(c: Config): string {
  return statePath(c, 4);
}
export function hasLegacyState(c: Config): boolean {
  return (
    existsSync(statePath(c, 3)) ||
    existsSync(c.guardStatePath ?? join(runtimeDir(c), "guard-state.json"))
  );
}
export function bucketKey(
  account: number,
  currency: Currency,
  date = budgetDate(currency),
): string {
  return `${date}:${account}:${currency}`;
}
export function orderKey(kind: string, account: number, id: string): string {
  return `${kind}:${account}:${id}`;
}
export function writeState(path: string, state: GuardState): void {
  atomicWrite(path, stateSchema.parse(state));
}
export function dailyCount(
  state: GuardState,
  account: number,
  currency: Currency,
  ms = Date.now(),
): number {
  return (
    (state.buckets[bucketKey(account, currency, budgetDate(currency, ms))]
      ?.count ?? 0) +
    // Legacy v3 combined counts cannot be assigned to a market reliably.
    // Retain them against each cap until their existing conservative expiry.
    state.legacyCounts
      .filter((v) => v.account === account && ms < v.until)
      .reduce((n, v) => n + v.count, 0)
  );
}
function migrateV3(config: Config, state: GuardState, now: number): boolean {
  const path = statePath(config, 3);
  if (!existsSync(path)) return false;
  const previous = v3Schema.parse(JSON.parse(readFileSync(path, "utf8")));
  if (previous.namespace !== state.namespace)
    throw new Error("Guard namespace mismatch.");
  copyFileSync(path, `${path}.pre-market-reset-${now}.bak`);
  const recent = new Set([kstDate(now), kstDate(now - 86_400_000)]);
  for (const [key, value] of Object.entries(previous.buckets)) {
    const [date, account, unit] = key.split(":");
    if (!recent.has(date)) continue;
    if (unit === "COUNT") {
      if (value.count)
        state.legacyCounts.push({
          account: Number(account),
          count: value.count,
          until: Math.max(nextReset("KRW", now), nextReset("USD", now)),
        });
    } else {
      applyDelta(
        state,
        Number(account),
        unit as Currency,
        value.amount,
        budgetDate(unit as Currency, now),
      );
    }
  }
  state.operations = previous.operations;
  state.orders = previous.orders;
  for (const op of Object.values(state.operations)) {
    if (op.currency) op.date = budgetDate(op.currency, op.started);
    if (op.replacement)
      op.replacement.date = budgetDate(op.replacement.currency, op.started);
  }
  for (const order of Object.values(state.orders)) {
    const origin = Object.values(state.operations).find(
      (op) =>
        op.kind === order.kind &&
        op.account === order.account &&
        op.replacement?.id === order.id,
    );
    if (origin) order.date = budgetDate(order.currency, origin.started);
    else order.closed = true; // Unknown reservation time cannot prove a refundable window.
  }
  state.warnings.push(
    ...previous.warnings,
    "Migrated v3 midnight budgets conservatively into market reset windows; current/previous calendar-day balances were retained. Unattributed combined counts apply conservatively to each market cap until both markets next reset. Refunds require a known reservation window. Original v3 file was backed up.",
  );
  return true;
}
export function readState(path: string, config: Config): GuardState {
  try {
    const state = stateSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    if (state.namespace !== credentialId(config))
      throw new Error("Guard namespace mismatch.");
    return state;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT")
      throw new Error(
        `Cannot read guard state (not reset): ${e instanceof Error ? e.message : String(e)}`,
      );
  }
  const state: GuardState = {
    version: 4,
    namespace: credentialId(config),
    buckets: {},
    orders: {},
    operations: {},
    warnings: [],
    legacyCounts: [],
  };
  const now = Date.now();
  if (migrateV3(config, state, now)) {
    writeState(path, state);
    return state;
  }
  const legacy =
    config.guardStatePath ?? join(runtimeDir(config), "guard-state.json");
  if (existsSync(legacy)) {
    const rows = JSON.parse(readFileSync(legacy, "utf8"));
    if (!Array.isArray(rows))
      throw new Error("Legacy guard state must be an array; not resetting.");
    copyFileSync(legacy, `${legacy}.pre-0.3.0-${Date.now()}.bak`);
    const seen = new Set<string>();
    for (const row of rows) {
      if (![kstDate(now), kstDate(now - 86_400_000)].includes(row.date))
        continue;
      const amount = row.committedAmount ?? row.estimatedAmount;
      if (
        !Number.isInteger(row.account) ||
        row.account < 1 ||
        !["KRW", "USD"].includes(row.currency) ||
        !new Decimal(amount ?? NaN).isFinite() ||
        new Decimal(amount).lt(0)
      )
        throw new Error("Invalid legacy record; not resetting daily limits.");
      const id = row.orderId ?? `legacy-${seen.size}`;
      const key = orderKey("order", row.account, id);
      if (seen.has(key)) continue;
      seen.add(key);
      const bucket = (state.buckets[bucketKey(row.account, row.currency)] ??= {
        amount: "0",
        count: 0,
      });
      bucket.amount = new Decimal(bucket.amount).plus(amount).toFixed();
      bucket.count++;
      state.buckets[bucketKey(row.account, row.currency)] = bucket;
      // Legacy data lacks reliable open-quantity valuation. Keep the balance, but do not guess refunds.
    }
    state.warnings.push(
      "Migrated current/previous calendar-day legacy balances/counts conservatively into market reset windows; legacy state has no API-key identity. Legacy refunds cannot be reconstructed reliably. Original file was backed up.",
    );
  }
  writeState(path, state);
  return state;
}
export function applyDelta(
  state: GuardState,
  account: number,
  currency: Currency,
  delta: string,
  date = budgetDate(currency),
) {
  const key = bucketKey(account, currency, date);
  const bucket = (state.buckets[key] ??= { amount: "0", count: 0 });
  bucket.amount = Decimal.max(
    0,
    new Decimal(bucket.amount).plus(delta),
  ).toFixed();
  state.buckets[key] = bucket;
}
export function pruneState(state: GuardState): void {
  const now = Date.now();
  const pending = Object.values(state.operations).filter(
    (op) => op.status === "pending",
  );
  const heldBuckets = new Set(
    pending
      .filter((op) => op.currency)
      .map((op) => bucketKey(op.account, op.currency!, op.date)),
  );
  const heldOrders = new Set(
    pending.flatMap((op) =>
      [op.targetId, op.replacement?.id]
        .filter(Boolean)
        .map((id) => orderKey(op.kind, op.account, id!)),
    ),
  );
  for (const [key, value] of Object.entries(state.operations))
    if (
      value.status === "complete" &&
      value.date !==
        (value.currency ? budgetDate(value.currency, now) : kstDate(now)) &&
      now - value.started >= 10 * 60 * 1000
    )
      delete state.operations[key];
  for (const [key, value] of Object.entries(state.orders))
    if (value.date !== budgetDate(value.currency, now) && !heldOrders.has(key))
      delete state.orders[key];
  for (const key of Object.keys(state.buckets)) {
    const [date, , currency] = key.split(":");
    if (date !== budgetDate(currency as Currency, now) && !heldBuckets.has(key))
      delete state.buckets[key];
  }
  state.legacyCounts = state.legacyCounts.filter((v) => now < v.until);
}
