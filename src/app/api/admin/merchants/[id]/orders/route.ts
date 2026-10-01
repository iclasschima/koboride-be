import { z } from "zod";
import { api, json, options } from "@/lib/errors";
import { requireAdmin } from "@/lib/adminAuth";
import { parseBody } from "@/lib/validate";
import { listAdminShopOrders } from "@/lib/adminShops";

export const OPTIONS = () => options();

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date").optional();

export const GET = api(async (req, ctx) => {
  await requireAdmin(req, "shops");
  const params = new URL(req.url).searchParams;
  const range = parseBody(
    z.object({ from: day, to: day }),
    { from: params.get("from") || undefined, to: params.get("to") || undefined },
  );
  return json(await listAdminShopOrders(ctx.params?.id, range));
});
