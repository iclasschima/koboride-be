import { api, json, options } from "@/lib/errors";
import { requireAgent } from "@/lib/auth";
import { computeAgentEarnings, currentEarningsMonth } from "@/lib/agentEarnings";

export const OPTIONS = () => options();

export const GET = api(async (req) => {
  const { agent } = await requireAgent(req);
  const month = new URL(req.url).searchParams.get("month") ?? currentEarningsMonth();
  return json({ earnings: await computeAgentEarnings(agent.id, month) });
});
