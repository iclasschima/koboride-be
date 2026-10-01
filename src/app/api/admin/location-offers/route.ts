import { z } from "zod";
import { api, json, options } from "@/lib/errors";
import { requireAdmin } from "@/lib/adminAuth";
import { assertOfferPlace, listLocationOffers, offerOrderCounts } from "@/lib/locationOffers";
import { prisma } from "@/lib/prisma";
import { parseBody, readJson } from "@/lib/validate";

export const OPTIONS = () => options();

const writeSchema = z.object({
  name: z.string().trim().min(2).max(80),
  address: z.string().trim().min(4).max(200),
  lat: z.number().finite(),
  lng: z.number().finite(),
  feeNgn: z.number().int().min(0).max(100_000),
  pickup: z.boolean(),
  dropoff: z.boolean(),
  maxUsesPerCustomer: z.number().int().min(1).max(100).nullable().optional(),
  active: z.boolean().optional(),
});

export const GET = api(async (req) => {
  await requireAdmin(req, "settings");
  const offers = await listLocationOffers();
  const counts = await offerOrderCounts(offers.map((offer) => offer.id));
  return json({
    offers: offers.map((offer) => ({ ...offer, orderCount: counts.get(offer.id) ?? 0 })),
  });
});

export const POST = api(async (req) => {
  await requireAdmin(req, "settings");
  const body = parseBody(writeSchema, await readJson(req));
  assertOfferPlace(body);
  const offer = await prisma.locationOffer.create({
    data: {
      name: body.name,
      address: body.address,
      lat: body.lat,
      lng: body.lng,
      feeNgn: body.feeNgn,
      pickup: body.pickup,
      dropoff: body.dropoff,
      maxUsesPerCustomer: body.maxUsesPerCustomer ?? null,
      active: body.active ?? true,
    },
  });
  return json({ offer }, 201);
});
