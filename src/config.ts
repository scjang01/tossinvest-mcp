import { z } from "zod";

const optionalBool = z.enum(["true", "false"]).optional();
const countLimit = z.coerce.number().int().positive().optional();
const amount = z
  .string()
  .regex(/^\d+(\.\d+)?$/)
  .refine((v) => /[1-9]/.test(v), "Must be positive")
  .optional();
const envSchema = z.object({
  TOSSINVEST_CLIENT_ID: z.string().trim().min(1),
  TOSSINVEST_CLIENT_SECRET: z.string().trim().min(1),
  TOSSINVEST_ACCOUNT: z.coerce.number().int().positive().optional(),
  TOSSINVEST_BASE_URL: z
    .string()
    .url()
    .default("https://openapi.tossinvest.com"),
  TOSSINVEST_ENABLE_TRADING: optionalBool,
  TOSSINVEST_MAX_ORDER_AMOUNT_KRW: amount,
  TOSSINVEST_MAX_ORDER_AMOUNT_USD: amount,
  TOSSINVEST_DAILY_MAX_ORDER_AMOUNT_KRW: amount,
  TOSSINVEST_DAILY_MAX_ORDER_AMOUNT_USD: amount,
  TOSSINVEST_DAILY_MAX_ORDER_COUNT_KRW: countLimit,
  TOSSINVEST_DAILY_MAX_ORDER_COUNT_USD: countLimit,
  TOSSINVEST_DAILY_MAX_ORDER_COUNT: countLimit,
  TOSSINVEST_ALLOWED_SYMBOLS: z.string().optional(),
  TOSSINVEST_MARKET_ORDER_BUFFER_PCT: z.coerce
    .number()
    .min(0)
    .lt(100)
    .default(3),
  TOSSINVEST_DATA_DIR: z.string().min(1).optional(),
  TOSSINVEST_GUARD_STATE_PATH: z.string().min(1).optional(),
});
export type Config = {
  clientId: string;
  clientSecret: string;
  defaultAccountSeq?: number;
  baseUrl: string;
  tradingEnabled: boolean;
  maxOrderAmountKrw?: string | number;
  maxOrderAmountUsd?: string | number;
  dailyMaxOrderAmountKrw?: string | number;
  dailyMaxOrderAmountUsd?: string | number;
  dailyMaxOrderCountKrw?: number;
  dailyMaxOrderCountUsd?: number;
  allowedSymbols?: string[];
  marketOrderBufferPct: number;
  guardStatePath?: string;
  warnings?: string[];
  /** Shared data directory (TOSSINVEST_DATA_DIR). */
  runtimeDir?: string;
};
const removed = {
  TOSSINVEST_REQUIRE_ORDER_CONFIRMATION:
    "confirmOrderAction has been removed; trading tools no longer require this flag.",
  TOSSINVEST_ALLOW_SELL_ORDERS:
    "Sell orders are allowed when trading is enabled.",
  TOSSINVEST_ALLOW_MARKET_ORDERS:
    "Market orders are allowed when trading is enabled.",
  TOSSINVEST_LOCK_ACCOUNT:
    "TOSSINVEST_ACCOUNT now fixes the account; otherwise each account tool requires accountSeq.",
};
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const cleaned = Object.fromEntries(
    Object.entries(env).filter(([, v]) => v !== undefined && v.trim() !== ""),
  );
  // Resolve aliases before validation without modifying the caller's environment.
  // Blank canonical values count as unset, just like blank optional settings.
  const parsed = envSchema.safeParse({
    ...cleaned,
    TOSSINVEST_CLIENT_ID:
      cleaned.TOSSINVEST_CLIENT_ID ?? cleaned.TOSSINVEST_API_KEY,
    TOSSINVEST_CLIENT_SECRET:
      cleaned.TOSSINVEST_CLIENT_SECRET ?? cleaned.TOSSINVEST_SECRET_KEY,
  });
  if (!parsed.success)
    throw new Error(
      `Invalid Toss Invest MCP configuration: ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
  const d = parsed.data;
  const symbols = d.TOSSINVEST_ALLOWED_SYMBOLS?.split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (d.TOSSINVEST_ALLOWED_SYMBOLS && !symbols?.length)
    throw new Error(
      "TOSSINVEST_ALLOWED_SYMBOLS must contain at least one symbol.",
    );
  const warnings = Object.entries(removed)
    .filter(([k]) => cleaned[k] !== undefined)
    .map(([k, v]) => `${k} is removed in 0.3.0. ${v}`);
  if (d.TOSSINVEST_DAILY_MAX_ORDER_COUNT !== undefined)
    warnings.push(
      "TOSSINVEST_DAILY_MAX_ORDER_COUNT is deprecated; it now supplies the default count limit independently for each market, not a combined cap. Use TOSSINVEST_DAILY_MAX_ORDER_COUNT_KRW and TOSSINVEST_DAILY_MAX_ORDER_COUNT_USD; each explicit market setting takes precedence.",
    );
  for (const [legacy, canonical] of [
    ["TOSSINVEST_API_KEY", "TOSSINVEST_CLIENT_ID"],
    ["TOSSINVEST_SECRET_KEY", "TOSSINVEST_CLIENT_SECRET"],
  ] as const) {
    if (cleaned[legacy] !== undefined) {
      warnings.push(
        `${legacy} is a supported legacy alias; use ${canonical}.` +
          (cleaned[canonical] !== undefined
            ? ` Both are set; ${canonical} takes precedence.`
            : ""),
      );
    }
  }
  return {
    clientId: d.TOSSINVEST_CLIENT_ID,
    clientSecret: d.TOSSINVEST_CLIENT_SECRET,
    defaultAccountSeq: d.TOSSINVEST_ACCOUNT,
    baseUrl: d.TOSSINVEST_BASE_URL.replace(/\/+$/, ""),
    tradingEnabled: d.TOSSINVEST_ENABLE_TRADING === "true",
    maxOrderAmountKrw: d.TOSSINVEST_MAX_ORDER_AMOUNT_KRW,
    maxOrderAmountUsd: d.TOSSINVEST_MAX_ORDER_AMOUNT_USD,
    dailyMaxOrderAmountKrw: d.TOSSINVEST_DAILY_MAX_ORDER_AMOUNT_KRW,
    dailyMaxOrderAmountUsd: d.TOSSINVEST_DAILY_MAX_ORDER_AMOUNT_USD,
    dailyMaxOrderCountKrw:
      d.TOSSINVEST_DAILY_MAX_ORDER_COUNT_KRW ??
      d.TOSSINVEST_DAILY_MAX_ORDER_COUNT,
    dailyMaxOrderCountUsd:
      d.TOSSINVEST_DAILY_MAX_ORDER_COUNT_USD ??
      d.TOSSINVEST_DAILY_MAX_ORDER_COUNT,
    allowedSymbols: symbols,
    marketOrderBufferPct: d.TOSSINVEST_MARKET_ORDER_BUFFER_PCT,
    guardStatePath: d.TOSSINVEST_GUARD_STATE_PATH,
    runtimeDir: d.TOSSINVEST_DATA_DIR,
    warnings,
  };
}
export function resolveAccountSeq(
  input: number | undefined,
  fixed: number | undefined,
): number {
  if (fixed !== undefined) {
    if (input !== undefined && input !== fixed)
      throw new Error(`Account is fixed to TOSSINVEST_ACCOUNT (${fixed}).`);
    return fixed;
  }
  if (input === undefined)
    throw new Error(
      "accountSeq is required. Call toss_get_accounts first; ask the user if multiple accounts are ambiguous.",
    );
  return input;
}
