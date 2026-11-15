import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "../config.js";
import { resolveAccountSeq } from "../config.js";
import { executeTrade, reconcileAccepted } from "../guard/index.js";
import type { TossClient } from "../toss/client.js";
import {
  accountInputSchema,
  dateSchema,
  orderCancelSchema,
  orderCreateSchema,
  orderCreateFields,
  orderModifySchema,
  symbolSchema,
  withoutKeys,
  conditionalFields,
  conditionalCreateSchema,
  validatedConditionalModifySchema,
  clientOrderIdSchema,
} from "../toss/schemas.js";
import { registrar, runTool } from "./common.js";
export function registerOrderTools(
  server: McpServer,
  client: TossClient,
  config: Config,
): void {
  const register = registrar(server);
  const account = accountInputSchema(config);
  for (const kind of ["order", "conditional"] as const) {
    const conditional = kind === "conditional";
    const group = conditional ? "conditional-orders" : "orders";
    const key = conditional ? "conditionalOrderId" : "orderId";
    register(
      conditional ? "toss_get_conditional_orders" : "toss_get_orders",
      {
        title: conditional ? "Toss Get Conditional Orders" : "Toss Get Orders",
        description: conditional
          ? "List conditional orders. If hasNext, pass nextCursor as cursor."
          : "List regular orders. If hasNext, pass nextCursor as cursor. OPEN ignores limit and cursor.",
        inputSchema: {
          ...account,
          status: z.enum(["OPEN", "CLOSED"]),
          symbol: symbolSchema.optional(),
          ...(conditional
            ? {}
            : { from: dateSchema.optional(), to: dateSchema.optional() }),
          cursor: z.string().min(1).optional(),
          limit: z.number().int().min(1).max(100).optional(),
        },
      },
      (input) =>
        runTool(() =>
          client.request({
            path: `/api/v1/${group}`,
            accountSeq: resolveAccountSeq(
              input.accountSeq,
              config.defaultAccountSeq,
            ),
            query: withoutKeys(input, ["accountSeq"]) as Record<
              string,
              string | number | boolean | undefined
            >,
          }),
        ),
    );
    register(
      conditional ? "toss_get_conditional_order" : "toss_get_order",
      {
        title: `Toss Get ${conditional ? "Conditional " : ""}Order`,
        description: `Get one ${conditional ? "conditional" : "regular"} order by ${key}.`,
        inputSchema: { ...account, [key]: z.string().min(1) },
      },
      (input) =>
        runTool(async () => {
          const accountSeq = resolveAccountSeq(
            input.accountSeq as number | undefined,
            config.defaultAccountSeq,
          );
          const id = String((input as Record<string, unknown>)[key]);
          let response;
          try {
            response = await client.request({
              path: `/api/v1/${group}/${encodeURIComponent(String((input as Record<string, unknown>)[key]))}`,
              accountSeq,
            });
          } catch (error) {
            // A deleted conditional may no longer have a history row. A read
            // can settle its pending cancel conservatively without resending it.
            try {
              await reconcileAccepted(client, config, accountSeq, id);
            } catch {}
            throw error;
          }
          try {
            await reconcileAccepted(client, config, accountSeq, id);
          } catch {
            return {
              ...(response as object),
              _guardStateWarning:
                "Order details retrieved; accepted-operation budget could not be reconciled. Existing reservations are retained.",
            };
          }
          return response;
        }),
    );
  }
  if (!config.tradingEnabled) return;
  const unknownAcceptance =
    "If acceptance is unknown, check order status before retrying.";
  const createRetry =
    "If acceptance is unknown, check orders; never resubmit with a new clientOrderId.";
  register(
    "toss_create_order",
    {
      title: "Toss Create Order",
      description: `Submit a real order. LIMIT needs integer quantity and a price; MARKET omits price. Use exactly one of quantity or US MARKET orderAmount; orderAmount forbids timeInForce. Fractional quantity: US MARKET SELL only, max 6 decimals, regular session until 1h before close. OPG: KR; CLS: US LIMIT. ${createRetry}`,
      inputSchema: { ...orderCreateFields, ...account },
    },
    (input) =>
      runTool(async () => {
        const parsed = orderCreateSchema.parse(input);
        return executeTrade(client, config, {
          account: resolveAccountSeq(
            parsed.accountSeq,
            config.defaultAccountSeq,
          ),
          kind: "order",
          action: "create",
          body: withoutKeys(parsed, ["accountSeq"]),
        });
      }),
  );
  register(
    "toss_modify_order",
    {
      title: "Toss Modify Order",
      description: `Replace a real order; use the new orderId. KR requires quantity; US omits it and uses the unfilled quantity. orderType and LIMIT price can inherit existing values; MARKET omits price. ${unknownAcceptance}`,
      inputSchema: { ...orderModifySchema.shape, ...account },
    },
    (input) =>
      runTool(async () => {
        const parsed = orderModifySchema.parse(input);
        return executeTrade(client, config, {
          account: resolveAccountSeq(
            parsed.accountSeq,
            config.defaultAccountSeq,
          ),
          kind: "order",
          action: "modify",
          targetId: parsed.orderId,
          body: withoutKeys(parsed, ["accountSeq", "orderId"]),
        });
      }),
  );
  register(
    "toss_cancel_order",
    {
      title: "Toss Cancel Order",
      description:
        "Cancel the remaining unfilled quantity of a real order. Cancellation ID may differ from the original order ID.",
      inputSchema: { ...orderCancelSchema.shape, ...account },
    },
    (input) =>
      runTool(async () => {
        const p = orderCancelSchema.parse(input);
        return executeTrade(client, config, {
          account: resolveAccountSeq(p.accountSeq, config.defaultAccountSeq),
          kind: "order",
          action: "cancel",
          targetId: p.orderId,
          body: {},
        });
      }),
  );
  const conditionalRules =
    "SINGLE uses first only; OCO and OTO require LIMIT, with SELL/SELL or BUY/SELL respectively. LIMIT legs need orderPrice; MARKET omits it. expireDate: within one year. Budget applies at registration/change only (SINGLE one, OCO max, OTO sum; cap per leg).";
  register(
    "toss_create_conditional_order",
    {
      title: "Toss Create Conditional Order",
      description: `Register a real conditional order. ${conditionalRules} ${createRetry}`,
      inputSchema: {
        ...conditionalFields,
        symbol: symbolSchema,
        clientOrderId: clientOrderIdSchema.optional(),
        ...account,
      },
    },
    (input) =>
      runTool(async () => {
        const { accountSeq, ...body } = input;
        const parsed = conditionalCreateSchema.parse(body);
        return executeTrade(client, config, {
          account: resolveAccountSeq(accountSeq, config.defaultAccountSeq),
          kind: "conditional",
          action: "create",
          body: parsed,
        });
      }),
  );
  register(
    "toss_modify_conditional_order",
    {
      title: "Toss Modify Conditional Order",
      description: `Replace the full definition of a real conditional order; use the new conditionalOrderId. ${conditionalRules} ${unknownAcceptance}`,
      inputSchema: {
        ...conditionalFields,
        conditionalOrderId: z.string().min(1),
        ...account,
      },
    },
    (input) =>
      runTool(async () => {
        const { accountSeq, conditionalOrderId, ...body } = input;
        const parsed = validatedConditionalModifySchema.parse(body);
        return executeTrade(client, config, {
          account: resolveAccountSeq(accountSeq, config.defaultAccountSeq),
          kind: "conditional",
          action: "modify",
          targetId: conditionalOrderId,
          body: parsed,
        });
      }),
  );
  register(
    "toss_cancel_conditional_order",
    {
      title: "Toss Cancel Conditional Order",
      description:
        "Cancel a real conditional order group. Cancel any triggered child order separately.",
      inputSchema: { conditionalOrderId: z.string().min(1), ...account },
    },
    (input) =>
      runTool(() =>
        executeTrade(client, config, {
          account: resolveAccountSeq(
            input.accountSeq,
            config.defaultAccountSeq,
          ),
          kind: "conditional",
          action: "cancel",
          targetId: input.conditionalOrderId,
          body: {},
        }),
      ),
  );
}
