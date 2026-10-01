import { z } from "zod";
import type { Customer, CustomerRole, Merchant, MenuItem, OrderLine, PaymentMethod } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { quoteRoute } from "@/lib/fare";
import { attributionSchema, findOrCreateCustomer } from "@/lib/customers";
import { assertCustomerActive } from "@/lib/auth";
import { cancelOrder, composeOrderNotes, orderInclude, splitOrderNotes, type OrderRow } from "@/lib/orders";
import { assertOfferUsesAvailable } from "@/lib/locationOffers";
import { normalizePhone, phoneLookupKeys } from "@/lib/phone";
import { DEFAULT_SHOP_PACKAGE, type PackageType } from "@/lib/packages";
import { paystackFeeNgn, shopCardPaid, shopCardTotalNgn, shopPayoutNgn } from "@/lib/shopMoney";
import { CLOCK, formatClock, shopHours, shopTakingOrders } from "@/lib/shopHours";
import { onlinePaymentsEnabled } from "@/lib/payoutFlags";
import { cachedBanks, lookupAccountName } from "@/lib/bankVerify";
import { decryptField, encryptField, maskSecret } from "@/lib/fieldCrypto";
import {
  initializePaystack,
  nairaToKobo,
  newPaystackReference,
  paystackConfigured,
  paystackEmail,
  paystackPublicKey,
  verifyPaystack,
} from "@/lib/paystack";
import {
  notifyAdminBagReady,
  notifyAdminNewOrder,
  notifyMerchantNewOrder,
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
    hours: shopHours(merchant),
    openMode: merchant.openMode,
    openNow: shopTakingOrders(merchant),
    callPhone: merchant.callPhone,
    whatsappPhone: merchant.whatsappPhone,
    maxBags: merchant.maxBags,
    link: `/m/${merchant.slug}`,
    bank: merchant.bankCode
      ? {
          bankName: merchant.bankName ?? "",
          accountName: merchant.bankAccountName ?? "",
          accountNumber: maskSecret(decryptField(merchant.bankAccountNo)),
        }
      : null,
    items: items.map(presentItem),
  };
}

export function presentItem(item: MenuItem) {
  return {
    id: item.id,
    name: item.name,
    priceNgn: item.priceNgn,
    available: item.available,
    required: item.required,
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
    notes: splitOrderNotes(order.notes).shopNotes,
    packageType: order.packageType ?? DEFAULT_SHOP_PACKAGE,
    bagCount: order.bagCount,
    feeNgn: order.feeNgn,
    farePayer: order.farePayer,
    goodsNgn: order.goodsNgn,
    paidOnline: shopCardPaid(order),
    shopPayoutNgn: shopCardPaid(order) ? shopPayoutNgn(order) : 0,
    shopPaidOutAt: order.shopPaidOutAt?.toISOString() ?? null,
    readyAt: order.readyAt?.toISOString() ?? null,
    scheduledFor: order.scheduledFor?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    completedAt: order.completedAt?.toISOString() ?? null,
    lines: order.lines.map(presentLine),
  };
}

function presentLine(line: OrderLine) {
  return { id: line.id, name: line.name, qty: line.qty, priceNgn: line.priceNgn, bagIndex: line.bagIndex };
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
  callPhone: z.string().max(20).nullable().optional(),
  whatsappPhone: z.string().max(20).nullable().optional(),
  maxBags: z.number().int().min(1).max(10).optional(),
  openMode: z.enum(["hours", "open", "closed"]).optional(),
  hours: z
    .object({
      opensAt: z.string().regex(CLOCK, "Use a time like 09:00"),
      closesAt: z.string().regex(CLOCK, "Use a time like 21:00"),
    })
    .refine((hours) => hours.opensAt !== hours.closesAt, "Opening and closing times must differ")
    .nullable()
    .optional(),
});

/** Link orders only. The shop can still send its own bags when closed. */
function assertShopOpen(merchant: Merchant, at: Date = new Date()): void {
  if (shopTakingOrders(merchant, at)) return;
  const hours = shopHours(merchant);
  throw new AppError(
    merchant.openMode === "hours" && hours
      ? `${merchant.name} is closed now. Orders open at ${formatClock(hours.opensAt)}.`
      : `${merchant.name} is closed now.`,
    "SHOP_CLOSED",
    409,
  );
}

