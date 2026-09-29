import { api, json, options } from "@/lib/errors";
import { optionalUser } from "@/lib/auth";
import {
  listLocationOffers,
  offerUsesByCustomer,
  publicOffer,
  usesLeft,
} from "@/lib/locationOffers";

export const dynamic = "force-dynamic";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  const user = optionalUser(req);
  const customerId = user?.role === "customer" ? user.sub : null;
  const offers = await listLocationOffers(true);
  const used = customerId
    ? await offerUsesByCustomer(
        customerId,
        offers.map((offer) => offer.id),
      )
    : new Map<string, number>();
  return json({
    offers: offers
      .map((offer) => ({
        ...publicOffer(offer),
        usesLeft: usesLeft(offer.maxUsesPerCustomer, used.get(offer.id) ?? 0),
      }))
      .filter((offer) => offer.usesLeft !== 0),
  });
});
