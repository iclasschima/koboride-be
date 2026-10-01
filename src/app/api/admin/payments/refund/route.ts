import { api, json, options } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { confirmPin, requireSuperAdmin } from "@/lib/adminAuth";
import { refundPayment, refundSchema } from "@/lib/adminPayments";

export const OPTIONS = () => options();

export const POST = api(async (req) => {
  const { admin } = await requireSuperAdmin(req);
  const body = parseBody(refundSchema, await readJson(req));
  await confirmPin(admin, body.pin);
  const refund = await refundPayment(admin, body);
  return json({ refund: { id: refund.id, amountNgn: refund.amountNgn } }, 201);
});
