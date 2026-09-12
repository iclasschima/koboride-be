import { prisma } from "@/lib/prisma";
import { phoneLookupKeys, preferredPhone } from "@/lib/phone";
import { notifyAdminNewUser } from "@/lib/push";

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

async function mergeGroup(
  rows: Array<{ id: string; phone: string; name: string | null; createdAt: Date }>,
  canonical: string,
  name?: string,
) {
  const keeper =
    rows.find((row) => row.phone === canonical) ??
    [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]!;
  const label = name?.trim() || rows.find((row) => row.name?.trim())?.name?.trim();

  for (const row of rows) {
    if (row.id !== keeper.id) await absorbCustomer(row.id, keeper.id);
  }

  return prisma.customer.update({
    where: { id: keeper.id },
    data: {
      phone: canonical,
      ...(label ? { name: label } : {}),
    },
  });
}

export async function findOrCreateCustomer(phoneInput: string, name?: string) {
  const keys = phoneLookupKeys(phoneInput);
  const canonical = preferredPhone(phoneInput);
  const matches = await prisma.customer.findMany({
    where: { phone: { in: keys } },
    orderBy: { createdAt: "asc" },
  });

  if (matches.length === 0) {
    const customer = await prisma.customer.create({
      data: { phone: canonical, name: name?.trim() || undefined },
    });
    await notifyAdminNewUser(customer);
    return customer;
  }

  return mergeGroup(matches, canonical, name);
}

/** Collapse 080… / +234… twins and store the E.164 number. */
export async function reconcileDuplicateCustomers(): Promise<void> {
  const customers = await prisma.customer.findMany({
    select: { id: true, phone: true, name: true, createdAt: true },
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
