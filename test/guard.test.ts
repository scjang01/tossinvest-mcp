import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";

import { loadConfig, type Config } from "../src/config.js";
import { bestPrice, estimateOrderAmount, orderbookCurrency } from "../src/guard/estimate.js";
import {
  buildOrderRecord,
  generateClientOrderId,
  guardCancelOrder,
  guardCreateOrder,
  guardModifyOrder,
  withOrderLock
} from "../src/guard/index.js";
import { dailyTotals, kstDate, readState, recordOrder } from "../src/guard/state.js";
import type { TossClient } from "../src/toss/client.js";

const tempDir = mkdtempSync(join(tmpdir(), "tossinvest-guard-"));
let stateCounter = 0;

function nextStatePath(): string {
  stateCounter += 1;
  return join(tempDir, `guard-${stateCounter}.json`);
}

function makeConfig(overrides: Record<string, string> = {}): Config {
  return loadConfig({
    TOSSINVEST_API_KEY: "api-key",
    TOSSINVEST_SECRET_KEY: "secret-key",
    TOSSINVEST_ENABLE_TRADING: "true",
    TOSSINVEST_GUARD_STATE_PATH: nextStatePath(),
    ...overrides
  });
}

function clientReturning(response: unknown): TossClient {
  return { request: async () => response } as unknown as TossClient;
}

/** Client that only answers GET /api/v1/prices with the given currency (for LIMIT/orderAmount currency resolution). */
function pricesClient(currency: "KRW" | "USD"): TossClient {
  return {
    request: async ({ path }: { path: string }) => {
      if (path === "/api/v1/prices") {
        return { result: [{ symbol: "TEST", lastPrice: "1", currency }] };
      }
      throw new Error(`Unexpected API call: ${path}`);
    }
  } as unknown as TossClient;
}

const throwingClient = {
  request: async () => {
    throw new Error("API should not be called");
  }
} as unknown as TossClient;

const BASE_BUY = {
  rawAccountSeq: undefined,
  resolvedAccountSeq: 1,
  confirmOrderAction: true as boolean | undefined,
  symbol: "005930",
  side: "BUY" as const,
  orderType: "LIMIT" as const,
  quantity: "10",
  price: "1000"
};

describe("estimateOrderAmount", () => {
  it("estimates a LIMIT order as quantity * price without calling the API or reading currency", async () => {
    const result = await estimateOrderAmount(throwingClient, { ...BASE_BUY }, { marketOrderBufferPct: 5 });
    assert.deepEqual(result, { amount: 10000 });
  });

  it("estimates an amount-based MARKET order from orderAmount", async () => {
    const result = await estimateOrderAmount(
      throwingClient,
      { symbol: "AAPL", side: "BUY", orderType: "MARKET", orderAmount: "250.5" },
      { marketOrderBufferPct: 5 }
    );
    assert.deepEqual(result, { amount: 250.5 });
  });

  it("estimates a quantity MARKET buy from best ask plus buffer using the orderbook currency", async () => {
    const client = clientReturning({
      result: { currency: "USD", asks: [{ price: "100" }, { price: "101" }], bids: [{ price: "99" }] }
    });
    const result = await estimateOrderAmount(
      client,
      { symbol: "AAPL", side: "BUY", orderType: "MARKET", quantity: "10" },
      { marketOrderBufferPct: 5 }
    );
    assert.equal(result.currency, "USD");
    assert.equal(result.amount, 10 * 100 * 1.05);
  });

  it("blocks a market order when the orderbook reports no recognized currency", async () => {
    const client = clientReturning({ result: { asks: [{ price: "100" }], bids: [{ price: "99" }] } });
    await assert.rejects(
      () =>
        estimateOrderAmount(
          client,
          { symbol: "AAPL", side: "BUY", orderType: "MARKET", quantity: "10" },
          { marketOrderBufferPct: 5 }
        ),
      /did not report a recognized currency/
    );
  });

  it("blocks a quantity MARKET buy when best ask is unavailable", async () => {
    const client = clientReturning({ result: { currency: "USD", bids: [{ price: "99" }] } });
    await assert.rejects(
      () =>
        estimateOrderAmount(
          client,
          { symbol: "AAPL", side: "BUY", orderType: "MARKET", quantity: "10" },
          { marketOrderBufferPct: 5 }
        ),
      /best ask unavailable/
    );
  });
});

