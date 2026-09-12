import { z } from "zod";
import type { OrderStatus, RiderPhase } from "@prisma/client";
import { api, json, options, AppError } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { requireUser } from "@/lib/auth";
import { getOrderOrThrow, orderInclude, presentTrip } from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import {
  notifyAdminOrderStatus,
  notifyOrderAccepted,
  notifyOrderDelivered,
  notifySearchingRider,
} from "@/lib/push";

export const OPTIONS = () => options();

export const POST = api(async (req, ctx) => {
  requireUser(req, ["admin"]);
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing order id", "VALIDATION_ERROR", 400);

  const body = parseBody(
    z.object({
      status: z.enum(["dispatching", "in_progress", "completed", "cancelled"]),
      phase: z
        .enum(["accepted", "en_route_pickup", "collected", "en_route_dropoff", "delivered"])
        .nullable()
        .optional(),
    }),
    await readJson(req),
  );

  const order = await getOrderOrThrow(id);
  const data: {
    status: OrderStatus;
    riderPhase: RiderPhase | null;
    riderId?: string | null;
  } = {
    status: body.status,
    riderPhase: order.riderPhase,
  };

  if (body.status === "dispatching") {
    data.riderId = null;
    data.riderPhase = null;
  } else if (body.status === "in_progress") {
    if (!order.riderId) {
      throw new AppError("Assign a rider first", "NO_RIDER", 409);
    }
    data.riderPhase = body.phase ?? order.riderPhase ?? "accepted";
  } else if (body.status === "completed") {
    data.riderPhase = "delivered";
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    data,
    include: orderInclude,
  });

  if (order.status !== "dispatching" && updated.status === "dispatching") {
    await notifySearchingRider(updated);
  } else if (order.status === "dispatching" && updated.status === "in_progress") {
    await notifyOrderAccepted(updated);
  } else if (
    updated.riderPhase === "delivered" &&
    order.riderPhase !== "delivered" &&
    (updated.status === "in_progress" || updated.status === "completed")
  ) {
    await notifyOrderDelivered(updated);
  }
  if (order.status !== updated.status || order.riderPhase !== updated.riderPhase) {
    await notifyAdminOrderStatus(updated);
  }

  return json({ trip: presentTrip(updated) });
});
