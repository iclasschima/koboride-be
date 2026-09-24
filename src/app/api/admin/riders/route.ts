import { z } from "zod";
import { api, json, options } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { requireUser } from "@/lib/auth";
import { uploadRiderIdDocument, uploadRiderPhoto } from "@/lib/cloudinary";
import { prisma } from "@/lib/prisma";
import { normalizePhone, phoneLookupKeys } from "@/lib/phone";
import { notifyAdminNewUser } from "@/lib/push";
import {
  parseRiderVerification,
  parseZoneSlug,
  presentOpsRider,
  riderKeepRate,
  zoneTakeRate,
} from "@/lib/riders";
import { defaultZoneSlug } from "@/lib/zones";

export const OPTIONS = () => options();

const riderFields = z.object({
  phone: z.string().min(10),
  name: z.string().min(2).max(80),
  zoneSlug: z.string().optional(),
  idType: z.string().optional(),
  idNumber: z.string().optional(),
  nextOfKinName: z.string().optional(),
  nextOfKinPhone: z.string().optional(),
  nextOfKinRelationship: z.string().optional(),
});

async function readCreateInput(req: Request): Promise<{
  name: string;
  phone: string;
  zoneSlug: string;
  photo: File | null;
  idDocument: File | null;
  verification: ReturnType<typeof parseRiderVerification>;
}> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const body = parseBody(riderFields, {
      name: String(form.get("name") ?? ""),
      phone: String(form.get("phone") ?? ""),
      zoneSlug: String(form.get("zoneSlug") ?? "") || undefined,
      idType: String(form.get("idType") ?? "") || undefined,
      idNumber: String(form.get("idNumber") ?? "") || undefined,
      nextOfKinName: String(form.get("nextOfKinName") ?? "") || undefined,
      nextOfKinPhone: String(form.get("nextOfKinPhone") ?? "") || undefined,
      nextOfKinRelationship: String(form.get("nextOfKinRelationship") ?? "") || undefined,
    });
    const photo = form.get("photo");
    const idDocument = form.get("idDocument");
    return {
      name: body.name.trim(),
      phone: body.phone,
      zoneSlug: parseZoneSlug(body.zoneSlug),
      photo: photo instanceof File && photo.size > 0 ? photo : null,
      idDocument: idDocument instanceof File && idDocument.size > 0 ? idDocument : null,
      verification: parseRiderVerification(body),
    };
  }

  const body = parseBody(riderFields, await readJson(req));
  return {
    name: body.name.trim(),
    phone: body.phone,
    zoneSlug: parseZoneSlug(body.zoneSlug),
    photo: null,
    idDocument: null,
    verification: parseRiderVerification(body),
  };
}

export const GET = api(async (req) => {
  requireUser(req, ["admin"]);
  const [riders, completedRows, activeRows, dropRows, zoneRows] = await Promise.all([
    prisma.rider.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.order.groupBy({
      by: ["riderId"],
      where: { status: "completed", riderId: { not: null } },
      _count: { _all: true },
    }),
    prisma.order.groupBy({
      by: ["riderId"],
      where: { status: "in_progress", riderId: { not: null } },
      _count: { _all: true },
    }),
    prisma.orderRelease.groupBy({
      by: ["riderId"],
      _count: { _all: true },
    }),
    prisma.order.groupBy({
      by: ["zoneSlug", "status"],
      _count: { _all: true },
    }),
  ]);

  const completedByRider = countById(completedRows);
  const activeByRider = countById(activeRows);
  const droppedByRider = countById(dropRows);
  const acceptedByZone = new Map<string, number>();
  const cancelledByZone = new Map<string, number>();
  for (const row of zoneRows) {
    if (row.status === "in_progress" || row.status === "completed") {
      acceptedByZone.set(row.zoneSlug, (acceptedByZone.get(row.zoneSlug) ?? 0) + row._count._all);
    } else if (row.status === "cancelled") {
      cancelledByZone.set(row.zoneSlug, (cancelledByZone.get(row.zoneSlug) ?? 0) + row._count._all);
    }
  }

  return json({
    riders: riders.map((rider) => {
      const zoneSlug = rider.zoneSlug || defaultZoneSlug();
      const completedCount = completedByRider.get(rider.id) ?? 0;
      const droppedCount = droppedByRider.get(rider.id) ?? 0;
      return {
        ...presentOpsRider(rider),
        completedCount,
        droppedCount,
        acceptanceRate: riderKeepRate(
          completedCount,
          activeByRider.get(rider.id) ?? 0,
          droppedCount,
        ),
        zoneAcceptanceRate: zoneTakeRate(
          acceptedByZone.get(zoneSlug) ?? 0,
          cancelledByZone.get(zoneSlug) ?? 0,
        ),
      };
    }),
  });
});

function countById(
  rows: Array<{ riderId: string | null; _count: { _all: number } }>,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.riderId) continue;
    counts.set(row.riderId, row._count._all);
  }
  return counts;
}

export const POST = api(async (req) => {
  requireUser(req, ["admin"]);
  const input = await readCreateInput(req);
  const phone = normalizePhone(input.phone);
  const existing = await prisma.rider.findFirst({
    where: { phone: { in: phoneLookupKeys(input.phone) } },
  });
  let rider = existing
    ? await prisma.rider.update({
        where: { id: existing.id },
        data: { phone, name: input.name, zoneSlug: input.zoneSlug, approved: true, ...input.verification },
      })
    : await prisma.rider.create({
        data: {
          phone,
          name: input.name,
          approved: true,
          zoneSlug: input.zoneSlug,
          availability: "OFFLINE",
          ...input.verification,
        },
      });

  const uploads: { photoUrl?: string; idDocumentUrl?: string } = {};
  if (input.photo) uploads.photoUrl = await uploadRiderPhoto(rider.id, input.photo);
  if (input.idDocument) {
    uploads.idDocumentUrl = await uploadRiderIdDocument(rider.id, input.idDocument);
  }
  if (uploads.photoUrl || uploads.idDocumentUrl) {
    rider = await prisma.rider.update({
      where: { id: rider.id },
      data: uploads,
    });
  }

  if (!existing) {
    await notifyAdminNewUser({ name: rider.name, phone: rider.phone, kind: "rider" });
  }
  return json({ rider: presentOpsRider(rider) }, 201);
});
