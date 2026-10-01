import { z } from "zod";
import { api, json, options } from "@/lib/errors";
import { confirmPin, requireAdmin } from "@/lib/adminAuth";
import { parseBody, readJson } from "@/lib/validate";
import { sendShopPayout } from "@/lib/shopPayouts";
import { findShop, presentAdminShop } from "@/lib/adminShops";

export const OPTIONS = () => options();

export const POST = api(async (req, ctx) => {
  const { admin } = await requireAdmin(req, "payouts");
  const merchant = await findShop(ctx.params?.id);
  const body = parseBody(
    z.object({ amountNgn: z.number().int().positive(), pin: z.string().optional() }),
    await readJson(req),
  );
  await confirmPin(admin, body.pin);
  await sendShopPayout(admin, merchant.id, body.amountNgn);
  return json(await presentAdminShop(merchant.id));
});
