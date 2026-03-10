import { execa } from "execa";
import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import chalk from "chalk";
import type { AgentStatus } from "./agents/types.js";

export async function generatePatch(
  status: AgentStatus,
  repoRoot: string,
  baseBranch: string,
  outputDir: string,
  runId: string
): Promise<string | null> {
  if (status.status !== "done") return null;

  await mkdir(outputDir, { recursive: true });

  try {
    // Stage and commit any uncommitted changes (including new/untracked files)
    // so that the branch diff captures everything the agent produced.
    await execa("git", ["add", "-A"], { cwd: status.worktreePath });
    try {
      await execa(
        "git",
        ["commit", "-m", "aifork: capture uncommitted changes"],
        { cwd: status.worktreePath }
      );
    } catch {
      // Nothing to commit — already clean
    }

    const result = await execa(
      "git",
      ["diff", `${baseBranch}..${status.branchName}`],
      { cwd: repoRoot, stripFinalNewline: false }
    );

    const patchContent = result.stdout;
    if (!patchContent.trim()) {
      return null; // No changes
    }

    const patchFile = join(outputDir, `aifork-${runId}-${status.agentId}.patch`);
    await writeFile(patchFile, patchContent, "utf8");
    return patchFile;
  } catch (err) {
    console.error(
      `Failed to generate patch for ${status.agentId}: ${(err as Error).message}`
    );
    return null;
  }
}

export async function generateAll(
  statuses: AgentStatus[],
  repoRoot: string,
  baseBranch: string,
  outputDir: string,
  runId: string
): Promise<void> {
  await Promise.all(
    statuses.map(async (status) => {
      const patchFile = await generatePatch(status, repoRoot, baseBranch, outputDir, runId);
      status.patchFile = patchFile;
    })
  );
}

export function printSummary(statuses: AgentStatus[]): void {
  console.log("\n" + chalk.bold("aifork Summary"));
  console.log("===================");

  const colWidths = { agent: 10, status: 10, patch: 50 };
  const header =
    chalk.bold("Agent".padEnd(colWidths.agent)) +
    " " +
    chalk.bold("Status".padEnd(colWidths.status)) +
    " " +
    chalk.bold("Patch File");
  console.log(header);
  console.log("-".repeat(colWidths.agent + colWidths.status + colWidths.patch + 2));

  for (const status of statuses) {
    const agentCol = status.agentId.padEnd(colWidths.agent);
    const statusStr = formatStatus(status);
    const patchCol = formatPatchCol(status);
    console.log(`${agentCol} ${statusStr} ${patchCol}`);
  }

  console.log();

  // Print apply/merge commands for successful patches
  const done = statuses.filter((s) => s.status === "done" && s.patchFile);
  if (done.length > 0) {
    for (const status of done) {
      console.log(`To apply ${chalk.cyan(status.agentId)}'s changes:`);
      console.log(chalk.dim(`  git apply ${status.patchFile}`));
      console.log();
      console.log(`To merge ${chalk.cyan(status.agentId)}'s branch directly:`);
      console.log(chalk.dim(`  git merge ${status.branchName}`));
      console.log();
    }
  }
}

function formatStatus(status: AgentStatus): string {
  const s = status.status;
  const padded = s.padEnd(10);
  switch (s) {
    case "done":
      return chalk.green(padded);
    case "failed":
      return chalk.red(padded);
    case "skipped":
      return chalk.yellow(padded);
    case "running":
      return chalk.blue(padded);
    default:
      return chalk.dim(padded);
  }
}

function formatPatchCol(status: AgentStatus): string {
  if (status.patchFile) return status.patchFile;
  if (status.status === "failed") {
    return chalk.dim(`(exit code ${status.exitCode ?? "?"})`);
  }
  if (status.status === "skipped") return chalk.dim("(not installed)");
  if (status.status === "done") return chalk.dim("(no changes)");
  return chalk.dim("(pending)");
}
