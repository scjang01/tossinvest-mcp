import { z } from "zod";

const DEFAULT_BASE_URL = "https://openapi.tossinvest.com";
const DEFAULT_ACCOUNT_SEQ = 1;

const envSchema = z.object({
  TOSSINVEST_API_KEY: z.string().min(1),
  TOSSINVEST_SECRET_KEY: z.string().min(1),
  TOSSINVEST_ACCOUNT: z.coerce.number().int().positive().default(DEFAULT_ACCOUNT_SEQ),
  TOSSINVEST_BASE_URL: z.string().url().default(DEFAULT_BASE_URL),
  TOSSINVEST_ENABLE_TRADING: z.string().optional(),
  TOSSINVEST_YOLO_TRADING: z.string().optional()
});

export type Config = {
  clientId: string;
  clientSecret: string;
  defaultAccountSeq: number;
  baseUrl: string;
  tradingEnabled: boolean;
  yoloTrading: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);

  if (!parsed.success) {
    const missing = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid Toss Invest MCP configuration: ${missing}`);
  }

  return {
    clientId: parsed.data.TOSSINVEST_API_KEY,
    clientSecret: parsed.data.TOSSINVEST_SECRET_KEY,
    defaultAccountSeq: parsed.data.TOSSINVEST_ACCOUNT,
    baseUrl: parsed.data.TOSSINVEST_BASE_URL.replace(/\/+$/, ""),
    tradingEnabled: parsed.data.TOSSINVEST_ENABLE_TRADING === "true",
    yoloTrading: parsed.data.TOSSINVEST_YOLO_TRADING === "true"
  };
}

export function resolveAccountSeq(inputAccountSeq: number | undefined, defaultAccountSeq: number | undefined): number {
  return inputAccountSeq ?? defaultAccountSeq ?? DEFAULT_ACCOUNT_SEQ;
}