/** Undefined leaves the number as it is; empty clears it. */
function optionalPhone(input: string | null | undefined): string | null | undefined {
  if (input === undefined) return undefined;
  return input?.trim() ? normalizePhone(input) : null;
}

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
      callPhone: optionalPhone(body.callPhone),
      whatsappPhone: optionalPhone(body.whatsappPhone),
      maxBags: body.maxBags,
      openMode: body.openMode,
      opensAt: body.hours === undefined ? undefined : (body.hours?.opensAt ?? null),
      closesAt: body.hours === undefined ? undefined : (body.hours?.closesAt ?? null),
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
      approvedAt: body.approved === false ? null : new Date(),
    },
  });
}

export const shopBankSchema = z.object({
  bankCode: z.string().min(2).max(20),
  accountNumber: z.string().regex(/^\d{10}$/, "Use the 10-digit account number"),
});

/** The account name always comes from Paystack, never from what was typed. */
export async function setShopBank(merchantId: string, body: z.infer<typeof shopBankSchema>): Promise<Merchant> {
  const bank = (await cachedBanks()).find((row) => row.code === body.bankCode);
  if (!bank) throw new AppError("Choose a bank from the list", "VALIDATION_ERROR", 400);
  const accountName = await lookupAccountName(bank.code, body.accountNumber);
  return prisma.merchant.update({
    where: { id: merchantId },
    data: {
      bankName: bank.name,
      bankCode: bank.code,
      bankAccountNo: encryptField(body.accountNumber),
      bankAccountName: accountName,
    },
  });
}

export function adminShopBank(merchant: Merchant) {
  if (!merchant.bankCode) return null;
  return {
    bankName: merchant.bankName ?? "",
    accountName: merchant.bankAccountName ?? "",
    accountNumber: decryptField(merchant.bankAccountNo) ?? "",
  };
}

const OWED_WHERE = {
  paymentMethod: "paystack",
  paymentStatus: "paid",
  status: "completed",
} as const;

export async function shopSettlement(merchantId: string) {
  const orders = await prisma.order.findMany({
    where: { merchantId, ...OWED_WHERE },
    select: { goodsNgn: true, feeNgn: true, farePayer: true, shopPaidOutAt: true },
  });
  const owed = orders.filter((order) => !order.shopPaidOutAt);
  return {
    owedNgn: owed.reduce((sum, order) => sum + shopPayoutNgn(order), 0),
    owedOrders: owed.length,
    paidOutNgn: orders
      .filter((order) => order.shopPaidOutAt)
      .reduce((sum, order) => sum + shopPayoutNgn(order), 0),
  };
}

/** The admin confirms the amount they transferred so a new delivery can't slip into the batch. */
export async function markShopPaidOut(merchantId: string, amountNgn: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const owed = await tx.order.findMany({
      where: { merchantId, ...OWED_WHERE, shopPaidOutAt: null },
      select: { id: true, goodsNgn: true, feeNgn: true, farePayer: true },
    });
    const total = owed.reduce((sum, order) => sum + shopPayoutNgn(order), 0);
    if (total <= 0) throw new AppError("Nothing is owed to this shop", "NOTHING_OWED", 409);
    if (total !== amountNgn) {
      throw new AppError("The amount owed changed. Refresh and try again.", "AMOUNT_CHANGED", 409);
    }
    await tx.order.updateMany({
      where: { id: { in: owed.map((order) => order.id) }, shopPaidOutAt: null },
      data: { shopPaidOutAt: new Date() },
    });
  });
}

export async function shopCardPayments(): Promise<boolean> {
  return paystackConfigured() && (await onlinePaymentsEnabled());
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
  required: z.boolean().optional(),
});

export const itemPatchSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  priceNgn: z.number().int().min(0).max(5_000_000).optional(),
  available: z.boolean().optional(),
  required: z.boolean().optional(),
});

