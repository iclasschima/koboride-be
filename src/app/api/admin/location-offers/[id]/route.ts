import { z } from "zod";
import { api, json, options, AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/adminAuth";
import { assertOfferPlace } from "@/lib/locationOffers";
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
  maxUsesPerCustomer: z.number().int().min(1).max(100).nullable(),
  active: z.boolean(),
});

export const PATCH = api(async (req, ctx) => {
  await requireAdmin(req, "settings");
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing offer id", "VALIDATION_ERROR", 400);
  const body = parseBody(writeSchema, await readJson(req));
  assertOfferPlace(body);
  const existing = await prisma.locationOffer.findUnique({ where: { id } });
  if (!existing) throw new AppError("Offer not found", "NOT_FOUND", 404);
  const offer = await prisma.locationOffer.update({
    where: { id },
    data: body,
  });
  return json({ offer });
});

export const DELETE = api(async (req, ctx) => {
  await requireAdmin(req, "settings");
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing offer id", "VALIDATION_ERROR", 400);
  const existing = await prisma.locationOffer.findUnique({ where: { id } });
  if (!existing) throw new AppError("Offer not found", "NOT_FOUND", 404);
  await prisma.locationOffer.delete({ where: { id } });
  return json({ ok: true });
});
