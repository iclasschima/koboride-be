import { v2 as cloudinary } from "cloudinary";
import { config } from "@/lib/config";
import { AppError } from "@/lib/errors";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const MAX_BYTES = 5 * 1024 * 1024;

function cloudinaryReady(): boolean {
  return Boolean(
    config.cloudinaryCloudName && config.cloudinaryApiKey && config.cloudinaryApiSecret,
  );
}

function configureCloudinary(): void {
  if (!cloudinaryReady()) {
    throw new AppError(
      "Photo upload is not configured. Set Cloudinary keys on the API.",
      "CLOUDINARY_NOT_CONFIGURED",
      503,
    );
  }
  cloudinary.config({
    cloud_name: config.cloudinaryCloudName,
    api_key: config.cloudinaryApiKey,
    api_secret: config.cloudinaryApiSecret,
    secure: true,
  });
}

export function assertPhotoFile(file: File): void {
  if (!ALLOWED.has(file.type)) {
    throw new AppError("Use a JPEG, PNG, or WebP photo", "INVALID_PHOTO_TYPE", 400);
  }
  if (file.size > MAX_BYTES) {
    throw new AppError("Photo must be 5MB or smaller", "PHOTO_TOO_LARGE", 400);
  }
}

async function uploadImage(
  file: File,
  opts: { folder: string; publicId: string; transformation: object[] },
): Promise<string> {
  configureCloudinary();
  assertPhotoFile(file);
  const buffer = Buffer.from(await file.arrayBuffer());
  const result = await cloudinary.uploader.upload(`data:${file.type};base64,${buffer.toString("base64")}`, {
    folder: opts.folder,
    public_id: opts.publicId,
    overwrite: true,
    invalidate: true,
    transformation: opts.transformation,
  });
  if (!result.secure_url) {
    throw new AppError("Could not upload photo", "UPLOAD_FAILED", 502);
  }
  return result.secure_url;
}

export async function uploadRiderPhoto(riderId: string, file: File): Promise<string> {
  return uploadImage(file, {
    folder: "koboride/riders",
    publicId: riderId,
    transformation: [
      { width: 400, height: 400, crop: "fill", gravity: "face" },
      { quality: "auto", fetch_format: "auto" },
    ],
  });
}

export async function uploadRiderIdDocument(riderId: string, file: File): Promise<string> {
  return uploadImage(file, {
    folder: "koboride/rider-ids",
    publicId: riderId,
    transformation: [{ width: 1600, height: 1600, crop: "limit", quality: "auto" }],
  });
}

export async function uploadDeliveryProofPhoto(orderId: string, file: File): Promise<string | null> {
  if (!cloudinaryReady()) return null;
  try {
    return await uploadImage(file, {
      folder: "koboride/delivery-proof",
      publicId: orderId,
      transformation: [{ width: 1200, height: 1200, crop: "limit", quality: "auto" }],
    });
  } catch {
    return null;
  }
}
