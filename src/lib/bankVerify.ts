import { prisma } from "@/lib/prisma";
import { decryptField, encryptField } from "@/lib/fieldCrypto";
import { writeOnboardingEvent } from "@/lib/onboarding";
import { sendPushToAdmins } from "@/lib/push";
import { namesPlausiblyMatch } from "@/lib/payoutMath";
import { createPaystackRecipient, resolvePaystackAccount } from "@/lib/paystack";
import { AppError } from "@/lib/errors";

let bankCache: { at: number; banks: Array<{ name: string; code: string }> } | null = null;

export async function cachedBanks(): Promise<Array<{ name: string; code: string }>> {
  if (bankCache && Date.now() - bankCache.at < 24 * 60 * 60 * 1000) return bankCache.banks;
  const { listPaystackBanks } = await import("@/lib/paystack");
  const banks = await listPaystackBanks();
  bankCache = { at: Date.now(), banks };
  return banks;
}

export async function lookupAccountName(bankCode: string, accountNumber: string): Promise<string> {
  const code = bankCode.trim();
  const account = accountNumber.replace(/\D/g, "");
  if (code.length < 2 || account.length !== 10) {
    throw new AppError("Add the bank and a 10-digit account number", "VALIDATION_ERROR", 400);
  }
  try {
    const resolved = await resolvePaystackAccount(account, code);
    return resolved.accountName;
  } catch (err) {
    if (err instanceof AppError && err.code === "PAYSTACK_NOT_CONFIGURED") throw err;
    const message = err instanceof AppError && err.message ? err.message : "This account number was not found at that bank.";
    throw new AppError(message, "BANK_UNRESOLVED", 400);
  }
}

export async function verifyRiderBank(
  riderId: string,
  actorId: string,
  actorRole: "admin" | "rider" | "system" = actorId === "system" ? "system" : "admin",
): Promise<void> {
  const rider = await prisma.rider.findUnique({ where: { id: riderId } });
  if (!rider) throw new AppError("Rider not found", "NOT_FOUND", 404);
  const account = decryptField(rider.bankAccountNo)?.replace(/\D/g, "") ?? "";
  if (!rider.bankCode || account.length !== 10) {
    await prisma.rider.update({
      where: { id: rider.id },
      data: { bankNeedsReview: true, bankVerifiedAt: null, paystackRecipientCode: null },
    });
    return;
  }
  let resolved: { accountName: string };
  try {
    resolved = await resolvePaystackAccount(account, rider.bankCode);
  } catch (err) {
    await prisma.rider.update({
      where: { id: rider.id },
      data: { bankNeedsReview: true, bankVerifiedAt: null, paystackRecipientCode: null },
    });
    await sendPushToAdmins({
      title: "Bank needs review",
      body: `${rider.name}: account could not be resolved`,
      url: `/admin/payouts`,
    });
    if (err instanceof AppError) return;
    throw err;
  }
  if (!namesPlausiblyMatch(rider.name, resolved.accountName)) {
    await prisma.rider.update({
      where: { id: rider.id },
      data: {
        bankAccountName: resolved.accountName,
        bankNeedsReview: true,
        bankVerifiedAt: null,
        paystackRecipientCode: null,
      },
    });
    await writeOnboardingEvent({
      riderId: rider.id,
      actorId,
      actorRole,
      action: "BANK_REVIEW",
      note: `Resolved name ${resolved.accountName} does not match ${rider.name}`,
    });
    await sendPushToAdmins({
      title: "Bank name needs review",
      body: `${rider.name} resolved as ${resolved.accountName}`,
      url: `/admin/payouts`,
    });
    return;
  }
  const recipient = await createPaystackRecipient({
    name: resolved.accountName,
    accountNumber: account,
    bankCode: rider.bankCode,
  });
  await prisma.rider.update({
    where: { id: rider.id },
    data: {
      bankAccountName: resolved.accountName,
      paystackRecipientCode: recipient,
      bankVerifiedAt: new Date(),
      bankNeedsReview: false,
    },
  });
  await writeOnboardingEvent({
    riderId: rider.id,
    actorId,
    actorRole,
    action: "BANK_VERIFIED",
    note: resolved.accountName,
  });
}

