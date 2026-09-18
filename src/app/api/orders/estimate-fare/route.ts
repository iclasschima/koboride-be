import { z } from "zod";
import { api, json, options } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { rateLimit } from "@/lib/rate-limit";
import { customerFeeNgn, quoteRoute } from "@/lib/fare";
import { getPlatformSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";

export const OPTIONS = () => options();

export const POST = api(async (req) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  rateLimit(`estimate-fare:${ip}`, 40, 60_000);

  const body = parseBody(
    z.object({
      pickupLat: z.number().finite(),
      pickupLng: z.number().finite(),
      dropoffLat: z.number().finite(),
      dropoffLng: z.number().finite(),
      pickup: z.string().min(1).optional(),
      dropoff: z.string().min(1).optional(),
    }),
    await readJson(req),
  );

  const [quote, settings] = await Promise.all([
    quoteRoute({
      pickup: body.pickup ?? "pickup",
      dropoff: body.dropoff ?? "dropoff",
      pickupLat: body.pickupLat,
      pickupLng: body.pickupLng,
      dropoffLat: body.dropoffLat,
      dropoffLng: body.dropoffLng,
    }),
    getPlatformSettings(),
  ]);

  const onlineFeeNgn = customerFeeNgn(
    quote.listFeeNgn,
    "paystack",
    settings.onlinePaymentDiscountNgn,
  );

  return json({
    feeNgn: quote.listFeeNgn,
    onlineFeeNgn,
    onlineDiscountNgn: quote.listFeeNgn - onlineFeeNgn,
    payoutNgn: quote.payoutNgn,
    distanceKm: quote.distanceKm,
    maxDistanceKm: quote.maxDistanceKm,
    baseFeeNgn: settings.baseFeeNgn,
    perKmFeeNgn: settings.perKmFeeNgn,
    minFareNgn: settings.minFareNgn,
  });
});
