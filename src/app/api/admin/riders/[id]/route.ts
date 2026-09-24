import { z } from "zod";
import { api, json, options, AppError } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { requireUser } from "@/lib/auth";
import { uploadRiderIdDocument, uploadRiderPhoto } from "@/lib/cloudinary";
import { orderDurationSeconds, orderInclude, presentTrip } from "@/lib/orders";
import { normalizePhone, phoneLookupKeys } from "@/lib/phone";
import { prisma } from "@/lib/prisma";
import {
  parseRiderVerification,
  parseZoneSlug,
  presentOpsRider,
  riderKeepRate,
  zoneTakeRate,
} from "@/lib/riders";
import { defaultZoneSlug } from "@/lib/zones";

export const OPTIONS = () => options();

function parseOptionalBool(value: unknown): boolean | undefined {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  return undefined;
}

async function readPatchInput(req: Request): Promise<{
  name?: string;
  phone?: string;
  zoneSlug?: string;
  photo: File | null;
  idDocument: File | null;
  active?: boolean;
  verification: ReturnType<typeof parseRiderVerification>;
}> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const name = String(form.get("name") ?? "").trim();
    const phone = String(form.get("phone") ?? "").trim();
    const zoneSlugRaw = String(form.get("zoneSlug") ?? "").trim();
    const photo = form.get("photo");
    const idDocument = form.get("idDocument");
    const verificationFields = {
      idType: String(form.get("idType") ?? ""),
      idNumber: String(form.get("idNumber") ?? ""),
      nextOfKinName: String(form.get("nextOfKinName") ?? ""),
      nextOfKinPhone: String(form.get("nextOfKinPhone") ?? ""),
      nextOfKinRelationship: String(form.get("nextOfKinRelationship") ?? ""),
    };
    return {
      name: name || undefined,
      phone: phone || undefined,
      zoneSlug: zoneSlugRaw ? parseZoneSlug(zoneSlugRaw) : undefined,
      photo: photo instanceof File && photo.size > 0 ? photo : null,
      idDocument: idDocument instanceof File && idDocument.size > 0 ? idDocument : null,
      active: parseOptionalBool(form.get("active") ?? form.get("approved")),
      verification: parseRiderVerification(verificationFields),
    };
  }

  const body = parseBody(
    z.object({
      name: z.string().min(2).max(80).optional(),
      phone: z.string().min(10).optional(),
      zoneSlug: z.string().optional(),
      approved: z.boolean().optional(),
      active: z.boolean().optional(),
    }),
    await readJson(req),
  );
  return {
    name: body.name?.trim(),
    phone: body.phone,
    zoneSlug: body.zoneSlug ? parseZoneSlug(body.zoneSlug) : undefined,
    photo: null,
    idDocument: null,
    active: body.active ?? body.approved,
    verification: {},
  };
}

