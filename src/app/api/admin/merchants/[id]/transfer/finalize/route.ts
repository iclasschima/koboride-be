import { z } from "zod";
import { api, json, options } from "@/lib/errors";
import { requireAdmin } from "@/lib/adminAuth";
import { parseBody, readJson } from "@/lib/validate";
import { finalizeShopPayout } from "@/lib/shopPayouts";
import { findShop, presentAdminShop } from "@/lib/adminShops";

export const OPTIONS = () => options();

export const POST = api(async (req, ctx) => {
  await requireAdmin(req, "payouts");
  const merchant = await findShop(ctx.params?.id);
  const body = parseBody(
    z.object({ payoutId: z.string().min(1), otp: z.string().regex(/^\d{4,8}$/, "Enter the OTP from Paystack") }),
    await readJson(req),
  );
  await finalizeShopPayout(merchant.id, body.payoutId, body.otp);
  return json(await presentAdminShop(merchant.id));
});
