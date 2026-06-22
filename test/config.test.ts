import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { loadConfig, resolveAccountSeq } from "../src/config.js";

describe("config", () => {
  it("parses required environment variables and defaults", () => {
    const config = loadConfig({
      TOSSINVEST_API_KEY: "api-key",
      TOSSINVEST_SECRET_KEY: "secret-key"
    });

    assert.deepEqual(
      {
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        defaultAccountSeq: config.defaultAccountSeq,
        baseUrl: config.baseUrl,
        tradingEnabled: config.tradingEnabled,
        yoloTrading: config.yoloTrading
      },
      {
      clientId: "api-key",
      clientSecret: "secret-key",
      defaultAccountSeq: 1,
      baseUrl: "https://openapi.tossinvest.com",
      tradingEnabled: false,
      yoloTrading: false
      }
    );
  });

  it("parses account fallback and trading gates", () => {
    const config = loadConfig({
      TOSSINVEST_API_KEY: "api-key",
      TOSSINVEST_SECRET_KEY: "secret-key",
      TOSSINVEST_ACCOUNT: "3",
      TOSSINVEST_ENABLE_TRADING: "true",
      TOSSINVEST_YOLO_TRADING: "true",
      TOSSINVEST_BASE_URL: "https://example.com/"
    });

    assert.equal(config.defaultAccountSeq, 3);
    assert.equal(config.tradingEnabled, true);
    assert.equal(config.yoloTrading, true);
    assert.equal(config.baseUrl, "https://example.com");
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
