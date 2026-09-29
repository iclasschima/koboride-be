import type { Prisma, PrismaClient } from "@prisma/client";
import { haversineKm } from "@/lib/distance";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { isInLagos } from "@/lib/zones";

type OfferDb = PrismaClient | Prisma.TransactionClient;

const MATCH_KM = 0.08;

export type LocationOfferStop = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  feeNgn: number;
  pickup: boolean;
  dropoff: boolean;
  /** Null means this customer can use the price on every order. */
  maxUsesPerCustomer: number | null;
  active: boolean;
};

export type OfferRole = "pickup" | "dropoff";

export function offerApplies(offer: LocationOfferStop, role: OfferRole): boolean {
  if (!offer.active) return false;
  return role === "pickup" ? offer.pickup : offer.dropoff;
}

export function nearestOffer(
  offers: LocationOfferStop[],
  lat: number,
  lng: number,
  role: OfferRole,
): LocationOfferStop | null {
  let best: { offer: LocationOfferStop; km: number } | null = null;
  for (const offer of offers) {
    if (!offerApplies(offer, role)) continue;
    const km = haversineKm(lat, lng, offer.lat, offer.lng);
    if (km > MATCH_KM) continue;
    if (!best || km < best.km) best = { offer, km };
  }
  return best?.offer ?? null;
}

/** One matching end replaces the distance fare. Both ends add together. */
export function fixedListFee(
  distanceFeeNgn: number,
  pickupFeeNgn: number | null,
  dropoffFeeNgn: number | null,
): number {
  if (pickupFeeNgn == null && dropoffFeeNgn == null) return distanceFeeNgn;
  return (pickupFeeNgn ?? 0) + (dropoffFeeNgn ?? 0);
}

export function offerStopLabel(offer: Pick<LocationOfferStop, "name" | "address">): string {
  return `${offer.name} — ${offer.address}`;
}

export function applyFixedOffers(input: {
  listFeeNgn: number;
  pickup: string;
  dropoff: string;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  offers: LocationOfferStop[];
}): {
  listFeeNgn: number;
  pickup: string;
  dropoff: string;
  pickupOfferId: string | null;
  dropoffOfferId: string | null;
} {
  const pickupOffer = nearestOffer(input.offers, input.pickupLat, input.pickupLng, "pickup");
  const dropoffOffer = nearestOffer(input.offers, input.dropoffLat, input.dropoffLng, "dropoff");
  return {
    listFeeNgn: fixedListFee(input.listFeeNgn, pickupOffer?.feeNgn ?? null, dropoffOffer?.feeNgn ?? null),
    pickup: pickupOffer ? offerStopLabel(pickupOffer) : input.pickup,
    dropoff: dropoffOffer ? offerStopLabel(dropoffOffer) : input.dropoff,
    pickupOfferId: pickupOffer?.id ?? null,
    dropoffOfferId: dropoffOffer?.id ?? null,
  };
}

/** Offers this customer can still book at the special price. */
export function offersCustomerCanUse(
  offers: LocationOfferStop[],
  usedByOfferId: ReadonlyMap<string, number>,
): LocationOfferStop[] {
  return offers.filter((offer) => {
    if (offer.maxUsesPerCustomer == null) return true;
    return (usedByOfferId.get(offer.id) ?? 0) < offer.maxUsesPerCustomer;
  });
}

export function usesLeft(maxUsesPerCustomer: number | null, used: number): number | null {
  if (maxUsesPerCustomer == null) return null;
  return Math.max(0, maxUsesPerCustomer - used);
}

/** Non-cancelled orders that used each offer. The same offer on both ends of one order counts once. */
export async function offerOrderCounts(offerIds: string[]): Promise<Map<string, number>> {
  const ids = Array.from(new Set(offerIds.filter(Boolean)));
  const counts = new Map<string, number>();
  if (ids.length === 0) return counts;
  const orders = await prisma.order.findMany({
    where: {
      status: { not: "cancelled" },
      OR: [{ pickupOfferId: { in: ids } }, { dropoffOfferId: { in: ids } }],
    },
    select: { pickupOfferId: true, dropoffOfferId: true },
  });
  for (const order of orders) {
    const matched = new Set(
      [order.pickupOfferId, order.dropoffOfferId].filter((id): id is string => id != null && ids.includes(id)),
    );
    matched.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
  }
  return counts;
}

export async function offerUsesByCustomer(
  customerId: string,
  offerIds: string[],
  db: OfferDb = prisma,
): Promise<Map<string, number>> {
  const ids = Array.from(new Set(offerIds.filter(Boolean)));
  const counts = new Map<string, number>();
  if (!customerId || ids.length === 0) return counts;
  const orders = await db.order.findMany({
    where: {
      customerId,
      status: { not: "cancelled" },
      OR: [{ pickupOfferId: { in: ids } }, { dropoffOfferId: { in: ids } }],
    },
    select: { pickupOfferId: true, dropoffOfferId: true },
  });
  for (const order of orders) {
    const matched = new Set(
      [order.pickupOfferId, order.dropoffOfferId].filter((id): id is string => id != null),
    );
    matched.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
  }
  return counts;
}

export async function assertOfferUsesAvailable(
  customerId: string,
  offerIds: Array<string | null>,
  db: OfferDb = prisma,
): Promise<void> {
  const ids = Array.from(new Set(offerIds.filter((id): id is string => Boolean(id))));
  if (ids.length === 0) return;
  const offers = await db.locationOffer.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, maxUsesPerCustomer: true },
  });
  const used = await offerUsesByCustomer(customerId, ids, db);
  for (const offer of offers) {
    if (offer.maxUsesPerCustomer == null) continue;
    if ((used.get(offer.id) ?? 0) >= offer.maxUsesPerCustomer) {
      throw new AppError(
        `You've already used the price for ${offer.name}.`,
        "DISCOUNT_USED_UP",
        409,
      );
    }
  }
}

export function assertOfferPlace(input: { lat: number; lng: number; pickup: boolean; dropoff: boolean; feeNgn: number }): void {
  if (!input.pickup && !input.dropoff) {
    throw new AppError("Choose pickup, sending, or both", "VALIDATION_ERROR", 400);
  }
  if (!isInLagos(input.lat, input.lng)) {
    throw new AppError("That place is outside Lagos", "OUTSIDE_LAGOS", 400);
  }
  if (input.feeNgn % 50 !== 0) {
    throw new AppError("Price must be in steps of ₦50", "VALIDATION_ERROR", 400);
  }
}

export async function listLocationOffers(activeOnly = false): Promise<LocationOfferStop[]> {
  const rows = await prisma.locationOffer.findMany({
    where: activeOnly ? { active: true } : undefined,
    orderBy: { name: "asc" },
  });
  return rows;
}

export function publicOffer(offer: LocationOfferStop) {
  return {
    id: offer.id,
    name: offer.name,
    lat: offer.lat,
    lng: offer.lng,
    feeNgn: offer.feeNgn,
    pickup: offer.pickup,
    dropoff: offer.dropoff,
    maxUsesPerCustomer: offer.maxUsesPerCustomer,
  };
}
