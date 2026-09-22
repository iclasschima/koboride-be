import { api, json, options, AppError } from "@/lib/errors";
import { requireRider } from "@/lib/auth";
import { uploadDeliveryProofPhoto } from "@/lib/cloudinary";
import {
  deliveryPinsMatch,
  getOrderOrThrow,
  nextPhase,
  orderCompletedData,
  orderInclude,
  orderNeedsDeliveryPin,
  presentRiderTrip,
} from "@/lib/orders";
import { prisma } from "@/lib/prisma";
import { notifyAdminOrderStatus, notifyOrderDelivered } from "@/lib/push";

export const OPTIONS = () => options();

async function readProof(req: Request): Promise<{
  pin?: string;
  skipReason?: string;
  photo?: File | null;
}> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("multipart/form-data")) {
    const form = await req.formData();
    const photo = form.get("photo");
    const pin = String(form.get("pin") ?? "").trim();
    const skipReason = String(form.get("skipReason") ?? "").trim();
    return {
      pin: pin || undefined,
      skipReason: skipReason || undefined,
      photo: photo instanceof File && photo.size > 0 ? photo : null,
    };
  }
  if (!ct || ct.includes("application/json")) {
    const raw = await req.text();
    if (!raw.trim()) return {};
    try {
      const body = JSON.parse(raw) as { pin?: unknown; skipReason?: unknown };
      return {
        pin: typeof body.pin === "string" ? body.pin.trim() || undefined : undefined,
        skipReason:
          typeof body.skipReason === "string" ? body.skipReason.trim() || undefined : undefined,
      };
    } catch {
      return {};
    }
  }
  return {};
}

export const POST = api(async (req, ctx) => {
  const { rider } = await requireRider(req);
  const id = ctx.params?.id;
  if (!id) throw new AppError("Missing order id", "VALIDATION_ERROR", 400);

  const order = await getOrderOrThrow(id);
  if (order.riderId !== rider.id) {
    throw new AppError("You are not assigned to this order", "FORBIDDEN", 403);
  }
  if (order.status !== "in_progress") {
    throw new AppError("This job is not in progress", "INVALID_STATUS", 409);
  }

  const riderPhase = nextPhase(order.riderPhase);
  const data: {
    riderPhase: typeof riderPhase;
    status?: "completed";
    completedAt?: Date;
    deliveryProof?: string;
    deliveryProofNote?: string | null;
    deliveryProofPhotoUrl?: string | null;
  } = { riderPhase };

  if (
    riderPhase === "delivered" &&
    order.riderPhase !== "delivered" &&
    orderNeedsDeliveryPin(order)
  ) {
    const proof = await readProof(req);
    const pinOk = Boolean(proof.pin && deliveryPinsMatch(order.deliveryPin, proof.pin));
    const reason = proof.skipReason?.trim() ?? "";
    if (pinOk) {
      data.deliveryProof = "pin";
      data.deliveryProofNote = null;
    } else if (reason.length >= 8) {
      data.deliveryProof = "fallback";
      data.deliveryProofNote = reason.slice(0, 300);
      if (proof.photo) {
        data.deliveryProofPhotoUrl = await uploadDeliveryProofPhoto(order.id, proof.photo);
      }
    } else if (proof.pin) {
      throw new AppError("That delivery PIN does not match", "INVALID_DELIVERY_PIN", 409);
    } else {
      throw new AppError(
        "Ask the receiver for the 4-digit PIN, or note why you cannot collect it",
        "DELIVERY_PIN_REQUIRED",
        400,
      );
    }
  }

  if (riderPhase === "delivered" && order.riderPhase !== "delivered") {
    Object.assign(data, orderCompletedData());
  }

  const updated = await prisma.order.update({
    where: { id: order.id },
    data,
    include: orderInclude,
  });
  if (riderPhase === "delivered" && order.riderPhase !== "delivered") {
    await notifyOrderDelivered(updated);
  }
  if (riderPhase !== order.riderPhase) {
    await notifyAdminOrderStatus(updated);
  }
  return json({ trip: presentRiderTrip(updated) });
});
