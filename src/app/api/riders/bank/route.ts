import { z } from "zod";
import { api, json, options } from "@/lib/errors";
import { loadRider } from "@/lib/auth";
import { updateRiderOwnBank } from "@/lib/bankVerify";
import { prisma } from "@/lib/prisma";
import { presentRiderBank } from "@/lib/riders";
import { parseBody, readJson } from "@/lib/validate";

export const OPTIONS = () => options();

const writeSchema = z.object({
  bankCode: z.string().trim().min(2).max(10),
  bankName: z.string().trim().min(2).max(80).optional(),
  accountNumber: z.string().trim().min(10).max(20),
});

export const GET = api(async (req) => {
  const { rider } = await loadRider(req);
  return json({ bank: presentRiderBank(rider) });
});

export const PATCH = api(async (req) => {
  const { rider } = await loadRider(req);
  const body = parseBody(writeSchema, await readJson(req));
  await updateRiderOwnBank({
    riderId: rider.id,
    bankCode: body.bankCode,
    bankName: body.bankName,
    accountNumber: body.accountNumber,
  });
  const updated = await prisma.rider.findUnique({ where: { id: rider.id } });
  if (!updated) return json({ bank: presentRiderBank(rider) });
  return json({ bank: presentRiderBank(updated) });
});
