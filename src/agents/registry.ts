import which from "which";
import type { AgentDefinition } from "./types.js";
import claude from "./claude.js";
import codex from "./codex.js";
import gemini from "./gemini.js";
import kiro from "./kiro.js";

export const ALL_AGENTS: AgentDefinition[] = [claude, codex, gemini, kiro];

export interface AgentAvailability {
  agent: AgentDefinition;
  available: boolean;
  path?: string;
}

export async function resolveAvailableAgents(
  enabledIds?: string[]
): Promise<AgentAvailability[]> {
  const candidates = enabledIds
    ? ALL_AGENTS.filter((a) => enabledIds.includes(a.id))
    : ALL_AGENTS;

  const results = await Promise.all(
    candidates.map(async (agent) => {
      try {
        const path = await which(agent.cliCommand);
        return { agent, available: true, path };
      } catch {
        return { agent, available: false };
      }
    })
  );

  return results;
}
