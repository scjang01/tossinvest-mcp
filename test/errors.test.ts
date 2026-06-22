import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatToolError, normalizeTossError, TossNetworkError } from "../src/toss/errors.js";

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

  it("formats network errors as structured JSON", () => {
    const formatted = JSON.parse(formatToolError(new TossNetworkError("Failed to connect.")));

    assert.equal(formatted.code, "network-error");
    assert.equal(formatted.message, "Failed to connect.");
    assert.match(formatted.hint, /인터넷 연결/);
  });
});
