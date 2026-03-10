import type { AgentDefinition, AgentRunOptions } from "./types.js";

const codex: AgentDefinition = {
  id: "codex",
  displayName: "Codex",
  cliCommand: "codex",
  buildArgs: (prompt: string, opts: AgentRunOptions): string[] =>
    opts.interactive
      ? [...opts.extraFlags]
      : ["exec", prompt, ...opts.extraFlags],
};

export default codex;
