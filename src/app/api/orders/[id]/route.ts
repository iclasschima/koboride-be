import { api, json, options, AppError } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { getOrderOrThrow, presentRiderTrip, presentTrip } from "@/lib/orders";
import { getPlatformSettings } from "@/lib/settings";

export const OPTIONS = () => options();

export const GET = api(async (req, ctx) => {
  const user = requireUser(req);
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing order id", "VALIDATION_ERROR", 400);

  if (user.role === "customer") {
    const { runOrderMaintenance } = await import("@/lib/dispatch");
    await runOrderMaintenance();
  }

  const [order] = await Promise.all([getOrderOrThrow(id), getPlatformSettings()]);

  if (user.role === "admin") return json({ trip: presentTrip(order) });
  if (user.role === "customer" && order.customerId === user.sub) {
    return json({ trip: presentTrip(order) });
  }
  if (user.role === "rider" && order.riderId === user.sub) {
    return json({ trip: presentRiderTrip(order) });
  }

  throw new AppError("You cannot view this order", "FORBIDDEN", 403);
});
