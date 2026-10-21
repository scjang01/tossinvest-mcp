import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { Config } from "../config.js";
import { resolveAccountSeq } from "../config.js";
import type { TossClient } from "../toss/client.js";
import {
  accountInputSchema,
  currencySchema,
  symbolSchema,
} from "../toss/schemas.js";
import { runTool, registrar } from "./common.js";

export function registerAccountTools(
  server: McpServer,
  client: TossClient,
  config: Config,
): void {
  const register = registrar(server);
  register(
    "toss_get_accounts",
    {
      title: "Toss Get Accounts",
      description:
        "List Toss Securities accounts available to the configured Open API credentials.",
      inputSchema: {},
    },
    () => runTool(() => client.request({ path: "/api/v1/accounts" })),
  );

  register(
    "toss_get_holdings",
    {
      title: "Toss Get Holdings",
      description:
        "Get account holdings. accountSeq is optional when TOSSINVEST_ACCOUNT is configured.",
      inputSchema: {
        ...accountInputSchema(config),
        symbol: symbolSchema.optional(),
      },
    },
    ({ accountSeq, symbol }) =>
      runTool(() =>
        client.request({
          path: "/api/v1/holdings",
          accountSeq: resolveAccountSeq(accountSeq, config.defaultAccountSeq),
          query: { symbol },
        }),
      ),
  );

  register(
    "toss_get_buying_power",
    {
      title: "Toss Get Buying Power",
      description:
        "Get available buying power for an account. currency is required: KRW for Korean stocks, USD for US stocks.",
      inputSchema: {
        ...accountInputSchema(config),
        currency: currencySchema.describe(
          "Currency code: KRW (Korean stocks) or USD (US stocks)",
        ),
      },
    },
    ({ accountSeq, currency }) =>
      runTool(() =>
        client.request({
          path: "/api/v1/buying-power",
          accountSeq: resolveAccountSeq(accountSeq, config.defaultAccountSeq),
          query: { currency },
        }),
      ),
  );

  register(
    "toss_get_sellable_quantity",
    {
      title: "Toss Get Sellable Quantity",
      description: "Get sellable quantity for one symbol in an account.",
      inputSchema: {
        ...accountInputSchema(config),
        symbol: symbolSchema,
      },
    },
    ({ accountSeq, symbol }) =>
      runTool(() =>
        client.request({
          path: "/api/v1/sellable-quantity",
          accountSeq: resolveAccountSeq(accountSeq, config.defaultAccountSeq),
          query: { symbol },
        }),
      ),
  );

  register(
    "toss_get_commissions",
    {
      title: "Toss Get Commissions",
      description: "Get trading commission information for an account.",
      inputSchema: {
        ...accountInputSchema(config),
      },
    },
    ({ accountSeq }) =>
      runTool(() =>
        client.request({
          path: "/api/v1/commissions",
          accountSeq: resolveAccountSeq(accountSeq, config.defaultAccountSeq),
        }),
      ),
  );
}
