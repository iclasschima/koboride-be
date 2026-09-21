import { api, json, options, AppError } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { presentTrip } from "@/lib/orders";
import { acceptRetentionOffer } from "@/lib/dispatch";

export const OPTIONS = () => options();

export const POST = api(async (req, ctx) => {
  const user = requireUser(req, ["customer"]);
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing order id", "VALIDATION_ERROR", 400);

  const order = await acceptRetentionOffer(id, user.sub);
  return json({ trip: presentTrip(order) });
});
