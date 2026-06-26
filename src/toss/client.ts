import type { Config } from "../config.js";
import { MAX_RATE_LIMIT_RETRIES, MAX_RATE_LIMIT_TOTAL_WAIT_MS, parseRetryAfterMs, sleep } from "../utils/retry.js";
import { normalizeOAuthTokenError, normalizeTossError, TossApiError, TossNetworkError } from "./errors.js";

const TOKEN_REFRESH_BUFFER_MS = 60_000;

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
  method?: "GET" | "POST";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  accountSeq?: number;
  body?: unknown;
};

export class TossClient {
  private readonly config: Config;
  private tokenState?: TokenState;

  constructor(config: Config) {
    this.config = config;
  }

  async request<T = unknown>(options: RequestOptions): Promise<T> {
    const token = await this.getAccessToken();
    const url = this.buildUrl(options.path, options.query);
    const headers = new Headers({
      Authorization: `Bearer ${token}`
    });

    if (options.accountSeq !== undefined) {
      headers.set("X-Tossinvest-Account", String(options.accountSeq));
    }

    if (options.body !== undefined) {
      headers.set("Content-Type", "application/json");
    }

    return this.fetchWithRateLimitRetry<T>(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body)
    });
  }

  private async getAccessToken(): Promise<string> {
    if (this.tokenState && Date.now() < this.tokenState.expiresAt - TOKEN_REFRESH_BUFFER_MS) {
      return this.tokenState.accessToken;
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.config.clientId,
      client_secret: this.config.clientSecret
    });

    const response = await safeFetch(`${this.config.baseUrl}/oauth2/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    const payload = await readJson(response);

    if (!response.ok) {
      throw normalizeOAuthTokenError(response.status, payload, response.headers.get("X-Request-Id"));
    }

    const token = payload as TokenResponse;
    if (!isTokenResponse(token)) {
      throw new TossApiError("Invalid OAuth token response from Toss API.", {
        status: response.status,
        code: "invalid-token-response",
        requestId: response.headers.get("X-Request-Id") ?? undefined,
        data: payload,
        hint: "토스증권 Open API 토큰 응답 형식이 예상과 다릅니다. 잠시 후 다시 시도하거나 공식 API 상태를 확인하세요."
      });
    }

    const expiresInMs = (token.expires_in ?? 3600) * 1000;

    this.tokenState = {
      accessToken: token.access_token,
      expiresAt: Date.now() + expiresInMs
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

  private async fetchWithRateLimitRetry<T>(url: URL, init: RequestInit): Promise<T> {
    let totalWaitMs = 0;

    for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt += 1) {
      const response = await safeFetch(url, init);
      const payload = await readJson(response);

      if (response.ok) {
        return payload as T;
      }

      if (response.status !== 429 || attempt === MAX_RATE_LIMIT_RETRIES) {
        throw normalizeTossError(response.status, payload, response.headers.get("X-Request-Id"));
      }

      const waitMs = parseRetryAfterMs(response.headers.get("Retry-After"));
      if (totalWaitMs + waitMs > MAX_RATE_LIMIT_TOTAL_WAIT_MS) {
        throw normalizeTossError(response.status, payload, response.headers.get("X-Request-Id"));
      }

      totalWaitMs += waitMs;
      await sleep(waitMs);
    }

    throw new Error("Unreachable rate limit retry state.");
  }
}

async function safeFetch(input: URL | string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    throw new TossNetworkError("Failed to connect to Toss Open API.", { cause: error });
  }
}

function isTokenResponse(value: TokenResponse): value is TokenResponse & { access_token: string } {
  return typeof value.access_token === "string" && value.access_token.length > 0;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
