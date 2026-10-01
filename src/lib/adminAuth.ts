import bcrypt from "bcryptjs";
import { z } from "zod";
import { AdminPermission, type Admin } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { rateLimit, rateLimited } from "@/lib/rate-limit";

export const ADMIN_PERMISSIONS = Object.values(AdminPermission);

export const pinSchema = z.string().regex(/^\d{4,6}$/, "Your PIN is 4 to 6 digits");

const PIN_TRIES = 5;
const PIN_WINDOW_MS = 15 * 60 * 1000;

export function adminCan(admin: Pick<Admin, "role" | "permissions">, permission: AdminPermission): boolean {
  return admin.role === "super" || admin.permissions.includes(permission);
}

/** Signs in an active admin and, when given, checks they may open `permission`. */
export async function requireAdmin(req: Request, permission?: AdminPermission) {
  const user = requireUser(req, ["admin"]);
  const admin = await prisma.admin.findUnique({ where: { id: user.sub } });
  if (!admin || !admin.active) throw new AppError("Authentication required", "UNAUTHORIZED", 401);
  if (permission && !adminCan(admin, permission)) {
    throw new AppError("You do not have access to this. Ask the super admin.", "FORBIDDEN", 403);
  }
  return { sub: admin.id, role: "admin" as const, admin };
}

export async function requireSuperAdmin(req: Request) {
  const signedIn = await requireAdmin(req);
  if (signedIn.admin.role !== "super") {
    throw new AppError("Only the super admin can do this.", "FORBIDDEN", 403);
  }
  return signedIn;
}

/** Wrong PINs answer 403, not 401, so the console does not sign the admin out. */
export async function confirmPin(admin: Admin, pin: string | undefined): Promise<void> {
  if (!admin.pinHash) throw new AppError("Set your PIN under Team first.", "PIN_NOT_SET", 403);
  if (!pin) throw new AppError("Enter your PIN.", "PIN_REQUIRED", 403);
  const key = `admin-pin:${admin.id}`;
  if (rateLimited(key, PIN_TRIES)) {
    throw new AppError("Too many wrong PINs. Try again in 15 minutes.", "RATE_LIMITED", 429);
  }
  if (!(await bcrypt.compare(pin, admin.pinHash))) {
    rateLimit(key, PIN_TRIES, PIN_WINDOW_MS);
    throw new AppError("That PIN is not right.", "WRONG_PIN", 403);
  }
}

export function presentAdmin(admin: Admin) {
  return {
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
    permissions: admin.role === "super" ? ADMIN_PERMISSIONS : admin.permissions,
    hasPin: Boolean(admin.pinHash),
    active: admin.active,
    createdAt: admin.createdAt.toISOString(),
  };
}
