import jwt, { type SignOptions } from "jsonwebtoken";
import { config } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { findOrCreateCustomer } from "@/lib/customers";
import { phoneLookupKeys, preferredPhone } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import type { Rider } from "@prisma/client";

export const ROLES = ["customer", "rider", "admin"] as const;
export type Role = (typeof ROLES)[number];

export type AuthUser = {
  sub: string;
  role: Role;
};

export function signToken(user: AuthUser): string {
  const options: SignOptions = { expiresIn: config.jwtExpiresIn as SignOptions["expiresIn"] };
  return jwt.sign(user, config.jwtSecret, options);
}

export function verifyToken(token: string): AuthUser {
  try {
    const payload = jwt.verify(token, config.jwtSecret) as AuthUser;
    if (!payload.sub || !ROLES.includes(payload.role)) throw new Error("bad payload");
    return { sub: payload.sub, role: payload.role };
  } catch {
    throw new AppError("Invalid or expired token", "UNAUTHORIZED", 401);
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

export async function requireRider(req: Request): Promise<{ user: AuthUser; rider: Rider }> {
  const user = requireUser(req, ["rider"]);
  const rider = await prisma.rider.findUnique({ where: { id: user.sub } });
  if (!rider) throw new AppError("Account not found", "NOT_FOUND", 404);
  if (!rider.approved) {
    throw new AppError(
      "You're not yet approved. Contact the KoboRide team.",
      "RIDER_NOT_APPROVED",
      403,
    );
  }
  return { user, rider };
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

export async function signInCustomer(phoneInput: string, name?: string) {
  const customer = await findOrCreateCustomer(phoneInput, name);

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
    user: { id: rider.id, phone: rider.phone, name: rider.name },
    rider: {
      id: rider.id,
      approved: rider.approved,
      online: rider.availability === "ONLINE",
    },
  };
}
