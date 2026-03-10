import type { AgentDefinition, AgentRunOptions } from "./types.js";

const claude: AgentDefinition = {
  id: "claude",
  displayName: "Claude Code",
  cliCommand: "claude",
  buildArgs: (prompt: string, opts: AgentRunOptions): string[] =>
    opts.interactive
      ? [...opts.extraFlags]
      : ["--print", "--allowedTools", "Read,Edit,Write,Bash", ...opts.extraFlags, "--", prompt],
};

export default claude;
