import { execa } from "execa";
import { join, basename } from "path";
import type { AgentDefinition } from "./agents/types.js";
import type { AgentStatus } from "./agents/types.js";

export function worktreePath(repoRoot: string, agentId: string, timestamp: string): string {
  const repoName = basename(repoRoot);
  return join(repoRoot, "..", `${repoName}-dp-${agentId}-${timestamp}`);
}

export function branchName(agentId: string): string {
  return `aifork/${agentId}`;
}

async function pruneExistingBranch(repoRoot: string, branch: string): Promise<void> {
  // If the branch already exists, find and remove its worktree first, then delete the branch
  let worktreeList: string;
  try {
    const result = await execa("git", ["worktree", "list", "--porcelain"], { cwd: repoRoot });
    worktreeList = result.stdout;
  } catch {
    return;
  }

  // Parse porcelain output: blocks separated by blank lines, each has "worktree <path>" and optionally "branch refs/heads/<name>"
  const blocks = worktreeList.split(/\n\n/).filter(Boolean);
  for (const block of blocks) {
    const pathMatch = block.match(/^worktree (.+)$/m);
    const branchMatch = block.match(/^branch refs\/heads\/(.+)$/m);
    if (pathMatch && branchMatch && branchMatch[1] === branch) {
      try {
        await execa("git", ["worktree", "remove", "--force", pathMatch[1]], { cwd: repoRoot });
      } catch {
        // ignore
      }
      break;
    }
  }

  try {
    await execa("git", ["branch", "-D", branch], { cwd: repoRoot });
  } catch {
    // Branch didn't exist — fine
  }
}

export async function createWorktree(
  repoRoot: string,
  agentId: string,
  timestamp: string
): Promise<string> {
  const path = worktreePath(repoRoot, agentId, timestamp);
  const branch = branchName(agentId);

  await pruneExistingBranch(repoRoot, branch);

  await execa("git", ["worktree", "add", "-b", branch, path, "HEAD"], {
    cwd: repoRoot,
  });

  return path;
}

export async function setupAll(
  agents: AgentDefinition[],
  repoRoot: string,
  timestamp: string
): Promise<AgentStatus[]> {
  const statuses: AgentStatus[] = [];
  const created: string[] = [];

  for (const agent of agents) {
    try {
      const path = await createWorktree(repoRoot, agent.id, timestamp);
      created.push(agent.id);
      statuses.push({
        agentId: agent.id,
        branchName: branchName(agent.id),
        worktreePath: path,
        patchFile: null,
        exitCode: null,
        status: "pending",
      });
    } catch (err) {
      // Rollback already-created worktrees before re-throwing
      await cleanupAll(
        statuses.filter((s) => created.includes(s.agentId)),
        repoRoot
      );
      throw new Error(
        `Failed to create worktree for agent "${agent.id}": ${(err as Error).message}`
      );
    }
  }

  return statuses;
}

export async function removeWorktree(
  repoRoot: string,
  worktreePath: string,
  branch: string
): Promise<void> {
  try {
    await execa("git", ["worktree", "remove", "--force", worktreePath], {
      cwd: repoRoot,
    });
  } catch {
    // Ignore errors — worktree may already be gone
  }

  try {
    await execa("git", ["branch", "-D", branch], { cwd: repoRoot });
  } catch {
    // Ignore errors — branch may already be gone
  }
}

export async function cleanupAll(
  statuses: AgentStatus[],
  repoRoot: string
): Promise<void> {
  await Promise.all(
    statuses.map((s) => removeWorktree(repoRoot, s.worktreePath, s.branchName))
  );
}
