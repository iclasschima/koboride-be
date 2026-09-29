import type { OnboardingStatus, Prisma, RiderIdType } from "@prisma/client";
import { AppError } from "@/lib/errors";
import { decryptField, encryptField, fieldLookup, maskSecret } from "@/lib/fieldCrypto";
import { normalizePhone, phoneLookupKeys } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import { normalizeIdNumber, type RiderIdTypeValue } from "@/lib/riders";

const SUBMIT_PER_DAY = 30;
const LAGOS_OFFSET_MS = 60 * 60 * 1000;

/** Stamp the first time a rider reaches 10 completed orders. Later orders never move it. */
export function nextFirstTenReachedAt(
  existing: Date | null,
  completedCount: number,
  now = new Date(),
): Date | null {
  if (existing) return existing;
  if (completedCount < 10) return null;
  return now;
}

export async function noteRiderFirstTen(riderId: string | null | undefined, now = new Date()): Promise<void> {
  if (!riderId) return;
  const rider = await prisma.rider.findUnique({
    where: { id: riderId },
    select: { firstTenReachedAt: true },
  });
  if (!rider) return;
  const completed = await prisma.order.count({
    where: { riderId, status: "completed" },
  });
  const stamp = nextFirstTenReachedAt(rider.firstTenReachedAt, completed, now);
  if (!stamp || rider.firstTenReachedAt) return;
  await prisma.rider.updateMany({
    where: { id: riderId, firstTenReachedAt: null },
    data: { firstTenReachedAt: stamp },
  });
}

export async function writeOnboardingEvent(input: {
  riderId: string;
  actorId: string;
  actorRole: string;
  action: string;
  note?: string | null;
}): Promise<void> {
  await prisma.onboardingEvent.create({
    data: {
      riderId: input.riderId,
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: input.action,
      note: input.note?.trim() || null,
    },
  });
}

function lagosDayStart(now = new Date()): Date {
  const lagos = new Date(now.getTime() + LAGOS_OFFSET_MS);
  return new Date(Date.UTC(lagos.getUTCFullYear(), lagos.getUTCMonth(), lagos.getUTCDate()) - LAGOS_OFFSET_MS);
}

export async function submitRiderForAgent(
  agentId: string,
  input: {
    name: string;
    phone: string;
    idType: RiderIdTypeValue;
    idNumber: string;
    bankName: string;
    bankCode: string;
    bankAccountNo: string;
    nextOfKinName: string;
    nextOfKinPhone: string;
    zoneId: string;
    photoWithBikeUrl: string;
    selfieUrl: string;
    depositPaid: boolean;
  },
): Promise<{ id: string; onboardingStatus: OnboardingStatus; idNumberMasked: string | null }> {
  const since = lagosDayStart();
  const submittedToday = await prisma.rider.count({
    where: { onboardedByAgentId: agentId, submittedAt: { gte: since } },
  });
  if (submittedToday >= SUBMIT_PER_DAY) {
    throw new AppError("You can submit 30 riders a day.", "RATE_LIMITED", 429);
  }

  const phone = normalizePhone(input.phone);
  const kinPhone = normalizePhone(input.nextOfKinPhone);
  const idNumber = normalizeIdNumber(input.idType, input.idNumber);
  const account = input.bankAccountNo.replace(/\D/g, "");
  if (account.length !== 10) {
    throw new AppError("Bank account number must be 10 digits", "VALIDATION_ERROR", 400);
  }

  const zone = await prisma.pricingZone.findUnique({ where: { slug: input.zoneId } });
  if (!zone?.active) {
    throw new AppError("Pick an active delivery zone", "INVALID_ZONE", 400);
  }

  const phoneKeys = phoneLookupKeys(phone);
  const lookup = fieldLookup(idNumber);
  const existing = await prisma.rider.findFirst({
    where: {
      OR: [{ phone: { in: phoneKeys } }, { idNumberLookup: lookup }, { idNumber }],
    },
    select: { id: true },
  });
  if (existing) {
    throw new AppError("This rider is already registered", "DUPLICATE_RIDER", 409);
  }

  const now = new Date();
  try {
    const rider = await prisma.rider.create({
      data: {
        name: input.name.trim(),
        phone,
        idType: input.idType as RiderIdType,
        idNumber: encryptField(idNumber),
        idNumberLookup: lookup,
        bankName: input.bankName.trim(),
        bankCode: input.bankCode.trim(),
        bankAccountNo: encryptField(account),
        nextOfKinName: input.nextOfKinName.trim(),
        nextOfKinPhone: kinPhone,
        zoneSlug: zone.slug,
        photoWithBikeUrl: input.photoWithBikeUrl,
        selfieUrl: input.selfieUrl,
        depositPaid: input.depositPaid,
        approved: false,
        onboardingStatus: "SUBMITTED",
        submittedAt: now,
        onboardedByAgentId: agentId,
      },
    });
    await writeOnboardingEvent({
      riderId: rider.id,
      actorId: agentId,
      actorRole: "agent",
      action: "SUBMITTED",
    });
    return {
      id: rider.id,
      onboardingStatus: rider.onboardingStatus,
      idNumberMasked: maskSecret(idNumber),
    };
  } catch (err) {
    if (isUniqueConflict(err)) {
      throw new AppError("This rider is already registered", "DUPLICATE_RIDER", 409);
    }
    throw err;
  }
}

function isUniqueConflict(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}

export function presentAgentRider(rider: {
  id: string;
  name: string;
  phone: string;
  onboardingStatus: OnboardingStatus;
  submittedAt: Date | null;
  approvedAt: Date | null;
  firstTenReachedAt: Date | null;
  zoneSlug: string;
  _count?: { orders: number };
  completedCount?: number;
}) {
  const deliveries = rider.completedCount ?? rider._count?.orders ?? 0;
  return {
    id: rider.id,
    name: rider.name,
    phone: rider.phone,
    status: rider.onboardingStatus,
    submittedAt: rider.submittedAt?.toISOString() ?? null,
    approvedAt: rider.approvedAt?.toISOString() ?? null,
    zoneId: rider.zoneSlug,
    deliveries,
    reachedTen: Boolean(rider.firstTenReachedAt) || deliveries >= 10,
  };
}

export function adminRiderSecrets(rider: {
  idNumber: string | null;
  bankAccountNo: string | null;
  bankName: string | null;
}) {
  return {
    idNumber: decryptField(rider.idNumber),
    bankName: rider.bankName,
    bankAccountNo: decryptField(rider.bankAccountNo),
  };
}

export async function assertAgentOwnsRider(agentId: string, riderId: string) {
  const rider = await prisma.rider.findFirst({
    where: { id: riderId, onboardedByAgentId: agentId },
  });
  if (!rider) throw new AppError("Rider not found", "NOT_FOUND", 404);
  return rider;
}

export type RiderOnboardingRow = Prisma.RiderGetPayload<{
  include: { onboardedByAgent: { select: { id: true; name: true; phone: true } } };
}>;
