import { haversineKm } from "@/lib/distance";

/** Alagomeji / Sabo. Surulere and Gbagada are not part of this circle. */
export const YABA_ZONE = {
  slug: "yaba",
  name: "Yaba",
  centerLat: 6.5055,
  centerLng: 3.3795,
  radiusKm: 4,
} as const;

export function isInActiveServiceArea(lat: number, lng: number): boolean {
  return haversineKm(YABA_ZONE.centerLat, YABA_ZONE.centerLng, lat, lng) <= YABA_ZONE.radiusKm;
}

export function activeServiceCircle() {
  return {
    centerLat: YABA_ZONE.centerLat,
    centerLng: YABA_ZONE.centerLng,
    radiusMeters: YABA_ZONE.radiusKm * 1000,
  };
}
