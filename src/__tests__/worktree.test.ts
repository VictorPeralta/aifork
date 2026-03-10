import { describe, it, expect } from "vitest";
import { worktreePath, branchName } from "../worktree.js";

describe("worktreePath", () => {
  it("generates sibling path outside repo", () => {
    const result = worktreePath("/home/user/myrepo", "claude", "12345");
    expect(result).toBe("/home/user/myrepo-dp-claude-12345");
  });

  it("uses agent ID and timestamp in path", () => {
    const result = worktreePath("/projects/my-app", "codex", "99999");
    expect(result).toBe("/projects/my-app-dp-codex-99999");
  });

  it("handles repo names with hyphens", () => {
    const result = worktreePath("/home/user/my-cool-repo", "gemini", "11111");
    expect(result).toBe("/home/user/my-cool-repo-dp-gemini-11111");
  });
});

describe("branchName", () => {
  it("formats as aifork/<agentId>", () => {
    expect(branchName("claude")).toBe("aifork/claude");
    expect(branchName("codex")).toBe("aifork/codex");
    expect(branchName("gemini")).toBe("aifork/gemini");
    expect(branchName("kiro")).toBe("aifork/kiro");
  });
});
