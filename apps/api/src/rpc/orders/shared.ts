/**
 * Helpers shared by the order operations and the production scheduler.
 *
 * They live here rather than in either module because the scheduler reads
 * order lines and the order operations write them — putting them in one and
 * importing from the other would make the dependency point the wrong way.
 */
import { salesOrderLines, type salesOrders } from "@roastery/db/schema";
import { and, asc, eq } from "drizzle-orm";
import type { RpcContext } from "../../lib/api/rpc";
import { kg } from "../../lib/domain/inventory";

export function orderDto(o: typeof salesOrders.$inferSelect) {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    customerId: o.customerId,
    channel: o.channel,
    status: o.status,
    currency: o.currency,
    total: o.total,
    orderedAt: o.orderedAt.toISOString(),
    requestedShipAt: o.requestedShipAt ?? null,
  };
}

export function lineDto(l: typeof salesOrderLines.$inferSelect) {
  return {
    id: l.id,
    position: l.position,
    productId: l.productId ?? null,
    blendId: l.blendId ?? null,
    description: l.description,
    quantity: l.quantity,
    weightKg: l.weightKg,
    allocatedWeightKg: l.allocatedWeightKg,
    outstandingWeightKg: kg.sub(l.weightKg, l.allocatedWeightKg),
    unitPrice: l.unitPrice ?? null,
  };
}

export async function linesOf(ctx: RpcContext, orderId: string) {
  return ctx.db.query(async (t, scope) =>
    t
      .select()
      .from(salesOrderLines)
      .where(and(scope(salesOrderLines), eq(salesOrderLines.orderId, orderId)))
      .orderBy(asc(salesOrderLines.position)),
  );
}
