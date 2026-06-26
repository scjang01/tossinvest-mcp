import type { TossClient } from "../toss/client.js";
import { toFiniteNumber, type Currency } from "./currency.js";

export type OrderForEstimate = {
  symbol: string;
  side: "BUY" | "SELL";
  orderType: "LIMIT" | "MARKET";
  quantity?: string;
  price?: string;
  orderAmount?: string;
};

export type AmountEstimate = {
  amount: number;
  /** Set only when the currency was read authoritatively as a side effect (market orders read the orderbook). */
  currency?: Currency;
};

/**
 * Estimate the notional amount of an order before it reaches the Toss order API.
 *
 * Rules (see docs/trading-guardrails-plan.md):
 *  - LIMIT:                 quantity * price
 *  - amount-based MARKET:   orderAmount
 *  - quantity MARKET buy:   quantity * bestAsk * (1 + bufferPct/100)
 *  - quantity MARKET sell:  quantity * bestBid
 *
 * Anything we cannot price confidently (missing price, empty orderbook) throws
 * so the caller blocks the order. We never fall back to last/current price.
 *
 * Currency is never inferred here. For market orders we read it from the
 * orderbook response (authoritative) and return it; for LIMIT/orderAmount the
 * caller resolves currency separately from a Toss endpoint.
 */
export async function estimateOrderAmount(
  client: TossClient,
  order: OrderForEstimate,
  options: { marketOrderBufferPct: number }
): Promise<AmountEstimate> {
  if (order.orderType === "LIMIT") {
    const quantity = toFiniteNumber(order.quantity);
    const price = toFiniteNumber(order.price);
    if (quantity === undefined || price === undefined) {
      throw new Error("Order blocked: cannot estimate LIMIT order amount without numeric quantity and price.");
    }
    return { amount: quantity * price };
  }

  // MARKET order.
  if (order.orderAmount !== undefined) {
    const orderAmount = toFiniteNumber(order.orderAmount);
    if (orderAmount === undefined) {
      throw new Error("Order blocked: cannot estimate MARKET order amount from a non-numeric orderAmount.");
    }
    return { amount: orderAmount };
  }

  const quantity = toFiniteNumber(order.quantity);
  if (quantity === undefined) {
    throw new Error("Order blocked: cannot estimate quantity-based MARKET order without a numeric quantity.");
  }

  const orderbook = await client.request({ path: "/api/v1/orderbook", query: { symbol: order.symbol } });
  const currency = orderbookCurrency(orderbook);
  if (currency === undefined) {
    throw new Error(`Order blocked: orderbook for ${order.symbol} did not report a recognized currency.`);
  }

  if (order.side === "BUY") {
    const bestAsk = bestPrice(orderbook, "asks");
    if (bestAsk === undefined) {
      throw new Error(
        `Order blocked: best ask unavailable for ${order.symbol}; cannot safely estimate a market buy. Refusing to guess from last price.`
      );
    }
    const buffer = 1 + options.marketOrderBufferPct / 100;
    return { amount: quantity * bestAsk * buffer, currency };
  }

  const bestBid = bestPrice(orderbook, "bids");
  if (bestBid === undefined) {
    throw new Error(
      `Order blocked: best bid unavailable for ${order.symbol}; cannot safely estimate a market sell. Refusing to guess from last price.`
    );
  }
  return { amount: quantity * bestBid, currency };
}

/**
 * Authoritative currency for a symbol, read from GET /api/v1/prices. The Toss
 * PriceResponse requires a `currency` field. Throws (blocks) when it cannot be
 * read — we never infer currency for a financial decision.
 */
export async function fetchSymbolCurrency(client: TossClient, symbol: string): Promise<Currency> {
  const response = await client.request({ path: "/api/v1/prices", query: { symbols: symbol } });
  const root = unwrap(response);
  const list = Array.isArray(root) ? root : Array.isArray(root?.result) ? root.result : undefined;
  const entry = Array.isArray(list) ? list[0] : undefined;
  const currency = getKey(entry, "currency");
  if (currency !== "KRW" && currency !== "USD") {
    throw new Error(`Order blocked: could not read a recognized currency for ${symbol} from the prices API.`);
  }
  return currency;
}

/**
 * Top-of-book price from a Toss orderbook response.
 *
 * Per the Toss Open API schema the response is `{ result: { currency, asks:
 * [{ price, volume }], bids: [{ price, volume }] } }`. The schema description
 * and the spec's own examples disagree on array ordering, so we compute the best
 * ask as the lowest ask price and the best bid as the highest bid price rather
 * than trusting index 0. Returns undefined when no usable price exists.
 */
export function bestPrice(response: unknown, side: "asks" | "bids"): number | undefined {
  const root = unwrap(response);
  if (root === undefined) {
    return undefined;
  }

  const levels = (root as Record<string, unknown>)[side];
  if (!Array.isArray(levels) || levels.length === 0) {
    return undefined;
  }

  const prices: number[] = [];
  for (const level of levels) {
    const price = toFiniteNumber(getKey(level, "price"));
    if (price !== undefined) {
      prices.push(price);
    }
  }

  if (prices.length === 0) {
    return undefined;
  }

  return side === "asks" ? Math.min(...prices) : Math.max(...prices);
}

/** Currency reported by the orderbook response, if it is a recognized value. */
export function orderbookCurrency(response: unknown): Currency | undefined {
  const currency = getKey(unwrap(response), "currency");
  return currency === "KRW" || currency === "USD" ? currency : undefined;
}

function unwrap(response: unknown): any {
  if (response === null || typeof response !== "object") {
    return undefined;
  }
  if (Array.isArray(response)) {
    return response;
  }
  const obj = response as Record<string, unknown>;
  const inner = obj.result;
  if (inner !== undefined && inner !== null && typeof inner === "object") {
    return inner;
  }
  return obj;
}

function getKey(value: unknown, key: string): unknown {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return (value as Record<string, unknown>)[key];
  }
  return undefined;
}
