import type { Config } from "../config.js";
import type { TossClient } from "../toss/client.js";
import { type Currency } from "./currency.js";
import { estimateOrderAmount, fetchSymbolCurrency } from "./estimate.js";
import { reconcileTodayRecords } from "./reconcile.js";
import { contributionOf, kstDate, recordOrder, resolveStatePath, type OrderRecord } from "./state.js";

export { resolveStatePath, recordOrder } from "./state.js";
export type { OrderRecord } from "./state.js";

// In-process serialization for order-mutating critical sections (daily-limit
// check -> place order -> record state). Without this, two concurrent calls
// could both read the same pre-order state, both pass the daily limit, and both
// place orders (TOCTOU). Order throughput is not a concern here, so a strict
// global queue is the proportionate fix.
let orderChain: Promise<unknown> = Promise.resolve();
export function withOrderLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = orderChain.then(fn, fn);
  orderChain = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export type CreateGuardInput = {
  rawAccountSeq?: number;
  resolvedAccountSeq: number;
  confirmOrderAction?: boolean;
  symbol: string;
  side: "BUY" | "SELL";
  orderType: "LIMIT" | "MARKET";
  quantity?: string;
  price?: string;
  orderAmount?: string;
};

export type ModifyGuardInput = {
  rawAccountSeq?: number;
  resolvedAccountSeq: number;
  confirmOrderAction?: boolean;
  orderId: string;
  orderType?: "LIMIT" | "MARKET";
  quantity?: string;
  price?: string;
};

export type ModifyGuardResult = {
  currency: Currency;
  /** Order type to send (required by the Toss modify API). */
  orderType: "LIMIT" | "MARKET";
  /** Quantity to send: present for KR, omitted for US (US modify forbids quantity). */
  quantity?: string;
  /** Price to send: present for LIMIT, omitted for MARKET (MARKET modify forbids price). */
  price?: string;
  /** Estimated notional of the replacement order, for daily-limit accounting. */
  estimatedAmount: number;
  /** Symbol / side read from the existing order, for recording the replacement. */
  symbol?: string;
  side?: "BUY" | "SELL";
};

export type CancelGuardInput = {
  rawAccountSeq?: number;
  confirmOrderAction?: boolean;
};

export type CreateGuardResult = {
  currency: Currency;
  estimatedAmount: number;
};

/**
 * Enforce all create-order guardrails before the order reaches Toss. Throws with
 * a human-readable reason on any violation, so the order never hits the API.
 */
export async function guardCreateOrder(
  client: TossClient,
  config: Config,
  input: CreateGuardInput
): Promise<CreateGuardResult> {
  assertConfirmation(config, input.confirmOrderAction);
  assertAccountLock(config, input.rawAccountSeq);

  if (input.side === "SELL" && !config.allowSellOrders) {
    throw new Error("Order blocked: sell orders are disabled. Set TOSSINVEST_ALLOW_SELL_ORDERS=true to allow them.");
  }

  if (input.orderType === "MARKET" && !config.allowMarketOrders) {
    throw new Error("Order blocked: market orders are disabled. Set TOSSINVEST_ALLOW_MARKET_ORDERS=true to allow them.");
  }

  assertSymbolAllowed(config, input.symbol);

  const estimate = await estimateOrderAmount(client, input, {
    marketOrderBufferPct: config.marketOrderBufferPct
  });
  // Currency is read authoritatively from Toss (orderbook for market orders,
  // prices API otherwise) — never inferred from the symbol.
  const currency = estimate.currency ?? (await fetchSymbolCurrency(client, input.symbol));

  assertSingleOrderLimit(config, currency, estimate.amount);
  await assertDailyLimits(client, config, currency, estimate.amount);

  return { currency, estimatedAmount: estimate.amount };
}