export async function addShopItem(merchantId: string, body: z.infer<typeof itemCreateSchema>): Promise<MenuItem> {
  const count = await prisma.menuItem.count({ where: { merchantId } });
  return prisma.menuItem.create({
    data: { merchantId, name: body.name.trim(), priceNgn: body.priceNgn, required: body.required, sort: count },
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
    data: { name: body.name?.trim(), priceNgn: body.priceNgn, available: body.available, required: body.required },
  });
}

export async function removeShopItem(merchantId: string, itemId: string): Promise<void> {
  await ownItem(merchantId, itemId);
  await prisma.menuItem.delete({ where: { id: itemId } });
}

type LineInput = { name: string; qty: number; priceNgn: number; bagIndex: number };

type MenuRow = { id: string; name: string; priceNgn: number; required: boolean };

/** One bag, priced from the live menu. A required item is added when this bag omitted it. */
function priceBag(menu: MenuRow[], lines: Array<{ itemId: string; qty: number }>, bagIndex: number): LineInput[] {
  const byId = new Map(menu.map((item) => [item.id, item]));
  const priced: LineInput[] = [];
  const chosen = new Set<string>();
  for (const line of lines) {
    const item = byId.get(line.itemId);
    if (!item) throw new AppError("An item is no longer available. Refresh the menu.", "ITEM_UNAVAILABLE", 409);
    const qty = Math.trunc(line.qty);
    if (qty < 1 || qty > 99) throw new AppError("Choose between 1 and 99 of each item", "VALIDATION_ERROR", 400);
    chosen.add(item.id);
    priced.push({ name: item.name, qty, priceNgn: item.priceNgn, bagIndex });
  }
  const hasOptional = menu.some((item) => !item.required);
  if (hasOptional && !lines.some((line) => !byId.get(line.itemId)?.required)) {
    throw new AppError(bagIndex > 1 ? `Add an item to bag ${bagIndex}` : "Add an item from the menu", "VALIDATION_ERROR", 400);
  }
  for (const item of menu) {
    if (item.required && !chosen.has(item.id)) {
      priced.push({ name: item.name, qty: 1, priceNgn: item.priceNgn, bagIndex });
    }
  }
  return priced;
}

/**
 * Link orders are priced from the live menu, not from what the browser sent.
 * Each bag is its own selection. Required items are added to a bag that omitted them.
 */
async function priceLines(
  merchantId: string,
  lines: Array<{ itemId: string; qty: number; bag?: number }>,
  maxBags: number,
): Promise<LineInput[]> {
  const menu = await prisma.menuItem.findMany({ where: { merchantId, available: true } });
  const groups = new Map<number, Array<{ itemId: string; qty: number }>>();
  for (const line of lines) {
    const bag = line.bag ?? 1;
    if (bag < 1 || bag > maxBags) {
      throw new AppError(
        maxBags === 1 ? "This shop takes one bag per order" : `This shop takes up to ${maxBags} bags`,
        "VALIDATION_ERROR",
        400,
      );
    }
    const list = groups.get(bag) ?? [];
    list.push({ itemId: line.itemId, qty: line.qty });
    groups.set(bag, list);
  }
  const indexes = Array.from(groups.keys()).sort((a, b) => a - b);
  if (indexes.some((bag, index) => bag !== index + 1)) {
    throw new AppError("Number the bags from 1", "VALIDATION_ERROR", 400);
  }
  return indexes.flatMap((bag) => priceBag(menu, groups.get(bag) ?? [], bag));
}

/** Flat item list for one bag, or "Bag 1: …" lines when the delivery has several. */
function lineSummary(lines: Array<{ bagIndex: number; qty: number; name: string }>): string {
  const bags = new Map<number, string[]>();
  for (const line of lines) {
    const parts = bags.get(line.bagIndex) ?? [];
    parts.push(`${line.qty} × ${line.name}`);
    bags.set(line.bagIndex, parts);
  }
  const groups = Array.from(bags.entries()).sort((a, b) => a[0] - b[0]);
  if (groups.length <= 1) return groups[0]?.[1].join(", ") ?? "";
  return groups.map(([bag, parts]) => `Bag ${bag}: ${parts.join(", ")}`).join("\n");
}

