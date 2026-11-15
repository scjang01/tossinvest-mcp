import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { TossClient } from "../toss/client.js";
import {
  currencySchema,
  dateSchema,
  dateTimeSchema,
  symbolSchema,
  symbolsSchema,
} from "../toss/schemas.js";
import { runTool, registrar } from "./common.js";

const DEFAULT_TRADES_COUNT = 20;
const DEFAULT_CANDLES_COUNT = 20;

export function registerMarketTools(
  server: McpServer,
  client: TossClient,
): void {
  const register = registrar(server);
  register(
    "toss_get_orderbook",
    {
      title: "Toss Get Orderbook",
      description: "Get orderbook data for one KRX or US stock symbol.",
      inputSchema: {
        symbol: symbolSchema,
      },
    },
    ({ symbol }) =>
      runTool(() =>
        client.request({ path: "/api/v1/orderbook", query: { symbol } }),
      ),
  );

  register(
    "toss_get_prices",
    {
      title: "Toss Get Prices",
      description:
        "Get current prices for up to 200 comma-separated KRX or US stock symbols.",
      inputSchema: {
        symbols: symbolsSchema,
      },
    },
    ({ symbols }) =>
      runTool(() =>
        client.request({ path: "/api/v1/prices", query: { symbols } }),
      ),
  );

  register(
    "toss_get_trades",
    {
      title: "Toss Get Trades",
      description: `Get recent trades for one KRX or US stock symbol. Optional count defaults to ${DEFAULT_TRADES_COUNT} (max 50); set the needed count on the first call.`,
      inputSchema: {
        symbol: symbolSchema,
        count: z.number().int().min(1).max(50).optional(),
      },
    },
    ({ symbol, count }) =>
      runTool(() =>
        client.request({
          path: "/api/v1/trades",
          query: { symbol, count: count ?? DEFAULT_TRADES_COUNT },
        }),
      ),
  );

  register(
    "toss_get_price_limits",
    {
      title: "Toss Get Price Limits",
      description:
        "Get upper and lower price limits for one KRX or US stock symbol.",
      inputSchema: {
        symbol: symbolSchema,
      },
    },
    ({ symbol }) =>
      runTool(() =>
        client.request({ path: "/api/v1/price-limits", query: { symbol } }),
      ),
  );

  register(
    "toss_get_candles",
    {
      title: "Toss Get Candles",
      description: `KR/US stock 1-minute or daily OHLCV. count defaults to ${DEFAULT_CANDLES_COUNT} (max 200); set it on the first call. Pass nextBefore as before (ISO 8601 with timezone).`,
      inputSchema: {
        symbol: symbolSchema,
        interval: z.enum(["1m", "1d"]),
        count: z.number().int().min(1).max(200).optional(),
        before: dateTimeSchema.optional(),
        adjusted: z.boolean().optional(),
      },
    },
    ({ symbol, interval, count, before, adjusted }) =>
      runTool(() =>
        client.request({
          path: "/api/v1/candles",
          query: {
            symbol,
            interval,
            count: count ?? DEFAULT_CANDLES_COUNT,
            before,
            adjusted,
          },
        }),
      ),
  );

  register(
    "toss_get_stocks",
    {
      title: "Toss Get Stocks",
      description:
        "Get stock master data for up to 200 comma-separated KRX or US stock symbols.",
      inputSchema: {
        symbols: symbolsSchema,
      },
    },
    ({ symbols }) =>
      runTool(() =>
        client.request({ path: "/api/v1/stocks", query: { symbols } }),
      ),
  );

  register(
    "toss_get_stock_warnings",
    {
      title: "Toss Get Stock Warnings",
      description: "Get buy warning flags for one KRX or US stock symbol.",
      inputSchema: {
        symbol: symbolSchema,
      },
    },
    ({ symbol }) =>
      runTool(() =>
        client.request({
          path: `/api/v1/stocks/${encodeURIComponent(symbol)}/warnings`,
        }),
      ),
  );

  register(
    "toss_get_exchange_rate",
    {
      title: "Toss Get Exchange Rate",
      description:
        "Get KRW/USD or USD/KRW exchange rate. Optional dateTime is ISO 8601 with timezone.",
      inputSchema: {
        baseCurrency: currencySchema,
        quoteCurrency: currencySchema,
        dateTime: dateTimeSchema.optional(),
      },
    },
    ({ baseCurrency, quoteCurrency, dateTime }) =>
      runTool(() =>
        client.request({
          path: "/api/v1/exchange-rate",
          query: { baseCurrency, quoteCurrency, dateTime },
        }),
      ),
  );

  register(
    "toss_get_kr_market_calendar",
    {
      title: "Toss Get KR Market Calendar",
      description:
        "Get Korean market calendar and session hours. date is optional YYYY-MM-DD.",
      inputSchema: {
        date: dateSchema.optional(),
      },
    },
    ({ date }) =>
      runTool(() =>
        client.request({ path: "/api/v1/market-calendar/KR", query: { date } }),
      ),
  );

  register(
    "toss_get_us_market_calendar",
    {
      title: "Toss Get US Market Calendar",
      description:
        "Get US market calendar and session hours. date is optional YYYY-MM-DD in US local date.",
      inputSchema: {
        date: dateSchema.optional(),
      },
    },
    ({ date }) =>
      runTool(() =>
        client.request({ path: "/api/v1/market-calendar/US", query: { date } }),
      ),
  );
}
