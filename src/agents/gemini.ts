import type { AgentDefinition, AgentRunOptions } from "./types.js";

const gemini: AgentDefinition = {
  id: "gemini",
  displayName: "Gemini",
  cliCommand: "gemini",
  buildArgs: (prompt: string, opts: AgentRunOptions): string[] =>
    opts.interactive
      ? [...opts.extraFlags]
      : ["--prompt", prompt, ...opts.extraFlags],
};

export default gemini;
