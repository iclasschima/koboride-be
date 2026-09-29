import { z } from "zod";
import { api, json, options } from "@/lib/errors";
import { requireUser } from "@/lib/auth";
import { getAgentPayConfig, updateAgentPayConfig } from "@/lib/agentPay";
import { parseBody, readJson } from "@/lib/validate";

export const OPTIONS = () => options();

const kobo = z.number().int().min(0).max(50_000_000);

const patchSchema = z.object({
  activationPay: kobo,
  volumeBonusPer10: kobo,
  retentionBonus: kobo,
  retentionThreshold: z.number().gt(0).lte(1),
  activityWindowDays: z.number().int().min(1).max(90),
  baseStipend: kobo,
  transportAllowance: kobo,
});

export const GET = api(async (req) => {
  requireUser(req, ["admin"]);
  return json({ config: await getAgentPayConfig() });
});

export const PATCH = api(async (req) => {
  requireUser(req, ["admin"]);
  const body = parseBody(patchSchema, await readJson(req));
  return json({ config: await updateAgentPayConfig(body) });
});
