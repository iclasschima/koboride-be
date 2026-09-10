import { api, json, options, AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { reverseGeocode } from "@/lib/google-places";

export const dynamic = "force-dynamic";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  rateLimit(`places:${ip}`, 40, 60_000);

  const url = new URL(req.url);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new AppError("Missing coordinates", "VALIDATION_ERROR", 400);
  }

  const place = await reverseGeocode(lat, lng);
  return json({ place });
});