/**
 * Enforce modify-order guardrails and build the spec-compliant replacement body.
 *
 * Toss modify replaces the original order, so the request must carry `orderType`
 * (required) and, depending on market/type, quantity and price. We always fetch
 * the existing order to read authoritative values (currency, orderType, original
 * quantity/price, symbol, side) and enforce KR/US and LIMIT/MARKET rules from the
 * OpenAPI spec:
 *  - KR: quantity required (positive integer). US: quantity forbidden.
 *  - LIMIT: price required. MARKET: price forbidden.
 * The replacement is treated as a new order for accounting: it is subject to the
 * single-order and daily limits, and the order it replaces is counted at its
 * filled-only amount (its open part is being carried by the replacement).
 */
export async function guardModifyOrder(
  client: TossClient,
  config: Config,
  input: ModifyGuardInput
): Promise<ModifyGuardResult> {
  assertConfirmation(config, input.confirmOrderAction);
  assertAccountLock(config, input.rawAccountSeq);

  const detail = await fetchOrderDetail(client, input.orderId, input.resolvedAccountSeq);

  const currency = resolveDetailCurrency(detail);
  if (currency === undefined) {
    throw new Error(
      `Order blocked: cannot determine the currency of order ${input.orderId}. Refusing to modify without a verifiable currency.`
    );
  }

  const orderType = input.orderType ?? readStringField(detail, "orderType");
  if (orderType !== "LIMIT" && orderType !== "MARKET") {
    throw new Error(
      `Order blocked: cannot determine the order type of order ${input.orderId}. Provide orderType (LIMIT or MARKET) explicitly.`
    );
  }

  // KR/US quantity rules.
  let bodyQuantity: string | undefined;
  if (currency === "USD") {
    if (input.quantity !== undefined) {
      throw new Error(
        "Order blocked: 미국 주식 주문 정정은 수량(quantity) 정정을 지원하지 않으며 가격만 정정할 수 있습니다. 수량 파라미터를 제외하고 가격(price)만 입력하세요."
      );
    }
    bodyQuantity = undefined;
  } else {
    // KRW: quantity required (positive integer). Caller must state it explicitly.
    if (input.quantity === undefined) {
      throw new Error(
        "Order blocked: 국내 주식 주문 정정은 수량(quantity) 정정이 필수입니다. 기존 수량 또는 새로운 수량을 명시적으로 지정하세요."
      );
    }
    bodyQuantity = input.quantity;
  }

  // LIMIT/MARKET price rules.
  let bodyPrice: string | undefined;
  if (orderType === "MARKET") {
    if (input.price !== undefined) {
      throw new Error("Order blocked: 시장가(MARKET) 주문 정정에는 가격(price)을 전달할 수 없습니다.");
    }
    bodyPrice = undefined;
  } else {
    // LIMIT: price required. Fall back to the existing order's price when unchanged.
    bodyPrice = input.price ?? readStringField(detail, "price");
    if (bodyPrice === undefined) {
      throw new Error(
        `Order blocked: 지정가(LIMIT) 주문 정정에는 가격(price)이 필수입니다. order ${input.orderId}의 기존 가격을 확인할 수 없어 차단합니다.`
      );
    }
  }

  const symbol = readStringField(detail, "symbol");
  const detailSide = readField(detail, "side");
  const side = detailSide === "BUY" || detailSide === "SELL" ? detailSide : undefined;

  // Estimate the replacement notional for limit checks and accounting. Required
  // when any amount limit is configured; otherwise best-effort (reconciliation
  // refines it later via the recorded orderId).
  const amountChecksConfigured =
    config.maxOrderAmountKrw !== undefined ||
    config.maxOrderAmountUsd !== undefined ||
    config.dailyMaxOrderAmountKrw !== undefined ||
    config.dailyMaxOrderAmountUsd !== undefined;

  let estimatedAmount = 0;
  try {
    estimatedAmount = await estimateModifyAmount(client, config, detail, orderType, bodyQuantity, bodyPrice);
  } catch (error) {
    if (amountChecksConfigured) {
      throw error;
    }
  }

  assertSingleOrderLimit(config, currency, estimatedAmount);
  await assertDailyLimits(client, config, currency, estimatedAmount, { replaceOrderId: input.orderId });

  return { currency, orderType, quantity: bodyQuantity, price: bodyPrice, estimatedAmount, symbol, side };
}

