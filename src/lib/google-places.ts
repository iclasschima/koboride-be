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
    .map((p) => {
      const main = p.structuredFormat?.mainText?.text?.trim();
      const secondary = p.structuredFormat?.secondaryText?.text?.trim();
      const full = p.text?.text?.trim() || [main, secondary].filter(Boolean).join(", ");
      return {
        id: p.placeId!,
        name: full || "Place",
        area: secondary && full && !full.includes(secondary) ? secondary : "",
        source: "google" as const,
      };
    })
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

  const formatted = body.formattedAddress?.trim();
  const shortName = body.displayName?.text?.trim();

  return {
    id: body.id ?? id,
    name: formatted || shortName || "Place",
    area: shortName && formatted && !formatted.includes(shortName) ? shortName : "Yaba",
    lat,
    lng,
  };
}

type GeocodeBody = {
  status?: string;
  error_message?: string;
  results?: Array<{
    formatted_address?: string;
    types?: string[];
    address_components?: Array<{
      long_name: string;
      short_name: string;
      types: string[];
    }>;
  }>;
};

type NearbyBody = {
  places?: Array<{
    displayName?: { text?: string };
    shortFormattedAddress?: string;
    formattedAddress?: string;
  }>;
  error?: { message?: string };
};

function geoComponent(
  result: NonNullable<GeocodeBody["results"]>[number],
  type: string,
): string | undefined {
  return result.address_components?.find((c) => c.types.includes(type))?.long_name;
}

function isWeakLabel(name: string): boolean {
  const n = name.trim();
  if (n.length < 3) return true;
  if (/^[A-Z0-9]{4,}\+[A-Z0-9]{2,}/i.test(n)) return true;
  return /^(lekki west|lagos|nigeria|yaba|current location)$/i.test(n);
}

function streetNameFromGeocode(result: NonNullable<GeocodeBody["results"]>[number]): string {
  const premise = geoComponent(result, "premise");
  const number = geoComponent(result, "street_number");
  const route = geoComponent(result, "route");
  if (premise && route) return `${premise}, ${route}`;
  if (number && route) return `${number} ${route}`;
  if (route) return route;
  const formatted = result.formatted_address ?? "Current location";
  return formatted.split(",")[0]?.trim() || formatted;
}

type GeoV4Body = {
  results?: Array<{
    formattedAddress?: string;
    address?: {
      formattedAddress?: string;
      addressComponents?: Array<{
        longText?: string;
        types?: string[];
      }>;
    };
    addressComponents?: Array<{
      longText?: string;
      types?: string[];
    }>;
  }>;
};

function v4Component(
  result: NonNullable<GeoV4Body["results"]>[number],
  type: string,
): string | undefined {
  const parts = result.address?.addressComponents ?? result.addressComponents ?? [];
  return parts.find((c) => c.types?.includes(type))?.longText;
}

async function reverseFromGeocodeV4(lat: number, lng: number): Promise<PlaceDetails | null> {
  const key = requireKey();
  const res = await fetch(
    `https://geocode.googleapis.com/v4beta/geocode/location/${lat},${lng}?languageCode=en`,
    {
      cache: "no-store",
      headers: { "X-Goog-Api-Key": key },
    },
  );
  if (!res.ok) return null;
  const body = (await res.json()) as GeoV4Body;
  const best = body.results?.[0];
  if (!best) return null;
  const number = v4Component(best, "street_number");
  const route = v4Component(best, "route");
  const premise = v4Component(best, "premise");
  const formatted = best.formattedAddress ?? best.address?.formattedAddress ?? "";
  const name =
    (premise && route && `${premise}, ${route}`) ||
    (number && route && `${number} ${route}`) ||
    route ||
    formatted.split(",")[0]?.trim() ||
    "Current location";
  const area =
    v4Component(best, "neighborhood") ??
    v4Component(best, "sublocality") ??
    v4Component(best, "sublocality_level_1") ??
    "Yaba";
  return { id: `geo:${lat.toFixed(6)},${lng.toFixed(6)}`, name, area, lat, lng };
}

async function reverseFromGeocoding(lat: number, lng: number): Promise<PlaceDetails | null> {
  const fromV4 = await reverseFromGeocodeV4(lat, lng);
  if (fromV4) return fromV4;

  const key = requireKey();
  const query = (extra?: Record<string, string>) => {
    const params = new URLSearchParams({
      latlng: `${lat},${lng}`,
      key,
      language: "en",
      ...extra,
    });
    return fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`, {
      cache: "no-store",
    }).then((res) => res.json() as Promise<GeocodeBody>);
  };

  let body = await query({
    result_type: "street_address|premise|route|subpremise",
  });
  if (body.status === "ZERO_RESULTS") body = await query();
  if (body.status === "REQUEST_DENIED" || body.status === "OVER_QUERY_LIMIT") {
    return null;
  }
  if (body.status !== "OK" || !body.results?.[0]) return null;

  const best =
    body.results.find((r) => r.types?.some((t) => t === "street_address" || t === "premise")) ??
    body.results[0];
  const area =
    geoComponent(best, "neighborhood") ??
    geoComponent(best, "sublocality") ??
    geoComponent(best, "sublocality_level_1") ??
    "Yaba";

  return {
    id: `geo:${lat.toFixed(6)},${lng.toFixed(6)}`,
    name: streetNameFromGeocode(best),
    area,
    lat,
    lng,
  };
}

async function reverseFromNearby(lat: number, lng: number): Promise<PlaceDetails | null> {
  const body = await google<NearbyBody>(
    "places:searchNearby",
    {
      method: "POST",
      body: JSON.stringify({
        maxResultCount: 5,
        rankPreference: "DISTANCE",
        languageCode: "en",
        locationRestriction: {
          circle: {
            center: { latitude: lat, longitude: lng },
            radius: 120,
          },
        },
      }),
    },
    "places.displayName,places.shortFormattedAddress,places.formattedAddress",
  );
  const place = body.places?.[0];
  if (!place) return null;
  const formatted = place.formattedAddress ?? place.shortFormattedAddress ?? "";
  const streetPart = formatted
    .split(",")
    .map((p) => p.trim())
    .find((p) =>
      /\b(way|road|rd|street|st|close|avenue|ave|crescent|drive|lane|market|gate)\b/i.test(p),
    );
  const name = place.displayName?.text || streetPart || "Current location";
  return {
    id: `near:${lat.toFixed(6)},${lng.toFixed(6)}`,
    name: isWeakLabel(name) ? streetPart || name : name,
    area: "Yaba",
    lat,
    lng,
  };
}

export async function reverseGeocode(lat: number, lng: number): Promise<PlaceDetails> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new AppError("Invalid coordinates", "VALIDATION_ERROR", 400);
  }
  if (!isInYabaZone(lat, lng)) {
    throw new AppError("KoboRide only operates in Yaba", "OUTSIDE_SERVICE_AREA", 400);
  }

  const fromGeo = await reverseFromGeocoding(lat, lng);
  if (fromGeo && !isWeakLabel(fromGeo.name)) return fromGeo;

  try {
    const nearby = await reverseFromNearby(lat, lng);
    if (nearby && !isWeakLabel(nearby.name)) return nearby;
    if (fromGeo && !isWeakLabel(fromGeo.area)) {
      return { ...fromGeo, name: fromGeo.area };
    }
    if (nearby) return nearby;
  } catch {
    if (fromGeo) return fromGeo;
  }

  return (
    fromGeo ?? {
      id: `gps:${lat.toFixed(6)},${lng.toFixed(6)}`,
      name: "Current location",
      area: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      lat,
      lng,
    }
  );
}
