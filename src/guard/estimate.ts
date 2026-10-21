import { Decimal } from "decimal.js";
import type { TossClient } from "../toss/client.js";
export type Currency = "KRW" | "USD";
Decimal.set({ precision: 80 });
export type OrderForEstimate = {
  symbol: string;
  side: "BUY" | "SELL";
  orderType: "LIMIT" | "MARKET";
  quantity?: string;
  price?: string;
  orderAmount?: string;
};
export type Valuation = {
  amount: string;
  unitPrice?: string;
  quantity?: string;
  currency: Currency;
  referencePrice?: string;
  bufferPct?: number;
};
export function unwrap(value: unknown): any {
  return value && typeof value === "object" && "result" in value
    ? (value as any).result
    : value;
}
export async function fetchPrice(
  client: TossClient,
  symbol: string,
): Promise<{ currency: Currency; lastPrice: string }> {
  const list = unwrap(
    await client.request({
      path: "/api/v1/prices",
      query: { symbols: symbol },
    }),
  );
  const entry = Array.isArray(list)
    ? list.find((v) => v.symbol === symbol)
    : undefined;
  if (
    !entry ||
    !["KRW", "USD"].includes(entry.currency) ||
    !positive(entry.lastPrice)
  )
    throw new Error(
      `Cannot value ${symbol}: missing currency/positive lastPrice.`,
    );
  return entry;
}
export async function fetchSymbolCurrency(
  client: TossClient,
  symbol: string,
): Promise<Currency> {
  // Stock metadata remains available independently of live prices.
  const entries = unwrap(
    await client.request({
      path: "/api/v1/stocks",
      query: { symbols: symbol },
    }),
  );
  const entry = Array.isArray(entries)
    ? entries.find((v) => v.symbol === symbol)
    : undefined;
  if (!entry || !["KRW", "USD"].includes(entry.currency))
    throw new Error(`Cannot determine currency for ${symbol}.`);
  return entry.currency;
}
export function positive(value: unknown): boolean {
  try {
    return (
      (typeof value === "string" || typeof value === "number") &&
      new Decimal(value).isFinite() &&
      new Decimal(value).gt(0)
    );
  } catch {
    return false;
  }
}
export async function estimateOrderAmount(
  client: TossClient,
  order: OrderForEstimate,
  options: {
    marketOrderBufferPct: number;
    currency?: Currency;
    quote?: { currency: Currency; lastPrice: string };
  },
): Promise<Valuation> {
  if (order.orderAmount !== undefined)
    return {
      amount: new Decimal(order.orderAmount).toFixed(),
      currency:
        options.currency ?? (await fetchSymbolCurrency(client, order.symbol)),
    };
  if (!positive(order.quantity))
    throw new Error("Cannot estimate without positive quantity.");
  if (order.orderType === "LIMIT") {
    if (!positive(order.price))
      throw new Error("Cannot estimate LIMIT without positive price.");
    return {
      amount: new Decimal(order.quantity!).mul(order.price!).toFixed(),
      unitPrice: order.price,
      quantity: order.quantity,
      currency:
        options.currency ?? (await fetchSymbolCurrency(client, order.symbol)),
    };
  }
  const price = options.quote ?? (await fetchPrice(client, order.symbol));
  const unit = new Decimal(price.lastPrice).mul(
    new Decimal(1).plus(
      new Decimal(options.marketOrderBufferPct)
        .div(100)
        .mul(order.side === "BUY" ? 1 : -1),
    ),
  );
  return {
    amount: unit.mul(order.quantity!).toFixed(),
    unitPrice: unit.toFixed(),
    quantity: order.quantity,
    currency: price.currency,
    referencePrice: price.lastPrice,
    bufferPct: options.marketOrderBufferPct,
  };
}
