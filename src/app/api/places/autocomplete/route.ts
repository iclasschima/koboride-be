import { api, json, options } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { autocompletePlaces } from "@/lib/google-places";

export const dynamic = "force-dynamic";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  rateLimit(`places:${ip}`, 40, 60_000);

  const url = new URL(req.url);
  const q = url.searchParams.get("q") ?? "";
  const session = url.searchParams.get("session") ?? undefined;
  const fromLat = Number(url.searchParams.get("fromLat"));
  const fromLng = Number(url.searchParams.get("fromLng"));
  if (q.trim().length < 2) return json({ places: [] });

  const origin =
    Number.isFinite(fromLat) && Number.isFinite(fromLng)
      ? { lat: fromLat, lng: fromLng }
      : undefined;
  const places = await autocompletePlaces(q, session, origin);
  return json({ places });
});
