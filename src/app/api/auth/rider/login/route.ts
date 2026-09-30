import { requireCustomer, signInRider } from "@/lib/auth";
import { api, json, options } from "@/lib/errors";

export const OPTIONS = () => options();

/** Opens the rider app for a customer who already confirmed their phone with a code. */
export const POST = api(async (req) => {
  const customer = await requireCustomer(req);
  return json(await signInRider(customer.phone));
});
