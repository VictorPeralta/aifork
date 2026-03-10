/**
 * E2E smoke tests for aifork.
 *
 * These tests run in a real temporary git repo and exercise the full pipeline:
 * worktree creation, agent execution (--no-tmux), patch generation, cleanup.
 *
 * Requirements: git on PATH. Agent binaries (claude, codex, etc.) are NOT
 * required — agents are skipped gracefully when not installed.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir, writeFile, readFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { execa } from "execa";
import { existsSync } from "fs";

async function initGitRepo(dir: string): Promise<void> {
  await execa("git", ["init"], { cwd: dir });
  await execa("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  await execa("git", ["config", "user.name", "Test User"], { cwd: dir });
  // Initial commit so HEAD exists
  await writeFile(join(dir, "README.md"), "# Test repo\n");
  await execa("git", ["add", "."], { cwd: dir });
  await execa("git", ["commit", "-m", "initial"], { cwd: dir });
}

async function getCurrentBranch(dir: string): Promise<string> {
  const result = await execa("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: dir });
  return result.stdout.trim();
}

async function getWorktrees(dir: string): Promise<string[]> {
  const result = await execa("git", ["worktree", "list", "--porcelain"], { cwd: dir });
  return result.stdout
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.replace("worktree ", "").trim());
}

async function getBranches(dir: string): Promise<string[]> {
  const result = await execa("git", ["branch"], { cwd: dir });
  return result.stdout
    .split("\n")
    .map((l) => l.replace(/^[*+]\s*/, "").trim())
    .filter(Boolean);
}

describe("E2E: worktree creation and cleanup", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "dp-e2e-"));
    await initGitRepo(repoDir);
  });

  afterEach(async () => {
    // Clean up any lingering worktrees
    const worktrees = await getWorktrees(repoDir);
    for (const wt of worktrees.slice(1)) {
      await execa("git", ["worktree", "remove", "--force", wt], { cwd: repoDir }).catch(() => {});
    }
    await rm(repoDir, { recursive: true, force: true });
  });

  it("creates and removes a worktree for one agent", async () => {
    const { setupAll, cleanupAll } = await import("../worktree.js");
    const { ALL_AGENTS } = await import("../agents/registry.js");

    const claudeAgent = ALL_AGENTS.find((a) => a.id === "claude")!;
    const ts = "test123";

    const statuses = await setupAll([claudeAgent], repoDir, ts);

    expect(statuses).toHaveLength(1);
    expect(statuses[0].agentId).toBe("claude");
    expect(statuses[0].status).toBe("pending");
    expect(existsSync(statuses[0].worktreePath)).toBe(true);

    const worktrees = await getWorktrees(repoDir);
    expect(worktrees).toHaveLength(2); // main + new worktree

    const branches = await getBranches(repoDir);
    expect(branches).toContain("aifork/claude");

    await cleanupAll(statuses, repoDir);

    const worktreesAfter = await getWorktrees(repoDir);
    expect(worktreesAfter).toHaveLength(1); // only main

    const branchesAfter = await getBranches(repoDir);
    expect(branchesAfter).not.toContain("aifork/claude");
  });

  it("keeps worktrees with --keep-worktrees behaviour", async () => {
    const { setupAll } = await import("../worktree.js");
    const { ALL_AGENTS } = await import("../agents/registry.js");

    const agent = ALL_AGENTS.find((a) => a.id === "codex")!;
    const statuses = await setupAll([agent], repoDir, "keep999");

    expect(existsSync(statuses[0].worktreePath)).toBe(true);

    // Simulate --keep-worktrees: do NOT call cleanupAll
    const worktrees = await getWorktrees(repoDir);
    expect(worktrees).toHaveLength(2);

    // Manual cleanup for afterEach
    await import("../worktree.js").then((m) => m.cleanupAll(statuses, repoDir));
  });
});

