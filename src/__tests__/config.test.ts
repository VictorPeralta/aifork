import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { loadConfig } from "../config.js";

describe("loadConfig", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "aifork-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns defaults when no config file exists", async () => {
    const config = await loadConfig(tmpDir, {});
    expect(config.keepWorktrees).toBe(false);
    expect(config.patchOutputDir).toBe(".aifork-output");
    expect(config.tmux.sessionPrefix).toBe("aifork");
    expect(config.tmux.layout).toBe("tiled");
  });

  it("all agents enabled by default", async () => {
    const config = await loadConfig(tmpDir, {});
    expect(config.enabledAgentIds).toContain("claude");
    expect(config.enabledAgentIds).toContain("codex");
    expect(config.enabledAgentIds).toContain("gemini");
    expect(config.enabledAgentIds).toContain("kiro");
  });

  it("CLI agents override filters agent list", async () => {
    const config = await loadConfig(tmpDir, { agents: ["claude", "codex"] });
    expect(config.enabledAgentIds).toEqual(["claude", "codex"]);
  });

  it("CLI keepWorktrees override", async () => {
    const config = await loadConfig(tmpDir, { keepWorktrees: true });
    expect(config.keepWorktrees).toBe(true);
  });

  it("CLI outputDir override", async () => {
    const config = await loadConfig(tmpDir, { outputDir: "./custom-out" });
    expect(config.patchOutputDir).toBe("./custom-out");
  });

  it("noTmux defaults to false", async () => {
    const config = await loadConfig(tmpDir, {});
    expect(config.noTmux).toBe(false);
  });

  it("noTmux CLI override", async () => {
    const config = await loadConfig(tmpDir, { noTmux: true });
    expect(config.noTmux).toBe(true);
  });

  it("local config file is merged with defaults", async () => {
    const localConfig = {
      keepWorktrees: true,
      patchOutputDir: "./patches",
      agents: {
        codex: { enabled: false },
      },
    };
    await writeFile(
      join(tmpDir, ".aifork.json"),
      JSON.stringify(localConfig),
      "utf8"
    );

    const config = await loadConfig(tmpDir, {});
    expect(config.keepWorktrees).toBe(true);
    expect(config.patchOutputDir).toBe("./patches");
    // codex disabled in config
    expect(config.enabledAgentIds).not.toContain("codex");
    expect(config.enabledAgentIds).toContain("claude");
  });

  it("CLI flags override local config file", async () => {
    const localConfig = { patchOutputDir: "./local-patches" };
    await writeFile(
      join(tmpDir, ".aifork.json"),
      JSON.stringify(localConfig),
      "utf8"
    );

    const config = await loadConfig(tmpDir, { outputDir: "./cli-override" });
    expect(config.patchOutputDir).toBe("./cli-override");
  });
});
