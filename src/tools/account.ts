import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Config } from "../config.js";
import { resolveAccountSeq } from "../config.js";
import type { TossClient } from "../toss/client.js";
import {
  accountInputSchema,
  accountDescription,
  currencySchema,
  dateSchema,
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
    "toss_get_transactions",
    {
      title: "Toss Get Transactions",
      description: `Get account transactions: trades, cash and securities transfers, currency exchanges, dividends, interest and fees. KR/US stocks, options and bonds can appear; inspect assetClass. ${accountDescription} Dates use settlementDate in KST, not order or execution dates. Unsettled entries use their expected settlement date; omit the to filter to include future unsettled transactions. Results contain unsettled entries first, then settled entries, newest first within each group. Pass nextCursor unchanged and check hasNext even when fewer than limit entries are returned. Remove cursor when changing account or filters. No related order ID is provided.`,
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
          .describe("Opaque nextCursor from the previous response."),
        limit: z
          .number()
          .int()
          .min(1)
          .max(100)
          .optional()
          .describe("Page size; defaults to 20, maximum 100."),
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
            limit,
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
