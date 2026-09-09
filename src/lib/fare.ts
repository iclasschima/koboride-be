import { config, riderPayoutNgn } from "@/lib/config";
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

export function quoteRoute(input: {
  pickup: string;
  dropoff: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
}) {
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
    feeNgn,
    payoutNgn: riderPayoutNgn(feeNgn),
  };
}
