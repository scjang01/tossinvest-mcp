import type { Config } from "../config.js";
import type { TossClient } from "../toss/client.js";
import {
  contributionFromDetail,
  kstDate,
  readState,
  resolveStatePath,
  writeState,
  type OrderRecord
} from "./state.js";

/**
 * Refresh today's (KST) order records against the live Toss order state and
 * return them. This is the source of truth for daily limits: rather than trying
 * to keep a running balance in sync through every modify/cancel, we recompute
 * each open order's contribution from scratch at check time.
 *
 *  - Terminal orders (FILLED/CANCELED/REJECTED/REPLACED) are frozen: their
 *    contribution is the actually filled notional and they are never polled again.
 *  - Open orders are re-fetched via GET /orders/{orderId} and their contribution
 *    recomputed (filled + open remaining).
 *  - Records without an orderId (e.g. created before recording, or whose order id
 *    is unknown) keep their placement estimate — they cannot be polled.
 *
 * A failure to fetch an open order throws, so the caller blocks the new order
 * rather than acting on an unverifiable daily total. This is the single-session,
 * single-MCP accounting model: only orders placed through this server are tracked.
 */
export async function reconcileTodayRecords(client: TossClient, config: Config): Promise<OrderRecord[]> {
  const path = resolveStatePath(config);
  const all = readState(path);
  const today = kstDate();
  let mutated = false;

  const todays: OrderRecord[] = [];
  for (const record of all) {
    if (record.date !== today) {
      continue;
    }
    todays.push(record);

    if (record.terminal === true || record.orderId === undefined) {
      continue; // frozen, or not pollable — keep the cached/estimated contribution
    }

    let detail: unknown;
    try {
      detail = await client.request({
        path: `/api/v1/orders/${encodeURIComponent(record.orderId)}`,
        accountSeq: record.account
      });
    } catch (error) {
      throw new Error(
        `Order blocked: cannot reconcile open order ${record.orderId} against the daily limit: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    const contribution = contributionFromDetail(detail, record);
    record.status = contribution.status;
    record.filledAmount = contribution.filled;
    record.committedAmount = contribution.committed;
    record.terminal = contribution.terminal;
    if (contribution.currency !== undefined) {
      record.currency = contribution.currency;
    }
    mutated = true;
  }

  if (mutated) {
    writeState(path, all);
  }

  return todays;
}
