import { cosmiconfig } from "cosmiconfig";
import { z } from "zod";
import { homedir } from "os";
import { join } from "path";

const AgentConfigSchema = z.object({
  enabled: z.boolean().default(true),
  extraFlags: z.array(z.string()).default([]),
});

const ConfigSchema = z.object({
  agents: z
    .object({
      claude: AgentConfigSchema.default({}),
      codex: AgentConfigSchema.default({}),
      gemini: AgentConfigSchema.default({}),
      kiro: AgentConfigSchema.default({}),
    })
    .default({}),
  keepWorktrees: z.boolean().default(false),
  tmux: z
    .object({
      layout: z
        .enum(["tiled", "even-horizontal", "even-vertical", "main-horizontal", "main-vertical"])
        .default("tiled"),
      sessionPrefix: z.string().default("aifork"),
    })
    .default({}),
  patchOutputDir: z.string().default(".aifork-output"),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type Config = z.infer<typeof ConfigSchema>;

export interface CliOverrides {
  agents?: string[];
  keepWorktrees?: boolean;
  outputDir?: string;
  noTmux?: boolean;
}

export interface ResolvedConfig extends Config {
  enabledAgentIds: string[];
  noTmux: boolean;
}

const DEFAULTS = ConfigSchema.parse({});

async function loadFileConfig(searchFrom: string): Promise<Partial<Config>> {
  const explorer = cosmiconfig("aifork", {
    searchPlaces: [".aifork.json", ".aifork.yaml", ".aifork.yml"],
  });
  const result = await explorer.search(searchFrom);
  if (!result || result.isEmpty) return {};
  return ConfigSchema.partial().parse(result.config);
}

async function loadGlobalConfig(): Promise<Partial<Config>> {
  const explorer = cosmiconfig("aifork", {
    searchPlaces: [".aifork.json", ".aifork.yaml", ".aifork.yml"],
  });
  const result = await explorer.search(homedir());
  if (!result || result.isEmpty) return {};
  return ConfigSchema.partial().parse(result.config);
}

function deepMerge(base: Config, override: Partial<Config>): Config {
  const merged = { ...base };

  if (override.agents) {
    merged.agents = { ...base.agents };
    for (const [key, val] of Object.entries(override.agents) as [
      keyof Config["agents"],
      AgentConfig
    ][]) {
      if (val !== undefined) {
        merged.agents[key] = { ...base.agents[key], ...val };
      }
    }
  }

  if (override.keepWorktrees !== undefined) merged.keepWorktrees = override.keepWorktrees;
  if (override.patchOutputDir !== undefined) merged.patchOutputDir = override.patchOutputDir;

  if (override.tmux) {
    merged.tmux = { ...base.tmux, ...override.tmux };
  }

  return merged;
}

export async function loadConfig(
  repoRoot: string,
  cliOverrides: CliOverrides = {}
): Promise<ResolvedConfig> {
  const globalConfig = await loadGlobalConfig();
  const localConfig = await loadFileConfig(repoRoot);

  let config = deepMerge(DEFAULTS, globalConfig);
  config = deepMerge(config, localConfig);

  // Apply CLI overrides
  if (cliOverrides.keepWorktrees !== undefined) {
    config.keepWorktrees = cliOverrides.keepWorktrees;
  }
  if (cliOverrides.outputDir !== undefined) {
    config.patchOutputDir = cliOverrides.outputDir;
  }

  // Determine enabled agent IDs
  let enabledAgentIds: string[];
  if (cliOverrides.agents && cliOverrides.agents.length > 0) {
    enabledAgentIds = cliOverrides.agents;
  } else {
    enabledAgentIds = (
      Object.entries(config.agents) as [string, AgentConfig][]
    )
      .filter(([, agentCfg]) => agentCfg.enabled)
      .map(([id]) => id);
  }

  return {
    ...config,
    enabledAgentIds,
    noTmux: cliOverrides.noTmux ?? false,
  };
}

export function getAgentExtraFlags(config: Config, agentId: string): string[] {
  const agentCfg = config.agents[agentId as keyof Config["agents"]];
  return agentCfg?.extraFlags ?? [];
}
