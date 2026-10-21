import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "../config.js";
import { resolveAccountSeq } from "../config.js";
import { executeTrade, reconcileAccepted } from "../guard/index.js";
import type { TossClient } from "../toss/client.js";
import {
  accountInputSchema,
  accountDescription,
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
        description: `List ${group}; preserve nextCursor/hasNext for pagination. OPEN regular orders ignore limit/cursor. ${accountDescription}`,
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
        description: `Fetch one ${group} by identifier. ${accountDescription}`,
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
  const instructions = `Real order, no sandbox. ${accountDescription} confirmHighValueOrder requires the user's high-value authorization; never set it automatically to bypass a rejection. Local budget uses lastPrice with configurable +/- buffer, not guaranteed execution value. Daily amount/count windows reset at fixed KST 20:01 for KR and 10:01 for US. Count caps are independent per account and market (KRW/USD); each reset clears only that market's amount and count.`;
  register(
    "toss_create_order",
    {
      title: "Toss Create Order",
      description: `${instructions} Provide quantity XOR orderAmount (US MARKET). Fractional quantity: US MARKET SELL only, up to 6 places, regular session until one hour before close. OPG: KR; CLS: US LIMIT.`,
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
      description: `${instructions} Replaces an order and returns a NEW orderId. KR requires quantity; US forbids quantity and uses unfilled quantity. orderType/price may default to existing values.`,
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
      description: `Cancel a real order; filled shares cannot be canceled. Cancellation operation ID can differ from the original. ${accountDescription}`,
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
  const conditionalDescription = `${instructions} Conditional budget applies on registration/modification day only, not future trigger day. SINGLE=one leg; OCO=max leg; OTO=sum. Per-order cap applies per leg. Future child orders are not charged a second time. OCO/OTO require LIMIT. expireDate is at most one year from today (Toss validates session/trigger rules).`;
  register(
    "toss_create_conditional_order",
    {
      title: "Toss Create Conditional Order",
      description: conditionalDescription,
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
      description: `${conditionalDescription} Supply the entire replacement definition. Returns a NEW conditionalOrderId; use it subsequently.`,
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
      description: `Cancel the conditional group. Triggered child orders require ordinary cancellation separately. ${accountDescription}`,
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
