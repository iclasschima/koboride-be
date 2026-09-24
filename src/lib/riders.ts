import type { RiderIdType } from "@prisma/client";
import { AppError } from "@/lib/errors";
import { normalizePhone } from "@/lib/phone";
import { defaultZoneSlug, isKnownZoneSlug, zoneName } from "@/lib/zones";

export const RIDER_ID_TYPES = [
  "nin",
  "drivers_license",
  "voters_card",
  "passport",
] as const;

export const KIN_RELATIONSHIPS = [
  "Spouse",
  "Parent",
  "Sibling",
  "Child",
  "Relative",
  "Friend",
  "Other",
] as const;

export type RiderIdTypeValue = (typeof RIDER_ID_TYPES)[number];

export function isRiderIdType(value: string): value is RiderIdTypeValue {
  return (RIDER_ID_TYPES as readonly string[]).includes(value);
}

export function normalizeIdNumber(idType: RiderIdTypeValue, raw: string): string {
  const value = raw.trim();
  if (idType === "nin") {
    const digits = value.replace(/\D/g, "");
    if (digits.length !== 11) {
      throw new AppError("NIN must be 11 digits", "VALIDATION_ERROR", 400);
    }
    return digits;
  }
  if (value.length < 4 || value.length > 40) {
    throw new AppError("ID number looks too short", "VALIDATION_ERROR", 400);
  }
  return value;
}

export function normalizeKinRelationship(raw: string): string {
  const value = raw.trim();
  if (value.length < 2 || value.length > 40) {
    throw new AppError("Add the next-of-kin relationship", "VALIDATION_ERROR", 400);
  }
  return value;
}

export function normalizeKinName(raw: string): string {
  const value = raw.trim();
  if (value.length < 2 || value.length > 80) {
    throw new AppError("Add the next-of-kin name", "VALIDATION_ERROR", 400);
  }
  return value;
}

export function riderDocsComplete(rider: {
  photoUrl?: string | null;
  idType?: RiderIdType | null;
  idNumber?: string | null;
  idDocumentUrl?: string | null;
  nextOfKinName?: string | null;
  nextOfKinPhone?: string | null;
  nextOfKinRelationship?: string | null;
}): boolean {
  return Boolean(
    rider.photoUrl &&
      rider.idType &&
      rider.idNumber &&
      rider.idDocumentUrl &&
      rider.nextOfKinName &&
      rider.nextOfKinPhone &&
      rider.nextOfKinRelationship,
  );
}

export function parseZoneSlug(raw: unknown, fallback = defaultZoneSlug()): string {
  const slug = String(raw ?? "").trim().toUpperCase() || fallback;
  if (!isKnownZoneSlug(slug)) {
    throw new AppError("Pick a delivery zone", "VALIDATION_ERROR", 400);
  }
  return slug;
}

export function presentOpsRider(rider: {
  id: string;
  name: string;
  phone: string;
  photoUrl?: string | null;
  approved: boolean;
  createdAt: Date;
  zoneSlug?: string | null;
  idType?: RiderIdType | null;
  idNumber?: string | null;
  idDocumentUrl?: string | null;
  nextOfKinName?: string | null;
  nextOfKinPhone?: string | null;
  nextOfKinRelationship?: string | null;
}) {
  const zoneSlug = rider.zoneSlug || defaultZoneSlug();
  return {
    id: rider.id,
    role: "rider" as const,
    name: rider.name,
    phone: rider.phone,
    photoUrl: rider.photoUrl ?? null,
    approved: rider.approved,
    active: rider.approved,
    createdAt: rider.createdAt.toISOString(),
    zoneSlug,
    zoneName: zoneName(zoneSlug),
    idType: rider.idType ?? null,
    idNumber: rider.idNumber ?? null,
    idDocumentUrl: rider.idDocumentUrl ?? null,
    nextOfKinName: rider.nextOfKinName ?? null,
    nextOfKinPhone: rider.nextOfKinPhone ?? null,
    nextOfKinRelationship: rider.nextOfKinRelationship ?? null,
    docsComplete: riderDocsComplete(rider),
  };
}

export function ratePercent(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 100);
}

/** Jobs they still have vs jobs they handed back. */
export function riderKeepRate(
  completedCount: number,
  activeCount: number,
  droppedCount: number,
): number | null {
  return ratePercent(completedCount + activeCount, completedCount + activeCount + droppedCount);
}

/** Share of settled zone jobs that got a rider. */
export function zoneTakeRate(acceptedCount: number, cancelledCount: number): number | null {
  return ratePercent(acceptedCount, acceptedCount + cancelledCount);
}

export function parseRiderVerification(input: {
  idType?: string;
  idNumber?: string;
  nextOfKinName?: string;
  nextOfKinPhone?: string;
  nextOfKinRelationship?: string;
}) {
  const data: {
    idType?: RiderIdTypeValue;
    idNumber?: string;
    nextOfKinName?: string;
    nextOfKinPhone?: string;
    nextOfKinRelationship?: string;
  } = {};

  const idTypeRaw = input.idType?.trim() ?? "";
  const idNumberRaw = input.idNumber?.trim() ?? "";
  if (idNumberRaw) {
    const idType = isRiderIdType(idTypeRaw) ? idTypeRaw : "nin";
    data.idType = idType;
    data.idNumber = normalizeIdNumber(idType, idNumberRaw);
  } else if (isRiderIdType(idTypeRaw)) {
    data.idType = idTypeRaw;
  }

  const kinName = input.nextOfKinName?.trim() ?? "";
  if (kinName) data.nextOfKinName = normalizeKinName(kinName);

  const kinPhone = input.nextOfKinPhone?.trim() ?? "";
  if (kinPhone) {
    if (kinPhone.length < 7) {
      throw new AppError("Add a next-of-kin phone number", "VALIDATION_ERROR", 400);
    }
    data.nextOfKinPhone = normalizePhone(kinPhone);
  }

  const kinRelationship = input.nextOfKinRelationship?.trim() ?? "";
  if (kinRelationship) data.nextOfKinRelationship = normalizeKinRelationship(kinRelationship);

  return data;
}
