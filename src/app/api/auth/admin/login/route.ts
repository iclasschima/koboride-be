import bcrypt from "bcryptjs";
import { z } from "zod";
import { api, json, options, AppError } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { prisma } from "@/lib/prisma";
import { signToken } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

export const OPTIONS = () => options();

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const POST = api(async (req) => {
  const body = parseBody(schema, await readJson(req));
  const email = body.email.toLowerCase().trim();
  rateLimit(`admin-login:${email}`, 8, 15 * 60 * 1000, "Too many login attempts.");

  const admin = await prisma.admin.findUnique({ where: { email } });
  if (!admin || !(await bcrypt.compare(body.password, admin.passwordHash))) {
    throw new AppError("Invalid email or password", "INVALID_CREDENTIALS", 401);
  }

  const token = signToken({ sub: admin.id, role: "admin" });
  return json({
    token,
    role: "admin" as const,
    user: { id: admin.id, email: admin.email },
  });
});
