import { api, json, options } from "@/lib/errors";
import { requireSuperAdmin } from "@/lib/adminAuth";
import { parseBody, readJson } from "@/lib/validate";
import { clearMetricGoals, metricGoals, metricGoalsSchema, saveMetricGoals } from "@/lib/metricGoals";

export const OPTIONS = () => options();

export const PUT = api(async (req) => {
  await requireSuperAdmin(req);
  await saveMetricGoals(parseBody(metricGoalsSchema, await readJson(req)));
  return json({ goals: await metricGoals() });
});

export const DELETE = api(async (req) => {
  await requireSuperAdmin(req);
  await clearMetricGoals();
  return json({ goals: null });
});
