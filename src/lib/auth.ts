import jwt, { type SignOptions } from "jsonwebtoken";
import { config } from "@/lib/config";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import type { Rider } from "@prisma/client";

export type Role = "customer" | "admin";

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
    if (!payload.sub || !payload.role) throw new Error("bad payload");
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
  const user = requireUser(req, ["customer"]);
  const customer = await prisma.customer.findUnique({ where: { id: user.sub } });
  if (!customer) throw new AppError("Account not found", "NOT_FOUND", 404);
  const rider = await prisma.rider.findUnique({ where: { phone: customer.phone } });
  if (!rider?.approved) {
    throw new AppError(
      "You're not yet approved. Contact the KoboRide team.",
      "RIDER_NOT_APPROVED",
      403,
    );
  }
  return { user, rider };
}

export async function signInWithPhone(phone: string, name?: string) {
  const customer = await prisma.customer.upsert({
    where: { phone },
    create: { phone, name },
    update: name ? { name } : {},
  });
  const token = signToken({ sub: customer.id, role: "customer" });
  return {
    token,
    user: { id: customer.id, phone: customer.phone, name: customer.name },
  };
}
