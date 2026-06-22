import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Config } from "../config.js";
import { resolveAccountSeq } from "../config.js";
import type { TossClient } from "../toss/client.js";
import {
  accountInputSchema,
  dateSchema,
  orderCancelSchema,
  orderCreateSchema,
  orderModifySchema,
  symbolSchema,
  withoutKeys
} from "../toss/schemas.js";
import { runTool } from "./common.js";

export function registerOrderTools(server: McpServer, client: TossClient, config: Config): void {
  registerOrderHistoryTools(server, client, config);

  if (!config.tradingEnabled) {
    return;
  }

  registerTradingTools(server, client, config);
}

function registerOrderHistoryTools(server: McpServer, client: TossClient, config: Config): void {
  server.registerTool(
    "toss_get_orders",
    {
      title: "Toss Get Orders",
      description:
        "List orders for an account using filters such as status, symbol, date range, cursor, and limit. Use this for order history or open-order lists, not for fetching a known single orderId.",
      inputSchema: {
        ...accountInputSchema,
        status: z.enum(["OPEN", "CLOSED"]),
        symbol: symbolSchema.optional(),
        from: dateSchema.optional(),
        to: dateSchema.optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional()
      }
    },
    ({ accountSeq, status, symbol, from, to, cursor, limit }) =>
      runTool(() =>
        client.request({
          path: "/api/v1/orders",
          accountSeq: resolveAccountSeq(accountSeq, config.defaultAccountSeq),
          query: { status, symbol, from, to, cursor, limit }
        })
      )
  );

  server.registerTool(
    "toss_get_order",
    {
      title: "Toss Get Order",
      description:
        "Fetch one specific order by its required orderId. Use toss_get_orders when you need to search or list orders by filters.",
      inputSchema: {
        ...accountInputSchema,
        orderId: z.string().min(1)
      }
    },
    ({ accountSeq, orderId }) =>
      runTool(() =>
        client.request({
          path: `/api/v1/orders/${encodeURIComponent(orderId)}`,
          accountSeq: resolveAccountSeq(accountSeq, config.defaultAccountSeq)
        })
      )
  );
}

function registerTradingTools(server: McpServer, client: TossClient, config: Config): void {
  const confirmOrderActionSchema = config.yoloTrading
    ? z.boolean().optional().describe("Optional only when TOSSINVEST_YOLO_TRADING=true. Otherwise true is required.")
    : z.literal(true);
  const confirmationDescription = config.yoloTrading
    ? "TOSSINVEST_YOLO_TRADING=true is enabled, so confirmOrderAction is optional. This can place real orders without a per-call confirmation flag."
    : "Requires confirmOrderAction=true.";

  server.registerTool(
    "toss_create_order",
    {
      title: "Toss Create Order",
      description:
        `Create a real stock order. ${confirmationDescription} For LIMIT orders, price is required. Provide exactly one of quantity (shares) or orderAmount (US MARKET only, regular hours). Toss has no sandbox environment.`,
      inputSchema: {
        ...accountInputSchema,
        confirmOrderAction: confirmOrderActionSchema,
        clientOrderId: z.string().max(36).regex(/^[a-zA-Z0-9-_]+$/).optional(),
        symbol: symbolSchema,
        side: z.enum(["BUY", "SELL"]),
        orderType: z.enum(["LIMIT", "MARKET"]),
        timeInForce: z.enum(["DAY", "CLS"]).optional(),
        quantity: z.string().regex(/^\d+$/).max(30).optional(),
        price: z.string().regex(/^\d+(\.\d+)?$/).max(30).optional(),
        orderAmount: z.string().regex(/^\d+(\.\d+)?$/).max(30).optional(),
        confirmHighValueOrder: z.boolean().optional()
      }
    },
    (input) =>
      runTool(() => {
        const parsed = orderCreateSchema.parse(applyYoloConfirmation(input, config));
        const accountSeq = resolveAccountSeq(parsed.accountSeq, config.defaultAccountSeq);
        const body = withoutKeys(parsed, ["accountSeq", "confirmOrderAction"]);

        return client.request({
          method: "POST",
          path: "/api/v1/orders",
          accountSeq,
          body
        });
      })
  );

  server.registerTool(
    "toss_modify_order",
    {
      title: "Toss Modify Order",
      description:
        `Modify a real stock order. This is not an in-place PATCH: Toss replaces the original order and returns a new orderId. Store and use the returned orderId for later detail, modify, or cancel calls. ${confirmationDescription}`,
      inputSchema: {
        ...accountInputSchema,
        confirmOrderAction: confirmOrderActionSchema,
        orderId: z.string().min(1),
        quantity: z.string().regex(/^\d+$/).max(30).optional(),
        price: z.string().regex(/^\d+(\.\d+)?$/).max(30).optional(),
        confirmHighValueOrder: z.boolean().optional()
      }
    },
    (input) =>
      runTool(() => {
        const parsed = orderModifySchema.parse(applyYoloConfirmation(input, config));
        const accountSeq = resolveAccountSeq(parsed.accountSeq, config.defaultAccountSeq);
        const body = withoutKeys(parsed, ["accountSeq", "confirmOrderAction", "orderId"]);

        return client.request({
          method: "POST",
          path: `/api/v1/orders/${encodeURIComponent(parsed.orderId)}/modify`,
          accountSeq,
          body
        });
      })
  );

  server.registerTool(
    "toss_cancel_order",
    {
      title: "Toss Cancel Order",
      description:
        `Cancel a real stock order. ${confirmationDescription} Toss returns an operation orderId, which can differ from the original orderId.`,
      inputSchema: {
        ...accountInputSchema,
        confirmOrderAction: confirmOrderActionSchema,
        orderId: z.string().min(1)
      }
    },
    (input) =>
      runTool(() => {
        const parsed = orderCancelSchema.parse(applyYoloConfirmation(input, config));
        const accountSeq = resolveAccountSeq(parsed.accountSeq, config.defaultAccountSeq);

        return client.request({
          method: "POST",
          path: `/api/v1/orders/${encodeURIComponent(parsed.orderId)}/cancel`,
          accountSeq
        });
      })
  );
}

function applyYoloConfirmation(input: unknown, config: Config): unknown {
  if (!config.yoloTrading || typeof input !== "object" || input === null || Array.isArray(input)) {
    return input;
  }

  return {
    confirmOrderAction: true,
    ...input
  };
}
