import { config } from "@/lib/config";

export type RouteLine = {
  type: "LineString";
  coordinates: [number, number][];
};

export type OsrmRoute = {
  distanceKm: number;
  durationSeconds: number;
  geometry: RouteLine;
};

type OsrmResponse = {
  code?: string;
  routes?: Array<{
    distance?: number;
    duration?: number;
    geometry?: RouteLine;
  }>;
};

/**
 * Public OSRM is for local testing only. Set OSRM_BASE_URL to a self-hosted
 * server before production — the demo host has no uptime guarantee.
 */
export async function osrmRoute(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): Promise<OsrmRoute | null> {
  const base = config.osrmBaseUrl.replace(/\/$/, "");
  const path = `${fromLng},${fromLat};${toLng},${toLat}`;
  for (const profile of ["bike", "driving"] as const) {
    try {
      const url = `${base}/route/v1/${profile}/${path}?overview=full&geometries=geojson`;
      const res = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      if (!res.ok) continue;
      const body = (await res.json()) as OsrmResponse;
      const route = body.routes?.[0];
      const geometry = route?.geometry;
      if (
        body.code !== "Ok" ||
        !geometry ||
        geometry.type !== "LineString" ||
        !Array.isArray(geometry.coordinates) ||
        geometry.coordinates.length < 2 ||
        typeof route.distance !== "number" ||
        typeof route.duration !== "number"
      ) {
        continue;
      }
      return {
        distanceKm: route.distance / 1000,
        durationSeconds: Math.max(1, Math.round(route.duration)),
        geometry,
      };
    } catch {
      continue;
    }
  }
  return null;
}
