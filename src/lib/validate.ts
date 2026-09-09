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
