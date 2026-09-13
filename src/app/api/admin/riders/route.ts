import { z } from "zod";
import { api, json, options } from "@/lib/errors";
import { parseBody, readJson } from "@/lib/validate";
import { requireUser } from "@/lib/auth";
import { uploadRiderIdDocument, uploadRiderPhoto } from "@/lib/cloudinary";
import { prisma } from "@/lib/prisma";
import { normalizePhone, phoneLookupKeys } from "@/lib/phone";
import { notifyAdminNewUser } from "@/lib/push";
import { parseRiderVerification, presentOpsRider } from "@/lib/riders";

export const OPTIONS = () => options();

const riderFields = z.object({
  phone: z.string().min(10),
  name: z.string().min(2).max(80),
  idType: z.string().optional(),
  idNumber: z.string().optional(),
  nextOfKinName: z.string().optional(),
  nextOfKinPhone: z.string().optional(),
  nextOfKinRelationship: z.string().optional(),
});

async function readCreateInput(req: Request): Promise<{
  name: string;
  phone: string;
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
      photo: photo instanceof File && photo.size > 0 ? photo : null,
      idDocument: idDocument instanceof File && idDocument.size > 0 ? idDocument : null,
      verification: parseRiderVerification(body),
    };
  }

  const body = parseBody(riderFields, await readJson(req));
  return {
    name: body.name.trim(),
    phone: body.phone,
    photo: null,
    idDocument: null,
    verification: parseRiderVerification(body),
  };
}

export const GET = api(async (req) => {
  requireUser(req, ["admin"]);
  const riders = await prisma.rider.findMany({ orderBy: { createdAt: "desc" } });
  return json({ riders: riders.map(presentOpsRider) });
});

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
        data: { phone, name: input.name, approved: true, ...input.verification },
      })
    : await prisma.rider.create({
        data: {
          phone,
          name: input.name,
          approved: true,
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
