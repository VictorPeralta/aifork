export interface AgentDefinition {
  id: string;
  displayName: string;
  cliCommand: string;
  buildArgs: (prompt: string, opts: AgentRunOptions) => string[];
  envOverrides?: Record<string, string>;
}

export interface AgentRunOptions {
  prompt: string;
  worktreePath: string;
  extraFlags: string[];
  interactive: boolean;
}

export interface AgentStatus {
  agentId: string;
  branchName: string;
  worktreePath: string;
  patchFile: string | null;
  exitCode: number | null;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  error?: string;
}