/** Enforce cancel-order guardrails: confirmation and account lock only. */
export function guardCancelOrder(config: Config, input: CancelGuardInput): void {
  assertConfirmation(config, input.confirmOrderAction);
  assertAccountLock(config, input.rawAccountSeq);
}

function assertConfirmation(config: Config, confirmOrderAction: boolean | undefined): void {
  if (config.requireOrderConfirmation && confirmOrderAction !== true) {
    throw new Error("Order blocked: confirmOrderAction=true is required. Confirm the exact order before submitting.");
  }
}

function assertAccountLock(config: Config, rawAccountSeq: number | undefined): void {
  if (config.lockAccount && rawAccountSeq !== undefined && rawAccountSeq !== config.defaultAccountSeq) {
    throw new Error(
      `Order blocked: account is locked to TOSSINVEST_ACCOUNT (${config.defaultAccountSeq}); accountSeq ${rawAccountSeq} is not allowed. Set TOSSINVEST_LOCK_ACCOUNT=false to override.`
    );
  }
}

function assertSymbolAllowed(config: Config, symbol: string): void {
  if (config.allowedSymbols && !config.allowedSymbols.includes(symbol.trim().toUpperCase())) {
    throw new Error(`Order blocked: symbol ${symbol} is not in TOSSINVEST_ALLOWED_SYMBOLS.`);
  }
}

function assertSingleOrderLimit(config: Config, currency: Currency, amount: number): void {
  const limit = currency === "KRW" ? config.maxOrderAmountKrw : config.maxOrderAmountUsd;
  if (limit !== undefined && amount > limit) {
    throw new Error(
      `Order blocked: estimated amount ${formatAmount(amount, currency)} exceeds the per-order limit of ${formatAmount(limit, currency)}.`
    );
  }
}

/**
 * Enforce daily count and per-currency amount limits. The daily total is the sum
 * of today's reconciled order contributions (see reconcileTodayRecords): each
 * open order is re-priced from the live Toss state, each terminal order counts
 * its filled amount only. When modifying, replaceOrderId names the order being
 * replaced so its open part is excluded (the new estimate carries it).
 */
async function assertDailyLimits(
  client: TossClient,
  config: Config,
  currency: Currency,
  addedAmount: number,
  options: { replaceOrderId?: string } = {}
): Promise<void> {
  if (
    config.dailyMaxOrderCount === undefined &&
    config.dailyMaxOrderAmountKrw === undefined &&
    config.dailyMaxOrderAmountUsd === undefined
  ) {
    return;
  }

  const todays = await reconcileTodayRecords(client, config);

  if (config.dailyMaxOrderCount !== undefined && todays.length + 1 > config.dailyMaxOrderCount) {
    throw new Error(
      `Order blocked: daily order count limit reached (${todays.length}/${config.dailyMaxOrderCount} orders today via this MCP).`
    );
  }

  const dailyAmountLimit = currency === "KRW" ? config.dailyMaxOrderAmountKrw : config.dailyMaxOrderAmountUsd;
  if (dailyAmountLimit === undefined) {
    return;
  }

  let used = 0;
  for (const record of todays) {
    if (record.currency !== currency) {
      continue;
    }
    if (options.replaceOrderId !== undefined && record.orderId === options.replaceOrderId) {
      // This order is being replaced: count only what already filled; its open
      // amount is represented by the replacement (addedAmount).
      used += record.filledAmount ?? 0;
    } else {
      used += contributionOf(record);
    }
  }

  if (used + addedAmount > dailyAmountLimit) {
    throw new Error(
      `Order blocked: daily ${currency} amount limit reached (${formatAmount(used, currency)} used + ${formatAmount(addedAmount, currency)} > ${formatAmount(dailyAmountLimit, currency)}).`
    );
  }
}

/**
 * Estimate the notional of a modify's replacement order, reusing the same logic
 * as create. LIMIT uses quantity * price; MARKET reads the orderbook (and needs
 * the symbol/side from the existing order). Unchanged fields come from the order.
 */
