import { randomUUID, createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { Decimal } from "decimal.js";
import type { Config } from "../config.js";
import type { TossClient } from "../toss/client.js";
import { TossApiError } from "../toss/errors.js";
import { withFileLock } from "../utils/storage.js";
import {
  estimateOrderAmount,
  fetchSymbolCurrency,
  fetchPrice,
  unwrap,
  type Valuation,
} from "./estimate.js";
import { aggregate, remainingAmount } from "./reconcile.js";
import {
  applyDelta,
  bucketKey,
  budgetDate,
  dailyCount,
  hasLegacyState,
  kstDate,
  orderKey,
  pruneState,
  readState,
  resolveStatePath,
  writeState,
  type BookedOrder,
  type GuardState,
  type Operation,
  type Currency,
} from "./state.js";
export { resolveStatePath } from "./state.js";
export function generateClientOrderId(): string {
  return `tm-${randomUUID()}`.slice(0, 36);
}
type Trade = {
  account: number;
  kind: "order" | "conditional";
  action: "create" | "modify" | "cancel";
  body: Record<string, any>;
  targetId?: string;
};
const hasAmounts = (c: Config, currency: Currency) =>
  (currency === "KRW"
    ? [c.maxOrderAmountKrw, c.dailyMaxOrderAmountKrw]
    : [c.maxOrderAmountUsd, c.dailyMaxOrderAmountUsd]
  ).some((v) => v !== undefined);
function symbolAllowed(config: Config, symbol: string) {
  if (
    config.allowedSymbols &&
    !config.allowedSymbols.includes(symbol.toUpperCase())
  )
    throw new Error(
      `Order blocked: symbol ${symbol} is not in TOSSINVEST_ALLOWED_SYMBOLS.`,
    );
}
function stable(value: any): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
}
function detailPath(kind: Trade["kind"], id: string): string {
  return `/api/v1/${kind === "order" ? "orders" : "conditional-orders"}/${encodeURIComponent(id)}`;
}
function mutationPath(t: Trade): string {
  return t.action === "create"
    ? `/api/v1/${t.kind === "order" ? "orders" : "conditional-orders"}`
    : detailPath(t.kind, t.targetId!) +
        (t.action === "modify"
          ? "/modify"
          : t.kind === "order"
            ? "/cancel"
            : "");
}
function resultId(kind: Trade["kind"], response: unknown): string | undefined {
  const r = unwrap(response);
  const v = kind === "order" ? r?.orderId : r?.conditionalOrderId;
  return typeof v === "string" && v ? v : undefined;
}
async function prepare(
  client: TossClient,
  c: Config,
  t: Trade,
  before: any,
  context: { currency?: Currency },
): Promise<BookedOrder | undefined> {
  if (t.action === "cancel") return undefined;
  const body = t.body;
  const symbol = t.action === "create" ? body.symbol : before.symbol;
  if (typeof symbol !== "string")
    throw new Error("Cannot determine order symbol.");
  symbolAllowed(c, symbol);
  const currency =
    before?.currency ??
    (before?.market === "KR"
      ? "KRW"
      : before?.market === "US"
        ? "USD"
        : undefined);
  // Market identity is required for reset/count windows even without amount
  // limits. Do not request live prices solely to maintain those counts.
  const resolved = currency ?? (await fetchSymbolCurrency(client, symbol));
  context.currency = resolved;
  const valueAmounts = hasAmounts(c, resolved);
  const quote =
    valueAmounts &&
    (body.orderType ?? before?.orderType) === "MARKET" &&
    body.orderAmount === undefined
      ? await fetchPrice(client, symbol)
      : undefined;
  if (t.kind === "order") {
    if (t.action === "modify") {
      body.orderType ??= before.orderType;
      if (!["LIMIT", "MARKET"].includes(body.orderType))
        throw new Error(
          "Unknown existing orderType; provide a supported type.",
        );
      if (resolved === "USD" && body.quantity !== undefined)
        throw new Error("US modify forbids quantity.");
      if (resolved === "KRW" && body.quantity === undefined)
        throw new Error("KR modify requires quantity.");
      if (body.orderType === "LIMIT") body.price ??= before.price;
    }
    if (body.orderType === "LIMIT" && !body.price)
      throw new Error("LIMIT requires price.");
    if (body.orderType === "MARKET" && body.price !== undefined)
      throw new Error("MARKET forbids price.");
    if (body.orderAmount !== undefined && resolved !== "USD")
      throw new Error("Amount orders require US MARKET.");
    if (
      body.timeInForce === "CLS" &&
      (resolved !== "USD" || body.orderType !== "LIMIT")
    )
      throw new Error("CLS requires US LIMIT.");
    if (body.timeInForce === "OPG" && resolved !== "KRW")
      throw new Error("OPG is domestic only.");
    if (resolved === "KRW" && body.quantity?.includes("."))
      throw new Error("Domestic orders require integer quantity.");
    if (resolved === "KRW" && body.price?.includes("."))
      throw new Error("Domestic prices must be integer KRW.");
  }
  if (!valueAmounts) return undefined;
  let legs: Valuation[];
  if (t.kind === "order") {
    const quantity =
      body.quantity ??
      (t.action === "modify"
        ? new Decimal(before.quantity)
            .minus(before.execution?.filledQuantity ?? NaN)
            .toFixed()
        : undefined);
    legs = [
      await estimateOrderAmount(
        client,
        {
          symbol,
          quantity,
          side: body.side ?? before.side,
          orderType: body.orderType,
          price: body.price,
          orderAmount: body.orderAmount,
        },
        {
          marketOrderBufferPct: c.marketOrderBufferPct,
          currency: resolved,
          quote,
        },
      ),
    ];
  } else {
    legs = [];
    for (const leg of [body.first, body.second].filter(Boolean))
      legs.push(
        await estimateOrderAmount(
          client,
          {
            symbol,
            side: leg.orderSide,
            orderType: body.orderType,
            quantity: body.quantity,
            price: leg.orderPrice,
          },
          {
            marketOrderBufferPct: c.marketOrderBufferPct,
            currency: resolved,
            quote,
          },
        ),
      );
  }
  const unitCurrency = legs[0].currency;
  const limit =
    unitCurrency === "KRW" ? c.maxOrderAmountKrw : c.maxOrderAmountUsd;
  for (const leg of legs)
    if (limit !== undefined && new Decimal(leg.amount).gt(limit))
      throw new Error(
        `Order blocked: amount ${leg.amount} ${unitCurrency} exceeds per-order limit ${limit}.`,
      );
  return {
    id: "pending",
    kind: t.kind,
    date: budgetDate(unitCurrency),
    account: t.account,
    currency: unitCurrency,
    amount: aggregate(
      body.type ?? "SINGLE",
      legs.map((l) => l.amount),
    ),
    legs,
    symbol,
    side: body.side ?? before?.side,
    orderType: body.orderType,
    group: body.type,
  };
}
function reducingWithoutValuation(t: Trade, before: any): boolean {
  if (t.action !== "modify") return false;
  try {
    if (t.kind === "order") {
      const remaining = new Decimal(before.quantity).minus(
        before.execution.filledQuantity,
      );
      const next = new Decimal(t.body.quantity ?? remaining);
      if (before.orderType === "MARKET" && t.body.orderType === "MARKET")
        return next.lte(remaining);
      return (
        before.orderType === "LIMIT" &&
        t.body.orderType === "LIMIT" &&
        next.mul(t.body.price).lte(remaining.mul(before.price))
      );
    }
    if (before.orderType !== "LIMIT" || t.body.orderType !== "LIMIT")
      return false;
    const old = aggregate(
      before.type,
      [before.first, before.second]
        .filter(Boolean)
        .map((l: any) =>
          new Decimal(before.quantity).mul(l.orderPrice).toFixed(),
        ),
    );
    const next = aggregate(
      t.body.type,
      [t.body.first, t.body.second]
        .filter(Boolean)
        .map((l: any) =>
          new Decimal(t.body.quantity).mul(l.orderPrice).toFixed(),
        ),
    );
    return new Decimal(next).lte(old);
  } catch {
    return false;
  }
}
function incrementCount(state: GuardState, op: Operation) {
  if (!op.currency)
    throw new Error(
      "Cannot determine count reset market; reservation retained.",
    );
  const key = bucketKey(op.account, op.currency, op.date);
  const b = (state.buckets[key] ??= { amount: "0", count: 0 });
  b.count++;
  state.buckets[key] = b;
}
async function finalize(
  client: TossClient,
  state: GuardState,
  op: Operation,
  response: unknown,
): Promise<void> {
  if (op.status === "complete") return;
  if (!op.currency && op.action !== "cancel") {
    const symbol =
      op.replacement?.symbol ??
      op.body.symbol ??
      (op.targetBefore as any)?.symbol;
    if (typeof symbol !== "string")
      throw new Error(
        "Cannot determine legacy operation market; reservation retained.",
      );
    op.currency = await fetchSymbolCurrency(client, symbol);
    op.date = budgetDate(op.currency, op.started);
  }
  const id = resultId(op.kind, response);
  if (!id)
    throw new Error("Response has no operation identifier; budget retained.");
  // The broker can fill the original while a replacement is in flight. Read only
  // the returned replacement, so US remaining quantity is not frozen at the preflight snapshot.
  if (op.kind === "order" && op.action === "modify" && op.replacement) {
    const detail = unwrap(
      await client.request({
        path: detailPath("order", id),
        accountSeq: op.account,
      }),
    );
    const quantity = detail?.quantity;
    if (
      typeof quantity !== "string" ||
      !new Decimal(quantity).isFinite() ||
      new Decimal(quantity).lt(0)
    )
      throw new Error("Cannot verify replacement quantity; budget retained.");
    const leg = op.replacement.legs[0];
    if (!leg.unitPrice)
      throw new Error("Cannot verify replacement valuation; budget retained.");
    leg.quantity = quantity;
    leg.amount = new Decimal(quantity).mul(leg.unitPrice).toFixed();
    op.replacement.amount = leg.amount;
  }
  let delta = op.delta;
  const old = op.targetId
    ? state.orders[orderKey(op.kind, op.account, op.targetId)]
    : undefined;
  if (old && old.date === op.date && !old.closed && op.action !== "create") {
    let final: any;
    try {
      final =
        op.kind === "conditional" && op.action === "modify"
          ? op.targetBefore
          : unwrap(
              await client.request({
                path: detailPath(op.kind, op.targetId!),
                accountSeq: op.account,
              }),
            );
    } catch (error) {
      if (
        !(
          op.kind === "conditional" &&
          op.action === "cancel" &&
          error instanceof TossApiError &&
          error.status === 404 &&
          error.code === "conditional-order-not-found"
        )
      )
        throw error;
      // Some deleted conditionals disappear from history. Never interpret that
      // as proof that every leg canceled: a leg may have triggered in flight.
      // Settle the cancellation without ANY refund, retaining the full charge.
      final = { historyUnavailable: true };
    }
    if (
      op.kind === "order" &&
      !["CANCELED", "REPLACED"].includes(final?.status)
    )
      throw new Error("Target mutation not terminal yet; budget retained.");
    if (op.kind === "conditional" && op.action === "cancel") {
      if (final.historyUnavailable) {
        delta = "0";
        response = {
          ...(response as object),
          _guardStateWarning:
            "Conditional order history is unavailable (404); cancellation has no budget refund. The full original budget is retained.",
          _budgetRetained: true,
        };
      } else {
        const legs = [final?.first, final?.second].filter(Boolean);
        if (
          !legs.length ||
          legs.some((l: any) =>
            ["WATCHING", "HOLDING", "PAUSED"].includes(l.status),
          )
        )
          throw new Error(
            "Conditional cancellation not confirmed; budget retained.",
          );
        // A canceled leg was refundable; triggered legs remain charged. The post-cancel shape proves which legs actually canceled.
        const previous = op.targetBefore as any;
        const retained = old.legs.map((l, i) =>
          [final.first, final.second][i]?.status === "CANCELED" &&
          ["WATCHING", "HOLDING", "PAUSED"].includes(
            [previous?.first, previous?.second][i]?.status,
          )
            ? "0"
            : l.amount,
        );
        delta = Decimal.max(
          0,
          new Decimal(old.amount).minus(
            aggregate(old.group ?? "SINGLE", retained),
          ),
        )
          .negated()
          .toFixed();
      }
    } else if (op.kind === "conditional" && op.action === "modify") {
      // Old IDs become inaccessible after a successful conditional replacement.
      delta = op.delta;
    } else {
      const refundable = remainingAmount(old, final);
      delta = new Decimal(op.replacement?.amount ?? 0)
        .minus(refundable)
        .toFixed();
    }
    old.closed = true;
  }
  if (op.currency)
    applyDelta(
      state,
      op.account,
      op.currency,
      new Decimal(delta).minus(op.reserved).toFixed(),
      op.date,
    );
  if (op.replacement) {
    op.replacement.id = id;
    state.orders[orderKey(op.kind, op.account, id)] = op.replacement;
  }
  if (op.action !== "cancel" && !op.counted) {
    incrementCount(state, op);
    op.counted = true;
  }
  op.response = response;
  op.status = "complete";
}
async function recover(
  client: TossClient,
  state: GuardState,
  op: Operation,
): Promise<void> {
  if (op.status !== "pending") return;
  if (!op.dispatching) {
    if (op.currency)
      applyDelta(
        state,
        op.account,
        op.currency,
        new Decimal(op.reserved).negated().toFixed(),
        op.date,
      );
    delete state.operations[op.id];
    return;
  }
  let response = op.response;
  if (
    response === undefined &&
    op.action === "create" &&
    Date.now() - op.started < 9 * 60 * 1000
  )
    response = await client.request({
      method: "POST",
      path: mutationPath({
        account: op.account,
        kind: op.kind,
        action: "create",
        body: op.body,
      }),
      accountSeq: op.account,
      body: op.body,
    });
  if (response === undefined && op.action === "cancel")
    response = {
      result: {
        [op.kind === "order" ? "orderId" : "conditionalOrderId"]: op.targetId,
      },
      _recovered: true,
    };
  if (response === undefined)
    throw new Error(
      `Unresolved ${op.action}; inspect ${op.targetId ?? op.clientOrderId}. Automatic create replay expires after 9 minutes.`,
    );
  await finalize(client, state, op, response);
}
/** Reconcile known responses or a dispatched cancel; never replay a mutation. */
export async function reconcileAccepted(
  client: TossClient,
  config: Config,
  account: number,
  targetId: string,
): Promise<void> {
  const path = resolveStatePath(config);
  if (!existsSync(path)) {
    if (!hasLegacyState(config)) return;
    await withFileLock(path, async () => {
      readState(path, config);
    });
  }
  const matches = (op: Operation) =>
    op.account === account &&
    op.status === "pending" &&
    (op.response !== undefined || (op.action === "cancel" && op.dispatching)) &&
    (op.targetId === targetId || resultId(op.kind, op.response) === targetId);
  // Normal detail reads need no write lock. State writes are atomic; if a new
  // operation arrives after this snapshot, its finalizer or next read settles it.
  if (!Object.values(readState(path, config).operations).some(matches)) return;
  await withFileLock(path, async () => {
    let state = readState(path, config);
    const pending = Object.values(state.operations).filter(matches);
    for (const op of pending) {
      // Finalization may adjust a replacement before discovering a pending target.
      // Do not persist a partially changed operation when another one settles.
      const next = structuredClone(state);
      try {
        await finalize(
          client,
          next,
          next.operations[op.id],
          op.response ?? {
            result: {
              [op.kind === "order" ? "orderId" : "conditionalOrderId"]:
                op.targetId,
            },
            _recovered: true,
          },
        );
      } catch {
        continue;
      }
      writeState(path, next);
      state = next;
    }
  });
}
export async function executeTrade(
  client: TossClient,
  c: Config,
  input: Trade,
): Promise<unknown> {
  if (!c.tradingEnabled) throw new Error("Trading is disabled.");
  const path = resolveStatePath(c);
  return withFileLock(path, async () => {
    let state: GuardState;
    try {
      state = readState(path, c);
    } catch (error) {
      // Cancel remains available even when local state is damaged. Do not invent a refund.
      if (input.action !== "cancel") throw error;
      const response = await client.request({
        method: input.kind === "conditional" ? "DELETE" : "POST",
        path: mutationPath(input),
        accountSeq: input.account,
        body: input.kind === "order" ? {} : undefined,
      });
      return {
        ...(response as object),
        _guardStateWarning:
          "Cancellation submitted; guard state could not be read, so no local refund was applied.",
      };
    }
    const body = { ...input.body };
    if (input.action === "create")
      body.clientOrderId ??= generateClientOrderId();
    const t = { ...input, body };
    const fingerprint = createHash("sha256")
      .update(stable({ account: t.account, kind: t.kind, body }))
      .digest("hex");
    if (t.action === "create") {
      const prior = Object.values(state.operations)
        .filter(
          (op) =>
            op.account === t.account &&
            op.kind === t.kind &&
            op.clientOrderId === body.clientOrderId &&
            Date.now() - op.started < 10 * 60 * 1000,
        )
        .sort((a, b) => b.started - a.started)[0];
      if (prior) {
        if (prior.fingerprint !== fingerprint)
          throw new Error(
            "clientOrderId conflicts with a different request within the 10-minute window.",
          );
        if (prior.status === "pending") {
          await recover(client, state, prior);
          writeState(path, state);
        }
        return prior.response;
      }
    }
    let unresolved = false;
    for (const op of Object.values(state.operations).filter(
      (o) =>
        t.action !== "cancel" &&
        o.account === t.account &&
        o.status === "pending",
    )) {
      try {
        await recover(client, state, op);
        writeState(path, state);
      } catch {
        unresolved = true;
      }
    }
    let before: any;
    if (t.action !== "create") {
      try {
        before = unwrap(
          await client.request({
            path: detailPath(t.kind, t.targetId!),
            accountSeq: t.account,
          }),
        );
      } catch (error) {
        if (t.action !== "cancel") throw error;
      }
    }
    const old = t.targetId
      ? state.orders[orderKey(t.kind, t.account, t.targetId)]
      : undefined;
    const context: { currency?: Currency } = {};
    const replacement = await prepare(client, c, t, before, context);
    const currency =
      context.currency ??
      replacement?.currency ??
      old?.currency ??
      (before?.currency === "KRW" || before?.market === "KR"
        ? "KRW"
        : before?.currency === "USD" || before?.market === "US"
          ? "USD"
          : undefined);
    // Freeze the reservation window once, after any asynchronous validation.
    const started = Date.now();
    const date = currency ? budgetDate(currency, started) : kstDate(started);
    const countLimit =
      currency === "KRW" ? c.dailyMaxOrderCountKrw : c.dailyMaxOrderCountUsd;
    if (replacement) replacement.date = date;
    let refundable = "0";
    if (old?.date === date && !old.closed) {
      try {
        refundable = remainingAmount(old, before);
      } catch (error) {
        if (t.action !== "cancel") throw error;
      }
    }
    const delta = new Decimal(replacement?.amount ?? 0).minus(refundable);
    const reduction =
      t.action === "modify" &&
      (replacement
        ? old?.date === date && !old.closed && delta.lte(0)
        : reducingWithoutValuation(t, before));
    if (t.action !== "cancel" && unresolved && !reduction)
      throw new Error(
        "Order blocked: unresolved prior operation; inspect orders before increasing exposure.",
      );
    if (t.action !== "cancel" && delta.gt(0)) {
      if (
        countLimit !== undefined &&
        currency &&
        dailyCount(state, t.account, currency, started) >= countLimit
      )
        throw new Error(`Daily order count limit reached (${currency}).`);
      const limit =
        replacement?.currency === "KRW"
          ? c.dailyMaxOrderAmountKrw
          : c.dailyMaxOrderAmountUsd;
      const used = replacement
        ? (state.buckets[bucketKey(t.account, replacement.currency, date)]
            ?.amount ?? "0")
        : "0";
      if (limit !== undefined && new Decimal(used).plus(delta).gt(limit))
        throw new Error("Daily order amount limit reached.");
    }
    if (
      t.action !== "cancel" &&
      !replacement &&
      !reduction &&
      countLimit !== undefined &&
      currency &&
      dailyCount(state, t.account, currency, started) >= countLimit
    )
      throw new Error(`Daily order count limit reached (${currency}).`);
    const op: Operation = {
      id: randomUUID(),
      date,
      account: t.account,
      kind: t.kind,
      action: t.action,
      fingerprint,
      body,
      clientOrderId: body.clientOrderId,
      started,
      currency,
      reserved: Decimal.max(0, delta).toFixed(),
      delta: delta.toFixed(),
      targetId: t.targetId,
      targetBefore: before,
      replacement,
      status: "pending",
      counted: false,
      dispatching: false,
    };
    if (op.currency)
      applyDelta(state, t.account, op.currency, op.reserved, op.date);
    state.operations[op.id] = op;
    pruneState(state);
    writeState(path, state);
    op.dispatching = true;
    writeState(path, state);
    let response: unknown;
    try {
      response = await client.request({
        method:
          t.kind === "conditional" && t.action === "cancel" ? "DELETE" : "POST",
        path: mutationPath(t),
        accountSeq: t.account,
        body:
          t.kind === "conditional" && t.action === "cancel" ? undefined : body,
      });
    } catch (error) {
      const definite =
        error instanceof TossApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 408 &&
        !(error.status === 409 && error.code === "request-in-progress");
      if (definite) {
        if (op.currency)
          applyDelta(
            state,
            t.account,
            op.currency,
            new Decimal(op.reserved).negated().toFixed(),
            op.date,
          );
        delete state.operations[op.id];
        writeState(path, state);
        throw error;
      }
      throw new Error(
        `Order acceptance unknown. clientOrderId=${body.clientOrderId ?? "n/a"}; target=${t.targetId ?? "n/a"}. Do not submit with a new key. ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    op.response = response;
    try {
      writeState(path, state);
      // A conditional modify returns a new ID and invalidates the old; the successful response is authoritative.
      await finalize(client, state, op, response);
      writeState(path, state);
      response = op.response;
      const warnings = state.warnings.splice(0);
      if (warnings.length) {
        writeState(path, state);
        return { ...(response as object), _warnings: warnings };
      }
      return response;
    } catch (error) {
      return {
        ...(response as object),
        _guardStateWarning: `Mutation accepted; budget remains reserved pending recovery. Do NOT retry as a new order. ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  });
}
