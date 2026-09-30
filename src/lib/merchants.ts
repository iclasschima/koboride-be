import { z } from "zod";
import type { CustomerRole, Merchant, MenuItem, OrderLine } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { quoteRoute } from "@/lib/fare";
import { findOrCreateCustomer } from "@/lib/customers";
import { assertCustomerActive } from "@/lib/auth";
import { customerCanCancel, orderInclude, type OrderRow } from "@/lib/orders";
import { assertOfferUsesAvailable } from "@/lib/locationOffers";
import { normalizePhone, phoneLookupKeys } from "@/lib/phone";
import { DEFAULT_SHOP_PACKAGE, type PackageType } from "@/lib/packages";
import {
  notifyAdminBagReady,
  notifyAdminNewOrder,
  notifyAdminOrderStatus,
  notifyMerchantNewOrder,
  notifyRiderOrderCancelled,
  notifySearchingRider,
} from "@/lib/push";
import { writeOrderEvent } from "@/lib/dispatch";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function shopReady(merchant: Pick<Merchant, "name" | "address" | "lat" | "lng">): boolean {
  return (
    merchant.name.trim().length >= 2 &&
    merchant.name.trim() !== "My shop" &&
    merchant.address.trim().length >= 4 &&
    merchant.lat != null &&
    merchant.lng != null
  );
}

/** Approved, active and set up: can send bags and show its public link. */
export function shopLive(
  merchant: Pick<Merchant, "name" | "address" | "lat" | "lng" | "active" | "approvedAt">,
): boolean {
  return merchant.active && merchant.approvedAt != null && shopReady(merchant);
}

/** A held bag is cooked before dispatch, so refuse zones with no riders up front. */
export async function assertZoneHasRiders(zoneSlug: string): Promise<void> {
  const riders = await prisma.rider.count({ where: { approved: true, zoneSlug } });
  if (riders === 0) {
    throw new AppError("No riders deliver to this address yet", "NO_RIDERS_IN_ZONE", 409);
  }
}

export function presentMerchant(merchant: Merchant, items: MenuItem[] = []) {
  return {
    id: merchant.id,
    phone: merchant.phone,
    name: merchant.name,
    slug: merchant.slug,
    address: merchant.address,
    lat: merchant.lat,
    lng: merchant.lng,
    ready: shopReady(merchant),
    approved: merchant.approvedAt != null,
    active: merchant.active,
    deliveryPayer: merchant.deliveryPayer,
    link: `/m/${merchant.slug}`,
    items: items.map(presentItem),
  };
}

export function presentItem(item: MenuItem) {
  return {
    id: item.id,
    name: item.name,
    priceNgn: item.priceNgn,
    available: item.available,
  };
}

export function presentMerchantOrder(order: OrderRow) {
  return {
    id: order.id,
    status: order.status,
    riderPhase: order.riderPhase,
    riderName: order.rider?.name ?? null,
    dropoff: order.dropoff,
    receiverName: order.receiverName,
    receiverPhone: order.receiverPhone,
    notes: order.notes ?? "",
    packageType: order.packageType ?? DEFAULT_SHOP_PACKAGE,
    feeNgn: order.feeNgn,
    farePayer: order.farePayer,
    goodsNgn: order.goodsNgn,
    readyAt: order.readyAt?.toISOString() ?? null,
    scheduledFor: order.scheduledFor?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    completedAt: order.completedAt?.toISOString() ?? null,
    lines: order.lines.map(presentLine),
  };
}

function presentLine(line: OrderLine) {
  return { id: line.id, name: line.name, qty: line.qty, priceNgn: line.priceNgn };
}

export function assertSlug(slug: string): string {
  const cleaned = slug.trim().toLowerCase();
  if (!SLUG.test(cleaned) || cleaned.length > 40) {
    throw new AppError("Use a short link with letters, numbers, and dashes", "VALIDATION_ERROR", 400);
  }
  return cleaned;
}

