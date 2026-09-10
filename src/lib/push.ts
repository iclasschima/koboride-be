import webpush from "web-push";
import type { PushRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";

export type PushPayload = {
  title: string;
  body: string;
  url: string;
};

export type PushSubscriptionInput = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

let vapidReady = false;

function ensureVapid(): boolean {
  if (vapidReady) return true;
  if (!config.vapidPublicKey || !config.vapidPrivateKey) {
    console.warn("[push] VAPID keys are not set; skipping send");
    return false;
  }
  webpush.setVapidDetails(config.vapidSubject, config.vapidPublicKey, config.vapidPrivateKey);
  vapidReady = true;
  return true;
}

function pushKeys(keys: unknown): PushSubscriptionInput["keys"] | null {
  if (!keys || typeof keys !== "object" || Array.isArray(keys)) return null;
  const rec = keys as Record<string, unknown>;
  if (typeof rec.p256dh !== "string" || typeof rec.auth !== "string") return null;
  return { p256dh: rec.p256dh, auth: rec.auth };
}

function isGone(err: unknown): boolean {
  const status = (err as { statusCode?: number } | null)?.statusCode;
  return status === 404 || status === 410;
}

export async function sendPushNotification(
  subscription: PushSubscriptionInput,
  payload: PushPayload,
): Promise<void> {
  if (!ensureVapid()) return;
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload));
  } catch (err) {
    if (isGone(err)) {
      await prisma.pushSubscription.deleteMany({ where: { endpoint: subscription.endpoint } });
      return;
    }
    console.error("[push] send failed", err);
  }
}

async function sendToRecords(
  rows: Array<{ endpoint: string; keys: unknown }>,
  payload: PushPayload,
): Promise<void> {
  await Promise.all(
    rows.map(async (row) => {
      const keys = pushKeys(row.keys);
      if (!keys) return;
      await sendPushNotification({ endpoint: row.endpoint, keys }, payload);
    }),
  );
}

async function runPush(task: () => Promise<void>): Promise<void> {
  try {
    await task();
  } catch (err) {
    console.error("[push]", err);
  }
}

export async function sendPushToUser(
  userId: string,
  role: PushRole,
  payload: PushPayload,
): Promise<void> {
  await runPush(async () => {
    const rows = await prisma.pushSubscription.findMany({ where: { userId, role } });
    if (rows.length === 0) return;
    await sendToRecords(rows, payload);
  });
}

async function availableRiderIds(): Promise<string[]> {
  const riders = await prisma.rider.findMany({
    where: { approved: true, availability: "ONLINE" },
    select: { id: true },
  });
  if (riders.length === 0) return [];

  const live = await prisma.order.findMany({
    where: { status: "in_progress", riderId: { not: null } },
    select: { riderId: true },
  });
  const busy = new Set(live.map((row) => row.riderId));
  return riders.filter((rider) => !busy.has(rider.id)).map((rider) => rider.id);
}

export async function notifySearchingRider(order: {
  id: string;
  pickup: string;
  dropoff: string;
}): Promise<void> {
  await runPush(async () => {
    const riderIds = await availableRiderIds();
    if (riderIds.length === 0) return;
    const rows = await prisma.pushSubscription.findMany({
      where: { role: "rider", userId: { in: riderIds } },
    });
    if (rows.length === 0) return;
    await sendToRecords(rows, {
      title: "New order waiting",
      body: `${order.pickup} → ${order.dropoff}`,
      url: "/rider",
    });
  });
}

export async function notifyOrderAccepted(order: {
  id: string;
  customerId: string;
  pickup: string;
}): Promise<void> {
  await sendPushToUser(order.customerId, "customer", {
    title: "A rider has accepted your order",
    body: `Heading to ${order.pickup}`,
    url: `/trips/${order.id}`,
  });
}

export async function notifyOrderDelivered(order: {
  id: string;
  customerId: string;
}): Promise<void> {
  await sendPushToUser(order.customerId, "customer", {
    title: "Your order was delivered",
    body: "Confirm you received it",
    url: `/trips/${order.id}`,
  });
}
