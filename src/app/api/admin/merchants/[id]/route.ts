import { z } from "zod";
import { api, json, options, AppError } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseBody, readJson } from "@/lib/validate";
import { orderInclude, presentTrip } from "@/lib/orders";
import { listShopItems, presentMerchant, shopPatchSchema, updateShop } from "@/lib/merchants";

export const OPTIONS = () => options();

async function findShop(id: string | undefined) {
  if (!id) throw new AppError("Missing shop id", "VALIDATION_ERROR", 400);
  const merchant = await prisma.merchant.findUnique({ where: { id } });
  if (!merchant) throw new AppError("Shop not found", "NOT_FOUND", 404);
  return merchant;
}

async function presentAdminShop(id: string | undefined) {
  const merchant = await findShop(id);
  const [items, orders] = await Promise.all([
    listShopItems(merchant.id),
    prisma.order.findMany({
      where: { merchantId: merchant.id },
      include: orderInclude,
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);
  const completed = orders.filter((order) => order.status === "completed");
  return {
    merchant: {
      ...presentMerchant(merchant, items),
      createdAt: merchant.createdAt.toISOString(),
      approvedAt: merchant.approvedAt?.toISOString() ?? null,
      ordersCount: orders.length,
      liveCount: orders.filter((order) => order.status === "dispatching" || order.status === "in_progress").length,
      deliveredCount: completed.length,
      deliveryNgn: completed.reduce((sum, order) => sum + order.feeNgn, 0),
      shopPaidNgn: completed
        .filter((order) => order.farePayer === "sender")
        .reduce((sum, order) => sum + order.feeNgn, 0),
      itemsNgn: completed.reduce((sum, order) => sum + order.goodsNgn, 0),
    },
    trips: orders.map(presentTrip),
  };
}

export const GET = api(async (req, ctx) => {
  requireUser(req, ["admin"]);
  return json(await presentAdminShop(ctx.params?.id));
});

export const PATCH = api(async (req, ctx) => {
  requireUser(req, ["admin"]);
  const merchant = await findShop(ctx.params?.id);
  const body = parseBody(
    shopPatchSchema.extend({
      approved: z.boolean().optional(),
      active: z.boolean().optional(),
    }),
    await readJson(req),
  );
  const { approved, active, ...shop } = body;
  await updateShop(merchant, shop, {
    active,
    approvedAt: approved === undefined ? undefined : approved ? (merchant.approvedAt ?? new Date()) : null,
  });
  return json(await presentAdminShop(merchant.id));
});
