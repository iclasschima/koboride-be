import { z } from "zod";
import { api, json, options, AppError } from "@/lib/errors";
import { optionalUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseBody, readJson } from "@/lib/validate";
import { rateLimit } from "@/lib/rate-limit";
import { customerFeeNgn, quoteRoute } from "@/lib/fare";
import { getPlatformSettings } from "@/lib/settings";
import { assertZoneHasRiders, shopLive } from "@/lib/merchants";

export const OPTIONS = () => options();

export const POST = api(async (req, ctx) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  rateLimit(`shop-quote:${ip}`, 40, 60_000);
  const slug = ctx.params?.slug;
  if (!slug) throw new AppError("Missing shop", "VALIDATION_ERROR", 400);
  const merchant = await prisma.merchant.findUnique({ where: { slug } });
  if (!merchant || !shopLive(merchant) || merchant.lat == null || merchant.lng == null) {
    throw new AppError("This shop is not available", "NOT_FOUND", 404);
  }
  const body = parseBody(
    z.object({ dropoffLat: z.number().finite(), dropoffLng: z.number().finite() }),
    await readJson(req),
  );
  const user = optionalUser(req);
  const quote = await quoteRoute({
    pickup: merchant.name,
    dropoff: "dropoff",
    pickupLat: merchant.lat,
    pickupLng: merchant.lng,
    dropoffLat: body.dropoffLat,
    dropoffLng: body.dropoffLng,
    paymentMethod: "cash",
    customerId: user?.role === "customer" ? user.sub : undefined,
  });
  await assertZoneHasRiders(quote.zoneSlug);
  const settings = await getPlatformSettings();
  return json({
    feeNgn: quote.feeNgn,
    cardFeeNgn: customerFeeNgn(quote.listFeeNgn, "paystack", settings.onlinePaymentDiscountNgn),
  });
});
