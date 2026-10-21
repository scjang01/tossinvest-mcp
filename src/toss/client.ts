import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  atomicWrite,
  credentialId,
  runtimeDir,
  withFileLock,
} from "../utils/storage.js";
import type { Config } from "../config.js";
import {
  MAX_RATE_LIMIT_RETRIES,
  MAX_RATE_LIMIT_TOTAL_WAIT_MS,
  parseRetryAfterMs,
  sleep,
} from "../utils/retry.js";
import {
  normalizeOAuthTokenError,
  normalizeTossError,
  TossApiError,
  TossNetworkError,
} from "./errors.js";

const TOKEN_REFRESH_BUFFER_MS = 60_000;

// Per-request wall-clock timeout. Without it a hung connection or a stalled
// response would block the MCP tool (and, on the order path, the pre-order
// reconciliation) indefinitely. Applied fresh on every attempt so rate-limit
// retries each get a full budget.
const REQUEST_TIMEOUT_MS = 20_000;

type TokenState = {
  accessToken: string;
  expiresAt: number;
};

type TokenResponse = {
  access_token: string;
  expires_in?: number;
  token_type?: string;
};

type RequestOptions = {
  method?: "GET" | "POST" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  accountSeq?: number;
  body?: unknown;
};

export class TossClient {
  private readonly config: Config;
  private tokenState?: TokenState;
  private tokenPromise?: Promise<string>;

  constructor(config: Config) {
    this.config = config;
  }

  async request<T = unknown>(
    options: RequestOptions,
    refreshed = false,
  ): Promise<T> {
    const token = await this.getAccessToken();
    const url = this.buildUrl(options.path, options.query);
    const headers = new Headers({
      Authorization: `Bearer ${token}`,
    });

    if (options.accountSeq !== undefined) {
      headers.set("X-Tossinvest-Account", String(options.accountSeq));
    }

    if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
    }

