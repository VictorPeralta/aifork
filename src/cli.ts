import { Command } from "commander";
import { readFile } from "fs/promises";
import { execa } from "execa";
import ora from "ora";
import chalk from "chalk";
import { loadConfig, getAgentExtraFlags } from "./config.js";
import { resolveAvailableAgents } from "./agents/registry.js";
import { setupAll, cleanupAll } from "./worktree.js";
import { createSession, attachSession } from "./tmux.js";
import { prepareExitDir, waitForAll, runAllDirect } from "./runner.js";
import { generateAll, printSummary } from "./patcher.js";
import type { AgentStatus } from "./agents/types.js";
import type { AgentCommand } from "./tmux.js";

async function getRepoRoot(): Promise<string> {
  try {
    const result = await execa("git", ["rev-parse", "--show-toplevel"]);
    return result.stdout.trim();
  } catch {
    console.error(chalk.red("Error: Not inside a git repository."));
    process.exit(1);
  }
}

async function getCurrentBranch(repoRoot: string): Promise<string> {
  const result = await execa("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: repoRoot,
  });
  return result.stdout.trim();
}

async function resolvePrompt(
  promptArg: string | undefined,
  promptFile: string | undefined,
  required: boolean
): Promise<string> {
  if (promptFile) {
    const content = await readFile(promptFile, "utf8");
    return content.trim();
  }
  if (promptArg) return promptArg;
  if (required) {
    console.error(chalk.red("Error: Provide a prompt via argument or --prompt-file when using --print."));
    process.exit(1);
  }
  return "";
}

