import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAX_RATE_LIMIT_RETRIES, MAX_RATE_LIMIT_TOTAL_WAIT_MS, parseRetryAfterMs } from "../src/utils/retry.js";

describe("retry policy", () => {
  it("uses the planned rate limit retry caps", () => {
    assert.equal(MAX_RATE_LIMIT_RETRIES, 2);
    assert.equal(MAX_RATE_LIMIT_TOTAL_WAIT_MS, 30_000);
  });

  it("parses Retry-After seconds", () => {
    assert.equal(parseRetryAfterMs("2"), 2_000);
  });

  it("falls back to one second for invalid Retry-After values", () => {
    assert.equal(parseRetryAfterMs("not-a-date"), 1_000);
  });
});
