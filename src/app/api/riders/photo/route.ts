import { api, json, options, AppError } from "@/lib/errors";
import { requireRider } from "@/lib/auth";
import { uploadRiderPhoto } from "@/lib/cloudinary";
import { prisma } from "@/lib/prisma";
import { rateLimit } from "@/lib/rate-limit";

export const OPTIONS = () => options();

export const POST = api(async (req) => {
  const { rider } = await requireRider(req);
  rateLimit(`rider-photo:${rider.id}`, 8, 60 * 60 * 1000, "Too many photo uploads. Try later.");

  const form = await req.formData();
  const file = form.get("photo");
  if (!(file instanceof File) || file.size === 0) {
    throw new AppError("Choose a photo to upload", "VALIDATION_ERROR", 400);
  }

  const photoUrl = await uploadRiderPhoto(rider.id, file);
  const updated = await prisma.rider.update({
    where: { id: rider.id },
    data: { photoUrl },
  });

  return json({
    photoUrl: updated.photoUrl,
    user: {
      id: updated.id,
      phone: updated.phone,
      name: updated.name,
      photoUrl: updated.photoUrl,
    },
  });
});