async function run(promptArg: string | undefined, options: {
  agents?: string;
  promptFile?: string;
  keepWorktrees: boolean;
  noTmux: boolean;
  outputDir?: string;
  print: boolean;
}): Promise<void> {
  const interactive = !options.print;

  if (interactive && options.noTmux) {
    console.error(chalk.red("Error: --no-tmux requires --print (-p) since agents need a terminal to be interactive."));
    process.exit(1);
  }

  const prompt = await resolvePrompt(promptArg, options.promptFile, !interactive);
  const repoRoot = await getRepoRoot();
  const baseBranch = await getCurrentBranch(repoRoot);

  const agentIds = options.agents ? options.agents.split(",").map((s) => s.trim()) : undefined;

  const config = await loadConfig(repoRoot, {
    agents: agentIds,
    keepWorktrees: options.keepWorktrees,
    outputDir: options.outputDir,
    noTmux: options.noTmux,
  });

  // Resolve which agents are installed
  const spinner = ora("Checking agent availability...").start();
  const availabilities = await resolveAvailableAgents(config.enabledAgentIds);
  spinner.stop();

  const available = availabilities.filter((a) => a.available);
  const skipped = availabilities.filter((a) => !a.available);

  if (skipped.length > 0) {
    console.log(
      chalk.yellow(`Skipping agents (not installed): ${skipped.map((a) => a.agent.id).join(", ")}`)
    );
  }

  if (available.length === 0) {
    console.error(chalk.red("No agents available. Install at least one AI CLI tool."));
    process.exit(1);
  }

  console.log(
    chalk.bold(`Running prompt with: ${available.map((a) => a.agent.displayName).join(", ")}`)
  );

  const timestamp = Date.now().toString();

  // Setup worktrees
  const setupSpinner = ora("Creating git worktrees...").start();
  let statuses: AgentStatus[];
  try {
    statuses = await setupAll(
      available.map((a) => a.agent),
      repoRoot,
      timestamp
    );
    setupSpinner.succeed("Worktrees created");
  } catch (err) {
    setupSpinner.fail("Failed to create worktrees");
    console.error(chalk.red((err as Error).message));
    process.exit(1);
  }

  // Add skipped agents to statuses
  for (const { agent } of skipped) {
    statuses.push({
      agentId: agent.id,
      branchName: `aifork/${agent.id}`,
      worktreePath: "",
      patchFile: null,
      exitCode: null,
      status: "skipped",
    });
  }

  const exitDir = await prepareExitDir(timestamp);
  const outputDir = config.patchOutputDir;
  const sessionName = `${config.tmux.sessionPrefix}-${timestamp}`;

  // Cleanup worktrees on Ctrl+C
  const activeStatuses = statuses.filter((s) => s.status !== "skipped" && s.worktreePath);
  process.once("SIGINT", async () => {
    console.log(chalk.yellow("\nInterrupted — cleaning up worktrees..."));
    if (!config.keepWorktrees) {
      await cleanupAll(activeStatuses, repoRoot);
    }
    process.exit(130);
  });

  // Build agent commands
  const agentCommands: AgentCommand[] = available.map(({ agent }) => {
    const status = statuses.find((s) => s.agentId === agent.id)!;
    const extraFlags = getAgentExtraFlags(config, agent.id);
    const args = agent.buildArgs(prompt, {
      prompt,
      worktreePath: status.worktreePath,
      extraFlags,
      interactive,
    });
    return { status, agent, command: agent.cliCommand, args };
  });

  if (config.noTmux) {
    // No-tmux mode: run directly
    console.log(chalk.dim("Running agents in background (no-tmux mode)..."));
    await runAllDirect(
      agentCommands.map((ac) => ({
        agent: ac.agent,
        status: ac.status,
        command: ac.command,
        args: ac.args,
        exitDir,
        onUpdate: (s: AgentStatus) => {
          const icon = s.status === "done" ? "✓" : s.status === "failed" ? "✗" : "…";
          console.log(`  ${icon} ${s.agentId}: ${s.status}`);
        },
      }))
    );
  } else {
    // Tmux mode
    const tmuxSpinner = ora("Creating tmux session...").start();
    try {
      await createSession(sessionName, agentCommands, {
        sessionPrefix: config.tmux.sessionPrefix,
        layout: config.tmux.layout,
        exitDir,
        prepopulatePrompt: interactive && prompt ? prompt : undefined,
      });
      tmuxSpinner.succeed(`Tmux session created: ${sessionName}`);
    } catch (err) {
      tmuxSpinner.fail("Failed to create tmux session");
      await cleanupAll(statuses.filter((s) => s.status !== "skipped"), repoRoot);
      console.error(chalk.red((err as Error).message));
      process.exit(1);
    }

    console.log(chalk.dim("Attaching to tmux session... (detach with Ctrl+b d)"));
    await attachSession(sessionName);

    // Wait for all agents to finish
    const waitSpinner = ora("Waiting for agents to complete...").start();
    await waitForAll(
      statuses.filter((s) => s.status !== "skipped"),
      exitDir,
      (s) => {
        if (s.status === "done" || s.status === "failed") {
          waitSpinner.text = `${s.agentId}: ${s.status}`;
        }
      }
    );
    waitSpinner.succeed("All agents completed");
  }

  // Generate patches
  const patchSpinner = ora("Generating patch files...").start();
  await generateAll(
    statuses.filter((s) => s.status === "done"),
    repoRoot,
    baseBranch,
    outputDir,
    timestamp
  );
  patchSpinner.succeed("Patches generated");

  // Print summary
  printSummary(statuses);

  // Cleanup
  if (!config.keepWorktrees) {
    const cleanupSpinner = ora("Cleaning up worktrees...").start();
    await cleanupAll(
      statuses.filter((s) => s.status !== "skipped" && s.worktreePath),
      repoRoot
    );
    cleanupSpinner.succeed("Worktrees removed");
  } else {
    console.log(chalk.dim("Worktrees kept (--keep-worktrees)."));
  }
}

const program = new Command();

program
  .name("aifork")
  .description("Fan out a prompt to multiple AI agent CLIs in parallel git worktrees")
  .version("0.1.0")
  .argument("[prompt]", "The prompt to send to all agents")
  .option("--agents <ids>", "Comma-separated list of agent IDs to run (e.g. claude,codex)")
  .option("--prompt-file <file>", "Load prompt from a file")
  .option("-p, --print", "Run agents non-interactively (pass prompt directly); requires a prompt argument or --prompt-file", false)
  .option("--keep-worktrees", "Keep worktrees and branches after completion", false)
  .option("--no-tmux", "Run agents as background processes instead of tmux panes")
  .option("--output-dir <dir>", "Directory for patch output files")
  .action(async (prompt: string | undefined, options) => {
    await run(prompt, {
      agents: options.agents,
      promptFile: options.promptFile,
      keepWorktrees: options.keepWorktrees,
      noTmux: options.noTmux,
      outputDir: options.outputDir,
      print: options.print,
    });
  });

program.parse();
