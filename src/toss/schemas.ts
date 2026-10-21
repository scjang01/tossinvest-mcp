import { z } from "zod";
import type { Config } from "../config.js";

export const symbolSchema = z.string().regex(/^[A-Za-z0-9.-]+$/);
export const symbolsSchema = z.string().refine((v) => {
  const a = v.split(",");
  return a.length <= 200 && a.every((s) => symbolSchema.safeParse(s).success);
}, "Provide 1 to 200 comma-separated symbols, without empty entries.");
export const accountSeqSchema = z.number().int().positive();
export const currencySchema = z.enum(["KRW", "USD"]);
export const dateSchema = z.iso.date();
export const decimalSchema = z
  .string()
  .max(30)
  .regex(/^\d+(\.\d+)?$/)
  .refine((v) => /[1-9]/.test(v), "Must be positive");
export const integerSchema = z
  .string()
  .max(30)
  .regex(/^\d+$/)
  .refine((v) => /[1-9]/.test(v), "Must be positive");
export const clientOrderIdSchema = z
  .string()
  .min(1)
  .max(36)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const highValueSchema = z
  .boolean()
  .optional()
  .describe(
    "Toss requires true for orders it values at KRW 100 million or more. Set true only when the user has acknowledged and authorized that high-value order; never automatically enable it after an error.",
  );
export const accountDescription =
  "When accountSeq is required, call toss_get_accounts first. Select the user's intended account; if multiple accounts are ambiguous, ask the user.";
export function accountInputSchema(config: Config) {
  return {
    accountSeq:
      config.defaultAccountSeq === undefined
        ? accountSeqSchema.describe(accountDescription)
        : z
            .literal(config.defaultAccountSeq)
            .optional()
            .describe("Fixed by TOSSINVEST_ACCOUNT; omit this field."),
  };
}
const fields = {
  accountSeq: accountSeqSchema.optional(),
  clientOrderId: clientOrderIdSchema.optional(),
  symbol: symbolSchema,
  side: z.enum(["BUY", "SELL"]),
  orderType: z.enum(["LIMIT", "MARKET"]),
  timeInForce: z.enum(["DAY", "CLS", "OPG"]).optional(),
  quantity: decimalSchema.optional(),
  price: decimalSchema.optional(),
  orderAmount: decimalSchema.optional(),
  confirmHighValueOrder: highValueSchema,
};
export const orderCreateSchema = z
  .strictObject(fields)
  .superRefine((v, ctx) => {
    if ((v.quantity === undefined) === (v.orderAmount === undefined))
      ctx.addIssue({
        code: "custom",
        message: "Provide exactly one of quantity or orderAmount.",
      });
    if (
      v.orderType === "LIMIT" &&
      (v.price === undefined ||
        v.orderAmount !== undefined ||
        !integerSchema.safeParse(v.quantity).success)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "LIMIT requires positive integer quantity and price; orderAmount is forbidden.",
      });
    if (v.orderType === "MARKET" && v.price !== undefined)
      ctx.addIssue({ code: "custom", message: "MARKET forbids price." });
    if (v.orderAmount !== undefined && v.timeInForce !== undefined)
      ctx.addIssue({
        code: "custom",
        message: "Amount orders forbid timeInForce.",
      });
    if (
      v.quantity?.includes(".") &&
      !integerSchema.safeParse(v.quantity).success &&
      (v.side !== "SELL" ||
        v.orderType !== "MARKET" ||
        (v.quantity.split(".")[1]?.length ?? 0) > 6)
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Fractional quantity (max 6 places) is only supported for US MARKET SELL.",
      });
  });
export const orderCreateFields = fields;
export const orderModifySchema = z.strictObject({
  accountSeq: accountSeqSchema.optional(),
  orderId: z.string().min(1),
  orderType: z.enum(["LIMIT", "MARKET"]).optional(),
  quantity: integerSchema.optional(),
  price: decimalSchema.optional(),
  confirmHighValueOrder: highValueSchema,
});
export const orderCancelSchema = z.strictObject({
  accountSeq: accountSeqSchema.optional(),
  orderId: z.string().min(1),
});
const condition = z.strictObject({
  orderSide: z.enum(["BUY", "SELL"]),
  triggerPrice: decimalSchema,
  orderPrice: decimalSchema.optional(),
});
export const conditionalFields = {
  type: z.enum(["SINGLE", "OCO", "OTO"]),
  quantity: decimalSchema,
  orderType: z.enum(["LIMIT", "MARKET"]),
  expireDate: dateSchema,
  first: condition,
  second: condition.nullish(),
  confirmHighValueOrder: highValueSchema,
};
const refineConditional = (
  v: z.infer<typeof conditionalModifySchema>,
  ctx: z.RefinementCtx,
) => {
  if (
    (v.type === "SINGLE" && v.second != null) ||
    (v.type !== "SINGLE" && v.second == null)
  )
    ctx.addIssue({
      code: "custom",
      message: "SINGLE uses first only; OCO/OTO require second.",
    });
  if (v.type !== "SINGLE" && v.orderType !== "LIMIT")
    ctx.addIssue({ code: "custom", message: "OCO/OTO require LIMIT." });
  if (
    v.type === "OCO" &&
    (v.first.orderSide !== "SELL" || v.second?.orderSide !== "SELL")
  )
    ctx.addIssue({ code: "custom", message: "OCO requires two SELL legs." });
  if (
    v.type === "OTO" &&
    (v.first.orderSide !== "BUY" || v.second?.orderSide !== "SELL")
  )
    ctx.addIssue({ code: "custom", message: "OTO requires BUY then SELL." });
  for (const leg of [v.first, v.second].filter(Boolean))
    if ((v.orderType === "LIMIT") !== (leg!.orderPrice !== undefined))
      ctx.addIssue({
        code: "custom",
        message: "LIMIT requires orderPrice on each leg; MARKET forbids it.",
      });
};
export const conditionalModifySchema = z.strictObject({ ...conditionalFields });
export const conditionalCreateSchema = z
  .strictObject({
    ...conditionalFields,
    symbol: symbolSchema,
    clientOrderId: clientOrderIdSchema.optional(),
  })
  .superRefine(refineConditional);
export const validatedConditionalModifySchema =
  conditionalModifySchema.superRefine(refineConditional);
export function withoutKeys<
  T extends Record<string, unknown>,
  K extends keyof T,
>(v: T, keys: K[]): Omit<T, K> {
  const out = { ...v };
  for (const k of keys) delete out[k];
  return out;
}
