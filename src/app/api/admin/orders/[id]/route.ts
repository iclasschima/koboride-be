import { api, json, options, AppError } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { getOrderOrThrow, presentTrip } from "@/lib/orders";

export const OPTIONS = () => options();

export const GET = api(async (req, ctx) => {
  requireUser(req, ["admin"]);
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing order id", "VALIDATION_ERROR", 400);
  return json({ trip: presentTrip(await getOrderOrThrow(id)) });
});
