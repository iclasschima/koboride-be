import { z } from "zod";
import { api, json, options, AppError } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { presentCustomer, presentRiderUser, requireUser } from "@/lib/auth";
import { presentAdmin } from "@/lib/adminAuth";
import { prisma } from "@/lib/prisma";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  const user = requireUser(req);

  if (user.role === "admin") {
    const admin = await prisma.admin.findUnique({ where: { id: user.sub } });
    if (!admin || !admin.active) throw new AppError("Authentication required", "UNAUTHORIZED", 401);
    return json({
      role: "admin" as const,
      user: { id: admin.id, email: admin.email, phone: admin.email, name: admin.name ?? admin.email },
      rider: null,
      admin: presentAdmin(admin),
    });
  }

  if (user.role === "agent") {
    const agent = await prisma.agent.findUnique({ where: { id: user.sub } });
    if (!agent || !agent.active) {
      throw new AppError(
        "This number is not registered as an agent. Contact KoboRide.",
        "AGENT_NOT_REGISTERED",
        403,
      );
    }
    return json({
      role: "agent" as const,
      user: { id: agent.id, phone: agent.phone, name: agent.name },
      rider: null,
    });
  }

  if (user.role === "rider") {
    const rider = await prisma.rider.findUnique({ where: { id: user.sub } });
    if (!rider) throw new AppError("Account not found", "NOT_FOUND", 404);
    return json({
      role: "rider" as const,
      user: presentRiderUser(rider),
      rider: {
        id: rider.id,
        approved: rider.approved,
        online: rider.availability === "ONLINE",
        zoneSlug: rider.zoneSlug,
      },
    });
  }

  const customer = await prisma.customer.findUnique({ where: { id: user.sub } });
  if (!customer) throw new AppError("Account not found", "NOT_FOUND", 404);

  return json({
    role: "customer" as const,
    user: await presentCustomer(customer),
    rider: null,
  });
});

export const PATCH = api(async (req) => {
  const user = requireUser(req, ["customer"]);
  const { name } = parseBody(z.object({ name: z.string().min(1).max(80) }), await readJson(req));
  const customer = await prisma.customer.update({
    where: { id: user.sub },
    data: { name: name.trim() },
  });
  return json({
    role: "customer" as const,
    user: await presentCustomer(customer),
  });
});
