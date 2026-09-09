import { z } from "zod";
import { api, json, options, AppError } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  const user = requireUser(req);

  if (user.role === "admin") {
    const admin = await prisma.admin.findUnique({
      where: { id: user.sub },
      select: { id: true, email: true, createdAt: true },
    });
    if (!admin) throw new AppError("Account not found", "NOT_FOUND", 404);
    return json({ user: { id: admin.id, phone: admin.email, name: admin.email }, rider: null });
  }

  const customer = await prisma.customer.findUnique({ where: { id: user.sub } });
  if (!customer) throw new AppError("Account not found", "NOT_FOUND", 404);

  const rider = await prisma.rider.findUnique({
    where: { phone: customer.phone },
    select: { id: true, approved: true, availability: true },
  });

  return json({
    user: { id: customer.id, phone: customer.phone, name: customer.name },
    rider: rider
      ? { id: rider.id, approved: rider.approved, online: rider.availability === "ONLINE" }
      : null,
  });
});

export const PATCH = api(async (req) => {
  const user = requireUser(req, ["customer"]);
  const { name } = parseBody(z.object({ name: z.string().min(1).max(80) }), await readJson(req));
  const customer = await prisma.customer.update({
    where: { id: user.sub },
    data: { name: name.trim() },
  });
  return json({ user: { id: customer.id, phone: customer.phone, name: customer.name } });
});