export const shopPatchSchema = z.object({
  name: z.string().min(2).max(80).optional(),
  slug: z.string().min(2).max(40).optional(),
  address: z.string().min(4).max(240).optional(),
  lat: z.number().finite().optional(),
  lng: z.number().finite().optional(),
  deliveryPayer: z.enum(["sender", "receiver"]).optional(),
});

export async function updateShop(
  merchant: Merchant,
  body: z.infer<typeof shopPatchSchema>,
  extra: { approvedAt?: Date | null; active?: boolean } = {},
): Promise<Merchant> {
  if ((body.lat === undefined) !== (body.lng === undefined)) {
    throw new AppError("Send the shop location with both coordinates", "VALIDATION_ERROR", 400);
  }
  const slug = body.slug === undefined ? undefined : assertSlug(body.slug);
  if (slug) {
    const taken = await prisma.merchant.findFirst({
      where: { slug, NOT: { id: merchant.id } },
      select: { id: true },
    });
    if (taken) throw new AppError("That link is already used", "SLUG_TAKEN", 409);
  }
  return prisma.merchant.update({
    where: { id: merchant.id },
    data: {
      name: body.name?.trim(),
      slug,
      address: body.address?.trim(),
      lat: body.lat,
      lng: body.lng,
      deliveryPayer: body.deliveryPayer,
      ...extra,
    },
  });
}

export const shopCreateSchema = z.object({
  phone: z.string().min(7).max(20),
  name: z.string().min(2).max(80),
  address: z.string().min(4).max(240),
  lat: z.number().finite(),
  lng: z.number().finite(),
  slug: z.string().min(2).max(40).optional(),
  deliveryPayer: z.enum(["sender", "receiver"]).optional(),
  approved: z.boolean().optional(),
});

function slugFromName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/, "");
  return base.length >= 2 ? base : "shop";
}

async function freeSlug(base: string): Promise<string> {
  for (let n = 1; n <= 20; n += 1) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const taken = await prisma.merchant.findUnique({ where: { slug }, select: { id: true } });
    if (!taken) return slug;
  }
  return `${base}-${Date.now().toString(36)}`;
}

/** Admin-added shops sign in later with this phone and find their shop ready. */
export async function createShop(body: z.infer<typeof shopCreateSchema>): Promise<Merchant> {
  const phone = normalizePhone(body.phone);
  const existing = await prisma.merchant.findFirst({
    where: { phone: { in: phoneLookupKeys(phone) } },
    select: { id: true },
  });
  if (existing) throw new AppError("A shop already uses this phone number", "PHONE_TAKEN", 409);

  let slug: string;
  if (body.slug) {
    slug = assertSlug(body.slug);
    const taken = await prisma.merchant.findUnique({ where: { slug }, select: { id: true } });
    if (taken) throw new AppError("That link is already used", "SLUG_TAKEN", 409);
  } else {
    slug = await freeSlug(slugFromName(body.name));
  }

  return prisma.merchant.create({
    data: {
      phone,
      name: body.name.trim(),
      slug,
      address: body.address.trim(),
      lat: body.lat,
      lng: body.lng,
      deliveryPayer: body.deliveryPayer,
      approvedAt: body.approved === false ? null : new Date(),
    },
  });
}

export function listShopItems(merchantId: string): Promise<MenuItem[]> {
  return prisma.menuItem.findMany({
    where: { merchantId },
    orderBy: [{ sort: "asc" }, { createdAt: "asc" }],
  });
}

export const itemCreateSchema = z.object({
  name: z.string().min(1).max(80),
  priceNgn: z.number().int().min(0).max(5_000_000),
});

export const itemPatchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  priceNgn: z.number().int().min(0).max(5_000_000).optional(),
  available: z.boolean().optional(),
});

export async function addShopItem(merchantId: string, body: z.infer<typeof itemCreateSchema>): Promise<MenuItem> {
  const count = await prisma.menuItem.count({ where: { merchantId } });
  return prisma.menuItem.create({
    data: { merchantId, name: body.name.trim(), priceNgn: body.priceNgn, sort: count },
  });
}

