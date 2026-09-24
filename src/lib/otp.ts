import { randomInt } from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { AppError } from "@/lib/errors";
import { sendOtpSms } from "@/lib/sms";
import { config } from "@/lib/config";
import { maskPhone } from "@/lib/phone";

const OTP_TTL_MS = 10 * 60 * 1000;
const CODE_LENGTH = 4;
const MAX_ATTEMPTS = 5;

function newCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

export async function issueOtp(phone: string) {
  const code = newCode();

  if (config.termiiApiKey) {
    await sendOtpSms(phone, code);
  } else if (config.isProd) {
    throw new AppError("SMS is not configured. Set TERMII_API_KEY.", "SMS_NOT_CONFIGURED", 503);
  } else {
    console.info(`[otp] Termii not configured — local code for ${maskPhone(phone)}`);
  }

  const codeHash = await bcrypt.hash(code, 10);
  await prisma.otpCode.deleteMany({ where: { phone } });
  await prisma.otpCode.create({
    data: {
      phone,
      codeHash,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    },
  });

  return {
    expires_in_seconds: OTP_TTL_MS / 1000,
    ...(!config.termiiApiKey && config.otpDevEcho ? { devCode: code } : {}),
  };
}

export async function verifyOtp(phone: string, code: string): Promise<void> {
  const record = await prisma.otpCode.findFirst({
    where: { phone },
    orderBy: { createdAt: "desc" },
  });

  if (!record?.codeHash) {
    throw new AppError("Request a new code first", "OTP_NOT_FOUND", 400);
  }
  if (record.expiresAt.getTime() < Date.now()) {
    await prisma.otpCode.delete({ where: { id: record.id } });
    throw new AppError("That code has expired. Request a new one.", "OTP_EXPIRED", 400);
  }
  if (record.attempts >= MAX_ATTEMPTS) {
    await prisma.otpCode.delete({ where: { id: record.id } });
    throw new AppError("Too many attempts. Request a new code.", "OTP_LOCKED", 400);
  }

  const ok = await bcrypt.compare(code, record.codeHash);
  if (!ok) {
    const attempts = record.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await prisma.otpCode.delete({ where: { id: record.id } });
      throw new AppError("Too many attempts. Request a new code.", "OTP_LOCKED", 400);
    }
    await prisma.otpCode.update({
      where: { id: record.id },
      data: { attempts },
    });
    throw new AppError("Incorrect code", "OTP_INVALID", 400);
  }

  await prisma.otpCode.deleteMany({ where: { phone } });
}
