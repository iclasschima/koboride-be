import { z } from "zod";
import { prisma } from "@/lib/prisma";

const GOALS_KEY = "metricGoals";

/** Weekly targets compound from the start week's actual numbers: baseline × (1 + rate)^weeks since. */
export const metricGoalsSchema = z.object({
  weeklyGrowthPct: z.number().min(0.1, "Use at least 0.1%").max(100, "Use 100% or less"),
  startWeek: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date")
    .refine((day) => new Date(`${day}T00:00:00Z`).getUTCDay() === 1, "The start week must begin on a Monday"),
  baseline: z.object({
    orders: z.number().int().min(0),
    gmvNgn: z.number().int().min(0),
    revenueNgn: z.number().int(),
    activeCustomers: z.number().int().min(0),
  }),
});

export type MetricGoals = z.infer<typeof metricGoalsSchema>;

export async function metricGoals(): Promise<MetricGoals | null> {
  const row = await prisma.appSetting.findUnique({ where: { key: GOALS_KEY } });
  if (!row) return null;
  const parsed = metricGoalsSchema.safeParse(JSON.parse(row.value));
  return parsed.success ? parsed.data : null;
}

export async function saveMetricGoals(goals: MetricGoals): Promise<void> {
  const value = JSON.stringify(goals);
  await prisma.appSetting.upsert({ where: { key: GOALS_KEY }, update: { value }, create: { key: GOALS_KEY, value } });
}

export async function clearMetricGoals(): Promise<void> {
  await prisma.appSetting.deleteMany({ where: { key: GOALS_KEY } });
}