async function ownItem(merchantId: string, itemId: string): Promise<MenuItem> {
  const item = await prisma.menuItem.findFirst({ where: { id: itemId, merchantId } });
  if (!item) throw new AppError("Item not found", "NOT_FOUND", 404);
  return item;
}

export async function updateShopItem(
  merchantId: string,
  itemId: string,
  body: z.infer<typeof itemPatchSchema>,
): Promise<MenuItem> {
  await ownItem(merchantId, itemId);
  return prisma.menuItem.update({
    where: { id: itemId },
    data: { name: body.name?.trim(), priceNgn: body.priceNgn, available: body.available },
  });
}

export async function removeShopItem(merchantId: string, itemId: string): Promise<void> {
  await ownItem(merchantId, itemId);
  await prisma.menuItem.delete({ where: { id: itemId } });
}

type LineInput = { name: string; qty: number; priceNgn: number };

/** Link orders are priced from the live menu, not from what the browser sent. */
async function priceLines(merchantId: string, lines: Array<{ itemId: string; qty: number }>): Promise<LineInput[]> {
  const ids = Array.from(new Set(lines.map((line) => line.itemId)));
  const items = await prisma.menuItem.findMany({
    where: { id: { in: ids }, merchantId, available: true },
  });
  const byId = new Map(items.map((item) => [item.id, item]));
  const priced: LineInput[] = [];
  for (const line of lines) {
    const item = byId.get(line.itemId);
    if (!item) throw new AppError("An item is no longer available. Refresh the menu.", "ITEM_UNAVAILABLE", 409);
    const qty = Math.trunc(line.qty);
    if (qty < 1 || qty > 99) throw new AppError("Choose between 1 and 99 of each item", "VALIDATION_ERROR", 400);
    priced.push({ name: item.name, qty, priceNgn: item.priceNgn });
  }
  return priced;
}