describe("bestPrice", () => {
  it("returns the lowest ask and highest bid regardless of array order", () => {
    const book = { result: { asks: [{ price: "100" }, { price: "99" }], bids: [{ price: 98 }, { price: 97 }] } };
    assert.equal(bestPrice(book, "asks"), 99);
    assert.equal(bestPrice(book, "bids"), 98);
  });

  it("handles the unwrapped (no result) shape", () => {
    assert.equal(bestPrice({ asks: [{ price: 55 }] }, "asks"), 55);
  });

  it("returns undefined when the level array is missing or empty", () => {
    assert.equal(bestPrice({ result: { asks: [] } }, "asks"), undefined);
    assert.equal(bestPrice({ foo: "bar" }, "asks"), undefined);
    assert.equal(bestPrice(null, "asks"), undefined);
  });
});

describe("orderbookCurrency", () => {
  it("reads a recognized currency from the response", () => {
    assert.equal(orderbookCurrency({ result: { currency: "USD" } }), "USD");
    assert.equal(orderbookCurrency({ currency: "KRW" }), "KRW");
  });

  it("returns undefined for missing or unrecognized currency", () => {
    assert.equal(orderbookCurrency({ result: {} }), undefined);
    assert.equal(orderbookCurrency({ currency: "EUR" }), undefined);
  });
});

describe("guardCreateOrder", () => {
  it("allows a compliant order and returns the estimate with API-resolved currency", async () => {
    const result = await guardCreateOrder(pricesClient("KRW"), makeConfig(), { ...BASE_BUY });
    assert.deepEqual(result, { currency: "KRW", estimatedAmount: 10000 });
  });

  it("blocks when confirmation is missing and required", async () => {
    await assert.rejects(
      () => guardCreateOrder(throwingClient, makeConfig(), { ...BASE_BUY, confirmOrderAction: undefined }),
      /confirmOrderAction=true is required/
    );
  });

  it("applies other guardrails even when confirmation is disabled", async () => {
    const config = makeConfig({ TOSSINVEST_REQUIRE_ORDER_CONFIRMATION: "false" });
    await assert.rejects(
      () => guardCreateOrder(throwingClient, config, { ...BASE_BUY, confirmOrderAction: undefined, side: "SELL" }),
      /sell orders are disabled/
    );
  });

  it("blocks a different accountSeq when the account is locked", async () => {
    await assert.rejects(
      () => guardCreateOrder(throwingClient, makeConfig(), { ...BASE_BUY, rawAccountSeq: 9 }),
      /account is locked/
    );
  });

  it("blocks sell orders by default", async () => {
    await assert.rejects(
      () => guardCreateOrder(throwingClient, makeConfig(), { ...BASE_BUY, side: "SELL" }),
      /sell orders are disabled/
    );
  });

  it("blocks market orders by default, including orderAmount market orders", async () => {
    await assert.rejects(
      () =>
        guardCreateOrder(throwingClient, makeConfig(), {
          ...BASE_BUY,
          orderType: "MARKET",
          quantity: undefined,
          price: undefined,
          orderAmount: "100"
        }),
      /market orders are disabled/
    );
  });

  it("blocks symbols outside the allowlist", async () => {
    const config = makeConfig({ TOSSINVEST_ALLOWED_SYMBOLS: "AAPL,VOO" });
    await assert.rejects(() => guardCreateOrder(throwingClient, config, { ...BASE_BUY }), /not in TOSSINVEST_ALLOWED_SYMBOLS/);
  });

  it("blocks when the estimated amount exceeds the per-order KRW limit", async () => {
    const config = makeConfig({ TOSSINVEST_MAX_ORDER_AMOUNT_KRW: "5000" });
    await assert.rejects(() => guardCreateOrder(pricesClient("KRW"), config, { ...BASE_BUY }), /exceeds the per-order limit/);
  });

  it("blocks when the daily order count limit is reached", async () => {
    const config = makeConfig({ TOSSINVEST_DAILY_MAX_ORDER_COUNT: "1" });
    recordOrder(
      config.guardStatePath!,
      buildOrderRecord({ account: 1, symbol: "005930", side: "BUY", orderType: "LIMIT", currency: "KRW", estimatedAmount: 1 })
    );
    await assert.rejects(() => guardCreateOrder(pricesClient("KRW"), config, { ...BASE_BUY }), /daily order count limit/);
  });

  it("blocks when the daily KRW amount limit would be exceeded", async () => {
    const config = makeConfig({ TOSSINVEST_DAILY_MAX_ORDER_AMOUNT_KRW: "15000" });
    recordOrder(
      config.guardStatePath!,
      buildOrderRecord({ account: 1, symbol: "005930", side: "BUY", orderType: "LIMIT", currency: "KRW", estimatedAmount: 10000 })
    );
    await assert.rejects(() => guardCreateOrder(pricesClient("KRW"), config, { ...BASE_BUY }), /daily KRW amount limit/);
  });

  it("blocks order creation when the guard state file is corrupt", async () => {
    const config = makeConfig({ TOSSINVEST_DAILY_MAX_ORDER_COUNT: "5" });
    writeFileSync(config.guardStatePath!, "{ not json", "utf8");
    await assert.rejects(() => guardCreateOrder(pricesClient("KRW"), config, { ...BASE_BUY }), /not valid JSON/);
  });
});

