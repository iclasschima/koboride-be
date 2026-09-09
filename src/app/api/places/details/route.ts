import { api, json, options, AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rate-limit";
import { getPlaceDetails } from "@/lib/google-places";

export const dynamic = "force-dynamic";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  rateLimit(`places:${ip}`, 40, 60_000);

  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";
  const session = url.searchParams.get("session") ?? undefined;
  if (!id.trim()) throw new AppError("Missing place id", "VALIDATION_ERROR", 400);

  const place = await getPlaceDetails(id, session);
  return json({ place });
});
