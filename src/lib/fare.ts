import { config, riderPayoutNgn } from "@/lib/config";
import { getPlatformSettings, type PlatformSettings } from "@/lib/settings";
import { haversineKm } from "@/lib/distance";
import {
  applyFixedOffers,
  listLocationOffers,
  offerUsesByCustomer,
  offersCustomerCanUse,
} from "@/lib/locationOffers";
import { osrmRoute } from "@/lib/osrm";
import { AppError } from "@/lib/errors";
import { routeZone, type PricingZone } from "@/lib/zones";

export type PaymentMethod = "cash" | "paystack";

export type FareRates = Pick<
  PlatformSettings,
  "baseFeeNgn" | "perKmFeeNgn" | "minFareNgn" | "onlinePaymentDiscountNgn"
>;

export function formatKm(km: number): string {
  const rounded = Math.round(km * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

const SAME_STOP_KM = 0.05;

export function assertDistinctStops(input: {
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
}): void {
  if (
    haversineKm(
      input.pickupLat,
      input.pickupLng,
      input.dropoffLat,
      input.dropoffLng,
    ) >= SAME_STOP_KM
  ) {
    return;
  }
  throw new AppError(
    "Pickup and drop-off need to be different places.",
    "SAME_LOCATION",
    400,
  );
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

export function assertRoutable(
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number,
): PricingZone {
  const routed = routeZone(pickupLat, pickupLng, dropoffLat, dropoffLng);
  if (!routed.ok) {
    throw new AppError(routed.message, routed.code, 400);
  }
  return routed.zone;
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

/** Rider pay uses the distance fare when a location price is lower. */
export function riderFareBasisNgn(distanceFeeNgn: number, listFeeNgn: number): number {
  return Math.max(0, distanceFeeNgn, listFeeNgn);
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
  customerId?: string;
}) {
  assertDistinctStops(input);
  const zone = assertRoutable(
    input.pickupLat,
    input.pickupLng,
    input.dropoffLat,
    input.dropoffLng,
  );

  const [routed, settings] = await Promise.all([
    osrmRoute(input.pickupLat, input.pickupLng, input.dropoffLat, input.dropoffLng),
    getPlatformSettings(),
  ]);
  const distanceKm =
    routed?.distanceKm ??
    haversineKm(input.pickupLat, input.pickupLng, input.dropoffLat, input.dropoffLng);
  assertWithinMaxDeliveryDistance(distanceKm);

  const distanceFeeNgn = feeFromDistanceKm(distanceKm, settings);
  const offers = await listLocationOffers(true);
  const used = input.customerId
    ? await offerUsesByCustomer(
        input.customerId,
        offers.map((offer) => offer.id),
      )
    : new Map<string, number>();
  const fixed = applyFixedOffers({
    listFeeNgn: distanceFeeNgn,
    pickup: input.pickup.trim(),
    dropoff: input.dropoff.trim(),
    pickupLat: input.pickupLat,
    pickupLng: input.pickupLng,
    dropoffLat: input.dropoffLat,
    dropoffLng: input.dropoffLng,
    offers: offersCustomerCanUse(offers, used),
  });
  const listFeeNgn = fixed.listFeeNgn;
  const paymentMethod: PaymentMethod =
    input.paymentMethod === "paystack" ? "paystack" : "cash";
  const feeNgn = customerFeeNgn(
    listFeeNgn,
    paymentMethod,
    settings.onlinePaymentDiscountNgn,
  );
  const onlineDiscountNgn = listFeeNgn - feeNgn;
  // A location price below the distance fare is a discount. The rider is still
  // paid from the distance fare, so that discount comes out of platform margin.
  const payoutNgn = riderPayoutNgn(
    riderFareBasisNgn(distanceFeeNgn, listFeeNgn),
    settings.platformCutPercent,
  );

  return {
    pickup: fixed.pickup,
    dropoff: fixed.dropoff,
    pickupLat: input.pickupLat,
    pickupLng: input.pickupLng,
    dropoffLat: input.dropoffLat,
    dropoffLng: input.dropoffLng,
    distanceKm: roundKm(distanceKm),
    routeGeometry: routed?.geometry ?? null,
    routeDurationSeconds: routed?.durationSeconds ?? null,
    maxDistanceKm: config.maxDeliveryDistanceKm,
    listFeeNgn,
    onlineDiscountNgn,
    feeNgn,
    payoutNgn,
    zoneSlug: zone.slug,
    pickupOfferId: fixed.pickupOfferId,
    dropoffOfferId: fixed.dropoffOfferId,
  };
}
