import { randomInt } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { sendOtpSms, verifyOtpSms } from "@/lib/sms";
import { config } from "@/lib/config";
import { maskPhone } from "@/lib/phone";

const OTP_TTL_MS = 6 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const SKIP_CODE = "00000";

export async function issueOtp(phone: string) {
  if (config.otpSkip) {
    await prisma.otpCode.deleteMany({ where: { phone } });
    await prisma.otpCode.create({
      data: {
        phone,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });
    console.info(`[otp] skipped Sendchamp for ${maskPhone(phone)}`);
    return { expires_in_seconds: OTP_TTL_MS / 1000, devCode: SKIP_CODE };
  }

  if (config.sendchampPublicKey) {
    const pinId = await sendOtpSms(phone);
    await prisma.otpCode.deleteMany({ where: { phone } });
    await prisma.otpCode.create({
      data: {
        phone,
        pinId,
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
    });
    return { expires_in_seconds: OTP_TTL_MS / 1000 };
  }

  if (config.isProd) {
    throw new AppError("SMS is not configured. Set SENDCHAMP_PUBLIC_KEY.", "SMS_NOT_CONFIGURED", 503);
  }

  const code = String(randomInt(10_000, 100_000));
  const codeHash = await bcrypt.hash(code, 10);
  await prisma.otpCode.deleteMany({ where: { phone } });
  await prisma.otpCode.create({
    data: {
      phone,
      codeHash,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });

  console.info(`[otp] Sendchamp not configured — local code for ${maskPhone(phone)}`);
  return {
    expires_in_seconds: OTP_TTL_MS / 1000,
    ...(config.otpDevEcho ? { devCode: code } : {}),
  };
}

export async function verifyOtp(phone: string, code: string): Promise<void> {
  if (config.otpSkip) {
    await prisma.otpCode.deleteMany({ where: { phone } });
    return;
  }

  const record = await prisma.otpCode.findFirst({
    where: { phone },
    orderBy: { createdAt: "desc" },
  });

  if (!record) throw new AppError("Request a new code first", "OTP_NOT_FOUND", 400);
  if (record.expiresAt.getTime() < Date.now()) {
    await prisma.otpCode.delete({ where: { id: record.id } });
    throw new AppError("That code has expired. Request a new one.", "OTP_EXPIRED", 400);
  }

  if (record.pinId) {
    try {
      await verifyOtpSms(record.pinId, code);
    } catch (err) {
      if (err instanceof AppError && err.code === "OTP_INVALID") {
        const attempts = record.attempts + 1;
        if (attempts >= MAX_ATTEMPTS) {
          await prisma.otpCode.delete({ where: { id: record.id } });
          throw new AppError("Too many attempts. Request a new code.", "OTP_LOCKED", 400);
        }
        await prisma.otpCode.update({
          where: { id: record.id },
          data: { attempts },
        });
      }
      if (err instanceof AppError && (err.code === "OTP_EXPIRED" || err.code === "OTP_NOT_FOUND")) {
        await prisma.otpCode.delete({ where: { id: record.id } }).catch(() => undefined);
      }
      throw err;
    }
    await prisma.otpCode.deleteMany({ where: { phone } });
    return;
  }

  if (!record.codeHash) {
    throw new AppError("Request a new code first", "OTP_NOT_FOUND", 400);
  }
  if (record.attempts >= MAX_ATTEMPTS) {
    await prisma.otpCode.delete({ where: { id: record.id } });
    throw new AppError("Too many attempts. Request a new code.", "OTP_LOCKED", 400);
  }

  const ok = await bcrypt.compare(code, record.codeHash);
  if (!ok) {
    await prisma.otpCode.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    });
    throw new AppError("Incorrect code", "OTP_INVALID", 400);
  }

  await prisma.otpCode.deleteMany({ where: { phone } });
}