async function estimateModifyAmount(
  client: TossClient,
  config: Config,
  detail: unknown,
  orderType: "LIMIT" | "MARKET",
  bodyQuantity: string | undefined,
  bodyPrice: string | undefined
): Promise<number> {
  const quantity = bodyQuantity ?? readStringField(detail, "quantity");

  if (orderType === "LIMIT") {
    const price = bodyPrice ?? readStringField(detail, "price");
    const estimate = await estimateOrderAmount(
      client,
      { symbol: "", side: "BUY", orderType: "LIMIT", quantity, price },
      { marketOrderBufferPct: config.marketOrderBufferPct }
    );
    return estimate.amount;
  }

  const symbol = readStringField(detail, "symbol");
  const detailSide = readField(detail, "side");
  if (symbol === undefined || (detailSide !== "BUY" && detailSide !== "SELL")) {
    throw new Error("Order blocked: cannot determine the symbol/side of the order to estimate the modified amount.");
  }
  const estimate = await estimateOrderAmount(
    client,
    { symbol, side: detailSide, orderType: "MARKET", quantity },
    { marketOrderBufferPct: config.marketOrderBufferPct }
  );
  return estimate.amount;
}

export function buildOrderRecord(params: {
  account: number;
  symbol: string;
  side: "BUY" | "SELL";
  orderType: "LIMIT" | "MARKET";
  currency: Currency;
  estimatedAmount: number;
  orderId?: string;
  clientOrderId?: string;
}): OrderRecord {
  const now = Date.now();
  return {
    date: kstDate(now),
    account: params.account,
    symbol: params.symbol,
    side: params.side,
    orderType: params.orderType,
    currency: params.currency,
    estimatedAmount: params.estimatedAmount,
    orderId: params.orderId,
    clientOrderId: params.clientOrderId,
    timestamp: new Date(now).toISOString()
  };
}

/**
 * Generate a traceable, unique clientOrderId: tossinvest-mcp-YYYYMMDD-<suffix>.
 *
 * Toss treats clientOrderId as a 10-minute idempotency key, so distinct orders
 * must get distinct ids. The prefix is 24 chars, leaving 12 for entropy within
 * the 36-char schema limit; two base-36 random segments give ~10^15 of space.
 */
export function generateClientOrderId(): string {
  const date = kstDate().replace(/-/g, "");
  const rand = () => Math.floor(Math.random() * 0xffffffff).toString(36);
  const suffix = `${rand()}${rand()}`.slice(0, 11);
  return `tossinvest-mcp-${date}-${suffix}`;
}

async function fetchOrderDetail(client: TossClient, orderId: string, accountSeq: number): Promise<unknown> {
  try {
    return await client.request({
      path: `/api/v1/orders/${encodeURIComponent(orderId)}`,
      accountSeq
    });
  } catch (error) {
    throw new Error(
      `Order blocked: failed to fetch order ${orderId} to verify the modify amount limit: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Determine an order's currency from its detail response. The Toss order object
 * carries `currency` directly (a required field). Returns undefined when it is
 * absent or unrecognized — we never infer it from the symbol.
 */
function resolveDetailCurrency(detail: unknown): Currency | undefined {
  const currency = readField(detail, "currency");
  return currency === "KRW" || currency === "USD" ? currency : undefined;
}

function readField(response: unknown, key: string): unknown {
  const root =
    response !== null && typeof response === "object"
      ? ((response as Record<string, unknown>).result ?? response)
      : response;

  if (root === null || typeof root !== "object") {
    return undefined;
  }

  return (root as Record<string, unknown>)[key];
}

/** Read a field as a string (numbers are stringified), or undefined. */
function readStringField(response: unknown, key: string): string | undefined {
  const value = readField(response, key);
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}

function formatAmount(amount: number, currency: Currency): string {
  return `${amount.toLocaleString("en-US", { maximumFractionDigits: 4 })} ${currency}`;
}
