import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatToolError, normalizeOAuthTokenError, normalizeTossError, TossNetworkError } from "../src/toss/errors.js";

describe("Toss error handling", () => {
  it("normalizes Toss error envelope with request id fallback", () => {
    const error = normalizeTossError(
      400,
      {
        error: {
          code: "invalid-request",
          message: "잘못된 요청입니다."
        }
      },
      "header-request-id"
    );

    assert.equal(error.status, 400);
    assert.equal(error.code, "invalid-request");
    assert.equal(error.message, "잘못된 요청입니다.");
    assert.equal(error.requestId, "header-request-id");
  });

  it("adds a user hint for disallowed IP errors", () => {
    const error = normalizeTossError(
      403,
      {
        error: {
          requestId: "request-id",
          code: "forbidden",
          message: "허용되지 않은 IP 주소입니다."
        }
      },
      null
    );

    assert.match(error.hint ?? "", /허용 IP/);
  });

  it("keeps non-envelope error bodies as diagnostic data", () => {
    const error = normalizeTossError(502, { raw: "bad gateway" }, "request-id");

    assert.equal(error.status, 502);
    assert.equal(error.requestId, "request-id");
    assert.deepEqual(error.data, { raw: "bad gateway" });
  });

  it("parses the OAuth2 token error shape ({ error, error_description })", () => {
    const error = normalizeOAuthTokenError(
      401,
      { error: "invalid_client", error_description: "Client authentication failed." },
      "req-1"
    );

    assert.equal(error.status, 401);
    assert.equal(error.code, "invalid_client");
    assert.equal(error.message, "Client authentication failed.");
    assert.equal(error.requestId, "req-1");
    assert.deepEqual(error.data, { error: "invalid_client", error_description: "Client authentication failed." });
    assert.match(error.hint ?? "", /API Key/);
  });

  it("falls back to the common normalizer when the token body is an envelope", () => {
    const error = normalizeOAuthTokenError(500, { error: { code: "server-error", message: "boom" } }, null);
    assert.equal(error.code, "server-error");
    assert.equal(error.message, "boom");
  });

  it("formats network errors as structured JSON", () => {
    const formatted = JSON.parse(formatToolError(new TossNetworkError("Failed to connect.")));

    assert.equal(formatted.code, "network-error");
    assert.equal(formatted.message, "Failed to connect.");
    assert.match(formatted.hint, /인터넷 연결/);
  });
});
