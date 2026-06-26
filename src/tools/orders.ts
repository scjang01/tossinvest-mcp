import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Config } from "../config.js";
import { resolveAccountSeq } from "../config.js";
import {
  buildOrderRecord,
  generateClientOrderId,
  guardCancelOrder,
  guardCreateOrder,
  guardModifyOrder,
  recordOrder,
  resolveStatePath,
  withOrderLock
} from "../guard/index.js";
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
  const confirmOrderActionSchema = config.requireOrderConfirmation
    ? z.literal(true).describe("Required: set true to confirm the exact order before submitting.")
    : z
        .boolean()
        .optional()
        .describe("Optional because TOSSINVEST_REQUIRE_ORDER_CONFIRMATION=false. Other guardrails still apply.");
  const confirmationDescription = config.requireOrderConfirmation
    ? "Requires confirmOrderAction=true."
    : "TOSSINVEST_REQUIRE_ORDER_CONFIRMATION=false, so confirmOrderAction is optional; remaining guardrails still apply.";

  server.registerTool(
    "toss_create_order",
    {
      title: "Toss Create Order",
      description:
        `Create a real stock order. ${confirmationDescription} For LIMIT orders, price is required. Provide exactly one of quantity (shares) or orderAmount (US MARKET only, regular hours). Server-side guardrails may block this order. Toss has no sandbox environment.`,
      inputSchema: {
        ...accountInputSchema,
        confirmOrderAction: confirmOrderActionSchema,
        clientOrderId: z.string().max(36).regex(/^[a-zA-Z0-9-_]+$/).optional(),
        symbol: symbolSchema,
        side: z.enum(["BUY", "SELL"]),
        orderType: z.enum(["LIMIT", "MARKET"]),
        timeInForce: z.enum(["DAY", "CLS"]).optional(),
        quantity: z.string().regex(/^\d+(\.\d+)?$/).max(30).optional(),
        price: z.string().regex(/^\d+(\.\d+)?$/).max(30).optional(),
        orderAmount: z.string().regex(/^\d+(\.\d+)?$/).max(30).optional(),
        confirmHighValueOrder: z.boolean().optional()
      }
    },
    (input) =>
      runTool(async () => {
        const parsed = orderCreateSchema.parse(input);
        const accountSeq = resolveAccountSeq(parsed.accountSeq, config.defaultAccountSeq);

        // Serialize the daily-check -> place -> record critical section.
        return withOrderLock(async () => {
        const guardResult = await guardCreateOrder(client, config, {
          rawAccountSeq: parsed.accountSeq,
          resolvedAccountSeq: accountSeq,
          confirmOrderAction: parsed.confirmOrderAction,
          symbol: parsed.symbol,
          side: parsed.side,
          orderType: parsed.orderType,
          quantity: "quantity" in parsed ? parsed.quantity : undefined,
          price: "price" in parsed ? parsed.price : undefined,
          orderAmount: "orderAmount" in parsed ? parsed.orderAmount : undefined
        });

        const clientOrderId = parsed.clientOrderId ?? generateClientOrderId();
        const body = { ...withoutKeys(parsed, ["accountSeq", "confirmOrderAction"]), clientOrderId };

        const response = await client.request<unknown>({
          method: "POST",
          path: "/api/v1/orders",
          accountSeq,
          body
        });

        // The order has been placed. Recording guard state must NOT be able to
        // turn this success into an error response — otherwise the user may
        // retry and place a duplicate order (a fresh clientOrderId means no
        // idempotency protection). Isolate any recording failure as a warning.
        try {
          recordOrder(
            resolveStatePath(config),
            buildOrderRecord({
              account: accountSeq,
              symbol: parsed.symbol,
              side: parsed.side,
              orderType: parsed.orderType,
              currency: guardResult.currency,
              estimatedAmount: guardResult.estimatedAmount,
              orderId: extractOrderId(response),
              clientOrderId
            })
          );
        } catch (recordError) {
          const message = recordError instanceof Error ? recordError.message : String(recordError);
          console.error(`[guard] order placed but guard-state recording failed: ${message}`);
          if (response !== null && typeof response === "object" && !Array.isArray(response)) {
            return {
              ...(response as Record<string, unknown>),
              _guardStateWarning:
                `Order was placed successfully (clientOrderId=${clientOrderId}), but recording guard state failed: ${message}. ` +
                "Daily limits may undercount this order. Do NOT retry — the order already exists."
            };
          }
        }

        return response;
        });
      })
  );

  server.registerTool(
    "toss_modify_order",
    {
      title: "Toss Modify Order",
      description:
        `Modify a real stock order. This is not an in-place PATCH: Toss replaces the original order and returns a new orderId. Store and use the returned orderId for later detail, modify, or cancel calls. For KR stocks, quantity is required. For US stocks, quantity must not be provided (only price modification is supported). orderType is optional and defaults to the existing order's type. ${confirmationDescription}`,
      inputSchema: {
        ...accountInputSchema,
        confirmOrderAction: confirmOrderActionSchema,
        orderId: z.string().min(1),
        orderType: z.enum(["LIMIT", "MARKET"]).optional(),
        quantity: z.string().regex(/^\d+$/).max(30).optional(),
        price: z.string().regex(/^\d+(\.\d+)?$/).max(30).optional(),
        confirmHighValueOrder: z.boolean().optional()
      }
    },
    (input) =>
      runTool(async () => {
        const parsed = orderModifySchema.parse(input);
        const accountSeq = resolveAccountSeq(parsed.accountSeq, config.defaultAccountSeq);

        const guardResult = await guardModifyOrder(client, config, {
          rawAccountSeq: parsed.accountSeq,
          resolvedAccountSeq: accountSeq,
          confirmOrderAction: parsed.confirmOrderAction,
          orderId: parsed.orderId,
          orderType: parsed.orderType,
          quantity: parsed.quantity,
          price: parsed.price
        });

        // Build the replacement body from guard-resolved, spec-compliant values.
        // orderType is required by Toss; quantity/price are included only when allowed.
        const body: Record<string, unknown> = { orderType: guardResult.orderType };
        if (guardResult.quantity !== undefined) {
          body.quantity = guardResult.quantity;
        }
        if (guardResult.price !== undefined) {
          body.price = guardResult.price;
        }
        if (parsed.confirmHighValueOrder !== undefined) {
          body.confirmHighValueOrder = parsed.confirmHighValueOrder;
        }

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
      runTool(async () => {
        const parsed = orderCancelSchema.parse(input);
        const accountSeq = resolveAccountSeq(parsed.accountSeq, config.defaultAccountSeq);

        guardCancelOrder(config, {
          rawAccountSeq: parsed.accountSeq,
          confirmOrderAction: parsed.confirmOrderAction
        });

        return client.request({
          method: "POST",
          path: `/api/v1/orders/${encodeURIComponent(parsed.orderId)}/cancel`,
          accountSeq,
          // Toss requires Content-Type: application/json on POST; send an empty
          // JSON body so the header is set even though cancel has no fields.
          body: {}
        });
      })
  );
}

function extractOrderId(response: unknown): string | undefined {
  if (response === null || typeof response !== "object") {
    return undefined;
  }
  const root = (response as Record<string, unknown>).result ?? response;
  if (root === null || typeof root !== "object") {
    return undefined;
  }
  const orderId = (root as Record<string, unknown>).orderId;
  return typeof orderId === "string" ? orderId : undefined;
}