    try {
      return await this.fetchWithRateLimitRetry<T>(url, {
        method: options.method ?? "GET",
        headers,
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (error) {
      if (
        !refreshed &&
        error instanceof TossApiError &&
        error.status === 401 &&
        ["invalid-token", "token-expired", "token-revoked"].includes(
          error.code ?? "",
        )
      ) {
        const path = join(
          runtimeDir(this.config),
          `token-${credentialId(this.config)}.json`,
        );
        await withFileLock(path, async () => {
          let cached: TokenState | undefined;
          try {
            cached = JSON.parse(readFileSync(path, "utf8"));
          } catch {}
          if (cached?.accessToken === token)
            atomicWrite(path, { accessToken: token, expiresAt: 0 });
        });
        return this.request<T>(options, true);
      }
      throw error;
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.tokenPromise) return this.tokenPromise;
    const path = join(
      runtimeDir(this.config),
      `token-${credentialId(this.config)}.json`,
    );
    const read = (): TokenState | undefined => {
      try {
        const value = JSON.parse(readFileSync(path, "utf8"));
        if (
          value !== null &&
          typeof value === "object" &&
          typeof value.accessToken === "string" &&
          value.accessToken.trim().length > 0 &&
          Number.isFinite(value.expiresAt)
        )
          return value;
      } catch (error) {
        if (
          (error as NodeJS.ErrnoException).code !== "ENOENT" &&
          !(error instanceof SyntaxError)
        )
          throw error;
      }
      return undefined;
    };
    const valid = (value: TokenState | undefined) =>
      value && Date.now() < value.expiresAt - TOKEN_REFRESH_BUFFER_MS;
    // Read shared state even when the process has a token: another process may have refreshed it.
    const cached = read();
    if (valid(cached)) {
      this.tokenState = cached;
      return cached!.accessToken;
    }
    this.tokenPromise = withFileLock(path, async () => {
      const shared = read();
      if (valid(shared)) {
        this.tokenState = shared;
        return shared!.accessToken;
      }
      const token = await this.issueAccessToken();
      atomicWrite(path, this.tokenState);
      return token;
    });
    try {
      return await this.tokenPromise;
    } finally {
      this.tokenPromise = undefined;
    }
  }

  private async issueAccessToken(): Promise<string> {
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret,
    });

    const response = await safeFetch(`${this.config.baseUrl}/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });

    const payload = await readJson(response);

    if (!response.ok) {
      throw normalizeOAuthTokenError(
        response.status,
        payload,
        response.headers.get("X-Request-Id"),
      );
    }

    if (!isTokenResponse(payload)) {
      throw new TossApiError("Invalid OAuth token response from Toss API.", {
        status: response.status,
        code: "invalid-token-response",
        requestId: response.headers.get("X-Request-Id") ?? undefined,
        data: payload,
        hint: "토스증권 Open API 토큰 응답 형식이 예상과 다릅니다. 잠시 후 다시 시도하거나 공식 API 상태를 확인하세요.",
      });
    }

    const token = payload;
    if (
      token.expires_in !== undefined &&
      (!Number.isFinite(token.expires_in) || token.expires_in <= 0)
    )
      throw new TossApiError("Invalid OAuth token expiry.", {
        status: 200,
        code: "invalid-token-response",
      });
    const expiresInMs = (token.expires_in ?? 3600) * 1000;

    this.tokenState = {
      accessToken: token.access_token,
      expiresAt: Date.now() + expiresInMs,
    };

    return token.access_token;
  }

  private buildUrl(path: string, query: RequestOptions["query"]): URL {
    const url = new URL(path, this.config.baseUrl);

    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    return url;
  }

  private async fetchWithRateLimitRetry<T>(
    url: URL,
    init: RequestInit,
  ): Promise<T> {
    let totalWaitMs = 0;

    for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
      const response = await safeFetch(url, init);
      const payload = await readJson(response);

      if (response.ok) {
        // This operation alone documents a bodyless success. Return the known
        // target ID in the MCP envelope; never infer IDs for creates/amends.
        const canceled = url.pathname.match(
          /^\/api\/v1\/conditional-orders\/([^/]+)$/,
        );
        if (response.status === 204 && init.method === "DELETE" && canceled)
          return {
            result: { conditionalOrderId: decodeURIComponent(canceled[1]) },
          } as T;
        if (
          payload === null ||
          typeof payload !== "object" ||
          !("result" in payload)
        ) {
          throw new TossApiError(
            "Invalid success response; order acceptance may be unknown.",
            {
              status: response.status,
              code: "invalid-success-response",
              requestId: response.headers.get("X-Request-Id") ?? undefined,
              data: payload,
            },
          );
        }
        return payload as T;
      }

      if (response.status !== 429 || attempt === MAX_RATE_LIMIT_RETRIES) {
        throw normalizeTossError(
          response.status,
          payload,
          response.headers.get("X-Request-Id"),
        );
      }

      const waitMs = parseRetryAfterMs(response.headers.get("Retry-After"));
      if (totalWaitMs + waitMs > MAX_RATE_LIMIT_TOTAL_WAIT_MS) {
        throw normalizeTossError(
          response.status,
          payload,
          response.headers.get("X-Request-Id"),
        );
      }

      totalWaitMs += waitMs;
      await sleep(waitMs);
    }

    throw new Error("Unreachable rate limit retry state.");
  }
}

async function safeFetch(
  input: URL | string,
  init: RequestInit,
): Promise<Response> {
  try {
    // Fresh timeout signal per call so retries are not aborted by an earlier one.
    return await fetch(input, {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new TossNetworkError(
        `Toss Open API request timed out after ${REQUEST_TIMEOUT_MS / 1000}s.`,
        {
          cause: error,
          hint: "토스증권 Open API 응답이 지연되었습니다. 네트워크 상태를 확인하고 잠시 후 다시 시도하세요.",
        },
      );
    }
    throw new TossNetworkError("Failed to connect to Toss Open API.", {
      cause: error,
    });
  }
}

function isTokenResponse(value: unknown): value is TokenResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { access_token?: unknown }).access_token === "string" &&
    (value as { access_token: string }).access_token.length > 0
  );
}

async function readJson(response: Response): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch (cause) {
    throw new TossApiError(
      "Failed to read Toss response body; acceptance may be unknown.",
      {
        status: response.status,
        code: "response-read-error",
        requestId: response.headers.get("X-Request-Id") ?? undefined,
        data: { cause: cause instanceof Error ? cause.message : String(cause) },
      },
    );
  }

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
