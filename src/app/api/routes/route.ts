import { api, json, options, AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { osrmRoute } from "@/lib/osrm";

export const dynamic = "force-dynamic";

export const OPTIONS = () => options();

/** Live leg (rider → stop). The stored order route stays pickup → drop-off. */
export const GET = api(async (req) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  rateLimit(`routes:${ip}`, 60, 60_000);

  const url = new URL(req.url);
  const fromLat = Number(url.searchParams.get("fromLat"));
  const fromLng = Number(url.searchParams.get("fromLng"));
  const toLat = Number(url.searchParams.get("toLat"));
  const toLng = Number(url.searchParams.get("toLng"));
  if (![fromLat, fromLng, toLat, toLng].every(Number.isFinite)) {
    throw new AppError("Missing coordinates", "VALIDATION_ERROR", 400);
  }

  const route = await osrmRoute(fromLat, fromLng, toLat, toLng);
  if (!route) throw new AppError("No route for those stops", "ROUTE_UNAVAILABLE", 404);
  return json({
    distanceKm: Math.round(route.distanceKm * 10) / 10,
    durationSeconds: route.durationSeconds,
    geometry: route.geometry,
  });
});
