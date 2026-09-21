import { z } from "zod";
import { AppError } from "@/lib/errors";

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new AppError("Request body must be JSON", "INVALID_JSON", 400);
  }
}

export function parseBody<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path?.length ? `${first.path.join(".")}: ` : "";
    throw new AppError(
      `${path}${first?.message ?? "Invalid input"}`,
      "VALIDATION_ERROR",
      400,
    );
  }
  return result.data;
}

export const customerBookingSchema = z.object({
  pickup: z.string().min(2),
  dropoff: z.string().min(2),
  notes: z.string().min(1).max(500),
  pickupLat: z.number().finite(),
  pickupLng: z.number().finite(),
  dropoffLat: z.number().finite(),
  dropoffLng: z.number().finite(),
  customerRole: z.enum(["sender", "receiver"]).optional(),
  farePayer: z.enum(["sender", "receiver"]).optional(),
  senderName: z.string().min(2).max(80).optional(),
  senderPhone: z.string().min(7).max(20).optional(),
  receiverName: z.string().min(2).max(80).optional(),
  receiverPhone: z.string().min(7).max(20).optional(),
});