export const shopOrderSchema = z.object({
  dropoff: z.string().min(3).max(240),
  dropoffLat: z.number().finite(),
  dropoffLng: z.number().finite(),
  receiverName: z.string().min(2).max(80),
  receiverPhone: z.string().min(7).max(20),
  notes: z.string().max(400).optional(),
  noteFor: z.enum(["shop", "rider"]).optional(),
  items: z
    .array(
      z.object({
        itemId: z.string().min(1),
        qty: z.number().int().min(1).max(99),
        bag: z.number().int().min(1).max(10).optional(),
      }),
    )
    .min(1)
    .max(80),
  attribution: attributionSchema,
});

function assertShopCanSend(merchant: Merchant): asserts merchant is Merchant & { lat: number; lng: number } {
  if (!shopReady(merchant) || merchant.lat == null || merchant.lng == null) {
    throw new AppError("Add the shop name and pickup address first", "SHOP_INCOMPLETE", 400);
  }
  if (!merchant.approvedAt) {
    throw new AppError("KoboRide is still reviewing this shop", "SHOP_PENDING", 403);
  }
}

async function priceShopOrder(input: {
  merchant: Merchant & { lat: number; lng: number };
  dropoff: string;
  dropoffLat: number;
  dropoffLng: number;
  items?: Array<{ itemId: string; qty: number; bag?: number }>;
  paymentMethod: PaymentMethod;
  customerId: string;
}) {
  const { merchant } = input;
  const lines = input.items?.length ? await priceLines(merchant.id, input.items, merchant.maxBags) : [];
  const goodsNgn = lines.reduce((sum, line) => sum + line.priceNgn * line.qty, 0);
  const quote = await quoteRoute({
    pickup: `${merchant.name} — ${merchant.address.trim()}`,
    dropoff: input.dropoff.trim(),
    pickupLat: merchant.lat,
    pickupLng: merchant.lng,
    dropoffLat: input.dropoffLat,
    dropoffLng: input.dropoffLng,
    paymentMethod: input.paymentMethod,
    customerId: input.customerId,
  });
  await assertZoneHasRiders(quote.zoneSlug);
  await assertOfferUsesAvailable(input.customerId, [quote.pickupOfferId, quote.dropoffOfferId]);
  return { lines, goodsNgn, quote };
}

/** Starts a Paystack charge for a link order. The order is only created once the charge is verified. */
export async function startShopCardPayment(
  merchant: Merchant,
  body: z.infer<typeof shopOrderSchema>,
  customer: Customer,
) {
  assertShopCanSend(merchant);
  assertShopOpen(merchant);
  if (!(await shopCardPayments())) {
    throw new AppError("Card payment is not available right now", "ONLINE_PAYMENTS_DISABLED", 503);
  }
  assertCustomerActive(customer);
  const { goodsNgn, quote } = await priceShopOrder({
    merchant,
    dropoff: body.dropoff,
    dropoffLat: body.dropoffLat,
    dropoffLng: body.dropoffLng,
    items: body.items,
    paymentMethod: "paystack",
    customerId: customer.id,
  });
  const cardNgn = shopCardTotalNgn(goodsNgn, quote.feeNgn, "receiver");
  const paymentFeeNgn = paystackFeeNgn(cardNgn);
  const totalNgn = cardNgn + paymentFeeNgn;
  const email = paystackEmail(customer.phone);
  const started = await initializePaystack({
    email,
    amountKobo: nairaToKobo(totalNgn),
    reference: newPaystackReference(),
    metadata: { customerId: customer.id, merchantId: merchant.id, dropoff: quote.dropoff },
  });
  return {
    accessCode: started.accessCode,
    reference: started.reference,
    publicKey: paystackPublicKey(),
    email,
    amountKobo: nairaToKobo(totalNgn),
    feeNgn: totalNgn,
    paymentFeeNgn,
  };
}

