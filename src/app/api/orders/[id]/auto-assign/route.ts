import { api, json, options, AppError } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { assertCustomerOwns, getOrderOrThrow, presentTrip } from "@/lib/orders";
import { autoAssignOrder } from "@/lib/dispatch";

export const OPTIONS = () => options();

export const POST = api(async (req, ctx) => {
  const user = requireUser(req, ["customer"]);
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing order id", "VALIDATION_ERROR", 400);

  const order = await getOrderOrThrow(id);
  assertCustomerOwns(order, user.sub);

  if (order.status !== "dispatching") {
    return json({ trip: presentTrip(order) });
  }

  const assigned = await autoAssignOrder(order.id);
  return json({ trip: presentTrip(assigned ?? order) });
});