export const GET = api(async (req, ctx) => {
  requireUser(req, ["admin"]);
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing rider id", "VALIDATION_ERROR", 400);

  const rider = await prisma.rider.findUnique({
    where: { id },
    include: {
      orders: {
        include: orderInclude,
        orderBy: { createdAt: "desc" },
      },
      releases: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!rider) throw new AppError("Rider not found", "NOT_FOUND", 404);

  const completed = rider.orders.filter((order) => order.status === "completed");
  const activeCount = rider.orders.filter((order) => order.status === "in_progress").length;
  const last = rider.orders[0];
  const durations = completed
    .map(orderDurationSeconds)
    .filter((seconds): seconds is number => seconds != null);
  const avgDurationSeconds =
    durations.length > 0
      ? Math.round(durations.reduce((sum, seconds) => sum + seconds, 0) / durations.length)
      : null;
  const zoneSlug = rider.zoneSlug || defaultZoneSlug();
  const [zoneAccepted, zoneCancelled] = await Promise.all([
    prisma.order.count({
      where: { zoneSlug, status: { in: ["in_progress", "completed"] } },
    }),
    prisma.order.count({ where: { zoneSlug, status: "cancelled" } }),
  ]);

  return json({
    rider: {
      ...presentOpsRider(rider),
      online: rider.availability === "ONLINE",
      jobsCount: rider.orders.length,
      completedCount: completed.length,
      earnedNgn: completed.reduce((sum, order) => sum + order.payoutNgn, 0),
      unpaidNgn: completed
        .filter((order) => !order.payoutPaid)
        .reduce((sum, order) => sum + order.payoutNgn, 0),
      paidNgn: completed
        .filter((order) => order.payoutPaid)
        .reduce((sum, order) => sum + order.payoutNgn, 0),
      distanceKm: completed.reduce((sum, order) => sum + order.distanceKm, 0),
      avgDurationSeconds,
      lastJobAt: last?.createdAt.toISOString() ?? null,
      droppedCount: rider.releases.length,
      droppedRecentCount: rider.releases.filter(
        (row) => row.createdAt >= new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      ).length,
      lastDroppedAt: rider.releases[0]?.createdAt.toISOString() ?? null,
      lastDropReason: rider.releases[0]?.reason ?? null,
      acceptanceRate: riderKeepRate(completed.length, activeCount, rider.releases.length),
      zoneAcceptanceRate: zoneTakeRate(zoneAccepted, zoneCancelled),
    },
    trips: rider.orders.map(presentTrip),
  });
});

export const PATCH = api(async (req, ctx) => {
  requireUser(req, ["admin"]);
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing rider id", "VALIDATION_ERROR", 400);

  const input = await readPatchInput(req);
  if (
    !input.name &&
    !input.phone &&
    !input.zoneSlug &&
    !input.photo &&
    !input.idDocument &&
    input.active === undefined &&
    Object.keys(input.verification).length === 0
  ) {
    throw new AppError("Nothing to update", "VALIDATION_ERROR", 400);
  }

  const rider = await prisma.rider.findUnique({ where: { id } });
  if (!rider) throw new AppError("Rider not found", "NOT_FOUND", 404);

  if (input.active === false) {
    const liveJobs = await prisma.order.count({
      where: { riderId: id, status: "in_progress" },
    });
    if (liveJobs > 0) {
      throw new AppError(
        "This rider has a live job. Reassign or finish it first.",
        "RIDER_HAS_LIVE_JOB",
        409,
      );
    }
  }

  let phone = rider.phone;
  if (input.phone) {
    phone = normalizePhone(input.phone);
    const clash = await prisma.rider.findFirst({
      where: { id: { not: id }, phone: { in: phoneLookupKeys(input.phone) } },
    });
    if (clash) {
      throw new AppError("Another rider already uses that phone", "PHONE_TAKEN", 409);
    }
  }

  let updated = await prisma.rider.update({
    where: { id },
    data: {
      ...(input.name ? { name: input.name } : {}),
      ...(input.phone ? { phone } : {}),
      ...(input.zoneSlug ? { zoneSlug: input.zoneSlug } : {}),
      ...input.verification,
      ...(input.active === undefined
        ? {}
        : {
            approved: input.active,
            ...(!input.active ? { availability: "OFFLINE" as const } : {}),
          }),
    },
  });

  if (input.photo) {
    const photoUrl = await uploadRiderPhoto(updated.id, input.photo);
    updated = await prisma.rider.update({
      where: { id: updated.id },
      data: { photoUrl },
    });
  }
  if (input.idDocument) {
    const idDocumentUrl = await uploadRiderIdDocument(updated.id, input.idDocument);
    updated = await prisma.rider.update({
      where: { id: updated.id },
      data: { idDocumentUrl },
    });
  }

  return json({ rider: presentOpsRider(updated) });
});

export const DELETE = api(async (req, ctx) => {
  requireUser(req, ["admin"]);
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing rider id", "VALIDATION_ERROR", 400);

  const rider = await prisma.rider.findUnique({ where: { id } });
  if (!rider) throw new AppError("Rider not found", "NOT_FOUND", 404);

  const liveJobs = await prisma.order.count({
    where: { riderId: id, status: "in_progress" },
  });
  if (liveJobs > 0) {
    throw new AppError(
      "This rider has a live job. Reassign or finish it first.",
      "RIDER_HAS_LIVE_JOB",
      409,
    );
  }

  await prisma.rider.delete({ where: { id } });
  return json({ ok: true });
});
