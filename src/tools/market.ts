import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { TossClient } from "../toss/client.js";
import { currencySchema, dateSchema, symbolSchema, symbolsSchema } from "../toss/schemas.js";
import { runTool } from "./common.js";

export function registerMarketTools(server: McpServer, client: TossClient): void {
  server.registerTool(
    "toss_get_orderbook",
    {
      title: "Toss Get Orderbook",
      description: "Get orderbook data for one KRX or US stock symbol.",
      inputSchema: {
        symbol: symbolSchema
      }
    },
    ({ symbol }) => runTool(() => client.request({ path: "/api/v1/orderbook", query: { symbol } }))
  );

  server.registerTool(
    "toss_get_prices",
    {
      title: "Toss Get Prices",
      description: "Get current prices for up to 200 comma-separated KRX or US stock symbols.",
      inputSchema: {
        symbols: symbolsSchema
      }
    },
    ({ symbols }) => runTool(() => client.request({ path: "/api/v1/prices", query: { symbols } }))
  );

  server.registerTool(
    "toss_get_trades",
    {
      title: "Toss Get Trades",
      description: "Get recent trades for one KRX or US stock symbol. count defaults to the Toss API default and is capped at 50.",
      inputSchema: {
        symbol: symbolSchema,
        count: z.number().int().min(1).max(50).optional()
      }
    },
    ({ symbol, count }) => runTool(() => client.request({ path: "/api/v1/trades", query: { symbol, count } }))
  );

  server.registerTool(
    "toss_get_price_limits",
    {
      title: "Toss Get Price Limits",
      description: "Get upper and lower price limits for one KRX or US stock symbol.",
      inputSchema: {
        symbol: symbolSchema
      }
    },
    ({ symbol }) => runTool(() => client.request({ path: "/api/v1/price-limits", query: { symbol } }))
  );

  server.registerTool(
    "toss_get_candles",
    {
      title: "Toss Get Candles",
      description: "Get 1-minute or daily OHLCV candles for one KRX or US stock symbol.",
      inputSchema: {
        symbol: symbolSchema,
        interval: z.enum(["1m", "1d"]),
        count: z.number().int().min(1).max(200).optional(),
        before: z.string().datetime({ offset: true }).optional(),
        adjusted: z.boolean().optional()
      }
    },
    ({ symbol, interval, count, before, adjusted }) =>
      runTool(() => client.request({ path: "/api/v1/candles", query: { symbol, interval, count, before, adjusted } }))
  );

  server.registerTool(
    "toss_get_stocks",
    {
      title: "Toss Get Stocks",
      description: "Get stock master data for up to 200 comma-separated KRX or US stock symbols.",
      inputSchema: {
        symbols: symbolsSchema
      }
    },
    ({ symbols }) => runTool(() => client.request({ path: "/api/v1/stocks", query: { symbols } }))
  );

  server.registerTool(
    "toss_get_stock_warnings",
    {
      title: "Toss Get Stock Warnings",
      description: "Get buy warning flags for one KRX or US stock symbol.",
      inputSchema: {
        symbol: symbolSchema
      }
    },
    ({ symbol }) => runTool(() => client.request({ path: `/api/v1/stocks/${encodeURIComponent(symbol)}/warnings` }))
  );

  server.registerTool(
    "toss_get_exchange_rate",
    {
      title: "Toss Get Exchange Rate",
      description: "Get KRW/USD or USD/KRW exchange rate. dateTime is optional ISO 8601.",
      inputSchema: {
        baseCurrency: currencySchema,
        quoteCurrency: currencySchema,
        dateTime: z.string().datetime({ offset: true }).optional()
      }
    },
    ({ baseCurrency, quoteCurrency, dateTime }) =>
      runTool(() =>
        client.request({
          path: "/api/v1/exchange-rate",
          query: { baseCurrency, quoteCurrency, dateTime }
        })
      )
  );

  server.registerTool(
    "toss_get_kr_market_calendar",
    {
      title: "Toss Get KR Market Calendar",
      description: "Get Korean market calendar and session hours. date is optional YYYY-MM-DD.",
      inputSchema: {
        date: dateSchema.optional()
      }
    },
    ({ date }) => runTool(() => client.request({ path: "/api/v1/market-calendar/KR", query: { date } }))
  );

  server.registerTool(
    "toss_get_us_market_calendar",
    {
      title: "Toss Get US Market Calendar",
      description: "Get US market calendar and session hours. date is optional YYYY-MM-DD in US local date.",
      inputSchema: {
        date: dateSchema.optional()
      }
    },
    ({ date }) => runTool(() => client.request({ path: "/api/v1/market-calendar/US", query: { date } }))
  );
}
