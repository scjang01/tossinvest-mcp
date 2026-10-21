import { Decimal } from "decimal.js";
import type { BookedOrder } from "./state.js";
import { unwrap } from "./estimate.js";
/** Return the still-open value using the original booked valuation, never current quotes. */
export function remainingAmount(booked: BookedOrder, detail: unknown): string {
  const root = unwrap(detail);
  if (
    !root ||
    !["KRW", "USD"].includes(
      root.currency ??
        (root.market === "KR"
          ? "KRW"
          : root.market === "US"
            ? "USD"
            : undefined),
    )
  )
    throw new Error("Cannot verify order currency.");
  if (booked.kind === "conditional") {
    const retained = booked.legs.map((leg, i) => {
      const data = i === 0 ? root.first : root.second;
      if (!data || typeof data.status !== "string")
        throw new Error("Cannot verify conditional leg status.");
      return ["WATCHING", "HOLDING", "PAUSED"].includes(data.status)
        ? "0"
        : leg.amount;
    });
    // With OCO, the maximum is shared by both branches: canceling the opposite
    // branch must not refund the amount already committed to a triggered branch.
    return Decimal.max(
      0,
      new Decimal(booked.amount).minus(
        aggregate(booked.group ?? "SINGLE", retained),
      ),
    ).toFixed();
  }

  const qty = root.quantity;
  const filled = root.execution?.filledQuantity;
  if (
    typeof qty !== "string" ||
    typeof filled !== "string" ||
    !new Decimal(qty).isFinite() ||
    !new Decimal(filled).isFinite() ||
    new Decimal(filled).lt(0) ||
    new Decimal(filled).gt(qty)
  )
    throw new Error("Cannot verify filled quantity; reserved budget retained.");
  if (booked.legs[0]?.unitPrice)
    return Decimal.min(
      booked.amount,
      new Decimal(qty).minus(filled).mul(booked.legs[0].unitPrice),
    ).toFixed();
  const filledAmount = root.execution?.filledAmount;
  if (
    typeof filledAmount !== "string" ||
    !new Decimal(filledAmount).isFinite() ||
    new Decimal(filledAmount).lt(0)
  )
    throw new Error(
      "Cannot verify amount-order fills; reserved budget retained.",
    );
  return Decimal.max(
    0,
    new Decimal(booked.amount).minus(filledAmount),
  ).toFixed();
}
export function aggregate(group: string, amounts: string[]): string {
  return (
    group === "OCO"
      ? Decimal.max(...amounts)
      : amounts.reduce((a, v) => a.plus(v), new Decimal(0))
  ).toFixed();
}
