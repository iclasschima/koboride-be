import { prisma } from "@/lib/prisma";

const ONLINE_KEY = "onlinePaymentsEnabled";
const PAYOUTS_KEY = "payoutsEnabled";

async function flag(key: string): Promise<boolean> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row?.value === "true";
}

export async function onlinePaymentsEnabled(): Promise<boolean> {
  return flag(ONLINE_KEY);
}

export async function payoutsEnabled(): Promise<boolean> {
  return flag(PAYOUTS_KEY);
}

export async function setPaymentFlag(key: "onlinePaymentsEnabled" | "payoutsEnabled", enabled: boolean) {
  await prisma.appSetting.upsert({
    where: { key },
    update: { value: enabled ? "true" : "false" },
    create: { key, value: enabled ? "true" : "false" },
  });
}

export async function paymentFlags(): Promise<{ onlinePaymentsEnabled: boolean; payoutsEnabled: boolean }> {
  return {
    onlinePaymentsEnabled: await onlinePaymentsEnabled(),
    payoutsEnabled: await payoutsEnabled(),
  };
}
