import { z } from "zod";

const DEFAULT_BASE_URL = "https://openapi.tossinvest.com";
const DEFAULT_ACCOUNT_SEQ = 1;
const DEFAULT_MARKET_ORDER_BUFFER_PCT = 5;

const boolEnum = z.enum(["true", "false"]);

const optionalBool = boolEnum.optional();
const optionalPositiveAmount = z.coerce.number().positive().optional();
const optionalPositiveInt = z.coerce.number().int().positive().optional();

const envSchema = z.object({
  TOSSINVEST_API_KEY: z.string().min(1),
  TOSSINVEST_SECRET_KEY: z.string().min(1),
  TOSSINVEST_ACCOUNT: z.coerce.number().int().positive().default(DEFAULT_ACCOUNT_SEQ),
  TOSSINVEST_BASE_URL: z.string().url().default(DEFAULT_BASE_URL),
  TOSSINVEST_ENABLE_TRADING: optionalBool,

  // Guardrails.
  TOSSINVEST_REQUIRE_ORDER_CONFIRMATION: optionalBool,
  TOSSINVEST_MAX_ORDER_AMOUNT_KRW: optionalPositiveAmount,
  TOSSINVEST_MAX_ORDER_AMOUNT_USD: optionalPositiveAmount,
  TOSSINVEST_DAILY_MAX_ORDER_AMOUNT_KRW: optionalPositiveAmount,
  TOSSINVEST_DAILY_MAX_ORDER_AMOUNT_USD: optionalPositiveAmount,
  TOSSINVEST_DAILY_MAX_ORDER_COUNT: optionalPositiveInt,
  TOSSINVEST_ALLOWED_SYMBOLS: z.string().optional(),
  TOSSINVEST_ALLOW_SELL_ORDERS: optionalBool,
  TOSSINVEST_ALLOW_MARKET_ORDERS: optionalBool,
  TOSSINVEST_MARKET_ORDER_BUFFER_PCT: z.coerce.number().min(0).optional(),
  TOSSINVEST_LOCK_ACCOUNT: optionalBool,
  TOSSINVEST_GUARD_STATE_PATH: z.string().min(1).optional()
});

export type Config = {
  clientId: string;
  clientSecret: string;
  defaultAccountSeq: number;
  baseUrl: string;
  tradingEnabled: boolean;

  requireOrderConfirmation: boolean;
  maxOrderAmountKrw?: number;
  maxOrderAmountUsd?: number;
  dailyMaxOrderAmountKrw?: number;
  dailyMaxOrderAmountUsd?: number;
  dailyMaxOrderCount?: number;
  allowedSymbols?: string[];
  allowSellOrders: boolean;
  allowMarketOrders: boolean;
  marketOrderBufferPct: number;
  lockAccount: boolean;
  guardStatePath?: string;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Treat empty-string env values (common in .env templates) as unset so that
  // optional guardrails fall back to defaults instead of failing validation.
  const cleaned: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value !== "") {
      cleaned[key] = value;
    }
  }

  const parsed = envSchema.safeParse(cleaned);

  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid Toss Invest MCP configuration: ${missing}`);
  }

  const data = parsed.data;

  return {
    clientId: data.TOSSINVEST_API_KEY,
    clientSecret: data.TOSSINVEST_SECRET_KEY,
    defaultAccountSeq: data.TOSSINVEST_ACCOUNT,
    baseUrl: data.TOSSINVEST_BASE_URL.replace(/\/+$/, ""),
    tradingEnabled: data.TOSSINVEST_ENABLE_TRADING === "true",

    requireOrderConfirmation: data.TOSSINVEST_REQUIRE_ORDER_CONFIRMATION !== "false",
    maxOrderAmountKrw: data.TOSSINVEST_MAX_ORDER_AMOUNT_KRW,
    maxOrderAmountUsd: data.TOSSINVEST_MAX_ORDER_AMOUNT_USD,
    dailyMaxOrderAmountKrw: data.TOSSINVEST_DAILY_MAX_ORDER_AMOUNT_KRW,
    dailyMaxOrderAmountUsd: data.TOSSINVEST_DAILY_MAX_ORDER_AMOUNT_USD,
    dailyMaxOrderCount: data.TOSSINVEST_DAILY_MAX_ORDER_COUNT,
    allowedSymbols: parseAllowedSymbols(data.TOSSINVEST_ALLOWED_SYMBOLS),
    allowSellOrders: data.TOSSINVEST_ALLOW_SELL_ORDERS === "true",
    allowMarketOrders: data.TOSSINVEST_ALLOW_MARKET_ORDERS === "true",
    marketOrderBufferPct: data.TOSSINVEST_MARKET_ORDER_BUFFER_PCT ?? DEFAULT_MARKET_ORDER_BUFFER_PCT,
    lockAccount: data.TOSSINVEST_LOCK_ACCOUNT !== "false",
    guardStatePath: data.TOSSINVEST_GUARD_STATE_PATH
  };
}

export function resolveAccountSeq(inputAccountSeq: number | undefined, defaultAccountSeq: number | undefined): number {
  return inputAccountSeq ?? defaultAccountSeq ?? DEFAULT_ACCOUNT_SEQ;
}

function parseAllowedSymbols(raw: string | undefined): string[] | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const symbols = raw
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => symbol.length > 0);

  return symbols.length > 0 ? symbols : undefined;
}
