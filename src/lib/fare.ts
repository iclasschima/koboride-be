import { config, riderPayoutNgn } from "@/lib/config";
import { getPlatformSettings, type PlatformSettings } from "@/lib/settings";
import { roadDistanceKm } from "@/lib/distance";
import { AppError } from "@/lib/errors";
import { isInActiveServiceArea } from "@/lib/zones";

export type PaymentMethod = "cash" | "paystack";

export type FareRates = Pick<
  PlatformSettings,
  "baseFeeNgn" | "perKmFeeNgn" | "minFareNgn" | "onlinePaymentDiscountNgn"
>;

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

export function assertInServiceArea(
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number,
): void {
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
}

/** Customer-facing fares always land on a ₦50 step — never show ₦818. */
export function roundToDisplayPrice(rawFee: number): number {
  if (!Number.isFinite(rawFee) || rawFee <= 0) return 0;
  return Math.round(rawFee / 50) * 50;
}

/** Exact distance math, then round to nearest ₦50 for the list price. */
export function feeFromDistanceKm(distanceKm: number, rates: FareRates): number {
  const km = Math.max(0, distanceKm);
  const exact = rates.baseFeeNgn + km * rates.perKmFeeNgn;
  return roundToDisplayPrice(Math.max(rates.minFareNgn, exact));
}

/** What the customer pays. Online discount comes out of platform margin only. */
export function customerFeeNgn(
  listFeeNgn: number,
  paymentMethod: PaymentMethod = "cash",
  onlineDiscountNgn = config.onlinePaymentDiscountNgn,
): number {
  if (paymentMethod !== "paystack") return roundToDisplayPrice(listFeeNgn);
  const discount = Math.max(0, Math.min(onlineDiscountNgn, listFeeNgn));
  return roundToDisplayPrice(listFeeNgn - discount);
}

export async function quoteRoute(input: {
  pickup: string;
  dropoff: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  paymentMethod?: PaymentMethod;
}) {
  assertInServiceArea(
    input.pickupLat,
    input.pickupLng,
    input.dropoffLat,
    input.dropoffLng,
  );

  const [distanceKm, settings] = await Promise.all([
    roadDistanceKm(
      input.pickupLat,
      input.pickupLng,
      input.dropoffLat,
      input.dropoffLng,
    ),
    getPlatformSettings(),
  ]);
  assertWithinMaxDeliveryDistance(distanceKm);

  const listFeeNgn = feeFromDistanceKm(distanceKm, settings);
  const paymentMethod: PaymentMethod =
    input.paymentMethod === "paystack" ? "paystack" : "cash";
  const feeNgn = customerFeeNgn(
    listFeeNgn,
    paymentMethod,
    settings.onlinePaymentDiscountNgn,
  );
  const onlineDiscountNgn = listFeeNgn - feeNgn;
  // Rider payout is always from the full list fare — never reduced by online discount.
  const payoutNgn = riderPayoutNgn(listFeeNgn, settings.platformCutPercent);

  return {
    pickup: input.pickup.trim(),
    dropoff: input.dropoff.trim(),
    pickupLat: input.pickupLat,
    pickupLng: input.pickupLng,
    dropoffLat: input.dropoffLat,
    dropoffLng: input.dropoffLng,
    distanceKm: roundKm(distanceKm),
    maxDistanceKm: config.maxDeliveryDistanceKm,
    listFeeNgn,
    onlineDiscountNgn,
    feeNgn,
    payoutNgn,
  };
}
