import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { orderCreateSchema, orderModifySchema } from "../src/toss/schemas.js";

describe("order schemas", () => {
  it("treats confirmation as optional at the schema level (enforced by the guard)", () => {
    assert.doesNotThrow(() =>
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

  it("rejects an order carrying both quantity and orderAmount (no silent reinterpretation)", () => {
    assert.throws(() =>
      orderCreateSchema.parse({
        confirmOrderAction: true,
        symbol: "AAPL",
        side: "BUY",
        orderType: "MARKET",
        quantity: "10",
        orderAmount: "100"
      })
    );
  });

  it("rejects a LIMIT order that also carries orderAmount", () => {
    assert.throws(() =>
      orderCreateSchema.parse({
        confirmOrderAction: true,
        symbol: "005930",
        side: "BUY",
        orderType: "LIMIT",
        quantity: "10",
        price: "70000",
        orderAmount: "100"
      })
    );
  });

  it("rejects unknown keys", () => {
    assert.throws(() =>
      orderCreateSchema.parse({
        confirmOrderAction: true,
        symbol: "005930",
        side: "BUY",
        orderType: "LIMIT",
        quantity: "10",
        price: "70000",
        bogusKey: "x"
      })
    );
  });

  it("rejects a MARKET order carrying price (spec: MARKET forbids price)", () => {
    assert.throws(() =>
      orderCreateSchema.parse({
        confirmOrderAction: true,
        symbol: "AAPL",
        side: "BUY",
        orderType: "MARKET",
        quantity: "1",
        price: "100"
      })
    );
  });

  it("rejects an amount-based order carrying timeInForce (not in the amount-based spec schema)", () => {
    assert.throws(() =>
      orderCreateSchema.parse({
        confirmOrderAction: true,
        symbol: "AAPL",
        side: "SELL",
        orderType: "MARKET",
        timeInForce: "DAY",
        orderAmount: "100"
      })
    );
  });

  it("requires a non-empty orderId for modification", () => {
    assert.throws(() =>
      orderModifySchema.parse({
        orderId: "",
        price: "71000"
      })
    );
  });
});
