import { prisma } from "@/lib/prisma";

export const AGENT_PAY_ID = "default";

const DEFAULTS = {
  activationPay: 250_000,
  volumeBonusPer10: 500_000,
  retentionBonus: 1_000_000,
  retentionThreshold: 0.7,
  activityWindowDays: 14,
  baseStipend: 3_000_000,
  transportAllowance: 1_000_000,
};

export type AgentPayRates = typeof DEFAULTS;

export async function getAgentPayConfig(): Promise<AgentPayRates> {
  const row = await prisma.agentPayConfig.upsert({
    where: { id: AGENT_PAY_ID },
    update: {},
    create: { id: AGENT_PAY_ID, ...DEFAULTS },
  });
  return {
    activationPay: row.activationPay,
    volumeBonusPer10: row.volumeBonusPer10,
    retentionBonus: row.retentionBonus,
    retentionThreshold: row.retentionThreshold,
    activityWindowDays: row.activityWindowDays,
    baseStipend: row.baseStipend,
    transportAllowance: row.transportAllowance,
  };
}

export async function updateAgentPayConfig(next: AgentPayRates): Promise<AgentPayRates> {
  const row = await prisma.agentPayConfig.upsert({
    where: { id: AGENT_PAY_ID },
    update: next,
    create: { id: AGENT_PAY_ID, ...next },
  });
  return {
    activationPay: row.activationPay,
    volumeBonusPer10: row.volumeBonusPer10,
    retentionBonus: row.retentionBonus,
    retentionThreshold: row.retentionThreshold,
    activityWindowDays: row.activityWindowDays,
    baseStipend: row.baseStipend,
    transportAllowance: row.transportAllowance,
  };
}
