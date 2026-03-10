import { execa } from "execa";
import type { AgentStatus } from "./agents/types.js";
import type { AgentDefinition } from "./agents/types.js";
import type { AgentRunOptions } from "./agents/types.js";

export type TmuxLayout =
  | "tiled"
  | "even-horizontal"
  | "even-vertical"
  | "main-horizontal"
  | "main-vertical";

function chooseLayout(agentCount: number): TmuxLayout {
  if (agentCount <= 1) return "tiled";
  if (agentCount === 2) return "even-horizontal";
  return "tiled";
}

export interface TmuxOptions {
  sessionPrefix: string;
  layout?: TmuxLayout;
  exitDir: string;
  prepopulatePrompt?: string;
}

export interface AgentCommand {
  status: AgentStatus;
  agent: AgentDefinition;
  command: string;
  args: string[];
}

function buildPaneCommand(
  agentCmd: AgentCommand,
  exitDir: string
): string {
  const { command, args, status } = agentCmd;
  const escapedArgs = args.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
  const exitFile = `${exitDir}/${status.agentId}.exitcode`;
  return `cd '${status.worktreePath}' && ${command} ${escapedArgs}; echo $? > '${exitFile}'`;
}

export async function createSession(
  sessionName: string,
  agentCommands: AgentCommand[],
  opts: TmuxOptions
): Promise<void> {
  if (agentCommands.length === 0) {
    throw new Error("No agents to run");
  }

  const layout = opts.layout ?? chooseLayout(agentCommands.length);

  if (agentCommands.length >= 5) {
    console.warn(
      `Warning: Running ${agentCommands.length} agents. Panes may be very small.`
    );
  }

  const firstCmd = buildPaneCommand(agentCommands[0], opts.exitDir);

  // Create the session with the first pane
  await execa("tmux", [
    "new-session",
    "-d",
    "-s",
    sessionName,
    "-x",
    "220",
    "-y",
    "50",
  ]);

  // Send the first command
  await execa("tmux", ["send-keys", "-t", `${sessionName}:0.0`, firstCmd, "Enter"]);

  // Create additional panes for remaining agents
  for (let i = 1; i < agentCommands.length; i++) {
    const cmd = buildPaneCommand(agentCommands[i], opts.exitDir);
    await execa("tmux", ["split-window", "-t", `${sessionName}:0`, "-h"]);
    await execa("tmux", [
      "send-keys",
      "-t",
      `${sessionName}:0.${i}`,
      cmd,
      "Enter",
    ]);
  }

  // Apply layout
  await execa("tmux", ["select-layout", "-t", `${sessionName}:0`, layout]);

  // Prepopulate each pane with the prompt (typed but not submitted)
  if (opts.prepopulatePrompt) {
    const prompt = opts.prepopulatePrompt;
    await new Promise((resolve) => setTimeout(resolve, 1500));
    for (let i = 0; i < agentCommands.length; i++) {
      await execa("tmux", ["send-keys", "-l", "-t", `${sessionName}:0.${i}`, prompt]);
    }
  }
}

export async function attachSession(sessionName: string): Promise<void> {
  const inTmux = !!process.env["TMUX"];

  if (inTmux) {
    await execa("tmux", ["switch-client", "-t", sessionName], {
      stdio: "inherit",
    });
  } else {
    await execa("tmux", ["attach-session", "-t", sessionName], {
      stdio: "inherit",
    });
  }
}

export async function sessionExists(sessionName: string): Promise<boolean> {
  try {
    await execa("tmux", ["has-session", "-t", sessionName]);
    return true;
  } catch {
    return false;
  }
}

export async function killSession(sessionName: string): Promise<void> {
  try {
    await execa("tmux", ["kill-session", "-t", sessionName]);
  } catch {
    // Session may already be gone
  }
}
