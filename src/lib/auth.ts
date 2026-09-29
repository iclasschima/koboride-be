import jwt from "jsonwebtoken";
import { config } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { findOrCreateCustomer } from "@/lib/customers";
import { phoneLookupKeys, preferredPhone } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import type { Rider } from "@prisma/client";

export const ROLES = ["customer", "rider", "admin", "agent"] as const;
export type Role = (typeof ROLES)[number];

export type AuthUser = {
  sub: string;
  role: Role;
};

export function signToken(user: AuthUser): string {
  return jwt.sign(user, config.jwtSecret);
}

export function verifyToken(token: string): AuthUser {
  try {
    const payload = jwt.verify(token, config.jwtSecret, { ignoreExpiration: true }) as AuthUser;
    if (!payload.sub || !ROLES.includes(payload.role)) throw new Error("bad payload");
    return { sub: payload.sub, role: payload.role };
  } catch {
    throw new AppError("Invalid or expired token", "UNAUTHORIZED", 401);
  }
}

export function optionalUser(req: Request): AuthUser | null {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) return null;
  try {
    return verifyToken(match[1]);
  } catch {
    return null;
  }
}

export function requireUser(req: Request, roles?: Role[]): AuthUser {
  const header = req.headers.get("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) throw new AppError("Authentication required", "UNAUTHORIZED", 401);
  const user = verifyToken(match[1]);
  if (roles && !roles.includes(user.role)) {
    throw new AppError("You do not have access to this resource", "FORBIDDEN", 403);
  }
  return user;
}

export async function loadRider(req: Request): Promise<{ user: AuthUser; rider: Rider }> {
  const user = requireUser(req, ["rider"]);
  const rider = await prisma.rider.findUnique({ where: { id: user.sub } });
  if (!rider) throw new AppError("Account not found", "NOT_FOUND", 404);
  return { user, rider };
}

export async function requireRider(req: Request): Promise<{ user: AuthUser; rider: Rider }> {
  const loaded = await loadRider(req);
  const { rider } = loaded;
  if (!rider.approved) {
    throw new AppError(
      "This rider account is inactive. Contact the KoboRide team.",
      "ACCOUNT_INACTIVE",
      403,
    );
  }
  return loaded;
}

export async function findApprovedRiderByPhone(phone: string) {
  const keys = phoneLookupKeys(phone);
  return prisma.rider.findFirst({
    where: { approved: true, phone: { in: keys } },
  });
}

export async function presentCustomer(customer: {
  id: string;
  phone: string;
  name: string | null;
}) {
  const rider = await findApprovedRiderByPhone(customer.phone);
  return {
    id: customer.id,
    phone: customer.phone,
    name: customer.name,
    isRider: Boolean(rider),
  };
}

export function assertCustomerActive(customer: { active: boolean }): void {
  if (customer.active) return;
  throw new AppError(
    "This account is inactive. Contact the KoboRide team.",
    "ACCOUNT_INACTIVE",
    403,
  );
}

export async function signInCustomer(phoneInput: string, name?: string) {
  const customer = await findOrCreateCustomer(phoneInput, name);
  assertCustomerActive(customer);

  const token = signToken({ sub: customer.id, role: "customer" });
  return {
    token,
    role: "customer" as const,
    user: await presentCustomer(customer),
  };
}

export async function signInRider(phoneInput: string) {
  const keys = phoneLookupKeys(phoneInput);
  const phone = preferredPhone(phoneInput);
  const rider = await prisma.rider.findFirst({ where: { phone: { in: keys } } });
  if (rider && rider.phone !== phone) {
    await prisma.rider.update({ where: { id: rider.id }, data: { phone } });
    rider.phone = phone;
  }
  if (!rider) {
    throw new AppError(
      "No rider account for this number. Ask ops to add you.",
      "RIDER_NOT_FOUND",
      401,
    );
  }

  const token = signToken({ sub: rider.id, role: "rider" });
  return {
    token,
    role: "rider" as const,
    user: presentRiderUser(rider),
    rider: {
      id: rider.id,
      approved: rider.approved,
      online: rider.availability === "ONLINE",
    },
  };
}

export async function signInAgent(phoneInput: string) {
  const keys = phoneLookupKeys(phoneInput);
  const agent = await prisma.agent.findFirst({ where: { phone: { in: keys } } });
  if (!agent || !agent.active) {
    throw new AppError(
      "This number is not registered as an agent. Contact KoboRide.",
      "AGENT_NOT_REGISTERED",
      403,
    );
  }
  const token = signToken({ sub: agent.id, role: "agent" });
  return {
    token,
    role: "agent" as const,
    user: { id: agent.id, phone: agent.phone, name: agent.name },
  };
}

export async function requireAgent(req: Request) {
  const user = requireUser(req, ["agent"]);
  const agent = await prisma.agent.findUnique({ where: { id: user.sub } });
  if (!agent || !agent.active) {
    throw new AppError(
      "This number is not registered as an agent. Contact KoboRide.",
      "AGENT_NOT_REGISTERED",
      403,
    );
  }
  return { user, agent };
}

export function presentRiderUser(rider: {
  id: string;
  phone: string;
  name: string;
  photoUrl?: string | null;
}) {
  return {
    id: rider.id,
    phone: rider.phone,
    name: rider.name,
    photoUrl: rider.photoUrl ?? null,
  };
}
