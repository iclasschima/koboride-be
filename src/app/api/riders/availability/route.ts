import { z } from "zod";
import { api, json, options, AppError } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { requireRider } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { cashDebtKobo } from "@/lib/ledger";

export const OPTIONS = () => options();

export const POST = api(async (req) => {
  const { rider } = await requireRider(req);
  const { online } = parseBody(z.object({ online: z.boolean() }), await readJson(req));
  if (online) {
    const [debt, config] = await Promise.all([
      cashDebtKobo(rider.id),
      prisma.payoutConfig.findUnique({ where: { id: "default" } }),
    ]);
    const limit = config?.cashDebtBlockLimit ?? 200_000;
    if (debt > limit) {
      throw new AppError(
        "Cash commission owed is over the limit. You can go online again after the next payout.",
        "CASH_DEBT_BLOCKED",
        403,
      );
    }
  }
  const updated = await prisma.rider.update({
    where: { id: rider.id },
    data: { availability: online ? "ONLINE" : "OFFLINE" },
    select: { id: true, name: true, phone: true, availability: true },
  });
  return json({ rider: { ...updated, online: updated.availability === "ONLINE" } });
});
