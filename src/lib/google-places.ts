import { config } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { isInYabaZone, YABA_ZONE } from "@/lib/fare";

export type PlaceSuggestion = {
  id: string;
  name: string;
  area: string;
  source: "google";
};

export type PlaceDetails = {
  id: string;
  name: string;
  area: string;
  lat: number;
  lng: number;
};

type AutocompleteBody = {
  suggestions?: Array<{
    placePrediction?: {
      placeId?: string;
      structuredFormat?: {
        mainText?: { text?: string };
        secondaryText?: { text?: string };
      };
      text?: { text?: string };
    };
  }>;
  error?: { message?: string; status?: string };
};

type DetailsBody = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  error?: { message?: string };
};

function requireKey(): string {
  if (!config.googlePlacesApiKey) {
    throw new AppError(
      "Google Places is not configured. Set GOOGLE_PLACES_API_KEY.",
      "PLACES_NOT_CONFIGURED",
      503,
    );
  }
  return config.googlePlacesApiKey;
}

async function google<T>(path: string, init: RequestInit, fieldMask?: string): Promise<T> {
  const key = requireKey();
  const res = await fetch(`https://places.googleapis.com/v1/${path}`, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      ...(fieldMask ? { "X-Goog-FieldMask": fieldMask } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) {
    throw new AppError(
      body.error?.message || "Google Places request failed",
      "PLACES_ERROR",
      502,
    );
  }
  return body;
}

export async function autocompletePlaces(
  query: string,
  sessionToken?: string,
): Promise<PlaceSuggestion[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const body = await google<AutocompleteBody>(
    "places:autocomplete",
    {
      method: "POST",
      body: JSON.stringify({
        input: q,
        includedRegionCodes: ["ng"],
        languageCode: "en",
        locationRestriction: {
          rectangle: {
            low: { latitude: YABA_ZONE.minLat, longitude: YABA_ZONE.minLng },
            high: { latitude: YABA_ZONE.maxLat, longitude: YABA_ZONE.maxLng },
          },
        },
        ...(sessionToken ? { sessionToken } : {}),
      }),
    },
    "suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.text",
  );

  return (body.suggestions ?? [])
    .map((s) => s.placePrediction)
    .filter((p): p is NonNullable<typeof p> => Boolean(p?.placeId))
    .map((p) => ({
      id: p.placeId!,
      name: p.structuredFormat?.mainText?.text ?? p.text?.text ?? "Place",
      area: p.structuredFormat?.secondaryText?.text ?? "Lagos",
      source: "google" as const,
    }))
    .slice(0, 8);
}

export async function getPlaceDetails(
  placeId: string,
  sessionToken?: string,
): Promise<PlaceDetails> {
  const id = placeId.replace(/^places\//, "");
  const params = sessionToken
    ? `?sessionToken=${encodeURIComponent(sessionToken)}`
    : "";
  const body = await google<DetailsBody>(
    `places/${encodeURIComponent(id)}${params}`,
    { method: "GET" },
    "id,displayName,formattedAddress,location",
  );

  const lat = body.location?.latitude;
  const lng = body.location?.longitude;
  if (typeof lat !== "number" || typeof lng !== "number") {
    throw new AppError("That place has no map location", "PLACE_NO_LOCATION", 502);
  }
  if (!isInYabaZone(lat, lng)) {
    throw new AppError("KoboRide only operates in Yaba", "OUTSIDE_SERVICE_AREA", 400);
  }

  return {
    id: body.id ?? id,
    name: body.displayName?.text ?? "Place",
    area: body.formattedAddress ?? "Lagos",
    lat,
    lng,
  };
}
