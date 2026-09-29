import { api, json, options, AppError } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  requireUser(req, ["admin"]);
  const riderId = new URL(req.url).searchParams.get("riderId");
  if (!riderId) throw new AppError("Missing rider", "VALIDATION_ERROR", 400);
  const entries = await prisma.ledgerEntry.findMany({
    where: { riderId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return json({
    entries: entries.map((entry) => ({
      id: entry.id,
      type: entry.type,
      amount: entry.amount,
      note: entry.note,
      payoutId: entry.payoutId,
      createdAt: entry.createdAt.toISOString(),
    })),
  });
});
