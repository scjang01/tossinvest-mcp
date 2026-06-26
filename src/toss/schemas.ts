import { z } from "zod";

const symbolPattern = /^[A-Za-z0-9.-]+$/;
const symbolsPattern = /^[A-Za-z0-9.,-]+$/;
const decimalPattern = /^\d+(\.\d+)?$/;
const integerDecimalPattern = /^\d+$/;
const clientOrderIdPattern = /^[a-zA-Z0-9-_]+$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

export const symbolSchema = z.string().regex(symbolPattern);
export const symbolsSchema = z.string().regex(symbolsPattern);
export const accountSeqSchema = z.number().int().positive().optional();
export const currencySchema = z.enum(["KRW", "USD"]);
export const dateSchema = z.string().regex(datePattern);

// Confirmation is enforced by the guard layer based on
// TOSSINVEST_REQUIRE_ORDER_CONFIRMATION, not by the schema.
const confirmOrderActionSchema = z.boolean().optional();

export const accountInputSchema = {
  accountSeq: accountSeqSchema.describe("Toss accountSeq. If omitted, TOSSINVEST_ACCOUNT is used.")
};

// Each branch is .strict(): unknown keys are an error, not silently stripped.
// This enforces quantity XOR orderAmount — e.g. a MARKET order carrying BOTH
// fails every branch instead of being silently reinterpreted as a quantity order.
export const orderCreateSchema = z.union([
  z
    .object({
      accountSeq: accountSeqSchema,
      confirmOrderAction: confirmOrderActionSchema,
      clientOrderId: z.string().max(36).regex(clientOrderIdPattern).optional(),
      symbol: symbolSchema,
      side: z.enum(["BUY", "SELL"]),
      orderType: z.literal("LIMIT"),
      timeInForce: z.enum(["DAY", "CLS"]).optional(),
      quantity: z.string().regex(integerDecimalPattern).max(30),
      price: z.string().regex(decimalPattern).max(30),
      confirmHighValueOrder: z.boolean().optional()
    })
    .strict(),
  z
    .object({
      accountSeq: accountSeqSchema,
      confirmOrderAction: confirmOrderActionSchema,
      clientOrderId: z.string().max(36).regex(clientOrderIdPattern).optional(),
      symbol: symbolSchema,
      side: z.enum(["BUY", "SELL"]),
      orderType: z.literal("MARKET"),
      timeInForce: z.enum(["DAY", "CLS"]).optional(),
      // No price: the spec forbids price on MARKET orders (Toss returns
      // 400 invalid-request). .strict() rejects it before it reaches Toss.
      quantity: z.string().regex(decimalPattern).max(30),
      confirmHighValueOrder: z.boolean().optional()
    })
    .strict(),
  z
    .object({
      accountSeq: accountSeqSchema,
      confirmOrderAction: confirmOrderActionSchema,
      clientOrderId: z.string().max(36).regex(clientOrderIdPattern).optional(),
      symbol: symbolSchema,
      side: z.enum(["BUY", "SELL"]),
      orderType: z.literal("MARKET"),
      // No timeInForce: the amount-based (US MARKET) spec schema does not
      // define it, so we never send a field the spec doesn't list.
      orderAmount: z.string().regex(decimalPattern).max(30),
      confirmHighValueOrder: z.boolean().optional()
    })
    .strict()
]);

export const orderModifySchema = z.object({
  accountSeq: accountSeqSchema,
  confirmOrderAction: confirmOrderActionSchema,
  orderId: z.string().min(1),
  orderType: z.enum(["LIMIT", "MARKET"]).optional(),
  quantity: z.string().regex(integerDecimalPattern).max(30).optional(),
  price: z.string().regex(decimalPattern).max(30).optional(),
  confirmHighValueOrder: z.boolean().optional()
});

export const orderCancelSchema = z.object({
  accountSeq: accountSeqSchema,
  confirmOrderAction: confirmOrderActionSchema,
  orderId: z.string().min(1)
});

export function withoutKeys<T extends Record<string, unknown>, K extends keyof T>(value: T, keys: K[]): Omit<T, K> {
  const next = { ...value };

  for (const key of keys) {
    delete next[key];
  }

  return next;
}
