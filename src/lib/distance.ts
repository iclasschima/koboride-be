import { config } from "@/lib/config";

const EARTH_RADIUS_KM = 6371;

export function haversineKm(
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number,
): number {
  const dLat = toRad(dropoffLat - pickupLat);
  const dLng = toRad(dropoffLng - pickupLng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(pickupLat)) * Math.cos(toRad(dropoffLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Bicycle (then driving) road distance in km. Falls back to straight-line
 * distance if Google routing is unavailable so the cap still applies.
 */
export async function roadDistanceKm(
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number,
): Promise<number> {
  const fromRoutes = await googleRoutesKm(pickupLat, pickupLng, dropoffLat, dropoffLng);
  if (fromRoutes != null) return fromRoutes;

  const fromMatrix = await googleDistanceMatrixKm(
    pickupLat,
    pickupLng,
    dropoffLat,
    dropoffLng,
  );
  if (fromMatrix != null) return fromMatrix;

  return haversineKm(pickupLat, pickupLng, dropoffLat, dropoffLng);
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function metersToKm(meters: number): number {
  return meters / 1000;
}

type RoutesBody = {
  routes?: Array<{ distanceMeters?: number }>;
  error?: { message?: string };
};

async function googleRoutesKm(
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number,
): Promise<number | null> {
  const key = config.googlePlacesApiKey;
  if (!key) return null;

  for (const travelMode of ["BICYCLE", "DRIVE"] as const) {
    try {
      const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
        method: "POST",
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask": "routes.distanceMeters",
        },
        body: JSON.stringify({
          origin: { location: { latLng: { latitude: pickupLat, longitude: pickupLng } } },
          destination: {
            location: { latLng: { latitude: dropoffLat, longitude: dropoffLng } },
          },
          travelMode,
        }),
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) continue;
      const body = (await res.json()) as RoutesBody;
      const meters = body.routes?.[0]?.distanceMeters;
      if (typeof meters === "number" && Number.isFinite(meters) && meters >= 0) {
        return metersToKm(meters);
      }
    } catch {
      continue;
    }
  }
  return null;
}

type DistanceMatrixBody = {
  status?: string;
  rows?: Array<{
    elements?: Array<{
      status?: string;
      distance?: { value?: number };
    }>;
  }>;
};

async function googleDistanceMatrixKm(
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number,
): Promise<number | null> {
  const key = config.googlePlacesApiKey;
  if (!key) return null;

  for (const mode of ["bicycling", "driving"] as const) {
    try {
      const params = new URLSearchParams({
        origins: `${pickupLat},${pickupLng}`,
        destinations: `${dropoffLat},${dropoffLng}`,
        mode,
        key,
      });
      const res = await fetch(
        `https://maps.googleapis.com/maps/api/distancematrix/json?${params}`,
        { cache: "no-store", signal: AbortSignal.timeout(8_000) },
      );
      if (!res.ok) continue;
      const body = (await res.json()) as DistanceMatrixBody;
      const element = body.rows?.[0]?.elements?.[0];
      const meters = element?.distance?.value;
      if (
        body.status === "OK" &&
        element?.status === "OK" &&
        typeof meters === "number" &&
        Number.isFinite(meters) &&
        meters >= 0
      ) {
        return metersToKm(meters);
      }
    } catch {
      continue;
    }
  }
  return null;
}
