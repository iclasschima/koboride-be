import type { PushRole } from "@prisma/client";
import { api, json, options, AppError } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendPushToUser } from "@/lib/push";

export const OPTIONS = () => options();

const TEST_BODY: Record<PushRole, { body: string; url: string }> = {
  admin: { body: "You will get new orders, shop orders and status changes here.", url: "/admin" },
  merchant: { body: "You will get new orders, pickups and deliveries here.", url: "/merchant" },
  rider: { body: "You will get new jobs here.", url: "/rider" },
  customer: { body: "You will get order updates here.", url: "/" },
};

export const POST = api(async (req) => {
  const user = requireUser(req, ["customer", "rider", "admin", "merchant"]);
  const role = user.role as PushRole;
  const devices = await prisma.pushSubscription.count({ where: { userId: user.sub, role } });
  if (devices === 0) {
    throw new AppError("Turn on notifications on this device first", "NO_PUSH_DEVICE", 409);
  }
  await sendPushToUser(user.sub, role, { title: "KoboRide notifications are on", ...TEST_BODY[role] });
  return json({ ok: true, devices });
});
