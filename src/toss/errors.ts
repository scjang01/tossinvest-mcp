export type TossApiErrorPayload = {
  error?: {
    requestId?: string;
    code?: string;
    message?: string;
    data?: unknown;
  };
};

export class TossApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly requestId?: string;
  readonly data?: unknown;
  readonly hint?: string;

  constructor(message: string, options: { status: number; code?: string; requestId?: string; data?: unknown; hint?: string }) {
    super(message);
    this.name = "TossApiError";
    this.status = options.status;
    this.code = options.code;
    this.requestId = options.requestId;
    this.data = options.data;
    this.hint = options.hint;
  }

  toJSON() {
    return {
      status: this.status,
      code: this.code,
      message: this.message,
      requestId: this.requestId,
      data: this.data,
      hint: this.hint
    };
  }
}

export class TossNetworkError extends Error {
  readonly code = "network-error";
  readonly hint: string;

  constructor(message: string, options?: { cause?: unknown; hint?: string }) {
    super(message, { cause: options?.cause });
    this.name = "TossNetworkError";
    this.hint =
      options?.hint ??
      "Toss Open API에 연결하지 못했습니다. 인터넷 연결, DNS, VPN, 방화벽, 또는 TOSSINVEST_BASE_URL 설정을 확인하세요.";
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      hint: this.hint
    };
  }
}

export function normalizeTossError(status: number, body: unknown, requestIdHeader: string | null): TossApiError {
  const payload = body as TossApiErrorPayload;
  const error = payload.error;
  const message = error?.message ?? `Toss API request failed with HTTP ${status}`;

  return new TossApiError(message, {
    status,
    code: error?.code,
    requestId: error?.requestId ?? requestIdHeader ?? undefined,
    data: error?.data ?? (error ? undefined : body),
    hint: getErrorHint(status, error?.code, message)
  });
}

/**
 * Normalize an error from the OAuth2 token endpoint. Per the spec, token
 * failures use the OAuth2 shape `{ error, error_description }` where `error` is
 * a STRING code (e.g. "invalid_client") — not the common `{ error: { code,
 * message } }` envelope. Falls back to the common normalizer otherwise so a
 * non-standard body still surfaces useful detail.
 */
export function normalizeOAuthTokenError(status: number, body: unknown, requestIdHeader: string | null): TossApiError {
  const payload = body as { error?: unknown; error_description?: unknown };

  if (payload && typeof payload.error === "string") {
    const code = payload.error;
    const description = typeof payload.error_description === "string" ? payload.error_description : undefined;
    const message = description ?? `OAuth token request failed (${code}).`;

    return new TossApiError(message, {
      status,
      code,
      requestId: requestIdHeader ?? undefined,
      data: body,
      hint: getErrorHint(status, code, message)
    });
  }

  return normalizeTossError(status, body, requestIdHeader);
}

export function formatToolError(error: unknown): string {
  if (error instanceof TossApiError || error instanceof TossNetworkError) {
    return JSON.stringify(error.toJSON(), null, 2);
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function getErrorHint(status: number, code: string | undefined, message: string): string | undefined {
  if (message.includes("허용되지 않은 IP")) {
    return "토스증권 WTS의 Open API 설정에서 현재 공인 IP를 허용 IP 목록에 추가하세요.";
  }

  if (status === 401 || code === "invalid-token") {
    return "API Key와 Secret Key가 올바른지, 토스증권 Open API 키가 활성 상태인지 확인하세요.";
  }

  if (status === 429) {
    return "토스증권 Open API 요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.";
  }

  if (code === "account-header-required") {
    return "계좌가 필요한 요청입니다. TOSSINVEST_ACCOUNT 또는 tool 입력의 accountSeq 값을 확인하세요.";
  }

  if (code === "confirm-high-value-required") {
    return "고액 주문 확인이 필요합니다. 주문 금액을 다시 확인한 뒤 confirmHighValueOrder 값을 true로 설정해야 합니다.";
  }

  return undefined;
}