export async function syncRiderBankFromAdmin(input: {
  riderId: string;
  adminId: string;
  bankCode?: string;
  bankName?: string;
  accountNumber?: string;
}): Promise<void> {
  const bankCode = input.bankCode?.trim() ?? "";
  const accountNumber = (input.accountNumber ?? "").replace(/\D/g, "");
  if (!bankCode && !accountNumber) return;
  if (!bankCode || accountNumber.length !== 10) {
    throw new AppError("Add the bank and a 10-digit account number", "VALIDATION_ERROR", 400);
  }
  const rider = await prisma.rider.findUnique({ where: { id: input.riderId } });
  if (!rider) throw new AppError("Rider not found", "NOT_FOUND", 404);
  let current = "";
  try {
    current = decryptField(rider.bankAccountNo)?.replace(/\D/g, "") ?? "";
  } catch {
    current = "";
  }
  if (
    rider.bankCode === bankCode &&
    current === accountNumber &&
    rider.bankVerifiedAt &&
    !rider.bankNeedsReview
  ) {
    return;
  }
  let bankName = input.bankName?.trim() || "";
  if (!bankName) {
    const banks = await cachedBanks().catch(() => [] as Array<{ name: string; code: string }>);
    bankName = banks.find((bank) => bank.code === bankCode)?.name || rider.bankName || "Bank";
  }
  await replaceRiderBank({
    riderId: input.riderId,
    adminId: input.adminId,
    bankCode,
    bankName,
    accountNumber,
    note: "Saved from the rider profile",
  });
}

export async function updateRiderOwnBank(input: {
  riderId: string;
  bankCode: string;
  bankName?: string;
  accountNumber: string;
}): Promise<void> {
  const bankCode = input.bankCode.trim();
  const accountNumber = input.accountNumber.replace(/\D/g, "");
  if (bankCode.length < 2 || accountNumber.length !== 10) {
    throw new AppError("Add the bank and a 10-digit account number", "VALIDATION_ERROR", 400);
  }
  const rider = await prisma.rider.findUnique({ where: { id: input.riderId } });
  if (!rider) throw new AppError("Rider not found", "NOT_FOUND", 404);
  let current = "";
  try {
    current = decryptField(rider.bankAccountNo)?.replace(/\D/g, "") ?? "";
  } catch {
    current = "";
  }
  if (
    rider.bankCode === bankCode &&
    current === accountNumber &&
    rider.bankVerifiedAt &&
    !rider.bankNeedsReview
  ) {
    return;
  }
  await lookupAccountName(bankCode, accountNumber);
  let bankName = input.bankName?.trim() || "";
  if (!bankName) {
    const banks = await cachedBanks().catch(() => [] as Array<{ name: string; code: string }>);
    bankName = banks.find((bank) => bank.code === bankCode)?.name || rider.bankName || "Bank";
  }
  await replaceRiderBank({
    riderId: input.riderId,
    adminId: input.riderId,
    actorRole: "rider",
    bankCode,
    bankName,
    accountNumber,
    note: "Updated from the rider profile",
  });
}

export async function replaceRiderBank(input: {
  riderId: string;
  adminId: string;
  bankCode: string;
  bankName: string;
  accountNumber: string;
  note: string;
  actorRole?: "admin" | "rider";
}): Promise<void> {
  const account = input.accountNumber.replace(/\D/g, "");
  if (account.length !== 10) {
    throw new AppError("Bank account number must be 10 digits", "VALIDATION_ERROR", 400);
  }
  await prisma.rider.update({
    where: { id: input.riderId },
    data: {
      bankCode: input.bankCode,
      bankName: input.bankName,
      bankAccountNo: encryptField(account),
      bankAccountName: null,
      bankVerifiedAt: null,
      paystackRecipientCode: null,
      bankNeedsReview: true,
    },
  });
  await writeOnboardingEvent({
    riderId: input.riderId,
    actorId: input.adminId,
    actorRole: input.actorRole ?? "admin",
    action: "BANK_CHANGED",
    note: input.note,
  });
  await verifyRiderBank(input.riderId, input.adminId, input.actorRole ?? "admin");
}