describe("guardModifyOrder", () => {
  const krLimit = { result: { symbol: "005930", currency: "KRW", orderType: "LIMIT", quantity: "10", price: "1000" } };
  const usLimit = { result: { symbol: "AAPL", currency: "USD", orderType: "LIMIT", quantity: "5", price: "50" } };

  it("builds a KR replacement body with orderType and explicit quantity/price", async () => {
    const result = await guardModifyOrder(clientReturning(krLimit), makeConfig(), {
      rawAccountSeq: undefined,
      resolvedAccountSeq: 1,
      confirmOrderAction: true,
      orderId: "order-1",
      quantity: "10",
      price: "2000"
    });
    assert.deepEqual(result, { currency: "KRW", orderType: "LIMIT", quantity: "10", price: "2000" });
  });

  it("preserves the existing LIMIT price when only quantity changes", async () => {
    const result = await guardModifyOrder(clientReturning(krLimit), makeConfig(), {
      rawAccountSeq: undefined,
      resolvedAccountSeq: 1,
      confirmOrderAction: true,
      orderId: "order-1",
      quantity: "7"
    });
    assert.deepEqual(result, { currency: "KRW", orderType: "LIMIT", quantity: "7", price: "1000" });
  });

  it("builds a US replacement body with price only (no quantity)", async () => {
    const result = await guardModifyOrder(clientReturning(usLimit), makeConfig(), {
      rawAccountSeq: undefined,
      resolvedAccountSeq: 1,
      confirmOrderAction: true,
      orderId: "order-1",
      price: "60"
    });
    assert.deepEqual(result, { currency: "USD", orderType: "LIMIT", quantity: undefined, price: "60" });
  });

  it("blocks modification for US stocks when quantity is provided", async () => {
    await assert.rejects(
      () =>
        guardModifyOrder(clientReturning(usLimit), makeConfig(), {
          rawAccountSeq: undefined,
          resolvedAccountSeq: 1,
          confirmOrderAction: true,
          orderId: "order-1",
          quantity: "5",
          price: "55"
        }),
      /미국 주식 주문 정정은 수량\(quantity\) 정정을 지원하지 않으며/
    );
  });

  it("blocks modification for KR stocks when quantity is omitted", async () => {
    await assert.rejects(
      () =>
        guardModifyOrder(clientReturning(krLimit), makeConfig(), {
          rawAccountSeq: undefined,
          resolvedAccountSeq: 1,
          confirmOrderAction: true,
          orderId: "order-1",
          price: "1100"
        }),
      /국내 주식 주문 정정은 수량\(quantity\) 정정이 필수입니다/
    );
  });

  it("blocks a price change on a MARKET order", async () => {
    const market = { result: { symbol: "005930", currency: "KRW", orderType: "MARKET", quantity: "10", price: null } };
    await assert.rejects(
      () =>
        guardModifyOrder(clientReturning(market), makeConfig(), {
          rawAccountSeq: undefined,
          resolvedAccountSeq: 1,
          confirmOrderAction: true,
          orderId: "order-1",
          quantity: "10",
          price: "1000"
        }),
      /시장가\(MARKET\) 주문 정정에는 가격\(price\)을 전달할 수 없습니다/
    );
  });

  it("blocks when the order type cannot be determined", async () => {
    const noType = { result: { symbol: "005930", currency: "KRW", quantity: "10", price: "1000" } };
    await assert.rejects(
      () =>
        guardModifyOrder(clientReturning(noType), makeConfig(), {
          rawAccountSeq: undefined,
          resolvedAccountSeq: 1,
          confirmOrderAction: true,
          orderId: "order-1",
          quantity: "10"
        }),
      /cannot determine the order type/
    );
  });

  it("verifies the modify amount limit using the fetched order detail", async () => {
    const config = makeConfig({ TOSSINVEST_MAX_ORDER_AMOUNT_KRW: "5000" });
    // input price omitted -> uses existing price 1000; existing qty 10 -> 10000 > 5000.
    await assert.rejects(
      () =>
        guardModifyOrder(clientReturning(krLimit), config, {
          rawAccountSeq: undefined,
          resolvedAccountSeq: 1,
          confirmOrderAction: true,
          orderId: "order-1",
          quantity: "10"
        }),
      /exceeds the per-order limit/
    );
  });

  it("uses the USD currency reported by the order detail for the amount limit", async () => {
    const config = makeConfig({ TOSSINVEST_MAX_ORDER_AMOUNT_USD: "100" });
    // US: quantity from detail (5) * price 50 = 250 > 100.
    await assert.rejects(
      () =>
        guardModifyOrder(clientReturning(usLimit), config, {
          rawAccountSeq: undefined,
          resolvedAccountSeq: 1,
          confirmOrderAction: true,
          orderId: "order-1"
        }),
      /exceeds the per-order limit/
    );
  });

  it("blocks modification when the detail omits a recognized currency", async () => {
    const config = makeConfig({ TOSSINVEST_MAX_ORDER_AMOUNT_KRW: "5000" });
    const client = clientReturning({ result: { symbol: "005930", orderType: "LIMIT", quantity: "1", price: "1" } });
    await assert.rejects(
      () =>
        guardModifyOrder(client, config, {
          rawAccountSeq: undefined,
          resolvedAccountSeq: 1,
          confirmOrderAction: true,
          orderId: "order-1",
          price: "1"
        }),
      /cannot determine the currency/
    );
  });
});

