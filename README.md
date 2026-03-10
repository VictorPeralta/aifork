# aifork

AI Agent Multiplexer — fan out a single prompt to multiple AI coding agents in parallel, each working in an isolated git worktree.

## What it does

`aifork` takes a prompt and runs it against multiple AI agent CLIs simultaneously (Claude Code, Codex, Gemini, Kiro). Each agent works in its own isolated git worktree so they don't interfere with each other. When complete, aifork generates patch files from each agent's changes for review and selective application.

**Interactive mode** (default): opens a tmux session with one pane per agent so you can watch and interact with each one live.

**Non-interactive mode** (`--p`): sends the prompt directly to each agent and runs them as background processes, collecting patch output when done.

## Requirements

- Git (required)
- tmux (required for interactive mode)
- One or more AI agent CLIs installed: `claude`, `codex`, `gemini`, `kiro-cli`
  - Missing agents are skipped automatically

## Installation

```bash
npm install -g aifork
```

## Usage

```
aifork [prompt] [options]
```

Or using npx:

```
npx aifork [prompt] [options]

```

### Examples

```bash
# Interactive mode — opens tmux with all available agents
aifork "Add input validation to the login form"

# Non-interactive — run agents headlessly, collect patches
aifork --print "Fix the null pointer exception in main.js"

# Specific agents only
aifork --agents claude,gemini "Refactor the auth module"

# Load prompt from file
aifork --print --prompt-file prompt.txt

# Non-interactive without tmux (background processes)
aifork --print --no-tmux "Add unit tests for the API layer"

# Keep worktrees after completion for manual inspection
aifork --keep-worktrees "Implement the caching layer"

# Custom patch output directory
aifork --print --output-dir ./patches "Add TypeScript types"
```

## Flags

| Flag | Description |
|------|-------------|
| `--agents <ids>` | Comma-separated list of agent IDs to run (e.g. `claude,codex`). Defaults to all available agents. |
| `--prompt-file <file>` | Load prompt from a file instead of the command line argument. |
| `-p, --print` | Non-interactive mode — pass the prompt directly to each agent and collect output. Required when using `--no-tmux`. |
| `--no-tmux` | Run agents as background processes instead of tmux panes. Only valid with `--print`. |
| `--keep-worktrees` | Keep worktrees and branches after completion instead of cleaning up. Useful for debugging. |
| `--output-dir <dir>` | Directory for patch output files. Default: `.aifork-output` |

## Supported Agents

| ID | Name | CLI Command |
|----|------|-------------|
| `claude` | Claude Code | `claude` |
| `codex` | Codex | `codex` |
| `gemini` | Gemini | `gemini` |
| `kiro` | Kiro | `kiro-cli` |

## Configuration

aifork loads config from (in order, later values override earlier):

1. Defaults
2. `~/.aifork.json` / `~/.aifork.yaml` — global config
3. `./.aifork.json` / `./.aifork.yaml` — repo-local config
4. CLI flags

### Config Schema

```json
{
  "agents": {
    "claude": {
      "enabled": true,
      "extraFlags": []
    },
    "codex": {
      "enabled": true,
      "extraFlags": []
    },
    "gemini": {
      "enabled": true,
      "extraFlags": []
    },
    "kiro": {
      "enabled": true,
      "extraFlags": []
    }
  },
  "keepWorktrees": false,
  "tmux": {
    "layout": "tiled",
    "sessionPrefix": "aifork"
  },
  "patchOutputDir": ".aifork-output"
}
```

### Config Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `agents.<id>.enabled` | boolean | `true` | Enable or disable a specific agent |
| `agents.<id>.extraFlags` | string[] | `[]` | Extra CLI flags to pass to the agent |
| `keepWorktrees` | boolean | `false` | Keep worktrees after completion |
| `tmux.layout` | string | `"tiled"` | tmux pane layout: `tiled`, `even-horizontal`, `even-vertical`, `main-horizontal`, `main-vertical` |
| `tmux.sessionPrefix` | string | `"aifork"` | Prefix for tmux session names |
| `patchOutputDir` | string | `".aifork-output"` | Output directory for `.patch` files |

### Example: disable an agent globally

`~/.aifork.json`:
```json
{
  "agents": {
    "kiro": { "enabled": false }
  }
}
```

### Example: pass extra flags to Claude

`.aifork.json`:
```json
{
  "agents": {
    "claude": {
      "extraFlags": ["--model", "claude-opus-4-6"]
    }
  }
}
```

## Output

Patch files are written to `.aifork-output/` (or `--output-dir`):

```
.aifork-output/
  aifork-claude.patch
  aifork-codex.patch
  aifork-gemini.patch
```

Apply a patch:
```bash
git apply .aifork-output/aifork-claude.patch
```

## How it works

1. Validates the current git repository
2. Creates an isolated git worktree per agent (siblings to the repo root)
3. Runs each agent with the prompt in its worktree
4. Waits for all agents to complete
5. Generates a `.patch` file from each worktree's changes
6. Cleans up worktrees and branches (unless `--keep-worktrees`)
