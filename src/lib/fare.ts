import { config, riderPayoutNgn } from "@/lib/config";
import { roadDistanceKm } from "@/lib/distance";
import { AppError } from "@/lib/errors";

/** Yaba / Akoka / Onike / Adekunle / Jibowu. Keep in sync with koboride-fe `src/lib/fare.ts`. */
export const YABA_ZONE = {
  minLat: 6.49,
  maxLat: 6.528,
  minLng: 3.362,
  maxLng: 3.4,
};

export function isInYabaZone(lat: number, lng: number): boolean {
  return (
    lat >= YABA_ZONE.minLat &&
    lat <= YABA_ZONE.maxLat &&
    lng >= YABA_ZONE.minLng &&
    lng <= YABA_ZONE.maxLng
  );
}

export function formatKm(km: number): string {
  const rounded = Math.round(km * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function assertWithinMaxDeliveryDistance(distanceKm: number): void {
  const maxKm = config.maxDeliveryDistanceKm;
  if (distanceKm <= maxKm) return;
  throw new AppError(
    `This delivery is ${distanceKm.toFixed(1)}km, which is beyond KoboRide's current bicycle delivery range (${formatKm(maxKm)}km).`,
    "DISTANCE_EXCEEDS_MAX",
    400,
  );
}

export function feeFromCoords(
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number,
): number {
  if (!isInYabaZone(pickupLat, pickupLng) || !isInYabaZone(dropoffLat, dropoffLng)) {
    throw new AppError("KoboRide only operates in Yaba", "OUTSIDE_SERVICE_AREA", 400);
  }
  return config.yabaFlatFeeNgn;
}

export async function quoteRoute(input: {
  pickup: string;
  dropoff: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
}) {
  const distanceKm = await roadDistanceKm(
    input.pickupLat,
    input.pickupLng,
    input.dropoffLat,
    input.dropoffLng,
  );
  assertWithinMaxDeliveryDistance(distanceKm);
  const feeNgn = feeFromCoords(
    input.pickupLat,
    input.pickupLng,
    input.dropoffLat,
    input.dropoffLng,
  );
  return {
    pickup: input.pickup.trim(),
    dropoff: input.dropoff.trim(),
    pickupLat: input.pickupLat,
    pickupLng: input.pickupLng,
    dropoffLat: input.dropoffLat,
    dropoffLng: input.dropoffLng,
    distanceKm,
    maxDistanceKm: config.maxDeliveryDistanceKm,
    feeNgn,
    payoutNgn: riderPayoutNgn(feeNgn),
  };
}