describe("guardCancelOrder", () => {
  it("blocks cancel without confirmation but is not affected by sell/market settings", () => {
    assert.throws(
      () => guardCancelOrder(makeConfig(), { rawAccountSeq: undefined, confirmOrderAction: undefined }),
      /confirmOrderAction=true is required/
    );
    assert.doesNotThrow(() => guardCancelOrder(makeConfig(), { rawAccountSeq: undefined, confirmOrderAction: true }));
  });
});

describe("state helpers", () => {
  afterEach(() => undefined);

  it("treats a missing state file as empty history", () => {
    assert.deepEqual(readState(nextStatePath()), []);
  });

  it("round-trips records and aggregates daily totals", () => {
    const path = nextStatePath();
    const today = kstDate();
    recordOrder(path, buildOrderRecord({ account: 1, symbol: "005930", side: "BUY", orderType: "LIMIT", currency: "KRW", estimatedAmount: 100 }));
    recordOrder(path, buildOrderRecord({ account: 1, symbol: "AAPL", side: "BUY", orderType: "MARKET", currency: "USD", estimatedAmount: 5 }));

    const totals = dailyTotals(readState(path), today);
    assert.equal(totals.count, 2);
    assert.equal(totals.amountByCurrency.KRW, 100);
    assert.equal(totals.amountByCurrency.USD, 5);
  });

  it("ignores records from other dates", () => {
    const records = [
      buildOrderRecord({ account: 1, symbol: "005930", side: "BUY", orderType: "LIMIT", currency: "KRW", estimatedAmount: 100 })
    ];
    assert.equal(dailyTotals(records, "1999-01-01").count, 0);
  });

  it("formats KST date as YYYY-MM-DD", () => {
    assert.match(kstDate(), /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("withOrderLock", () => {
  it("runs critical sections one at a time", async () => {
    let active = 0;
    let maxActive = 0;
    const task = () =>
      withOrderLock(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active -= 1;
      });
    await Promise.all([task(), task(), task(), task()]);
    assert.equal(maxActive, 1);
    assert.equal(active, 0);
  });

  it("keeps serializing after a section throws", async () => {
    await assert.rejects(() => withOrderLock(async () => { throw new Error("boom"); }));
    const result = await withOrderLock(async () => 42);
    assert.equal(result, 42);
  });
});

describe("generateClientOrderId", () => {
  it("uses the expected prefix and fits the 36-char schema limit", () => {
    const id = generateClientOrderId();
    assert.match(id, /^tossinvest-mcp-\d{8}-[a-z0-9]+$/);
    assert.ok(id.length <= 36, `clientOrderId too long: ${id}`);
  });
});
