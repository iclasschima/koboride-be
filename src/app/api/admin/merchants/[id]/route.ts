import { z } from "zod";
import { api, json, options } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { parseBody, readJson } from "@/lib/validate";
import { shopPatchSchema, updateShop } from "@/lib/merchants";
import { findShop, presentAdminShop } from "@/lib/adminShops";

export const OPTIONS = () => options();

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
