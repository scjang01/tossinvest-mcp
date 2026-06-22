import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import type { Config } from "../src/config.js";
import { TossClient } from "../src/toss/client.js";
import { TossApiError, TossNetworkError } from "../src/toss/errors.js";

const originalFetch = globalThis.fetch;

const config: Config = {
  clientId: "api-key",
  clientSecret: "secret-key",
  defaultAccountSeq: 1,
  baseUrl: "https://mock-toss.example",
  tradingEnabled: false,
  yoloTrading: false
};

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("TossClient error handling", () => {
  it("throws a structured error when token response is malformed", async () => {
    mockFetch([{ status: 200, body: { expires_in: 3600 } }]);

    const client = new TossClient(config);

    await assert.rejects(() => client.request({ path: "/api/v1/accounts" }), (error) => {
      assert.ok(error instanceof TossApiError);
      assert.equal(error.code, "invalid-token-response");
      return true;
    });
  });

  it("normalizes token endpoint errors", async () => {
    mockFetch([
      {
        status: 401,
        body: {
          error: {
            requestId: "token-request",
            code: "invalid-token",
            message: "인증에 실패했습니다."
          }
        }
      }
    ]);

    const client = new TossClient(config);

    await assert.rejects(() => client.request({ path: "/api/v1/accounts" }), (error) => {
      assert.ok(error instanceof TossApiError);
      assert.equal(error.status, 401);
      assert.equal(error.requestId, "token-request");
      assert.match(error.hint ?? "", /API Key/);
      return true;
    });
  });

  it("retries 429 responses and then succeeds", async () => {
    const calls = mockFetch([
      tokenResponse(),
      {
        status: 429,
        body: { error: { code: "rate-limit", message: "Too many requests." } },
        headers: { "Retry-After": "0" }
      },
      { status: 200, body: { result: [{ symbol: "005930" }] } }
    ]);

    const client = new TossClient(config);
    const result = await client.request({ path: "/api/v1/prices", query: { symbols: "005930" } });

    assert.deepEqual(result, { result: [{ symbol: "005930" }] });
    assert.equal(calls.length, 3);
  });

  it("does not wait when 429 retry-after exceeds total wait cap", async () => {
    mockFetch([
      tokenResponse(),
      {
        status: 429,
        body: { error: { code: "rate-limit", message: "Too many requests." } },
        headers: { "Retry-After": "31" }
      }
    ]);

    const client = new TossClient(config);

    await assert.rejects(() => client.request({ path: "/api/v1/prices", query: { symbols: "005930" } }), (error) => {
      assert.ok(error instanceof TossApiError);
      assert.equal(error.status, 429);
      assert.match(error.hint ?? "", /요청 한도/);
      return true;
    });
  });

  it("wraps fetch failures as network errors", async () => {
    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };

    const client = new TossClient(config);

    await assert.rejects(() => client.request({ path: "/api/v1/accounts" }), (error) => {
      assert.ok(error instanceof TossNetworkError);
      assert.equal(error.code, "network-error");
      return true;
    });
  });

  it("preserves non-JSON error responses", async () => {
    mockFetch([
      tokenResponse(),
      {
        status: 502,
        body: "bad gateway",
        headers: { "X-Request-Id": "plain-text-error" },
        contentType: "text/plain"
      }
    ]);

    const client = new TossClient(config);

    await assert.rejects(() => client.request({ path: "/api/v1/accounts" }), (error) => {
      assert.ok(error instanceof TossApiError);
      assert.equal(error.status, 502);
      assert.equal(error.requestId, "plain-text-error");
      assert.deepEqual(error.data, { raw: "bad gateway" });
      return true;
    });
  });
});

type MockResponse = {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
  contentType?: string;
};

function tokenResponse(): MockResponse {
  return {
    status: 200,
    body: {
      access_token: "mock-access-token",
      token_type: "Bearer",
      expires_in: 3600
    }
  };
}

function mockFetch(responses: MockResponse[]) {
  const calls: Array<{ input: Parameters<typeof fetch>[0]; init?: RequestInit }> = [];

  globalThis.fetch = async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({ input, init });
    const next = responses.shift();

    if (!next) {
      throw new Error("Unexpected fetch call.");
    }

    const headers = new Headers(next.headers);
    headers.set("Content-Type", next.contentType ?? "application/json");

    const body = typeof next.body === "string" ? next.body : JSON.stringify(next.body);

    return new Response(body, {
      status: next.status,
      headers
    });
  };

  return calls;
}
