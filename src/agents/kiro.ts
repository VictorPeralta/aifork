import type { AgentDefinition, AgentRunOptions } from "./types.js";

const kiro: AgentDefinition = {
  id: "kiro",
  displayName: "Kiro",
  cliCommand: "kiro-cli",
  buildArgs: (prompt: string, opts: AgentRunOptions): string[] =>
    opts.interactive
      ? [...opts.extraFlags]
      : ["chat", "--no-interactive", "--trust-tools", "read,write,shell,glob,grep", prompt, ...opts.extraFlags],
};

export default kiro;
