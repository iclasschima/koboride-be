import { z } from "zod";
import { api, json, options } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { rateLimit } from "@/lib/rate-limit";
import { quoteRoute } from "@/lib/fare";

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

  const quote = await quoteRoute({
    pickup: body.pickup ?? "pickup",
    dropoff: body.dropoff ?? "dropoff",
    pickupLat: body.pickupLat,
    pickupLng: body.pickupLng,
    dropoffLat: body.dropoffLat,
    dropoffLng: body.dropoffLng,
  });

  return json({
    feeNgn: quote.feeNgn,
    payoutNgn: quote.payoutNgn,
    distanceKm: quote.distanceKm,
    maxDistanceKm: quote.maxDistanceKm,
  });
});
