import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { orderCreateSchema, orderModifySchema } from "../src/toss/schemas.js";

describe("order schemas", () => {
  it("requires explicit confirmation for order creation", () => {
    assert.throws(() =>
      orderCreateSchema.parse({
        symbol: "005930",
        side: "BUY",
        orderType: "LIMIT",
        quantity: "10",
        price: "70000"
      })
    );
  });

  it("accepts quantity-based order creation", () => {
    assert.deepEqual(
      orderCreateSchema.parse({
        confirmOrderAction: true,
        symbol: "005930",
        side: "BUY",
        orderType: "LIMIT",
        quantity: "10",
        price: "70000"
      }).symbol,
      "005930"
    );
  });

  it("accepts amount-based US market order creation", () => {
    const parsed = orderCreateSchema.parse({
      confirmOrderAction: true,
      symbol: "AAPL",
      side: "BUY",
      orderType: "MARKET",
      orderAmount: "100.5"
    });

    assert.ok("orderAmount" in parsed);
    assert.equal(parsed.orderAmount, "100.5");
  });

  it("requires explicit confirmation for order modification", () => {
    assert.throws(() =>
      orderModifySchema.parse({
        orderId: "order-1",
        orderType: "LIMIT",
        price: "71000"
      })
    );
  });
});