describe("E2E: no-tmux mode with a real command", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "dp-notmux-"));
    await initGitRepo(repoDir);
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  it("runs a command in a worktree and produces an exitcode file", async () => {
    const { setupAll, cleanupAll } = await import("../worktree.js");
    const { prepareExitDir, runAgentDirect } = await import("../runner.js");
    const { ALL_AGENTS } = await import("../agents/registry.js");

    // Use a custom agent-like struct with a real command (echo)
    const fakeAgent = {
      ...ALL_AGENTS[0],
      id: "fake",
      cliCommand: "echo",
      buildArgs: () => ["hello from aifork"],
    };

    const ts = "notmux001";
    const statuses = await setupAll([fakeAgent as typeof ALL_AGENTS[0]], repoDir, ts);
    const exitDir = await prepareExitDir(ts);

    await runAgentDirect({
      agent: fakeAgent as typeof ALL_AGENTS[0],
      status: statuses[0],
      command: "echo",
      args: ["hello from aifork"],
      exitDir,
    });

    expect(statuses[0].status).toBe("done");
    expect(statuses[0].exitCode).toBe(0);

    const exitFile = join(exitDir, "fake.exitcode");
    expect(existsSync(exitFile)).toBe(true);
    const content = await readFile(exitFile, "utf8");
    expect(content.trim()).toBe("0");

    await cleanupAll(statuses, repoDir);
  });

  it("marks agent as failed when command exits non-zero", async () => {
    const { setupAll, cleanupAll } = await import("../worktree.js");
    const { prepareExitDir, runAgentDirect } = await import("../runner.js");
    const { ALL_AGENTS } = await import("../agents/registry.js");

    const fakeAgent = {
      ...ALL_AGENTS[0],
      id: "fakefail",
      cliCommand: "sh",
      buildArgs: () => ["-c", "exit 42"],
    };

    const ts = "failtest002";
    const statuses = await setupAll([fakeAgent as typeof ALL_AGENTS[0]], repoDir, ts);
    const exitDir = await prepareExitDir(ts);

    await runAgentDirect({
      agent: fakeAgent as typeof ALL_AGENTS[0],
      status: statuses[0],
      command: "sh",
      args: ["-c", "exit 42"],
      exitDir,
    });

    expect(statuses[0].status).toBe("failed");
    expect(statuses[0].exitCode).toBe(42);

    await cleanupAll(statuses, repoDir);
  });
});

describe("E2E: patch generation", () => {
  let repoDir: string;

  beforeEach(async () => {
    repoDir = await mkdtemp(join(tmpdir(), "dp-patch-"));
    await initGitRepo(repoDir);
  });

  afterEach(async () => {
    await rm(repoDir, { recursive: true, force: true });
  });

  it("generates a patch file when worktree has changes", async () => {
    const { setupAll, cleanupAll } = await import("../worktree.js");
    const { generateAll } = await import("../patcher.js");
    const { ALL_AGENTS } = await import("../agents/registry.js");

    const agent = ALL_AGENTS.find((a) => a.id === "claude")!;
    const ts = "patchtest001";
    const statuses = await setupAll([agent], repoDir, ts);
    const status = statuses[0];
    status.status = "done"; // Simulate successful run

    // Make a change in the worktree
    await writeFile(join(status.worktreePath, "new-feature.ts"), "export const x = 42;\n");
    await execa("git", ["add", "."], { cwd: status.worktreePath });
    await execa("git", ["commit", "-m", "feat: add new feature"], {
      cwd: status.worktreePath,
      env: { ...process.env, GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "t@t.com",
             GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "t@t.com" },
    });

    const baseBranch = await getCurrentBranch(repoDir);
    const outputDir = join(repoDir, ".aifork-output");

    await generateAll(statuses, repoDir, baseBranch, outputDir, "patchtest001");

    expect(status.patchFile).toBeTruthy();
    expect(existsSync(status.patchFile!)).toBe(true);

    const patchContent = await readFile(status.patchFile!, "utf8");
    expect(patchContent).toContain("new-feature.ts");
    expect(patchContent).toContain("export const x = 42;");

    await cleanupAll(statuses, repoDir);
  });

  it("sets patchFile to null when worktree has no changes", async () => {
    const { setupAll, cleanupAll } = await import("../worktree.js");
    const { generateAll } = await import("../patcher.js");
    const { ALL_AGENTS } = await import("../agents/registry.js");

    const agent = ALL_AGENTS.find((a) => a.id === "claude")!;
    const ts = "patchtest002";
    const statuses = await setupAll([agent], repoDir, ts);
    statuses[0].status = "done";

    const baseBranch = await getCurrentBranch(repoDir);
    const outputDir = join(repoDir, ".aifork-output");

    await generateAll(statuses, repoDir, baseBranch, outputDir, "patchtest002");

    // No changes → no patch file
    expect(statuses[0].patchFile).toBeNull();

    await cleanupAll(statuses, repoDir);
  });
});

describe("E2E: agent availability (graceful skip)", () => {
  it("marks unavailable agents as not available", async () => {
    const { resolveAvailableAgents } = await import("../agents/registry.js");

    // "nonexistent-agent-xyz" will not be on PATH
    const results = await resolveAvailableAgents(["nonexistent-agent-xyz-12345" as any]);
    // resolveAvailableAgents only looks up ALL_AGENTS by id, so unknown ids return empty
    expect(results).toHaveLength(0);
  });

  it("skips agents not in ALL_AGENTS when filtering by unknown id", async () => {
    const { resolveAvailableAgents, ALL_AGENTS } = await import("../agents/registry.js");

    // Only request known agents
    const knownIds = ALL_AGENTS.map((a) => a.id);
    const results = await resolveAvailableAgents(knownIds);
    expect(results).toHaveLength(ALL_AGENTS.length);

    // Each result has available boolean
    for (const r of results) {
      expect(typeof r.available).toBe("boolean");
    }
  });
});
