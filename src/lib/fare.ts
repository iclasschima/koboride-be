import { config, riderPayoutNgn } from "@/lib/config";
import { getPlatformCutPercent } from "@/lib/settings";
import { roadDistanceKm } from "@/lib/distance";
import { AppError } from "@/lib/errors";
import { isInActiveServiceArea } from "@/lib/zones";

export function formatKm(km: number): string {
  const rounded = Math.round(km * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function roundKm(km: number): number {
  return Math.round(km * 1000) / 1000;
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
  if (
    !isInActiveServiceArea(pickupLat, pickupLng) ||
    !isInActiveServiceArea(dropoffLat, dropoffLng)
  ) {
    throw new AppError(
      "This location is outside the KoboRide service area.",
      "OUTSIDE_SERVICE_AREA",
      400,
    );
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
    distanceKm: roundKm(distanceKm),
    maxDistanceKm: config.maxDeliveryDistanceKm,
    feeNgn,
    payoutNgn: riderPayoutNgn(feeNgn, await getPlatformCutPercent()),
  };
}
