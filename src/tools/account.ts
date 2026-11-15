import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Config } from "../config.js";
import { resolveAccountSeq } from "../config.js";
import type { TossClient } from "../toss/client.js";
import {
  accountInputSchema,
  currencySchema,
  dateSchema,
  symbolSchema,
} from "../toss/schemas.js";
import { runTool, registrar } from "./common.js";

const DEFAULT_TRANSACTIONS_LIMIT = 10;

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
        "Get account holdings and valuation; optionally filter by symbol.",
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
    "toss_get_transactions",
    {
      title: "Toss Get Transactions",
      description:
        "Account trades, transfers, FX, dividends, interest and fees (KR/US stocks, options and bonds; see assetClass). Dates use KST settlement day (expected for unsettled); omit the to filter to include future settlements. Unsettled first, newest first within each group. Follow hasNext even on empty pages; pass nextCursor unchanged and clear it if account or filters change. No order IDs.",
      inputSchema: {
        ...accountInputSchema(config),
        transactionTypes: z
          .array(
            z.enum([
              "BUY",
              "SELL",
              "SECURITIES_TRANSFER_IN",
              "SECURITIES_TRANSFER_OUT",
              "DEPOSIT",
              "WITHDRAWAL",
              "EXCHANGE_IN",
              "EXCHANGE_OUT",
              "DIVIDEND",
              "INTEREST",
              "FEE",
            ]),
          )
          .optional()
          .describe(
            "OR filter. Omit or pass an empty array for all transaction types.",
          ),
        from: dateSchema
          .optional()
          .describe("Inclusive settlement start date (KST)."),
        to: dateSchema
          .optional()
          .describe(
            "Inclusive settlement end date (KST), including future dates.",
          ),
        cursor: z
          .string()
          .min(1)
          .optional()
          .describe("Pass nextCursor unchanged."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe(
            `Page size; defaults to ${DEFAULT_TRANSACTIONS_LIMIT}, maximum 100. Set the needed page size on the first call.`,
          ),
      },
    },
    ({ accountSeq, transactionTypes, from, to, cursor, limit }) =>
      runTool(() => {
        if (from !== undefined && to !== undefined && from > to)
          throw new Error(
            "from must be on or before to (settlement dates in KST).",
          );
        return client.request({
          path: "/api/v1/transactions",
          accountSeq: resolveAccountSeq(accountSeq, config.defaultAccountSeq),
          query: {
            transactionTypes: transactionTypes?.join(","),
            from,
            to,
            cursor,
            limit: limit ?? DEFAULT_TRANSACTIONS_LIMIT,
          },
        });
      }),
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
