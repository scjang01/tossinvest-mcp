import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadConfig, resolveAccountSeq } from "../src/config.js";

const BASE_ENV = {
  TOSSINVEST_API_KEY: "api-key",
  TOSSINVEST_SECRET_KEY: "secret-key"
};

describe("config", () => {
  it("parses required environment variables and conservative defaults", () => {
    const config = loadConfig({ ...BASE_ENV });

    assert.equal(config.clientId, "api-key");
    assert.equal(config.clientSecret, "secret-key");
    assert.equal(config.defaultAccountSeq, 1);
    assert.equal(config.baseUrl, "https://openapi.tossinvest.com");
    assert.equal(config.tradingEnabled, false);

    // Guardrail defaults.
    assert.equal(config.requireOrderConfirmation, true);
    assert.equal(config.allowSellOrders, false);
    assert.equal(config.allowMarketOrders, false);
    assert.equal(config.marketOrderBufferPct, 5);
    assert.equal(config.lockAccount, true);
    assert.equal(config.maxOrderAmountKrw, undefined);
    assert.equal(config.maxOrderAmountUsd, undefined);
    assert.equal(config.dailyMaxOrderAmountKrw, undefined);
    assert.equal(config.dailyMaxOrderAmountUsd, undefined);
    assert.equal(config.dailyMaxOrderCount, undefined);
    assert.equal(config.allowedSymbols, undefined);
    assert.equal(config.guardStatePath, undefined);
  });

  it("parses account fallback and trading gate", () => {
    const config = loadConfig({
      ...BASE_ENV,
      TOSSINVEST_ACCOUNT: "3",
      TOSSINVEST_ENABLE_TRADING: "true",
      TOSSINVEST_BASE_URL: "https://example.com/"
    });

    assert.equal(config.defaultAccountSeq, 3);
    assert.equal(config.tradingEnabled, true);
    assert.equal(config.baseUrl, "https://example.com");
  });

  it("parses guardrail booleans, amounts, counts, and symbol allowlist", () => {
    const config = loadConfig({
      ...BASE_ENV,
      TOSSINVEST_REQUIRE_ORDER_CONFIRMATION: "false",
      TOSSINVEST_ALLOW_SELL_ORDERS: "true",
      TOSSINVEST_ALLOW_MARKET_ORDERS: "true",
      TOSSINVEST_MARKET_ORDER_BUFFER_PCT: "3",
      TOSSINVEST_LOCK_ACCOUNT: "false",
      TOSSINVEST_MAX_ORDER_AMOUNT_KRW: "1000000",
      TOSSINVEST_MAX_ORDER_AMOUNT_USD: "500.25",
      TOSSINVEST_DAILY_MAX_ORDER_AMOUNT_KRW: "5000000",
      TOSSINVEST_DAILY_MAX_ORDER_AMOUNT_USD: "2000",
      TOSSINVEST_DAILY_MAX_ORDER_COUNT: "10",
      TOSSINVEST_ALLOWED_SYMBOLS: "005930, aapl ,voo",
      TOSSINVEST_GUARD_STATE_PATH: "/tmp/guard.json"
    });

    assert.equal(config.requireOrderConfirmation, false);
    assert.equal(config.allowSellOrders, true);
    assert.equal(config.allowMarketOrders, true);
    assert.equal(config.marketOrderBufferPct, 3);
    assert.equal(config.lockAccount, false);
    assert.equal(config.maxOrderAmountKrw, 1000000);
    assert.equal(config.maxOrderAmountUsd, 500.25);
    assert.equal(config.dailyMaxOrderAmountKrw, 5000000);
    assert.equal(config.dailyMaxOrderAmountUsd, 2000);
    assert.equal(config.dailyMaxOrderCount, 10);
    assert.deepEqual(config.allowedSymbols, ["005930", "AAPL", "VOO"]);
    assert.equal(config.guardStatePath, "/tmp/guard.json");
  });

  it("treats empty-string env values as unset (so .env templates use defaults)", () => {
    const config = loadConfig({
      ...BASE_ENV,
      TOSSINVEST_BASE_URL: "",
      TOSSINVEST_ENABLE_TRADING: "",
      TOSSINVEST_ALLOW_SELL_ORDERS: "",
      TOSSINVEST_MAX_ORDER_AMOUNT_KRW: "",
      TOSSINVEST_ALLOWED_SYMBOLS: ""
    });

    assert.equal(config.baseUrl, "https://openapi.tossinvest.com");
    assert.equal(config.tradingEnabled, false);
    assert.equal(config.allowSellOrders, false);
    assert.equal(config.maxOrderAmountKrw, undefined);
    assert.equal(config.allowedSymbols, undefined);
  });

  it("rejects invalid guard boolean values", () => {
    assert.throws(() => loadConfig({ ...BASE_ENV, TOSSINVEST_ALLOW_SELL_ORDERS: "yes" }));
  });

  it("rejects invalid guard numeric values", () => {
    assert.throws(() => loadConfig({ ...BASE_ENV, TOSSINVEST_MAX_ORDER_AMOUNT_KRW: "-5" }));
    assert.throws(() => loadConfig({ ...BASE_ENV, TOSSINVEST_DAILY_MAX_ORDER_COUNT: "2.5" }));
  });

  it("prefers tool account over default account", () => {
    assert.equal(resolveAccountSeq(7, 3), 7);
  });

  it("uses default account when tool account is omitted", () => {
    assert.equal(resolveAccountSeq(undefined, 3), 3);
  });

  it("falls back to account 1 when no account is provided", () => {
    assert.equal(resolveAccountSeq(undefined, undefined), 1);
  });
});
