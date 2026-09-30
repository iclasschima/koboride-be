import { z } from "zod";
import { api, json, options } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { parseBody, readJson } from "@/lib/validate";
import { markShopPaidOut } from "@/lib/merchants";
import { findShop, presentAdminShop } from "@/lib/adminShops";

export const OPTIONS = () => options();

export const POST = api(async (req, ctx) => {
  requireUser(req, ["admin"]);
  const merchant = await findShop(ctx.params?.id);
  const body = parseBody(z.object({ amountNgn: z.number().int().positive() }), await readJson(req));
  await markShopPaidOut(merchant.id, body.amountNgn);
  return json(await presentAdminShop(merchant.id));
});
