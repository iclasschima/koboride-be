import type { CustomerSource, Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { phoneLookupKeys, preferredPhone } from "@/lib/phone";
import { notifyAdminNewUser } from "@/lib/push";

/** First-visit details the browser keeps until sign-up. Never trusted for anything but reporting. */
export const attributionSchema = z
  .object({
    ref: z.string().trim().max(120).optional(),
    landing: z.string().trim().max(200).optional(),
    referrer: z.string().trim().max(120).optional(),
  })
  .optional();

export type CustomerOrigin = {
  source: CustomerSource;
  merchantId?: string;
  attribution?: z.infer<typeof attributionSchema>;
};

export const sourceMerchantInclude = { sourceMerchant: { select: { id: true, name: true, slug: true } } } as const;

/** For ops: how the customer first reached KoboRide. */
export function presentOrigin(customer: Prisma.CustomerGetPayload<{ include: typeof sourceMerchantInclude }>) {
  return {
    source: customer.source,
    merchant: customer.sourceMerchant,
    ref: customer.sourceRef,
    landing: customer.sourceLanding,
    referrer: customer.sourceReferrer,
  };
}

function originData(origin: CustomerOrigin) {
  return {
    source: origin.source,
    sourceMerchantId: origin.merchantId,
    sourceRef: origin.attribution?.ref || undefined,
    sourceLanding: origin.attribution?.landing || undefined,
    sourceReferrer: origin.attribution?.referrer || undefined,
  };
}

async function absorbCustomer(fromId: string, intoId: string) {
  if (fromId === intoId) return;
  await prisma.$transaction([
    prisma.order.updateMany({ where: { customerId: fromId }, data: { customerId: intoId } }),
    prisma.pushSubscription.updateMany({
      where: { userId: fromId, role: "customer" },
      data: { userId: intoId },
    }),
    prisma.customer.delete({ where: { id: fromId } }),
  ]);
}

const mergeSelect = {
  id: true,
  phone: true,
  name: true,
  createdAt: true,
  source: true,
  sourceMerchantId: true,
  sourceRef: true,
  sourceLanding: true,
  sourceReferrer: true,
} as const;

type MergeRow = Prisma.CustomerGetPayload<{ select: typeof mergeSelect }>;

async function mergeGroup(rows: MergeRow[], canonical: string, name?: string) {
  const oldestFirst = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const keeper = rows.find((row) => row.phone === canonical) ?? oldestFirst[0]!;
  const label = name?.trim() || rows.find((row) => row.name?.trim())?.name?.trim();
  const origin = keeper.source ? null : oldestFirst.find((row) => row.source);

  for (const row of rows) {
    if (row.id !== keeper.id) await absorbCustomer(row.id, keeper.id);
  }

  return prisma.customer.update({
    where: { id: keeper.id },
    data: {
      phone: canonical,
      ...(label ? { name: label } : {}),
      ...(origin
        ? {
            source: origin.source,
            sourceMerchantId: origin.sourceMerchantId,
            sourceRef: origin.sourceRef,
            sourceLanding: origin.sourceLanding,
            sourceReferrer: origin.sourceReferrer,
          }
        : {}),
    },
  });
}

/** The origin is only written when the account is created, so the first way in is kept. */
export async function findOrCreateCustomer(phoneInput: string, name: string | undefined, origin: CustomerOrigin) {
  const keys = phoneLookupKeys(phoneInput);
  const canonical = preferredPhone(phoneInput);
  const matches = await prisma.customer.findMany({
    where: { phone: { in: keys } },
    orderBy: { createdAt: "asc" },
    select: mergeSelect,
  });

  if (matches.length === 0) {
    const customer = await prisma.customer.create({
      data: { phone: canonical, name: name?.trim() || undefined, ...originData(origin) },
    });
    await notifyAdminNewUser(customer);
    return customer;
  }

  return mergeGroup(matches, canonical, name);
}

/** Collapse 080… / +234… twins and store the E.164 number. */
export async function reconcileDuplicateCustomers(): Promise<void> {
  const customers = await prisma.customer.findMany({
    select: mergeSelect,
    orderBy: { createdAt: "asc" },
  });

  const groups = new Map<string, typeof customers>();
  for (const row of customers) {
    const key = preferredPhone(row.phone);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }

  for (const [canonical, rows] of Array.from(groups.entries())) {
    if (rows.length === 1 && rows[0]!.phone === canonical) continue;
    await mergeGroup(rows, canonical);
  }
}
