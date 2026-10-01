import bcrypt from "bcryptjs";
import { z } from "zod";
import { AdminPermission, type Admin } from "@prisma/client";
import { AppError } from "@/lib/errors";
import { prisma } from "@/lib/prisma";
import { pinSchema } from "@/lib/adminAuth";

const permissionsSchema = z.array(z.nativeEnum(AdminPermission)).max(Object.keys(AdminPermission).length);
const passwordSchema = z.string().min(8, "Use at least 8 characters for the password").max(200);

export const createStaffSchema = z.object({
  name: z.string().trim().min(2, "Add their name").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: passwordSchema,
  permissions: permissionsSchema,
  pin: z.string().optional(),
});

export const updateStaffSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  permissions: permissionsSchema.optional(),
  active: z.boolean().optional(),
  password: passwordSchema.optional(),
  pin: z.string().optional(),
});

export const setPinSchema = z.object({
  password: z.string().min(1, "Enter your password"),
  pin: pinSchema,
});

export async function createStaff(input: z.infer<typeof createStaffSchema>): Promise<Admin> {
  const taken = await prisma.admin.findUnique({ where: { email: input.email } });
  if (taken) throw new AppError("That email already has an admin login.", "EMAIL_TAKEN", 409);
  return prisma.admin.create({
    data: {
      name: input.name,
      email: input.email,
      passwordHash: await bcrypt.hash(input.password, 10),
      role: "staff",
      permissions: Array.from(new Set(input.permissions)),
    },
  });
}

export async function updateStaff(id: string, input: z.infer<typeof updateStaffSchema>): Promise<Admin> {
  const staff = await prisma.admin.findUnique({ where: { id } });
  if (!staff) throw new AppError("Admin not found", "NOT_FOUND", 404);
  if (staff.role === "super") throw new AppError("A super admin cannot be changed here.", "FORBIDDEN", 403);
  return prisma.admin.update({
    where: { id },
    data: {
      name: input.name,
      permissions: input.permissions ? Array.from(new Set(input.permissions)) : undefined,
      active: input.active,
      passwordHash: input.password ? await bcrypt.hash(input.password, 10) : undefined,
    },
  });
}

export async function setAdminPin(admin: Admin, input: z.infer<typeof setPinSchema>): Promise<Admin> {
  if (!(await bcrypt.compare(input.password, admin.passwordHash))) {
    throw new AppError("That password is not right.", "WRONG_PASSWORD", 403);
  }
  return prisma.admin.update({ where: { id: admin.id }, data: { pinHash: await bcrypt.hash(input.pin, 10) } });
}
