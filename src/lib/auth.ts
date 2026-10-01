import jwt from "jsonwebtoken";
import { config } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { findOrCreateCustomer } from "@/lib/customers";
import { phoneLookupKeys, preferredPhone } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import type { Rider } from "@prisma/client";

export const ROLES = ["customer", "rider", "admin", "agent", "merchant"] as const;
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

export async function findMerchantByPhone(phone: string) {
  const keys = phoneLookupKeys(phone);
  return prisma.merchant.findFirst({
    where: { phone: { in: keys } },
  });
}

export async function presentCustomer(customer: {
  id: string;
  phone: string;
  name: string | null;
}) {
  const [rider, merchant, agent] = await Promise.all([
    findApprovedRiderByPhone(customer.phone),
    findMerchantByPhone(customer.phone),
    prisma.agent.findFirst({ where: { phone: { in: phoneLookupKeys(customer.phone) } } }),
  ]);
  return {
    id: customer.id,
    phone: customer.phone,
    name: customer.name,
    isRider: Boolean(rider),
    isMerchant: Boolean(merchant?.active),
    isAgent: Boolean(agent?.active),
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

/** A token for a customer that no longer exists is treated as signed out, so the app asks for a new code. */
export async function requireCustomer(req: Request) {
  const user = requireUser(req, ["customer"]);
  const customer = await prisma.customer.findUnique({ where: { id: user.sub } });
  if (!customer) throw new AppError("Your sign-in expired. Confirm your phone again.", "SESSION_EXPIRED", 401);
  return customer;
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

/** Throws before a code is sent when ops has not added this number. */
export async function requireRiderAccount(phone: string) {
  const rider = await prisma.rider.findFirst({ where: { phone: { in: phoneLookupKeys(phone) } } });
  if (!rider) {
    throw new AppError(
      "No rider account for this number. Ask ops to add you.",
      "RIDER_NOT_FOUND",
      401,
    );
  }
  return rider;
}

export async function signInRider(phoneInput: string) {
  const phone = preferredPhone(phoneInput);
  const rider = await requireRiderAccount(phoneInput);
  if (rider.phone !== phone) {
    await prisma.rider.update({ where: { id: rider.id }, data: { phone } });
    rider.phone = phone;
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

function presentMerchantSession(merchant: { id: string; phone: string; name: string }) {
  const token = signToken({ sub: merchant.id, role: "merchant" });
  return {
    token,
    role: "merchant" as const,
    user: { id: merchant.id, phone: merchant.phone, name: merchant.name },
  };
}

/** Sign in a shop that already exists. Does not open a new shop. */
export async function signInExistingMerchant(phoneInput: string) {
  const phone = preferredPhone(phoneInput);
  let merchant = await findMerchantByPhone(phoneInput);
  if (merchant && merchant.phone !== phone) {
    merchant = await prisma.merchant.update({ where: { id: merchant.id }, data: { phone } });
  }
  if (!merchant) {
    throw new AppError("No shop for this number.", "MERCHANT_NOT_FOUND", 401);
  }
  if (!merchant.active) {
    throw new AppError(
      "This shop is inactive. Contact the KoboRide team.",
      "ACCOUNT_INACTIVE",
      403,
    );
  }
  return presentMerchantSession(merchant);
}

export async function signInMerchant(phoneInput: string) {
  const phone = preferredPhone(phoneInput);
  let merchant = await findMerchantByPhone(phoneInput);
  if (merchant && merchant.phone !== phone) {
    merchant = await prisma.merchant.update({ where: { id: merchant.id }, data: { phone } });
  }
  if (!merchant) {
    const tail = phone.replace(/\D/g, "").slice(-6);
    merchant = await prisma.merchant.create({
      data: {
        phone,
        name: "My shop",
        slug: `shop-${tail}-${Date.now().toString(36)}`,
      },
    });
  }
  if (!merchant.active) {
    throw new AppError(
      "This shop is inactive. Contact the KoboRide team.",
      "ACCOUNT_INACTIVE",
      403,
    );
  }
  return presentMerchantSession(merchant);
}

export async function requireMerchant(req: Request) {
  const user = requireUser(req, ["merchant"]);
  const merchant = await prisma.merchant.findUnique({ where: { id: user.sub } });
  if (!merchant || !merchant.active) {
    throw new AppError(
      "This shop is inactive. Contact the KoboRide team.",
      "ACCOUNT_INACTIVE",
      403,
    );
  }
  return { user, merchant };
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
