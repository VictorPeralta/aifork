import { readFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { execa } from "execa";
import { join } from "path";
import type { AgentStatus } from "./agents/types.js";
import type { AgentDefinition } from "./agents/types.js";

const POLL_INTERVAL_MS = 2000;

export async function prepareExitDir(sessionId: string): Promise<string> {
  const dir = `/tmp/dp-${sessionId}`;
  await mkdir(dir, { recursive: true });
  return dir;
}

async function readExitCode(exitFile: string): Promise<number | null> {
  if (!existsSync(exitFile)) return null;
  try {
    const content = await readFile(exitFile, "utf8");
    const code = parseInt(content.trim(), 10);
    return isNaN(code) ? null : code;
  } catch {
    return null;
  }
}

export async function waitForAll(
  statuses: AgentStatus[],
  exitDir: string,
  onUpdate?: (status: AgentStatus) => void
): Promise<void> {
  const pending = new Set(statuses.map((s) => s.agentId));

  // Mark all as running
  for (const status of statuses) {
    status.status = "running";
    onUpdate?.(status);
  }

  while (pending.size > 0) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

    for (const agentId of [...pending]) {
      const status = statuses.find((s) => s.agentId === agentId)!;
      const exitFile = join(exitDir, `${agentId}.exitcode`);
      const exitCode = await readExitCode(exitFile);

      if (exitCode !== null) {
        status.exitCode = exitCode;
        status.status = exitCode === 0 ? "done" : "failed";
        pending.delete(agentId);
        onUpdate?.(status);
      }
    }
  }
}

export interface NoTmuxRunOptions {
  agent: AgentDefinition;
  status: AgentStatus;
  command: string;
  args: string[];
  exitDir: string;
  onUpdate?: (status: AgentStatus) => void;
}

export async function runAgentDirect(opts: NoTmuxRunOptions): Promise<void> {
  const { agent, status, command, args, exitDir, onUpdate } = opts;
  const exitFile = join(exitDir, `${agent.id}.exitcode`);

  status.status = "running";
  onUpdate?.(status);

  try {
    const result = await execa(command, args, {
      cwd: status.worktreePath,
      reject: false,
      all: true,
    });

    const exitCode = result.exitCode ?? 1;
    await import("fs/promises").then((fs) =>
      fs.writeFile(exitFile, String(exitCode), "utf8")
    );

    status.exitCode = exitCode;
    status.status = exitCode === 0 ? "done" : "failed";
  } catch (err) {
    status.exitCode = 1;
    status.status = "failed";
    status.error = (err as Error).message;

    await import("fs/promises").then((fs) =>
      fs.writeFile(exitFile, "1", "utf8")
    );
  }

  onUpdate?.(status);
}

export async function runAllDirect(
  runs: NoTmuxRunOptions[]
): Promise<void> {
  await Promise.all(runs.map((r) => runAgentDirect(r)));
}
