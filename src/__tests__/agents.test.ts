import { describe, it, expect } from "vitest";
import claude from "../agents/claude.js";
import codex from "../agents/codex.js";
import gemini from "../agents/gemini.js";
import kiro from "../agents/kiro.js";
import type { AgentRunOptions } from "../agents/types.js";

const baseOpts: AgentRunOptions = {
  prompt: "Fix the auth bug",
  worktreePath: "/tmp/test-worktree",
  extraFlags: [],
  interactive: false,
};

const interactiveOpts: AgentRunOptions = { ...baseOpts, interactive: true };

describe("agent buildArgs", () => {
  describe("non-interactive (--print mode)", () => {
    it("claude: uses --print flag", () => {
      const args = claude.buildArgs("Fix the auth bug", baseOpts);
      expect(args).toEqual(["--print", "Fix the auth bug"]);
    });

    it("claude: appends extraFlags", () => {
      const opts: AgentRunOptions = { ...baseOpts, extraFlags: ["--verbose"] };
      const args = claude.buildArgs("Fix it", opts);
      expect(args).toEqual(["--print", "Fix it", "--verbose"]);
    });

    it("codex: uses exec subcommand", () => {
      const args = codex.buildArgs("Fix the auth bug", baseOpts);
      expect(args).toEqual(["exec", "Fix the auth bug"]);
    });

    it("codex: appends extraFlags after exec subcommand", () => {
      const opts: AgentRunOptions = { ...baseOpts, extraFlags: ["--model", "o1"] };
      const args = codex.buildArgs("Fix it", opts);
      expect(args).toEqual(["exec", "Fix it", "--model", "o1"]);
    });

    it("gemini: uses --prompt flag", () => {
      const args = gemini.buildArgs("Fix the auth bug", baseOpts);
      expect(args).toEqual(["--prompt", "Fix the auth bug"]);
    });

    it("kiro: uses run subcommand", () => {
      const args = kiro.buildArgs("Fix the auth bug", baseOpts);
      expect(args).toEqual(["run", "Fix the auth bug"]);
    });
  });

  describe("interactive mode (default)", () => {
    it("claude: no args (launches CLI bare)", () => {
      expect(claude.buildArgs("ignored", interactiveOpts)).toEqual([]);
    });

    it("codex: no args", () => {
      expect(codex.buildArgs("ignored", interactiveOpts)).toEqual([]);
    });

    it("gemini: no args", () => {
      expect(gemini.buildArgs("ignored", interactiveOpts)).toEqual([]);
    });

    it("kiro: no args", () => {
      expect(kiro.buildArgs("ignored", interactiveOpts)).toEqual([]);
    });

    it("extraFlags are still passed in interactive mode", () => {
      const opts: AgentRunOptions = { ...interactiveOpts, extraFlags: ["--verbose"] };
      expect(claude.buildArgs("ignored", opts)).toEqual(["--verbose"]);
    });
  });
});

describe("agent metadata", () => {
  it("all agents have required fields", () => {
    for (const agent of [claude, codex, gemini, kiro]) {
      expect(agent.id).toBeTruthy();
      expect(agent.displayName).toBeTruthy();
      expect(agent.cliCommand).toBeTruthy();
      expect(typeof agent.buildArgs).toBe("function");
    }
  });

  it("agent IDs are unique", () => {
    const ids = [claude, codex, gemini, kiro].map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
