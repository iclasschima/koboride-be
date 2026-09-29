import { api, json, options, AppError } from "@/lib/errors";
import { requireAgent } from "@/lib/auth";
import { uploadAgentPhoto } from "@/lib/cloudinary";

export const OPTIONS = () => options();

export const POST = api(async (req) => {
  const { agent } = await requireAgent(req);
  const form = await req.formData();
  const file = form.get("photo");
  const kind = String(form.get("kind") ?? "photo");
  if (!(file instanceof File) || file.size === 0) {
    throw new AppError("Add a photo", "VALIDATION_ERROR", 400);
  }
  if (kind !== "bike" && kind !== "selfie") {
    throw new AppError("Photo kind must be bike or selfie", "VALIDATION_ERROR", 400);
  }
  const url = await uploadAgentPhoto(agent.id, kind, file);
  return json({ url });
});