export async function createMerchantOrder(input: {
  merchant: Merchant;
  dropoff: string;
  dropoffLat: number;
  dropoffLng: number;
  receiverName: string;
  receiverPhone: string;
  notes?: string;
  packageType?: PackageType;
  farePayer: CustomerRole;
  items?: Array<{ itemId: string; qty: number }>;
  scheduledFor?: Date | null;
  holdUntilReady: boolean;
  customerId?: string;
}): Promise<OrderRow> {
  const { merchant } = input;
  if (!shopReady(merchant) || merchant.lat == null || merchant.lng == null) {
    throw new AppError("Add the shop name and pickup address first", "SHOP_INCOMPLETE", 400);
  }
  if (!merchant.approvedAt) {
    throw new AppError("KoboRide is still reviewing this shop", "SHOP_PENDING", 403);
  }
  const receiverName = input.receiverName.trim();
  if (receiverName.length < 2) {
    throw new AppError("Add the receiver name", "VALIDATION_ERROR", 400);
  }
  if (!input.receiverPhone.trim()) {
    throw new AppError("Enter the receiver’s phone number", "INVALID_PHONE", 400);
  }
  const receiverPhone = normalizePhone(input.receiverPhone);

  const lines = input.items?.length ? await priceLines(merchant.id, input.items) : [];
  const goodsNgn = lines.reduce((sum, line) => sum + line.priceNgn * line.qty, 0);

  const customer = input.customerId
    ? await prisma.customer.findUnique({ where: { id: input.customerId } })
    : await findOrCreateCustomer(receiverPhone, receiverName);
  if (!customer) throw new AppError("Customer not found", "NOT_FOUND", 404);
  assertCustomerActive(customer);

  const quote = await quoteRoute({
    pickup: `${merchant.name} — ${merchant.address.trim()}`,
    dropoff: input.dropoff.trim(),
    pickupLat: merchant.lat,
    pickupLng: merchant.lng,
    dropoffLat: input.dropoffLat,
    dropoffLng: input.dropoffLng,
    paymentMethod: "cash",
    customerId: customer.id,
  });
  await assertZoneHasRiders(quote.zoneSlug);
  await assertOfferUsesAvailable(customer.id, [quote.pickupOfferId, quote.dropoffOfferId]);

  const now = new Date();
  const scheduledFor =
    input.scheduledFor && input.scheduledFor.getTime() > now.getTime() ? input.scheduledFor : null;
  const readyAt = input.holdUntilReady ? null : now;
  const summary = lines.map((line) => `${line.qty} × ${line.name}`).join(", ");
  const extra = input.notes?.trim() ?? "";
  const notes = [summary, extra].filter(Boolean).join("\n");

  const order = await prisma.order.create({
    data: {
      customerId: customer.id,
      merchantId: merchant.id,
      pickup: quote.pickup,
      dropoff: quote.dropoff,
      notes,
      packageType: input.packageType ?? DEFAULT_SHOP_PACKAGE,
      senderName: merchant.name,
      senderPhone: merchant.phone,
      receiverName,
      receiverPhone,
      customerRole: "receiver",
      farePayer: input.farePayer,
      pickupLat: quote.pickupLat,
      pickupLng: quote.pickupLng,
      dropoffLat: quote.dropoffLat,
      dropoffLng: quote.dropoffLng,
      pickupOfferId: quote.pickupOfferId,
      dropoffOfferId: quote.dropoffOfferId,
      zoneSlug: quote.zoneSlug,
      feeNgn: quote.feeNgn,
      payoutNgn: quote.payoutNgn,
      goodsNgn,
      readyAt,
      distanceKm: quote.distanceKm,
      routeGeometry: quote.routeGeometry ?? undefined,
      routeDurationSeconds: quote.routeDurationSeconds,
      scheduledFor,
      deliveryPin: "",
      lines: lines.length ? { create: lines } : undefined,
    },
    include: orderInclude,
  });

  await writeOrderEvent(order.id, input.holdUntilReady ? "shop_order_held" : "shop_order_sent", {
    goodsNgn,
    farePayer: input.farePayer,
  });
  await notifyAdminNewOrder(order);
  if (input.customerId) await notifyMerchantNewOrder(order);
  if (readyAt && !scheduledFor) await notifySearchingRider(order);
  return order;
}

export async function ownOrder(merchantId: string, orderId: string): Promise<OrderRow> {
  const order = await prisma.order.findFirst({
    where: { id: orderId, merchantId },
    include: orderInclude,
  });
  if (!order) throw new AppError("Order not found", "NOT_FOUND", 404);
  return order;
}

export async function markOrderReady(merchantId: string, orderId: string): Promise<OrderRow> {
  const order = await ownOrder(merchantId, orderId);
  if (order.status !== "dispatching") {
    throw new AppError("This bag is already with a rider", "ALREADY_DISPATCHED", 409);
  }
  if (order.readyAt) return order;
  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { readyAt: new Date() },
    include: orderInclude,
  });
  await writeOrderEvent(order.id, "shop_ready");
  await notifyAdminBagReady(updated);
  const waiting = updated.scheduledFor && updated.scheduledFor.getTime() > Date.now();
  if (!waiting) await notifySearchingRider(updated);
  return updated;
}

export async function cancelShopOrder(merchantId: string, orderId: string): Promise<OrderRow> {
  const order = await ownOrder(merchantId, orderId);
  if (!customerCanCancel(order)) {
    throw new AppError("The rider already has the bag", "ALREADY_PICKED_UP", 409);
  }
  const updated = await prisma.order.update({
    where: { id: order.id },
    data: { status: "cancelled", cancelReason: "Cancelled by the shop" },
    include: orderInclude,
  });
  await writeOrderEvent(order.id, "shop_cancelled");
  await notifyAdminOrderStatus(updated);
  if (updated.riderId) await notifyRiderOrderCancelled(updated);
  return updated;
}