async function verifyShopCardPayment(reference: string | undefined, totalNgn: number) {
  if (!(await onlinePaymentsEnabled())) {
    throw new AppError("Online payment is not available right now", "ONLINE_PAYMENTS_DISABLED", 403);
  }
  const ref = reference?.trim();
  if (!ref) throw new AppError("Payment reference is missing", "VALIDATION_ERROR", 400);
  const used = await prisma.order.findUnique({ where: { paystackReference: ref }, select: { id: true } });
  if (used) throw new AppError("This payment was already used", "PAYMENT_ALREADY_USED", 409);
  const paid = await verifyPaystack(ref);
  if (paid.status !== "success") {
    throw new AppError("Payment was not successful", "PAYMENT_REQUIRED", 402);
  }
  if (paid.amountKobo !== nairaToKobo(totalNgn)) {
    throw new AppError("Paid amount does not match the order", "PAYMENT_MISMATCH", 409);
  }
  return { paymentStatus: "paid" as const, paystackReference: ref, paidAt: new Date() };
}

export async function createMerchantOrder(input: {
  merchant: Merchant;
  dropoff: string;
  dropoffLat: number;
  dropoffLng: number;
  receiverName: string;
  receiverPhone: string;
  notes?: string;
  /** Who the checkout note is for. A blank note is ignored. Shop is the default. */
  noteFor?: "shop" | "rider";
  packageType?: PackageType;
  farePayer: CustomerRole;
  items?: Array<{ itemId: string; qty: number; bag?: number }>;
  scheduledFor?: Date | null;
  holdUntilReady: boolean;
  customerId?: string;
  paymentMethod?: PaymentMethod;
  paystackReference?: string;
}): Promise<OrderRow> {
  const { merchant } = input;
  assertShopCanSend(merchant);
  const receiverName = input.receiverName.trim();
  if (receiverName.length < 2) {
    throw new AppError("Add the receiver name", "VALIDATION_ERROR", 400);
  }
  if (!input.receiverPhone.trim()) {
    throw new AppError("Enter the receiver’s phone number", "INVALID_PHONE", 400);
  }
  const receiverPhone = normalizePhone(input.receiverPhone);

  const customer = input.customerId
    ? await prisma.customer.findUnique({ where: { id: input.customerId } })
    : await findOrCreateCustomer(receiverPhone, receiverName, { source: "shop_bag", merchantId: merchant.id });
  if (!customer) throw new AppError("Customer not found", "NOT_FOUND", 404);
  assertCustomerActive(customer);

  const paymentMethod: PaymentMethod = input.paymentMethod === "paystack" ? "paystack" : "cash";
  const { lines, goodsNgn, quote } = await priceShopOrder({
    merchant,
    dropoff: input.dropoff,
    dropoffLat: input.dropoffLat,
    dropoffLng: input.dropoffLng,
    items: input.items,
    paymentMethod,
    customerId: customer.id,
  });
  let payment = null;
  if (paymentMethod === "paystack") {
    const cardNgn = shopCardTotalNgn(goodsNgn, quote.feeNgn, input.farePayer);
    const paymentFeeNgn = paystackFeeNgn(cardNgn);
    payment = { ...(await verifyShopCardPayment(input.paystackReference, cardNgn + paymentFeeNgn)), paymentFeeNgn };
  }

  const now = new Date();
  const scheduledFor =
    input.scheduledFor && input.scheduledFor.getTime() > now.getTime() ? input.scheduledFor : null;
  const readyAt = input.holdUntilReady ? null : now;
  const notes = composeOrderNotes(lineSummary(lines), input.notes ?? "", input.noteFor === "rider" ? "rider" : "shop");
  const bagCount = new Set(lines.map((line) => line.bagIndex)).size || 1;

  const order = await prisma.order.create({
    data: {
      customerId: customer.id,
      merchantId: merchant.id,
      pickup: quote.pickup,
      dropoff: quote.dropoff,
      notes,
      packageType: input.packageType ?? DEFAULT_SHOP_PACKAGE,
      bagCount,
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
      paymentMethod,
      ...payment,
      lines: lines.length ? { create: lines } : undefined,
    },
    include: orderInclude,
  });

  await writeOrderEvent(order.id, input.holdUntilReady ? "shop_order_held" : "shop_order_sent", {
    goodsNgn,
    farePayer: input.farePayer,
    paymentMethod,
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
  const updated = await cancelOrder(order, { reason: "Cancelled by the shop", event: "shop_cancelled" });
  if (!updated) throw new AppError("The rider already has the bag", "ALREADY_PICKED_UP", 409);
  return updated;
}
