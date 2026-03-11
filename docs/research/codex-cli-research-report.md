# Research Report: OpenAI Codex CLI for First-Class Agent Integration

**Date**: 2026-02-23
**Research Classification**: STRATEGIC ANALYSIS
**Confidence Level**: 92% (based on official documentation, SDK source, npm registry)
**Researcher**: Claude Opus 4.6

---

## Executive Summary

OpenAI Codex CLI is a mature, Rust-based coding agent (v0.104.0) with a first-party TypeScript SDK (`@openai/codex-sdk`) that enables fully programmatic control. The SDK spawns the CLI as a child process and exchanges JSONL events over stdin/stdout, providing thread management, structured output via JSON Schema, streaming events, and session persistence. Codex supports MCP as a client, has three approval modes, OS-level sandboxing, and a comprehensive configuration system via TOML files. This makes it a strong candidate for integration into Ptah alongside Claude Agent SDK.

---

## 1. Current State and Package Identity

### Package: `@openai/codex`

- **Latest Version**: 0.104.0 (released February 18, 2026)
- **Runtime**: Rust binary distributed via npm (platform-specific dist-tags)
- **Installation**: `npm i -g @openai/codex` or `brew install --cask codex`
- **Platform Support**: macOS (stable), Linux (stable), Windows (experimental via WSL)
- **License**: Open source (GitHub: openai/codex)

### Package: `@openai/codex-sdk`

- **Purpose**: TypeScript SDK that wraps the CLI and spawns it to exchange JSONL events over stdin/stdout
- **Installation**: `npm install @openai/codex-sdk`
- **Requires**: Node.js 18+
- **Key Insight**: The SDK does NOT embed the agent logic -- it spawns the `codex` CLI binary as a child process

### Architecture Implication for Ptah

The Codex integration has TWO viable paths:

1. **CLI Path** (`codex exec`): Non-interactive mode, JSONL output, suitable for fire-and-forget tasks
2. **SDK Path** (`@openai/codex-sdk`): Programmatic thread management, streaming events, session resume -- this is the preferred path for a first-class integration

---

## 2. Interactive vs Headless Mode

### Interactive Mode (TUI)

- Full-screen terminal UI for human interaction
- Commands like `/model`, `/permissions`, `/review`, `/mcp` available inside TUI
- Approval prompts shown inline for user to accept/reject

### Non-Interactive / Headless Mode (`codex exec`)

```bash
# Basic non-interactive execution
codex exec "Fix the failing test in auth.ts"

# With JSON event stream
codex exec --json "Analyze this codebase" | jq

# With structured output
codex exec --output-schema ./schema.json -o ./result.json "Summarize status"

# With full auto (no approval prompts for file edits)
codex exec --full-auto "Refactor the logging module"

# Ephemeral (no session persistence)
codex exec --ephemeral "Quick analysis"
```

**stdin/stdout Protocol**:

- Default: Progress streams to stderr, final message to stdout
- `--json` flag: stdout becomes a JSONL event stream
- Event types: `thread.started`, `turn.started`, `turn.completed`, `item.*`, `error`
- Enables piping: `codex exec "generate notes" | tee output.md`

### SDK Programmatic Mode (Preferred for Ptah)

```typescript
import { Codex } from '@openai/codex-sdk';

const codex = new Codex();
const thread = codex.startThread({
  workingDirectory: '/path/to/project',
  skipGitRepoCheck: true,
});

// Buffered execution
const turn = await thread.run('Fix the failing test');
console.log(turn.finalResponse);
console.log(turn.items);

// Streaming execution
const { events } = await thread.runStreamed('Diagnose the issue');
for await (const event of events) {
  switch (event.type) {
    case 'item.completed':
      console.log('item', event.item);
      break;
    case 'turn.completed':
      console.log('usage', event.usage);
      break;
  }
}

// Multi-turn conversation (maintains context)
const turn2 = await thread.run('Now implement the fix');
```

---

## 3. Tool Use / Capabilities

### Built-in Tools

| Tool            | Description                                | Sandbox Gated                 |
| --------------- | ------------------------------------------ | ----------------------------- |
| Shell execution | Run terminal commands in working directory | Yes                           |
| File read       | Read files in workspace                    | No (always allowed)           |
| File write/edit | Modify files                               | Yes (approval mode dependent) |
| Web search      | Cached (OpenAI index) or live web search   | Configurable                  |
| Code review     | `/review` analyzes diffs against branches  | No                            |

### Sandbox Model

Three sandbox levels enforced at the OS level:

| Mode                        | File Access                      | Network            | Use Case                  |
| --------------------------- | -------------------------------- | ------------------ | ------------------------- |
| `read-only`                 | Read workspace only              | Blocked            | Consultative analysis     |
| `workspace-write` (default) | Read all, write workspace + /tmp | Blocked by default | Normal development        |
| `danger-full-access`        | Unrestricted                     | Allowed            | Trusted environments only |

**OS Enforcement Mechanisms**:

- **macOS**: Seatbelt policies via `sandbox-exec`
- **Linux**: Landlock + seccomp (default) or bwrap (optional)
- **Windows**: WSL-based sandboxing when available

**Protected Paths** (always read-only even in write mode):

- `.git` directories
- `.agents` and `.codex` directories

---

## 4. Automation Flags (Complete Reference)

### Global Flags

| Flag                     | Values                                               | Purpose                                      |
| ------------------------ | ---------------------------------------------------- | -------------------------------------------- |
| `--ask-for-approval, -a` | `untrusted`, `on-request`, `never`                   | Control approval prompts                     |
| `--full-auto`            | boolean                                              | Shortcut for `--ask-for-approval on-request` |
| `--sandbox, -s`          | `read-only`, `workspace-write`, `danger-full-access` | Sandbox policy                               |
| `--model, -m`            | string                                               | Model override (e.g., `gpt-5-codex`)         |
| `--cd, -C`               | path                                                 | Set working directory                        |
| `--add-dir`              | path                                                 | Grant write access to additional directories |
| `--image, -i`            | path(s)                                              | Attach images to prompt                      |
| `--profile, -p`          | string                                               | Select config profile                        |
| `--config, -c`           | key=value                                            | Override config settings                     |
| `--no-alt-screen`        | boolean                                              | Disable TUI alternate screen                 |
| `--search`               | boolean                                              | Enable live web search                       |
| `--oss`                  | boolean                                              | Use local open-source model                  |
| `--yolo`                 | boolean                                              | Disable ALL approvals and sandbox (unsafe)   |

### `codex exec` Specific Flags

| Flag                             | Purpose                             |
| -------------------------------- | ----------------------------------- |
| `--json` / `--experimental-json` | Output JSONL event stream           |
| `--output-last-message, -o`      | Write final message to file         |
| `--output-schema`                | JSON Schema for structured response |
| `--ephemeral`                    | Skip session persistence            |
| `--color`                        | `always`, `never`, `auto`           |
| `--skip-git-repo-check`          | Allow running outside git repos     |

### Key Subcommands

| Subcommand                      | Purpose                                            |
| ------------------------------- | -------------------------------------------------- |
| `codex exec` (alias: `codex e`) | Non-interactive execution                          |
| `codex resume`                  | Continue previous sessions (`--last`, `--all`)     |
| `codex cloud`                   | Cloud task management                              |
| `codex mcp`                     | MCP server management                              |
| `codex sandbox`                 | Run commands under sandbox                         |
| `codex login`                   | Authentication (`--device-auth`, `--with-api-key`) |

---

## 5. Output Format

### Plain Text (Default)

Progress to stderr, final message to stdout. Suitable for simple piping.

### JSONL Event Stream (`--json`)

Each line is a separate JSON object:

```json
{"type": "thread.started", ...}
{"type": "turn.started", ...}
{"type": "item.completed", "item": {...}}
{"type": "turn.completed", "usage": {...}}
```

### Structured Output (`--output-schema`)

Force final response to conform to a JSON Schema:

```bash
codex exec --output-schema ./schema.json -o ./result.json "Analyze status"
```

### SDK Event Types

When using `@openai/codex-sdk` with `runStreamed()`:

- `"item.completed"` -- contains `event.item` (tool calls, responses, file changes)
- `"turn.completed"` -- contains `event.usage` (token usage statistics)

---

## 6. Session Management

### Automatic Persistence

- Sessions stored in `~/.codex/sessions/`
- Each thread gets a unique ID
- Full conversation history + file changes tracked

### Resume Capabilities

**CLI**:

```bash
codex resume --last           # Resume most recent session
codex resume <SESSION_ID>     # Resume specific session
codex exec resume --last "next step"  # Non-interactive resume
```

**SDK**:

```typescript
const thread = codex.resumeThread(savedThreadId);
await thread.run('Continue with the next step');
```

### Multi-Turn Conversations (SDK)

```typescript
const thread = codex.startThread();
await thread.run('Analyze the test failures');
await thread.run('Fix the root cause');
await thread.run('Add regression tests');
// All three turns share context within the same thread
```

### Ephemeral Mode

Skip persistence with `--ephemeral` flag for one-off tasks that don't need session history.

---

## 7. Configuration

### File Hierarchy

| Location               | Scope          | Purpose                            |
| ---------------------- | -------------- | ---------------------------------- |
| `~/.codex/config.toml` | User-level     | Default settings                   |
| `.codex/config.toml`   | Project-scoped | Project overrides (requires trust) |
| `requirements.toml`    | Admin-enforced | Constraints on user overrides      |

### Key Configuration Sections

```toml
# Model
model = "gpt-5-codex"
model_provider = "openai"
model_context_window = 200000
model_reasoning_effort = "medium"   # minimal|low|medium|high|xhigh
model_reasoning_summary = "auto"    # auto|concise|detailed|none

# Approval & Sandbox
approval_policy = "on-request"      # untrusted|on-request|never
sandbox_mode = "workspace-write"    # read-only|workspace-write|danger-full-access

[sandbox_workspace_write]
network_access = true
writable_roots = ["/home/user/projects"]

# Web Search
web_search = "cached"               # disabled|cached|live

# Personality
personality = "friendly"            # none|friendly|pragmatic
```

### Profiles System

```toml
profile = "development"             # Active profile

[profiles.development]
model = "gpt-5-codex"
sandbox_mode = "workspace-write"
approval_policy = "never"

[profiles.production]
sandbox_mode = "read-only"
approval_policy = "on-request"
```

### Multi-Agent Configuration (Experimental)

```toml
[agents.researcher]
description = "Specialized for information gathering"
config_file = "./agent-configs/researcher.toml"

agents.max_threads = 5
```

### Environment Variables

| Variable                 | Purpose                        |
| ------------------------ | ------------------------------ |
| `CODEX_API_KEY`          | API authentication (CI/CD use) |
| `OPENAI_BASE_URL`        | API endpoint override          |
| `WS_PROXY` / `WSS_PROXY` | WebSocket proxy support        |

### Feature Flags

```toml
[features]
shell_tool = true
web_search = true
multi_agent = false          # Experimental
apply_patch_freeform = false
apps = false                 # Experimental
collaboration_modes = true
```

### SDK Configuration

```typescript
const codex = new Codex({
  env: { PATH: '/usr/local/bin' },
  config: {
    show_raw_agent_reasoning: true,
    sandbox_workspace_write: { network_access: true },
  },
});
```

The `config` object is flattened to dotted paths and passed as `--config key=value` flags to the CLI.

---

## 8. MCP Support

Codex supports MCP as a **client** (consuming tools from MCP servers). This is significant for Ptah integration.

### Adding MCP Servers

**CLI**:

```bash
codex mcp add <server-name> --env VAR1=VALUE1 -- <command>
codex mcp add context7 -- npx -y @upstash/context7-mcp
```

**Config**:

```toml
[mcp_servers.my-server]
command = "/path/to/server"        # STDIO server
# OR
url = "http://localhost:8000"      # HTTP server

enabled = true
required = false
startup_timeout_sec = 10
tool_timeout_sec = 60

enabled_tools = ["tool1", "tool2"]   # Allowlist
disabled_tools = ["tool3"]           # Denylist

[mcp_servers.my-server.env]
API_KEY = "value"

[mcp_servers.my-server.http_headers]
Authorization = "Bearer token"
```

### Server Types

| Type            | Connection                       | Use Case                     |
| --------------- | -------------------------------- | ---------------------------- |
| STDIO           | Local process spawned by command | Local tools, file access     |
| Streamable HTTP | Remote URL                       | Cloud services, shared tools |

### MCP CLI Commands

```bash
codex mcp list       # Show configured servers
codex mcp add        # Add a server
codex mcp remove     # Remove a server
codex mcp login      # Authenticate with a server
codex mcp logout     # Remove authentication
```

### Ptah Integration Opportunity

Codex can connect to Ptah's existing MCP server as a client, giving Codex agents access to Ptah's workspace intelligence, diagnostics, symbols, and other tools. This creates a bidirectional integration:

- Ptah spawns and manages Codex agents
- Codex agents consume Ptah's MCP tools for enhanced workspace awareness

---

## 9. Approval Modes (Detailed)

### Three-Tier Approval System

| Mode                             | CLI Flag        | File Reads | File Writes          | Shell Commands       | Network           | Use Case           |
| -------------------------------- | --------------- | ---------- | -------------------- | -------------------- | ----------------- | ------------------ |
| **Untrusted** (most restrictive) | `-a untrusted`  | Allowed    | Requires approval    | Requires approval    | Blocked           | Untrusted repos    |
| **On-Request** (default)         | `-a on-request` | Allowed    | Allowed in workspace | Allowed in workspace | Requires approval | Normal development |
| **Never** (full auto)            | `-a never`      | Allowed    | Allowed everywhere   | Allowed everywhere   | Allowed           | Fully trusted      |

### Shortcut Flags

- `--full-auto`: Equivalent to `--ask-for-approval on-request` (low-friction local work)
- `--yolo`: Disables ALL approvals AND sandboxing (dangerous, for testing only)

### Runtime Switching

In interactive mode, use `/permissions` command to change approval mode mid-session.

### Per-Approval IDs

As of v0.104.0, protocol/core carries distinct approval IDs for command approvals, enabling granular programmatic approval handling.

---

## 10. Comparative Analysis: Codex SDK vs Claude Agent SDK

| Dimension             | Codex SDK                                | Claude Agent SDK                         |
| --------------------- | ---------------------------------------- | ---------------------------------------- |
| **Package**           | `@openai/codex-sdk`                      | `@anthropic-ai/claude-code-sdk`          |
| **Architecture**      | Spawns Rust CLI, JSONL over stdin/stdout | Spawns Node CLI, JSONL over stdin/stdout |
| **Thread/Session**    | `startThread()` / `resumeThread()`       | `startSession()`                         |
| **Streaming**         | `runStreamed()` async generator          | Async iterator on session                |
| **Structured Output** | JSON Schema / Zod                        | Message types                            |
| **MCP Support**       | Client (consumes MCP tools)              | Client (consumes MCP tools)              |
| **Sandbox**           | OS-level (Seatbelt/Landlock/seccomp)     | OS-level                                 |
| **Approval Modes**    | 3 modes (untrusted/on-request/never)     | Similar permission model                 |
| **Multi-turn**        | Multiple `run()` on same thread          | Continuous session                       |
| **Windows**           | Experimental (WSL)                       | Supported                                |
| **Config**            | TOML files + profiles                    | JSON/YAML                                |

### Key Architectural Similarity

Both SDKs follow the **same pattern**: spawn a CLI binary and communicate via JSONL over stdin/stdout. This means Ptah's existing `AgentProcessManager` pattern (spawn process, parse events, manage lifecycle) applies directly to Codex integration.

---

## 11. Integration Strategy for Ptah

### Recommended Approach: SDK-Based Integration

Use `@openai/codex-sdk` as the primary integration path, mirroring the Claude Agent SDK pattern.

### Implementation Sketch

```typescript
// CodexAgentAdapter (mirrors VsCodeLmAdapter / ClaudeAgentSDK pattern)
import { Codex } from '@openai/codex-sdk';

class CodexAgentAdapter implements IAIProvider {
  private codex: Codex;
  private thread: Thread | null = null;

  constructor() {
    this.codex = new Codex({
      config: {
        approval_policy: 'on-request',
        sandbox_mode: 'workspace-write',
      },
    });
  }

  async startSession(workingDirectory: string): Promise<void> {
    this.thread = this.codex.startThread({
      workingDirectory,
      skipGitRepoCheck: true,
    });
  }

  async sendMessage(prompt: string): Promise<AgentResponse> {
    const { events } = await this.thread.runStreamed(prompt);

    for await (const event of events) {
      // Transform Codex events to Ptah message types
      this.emitPtahEvent(transformEvent(event));
    }
  }

  async resumeSession(threadId: string): Promise<void> {
    this.thread = this.codex.resumeThread(threadId);
  }
}
```

### MCP Bidirectional Integration

```toml
# .codex/config.toml - Give Codex access to Ptah's MCP tools
[mcp_servers.ptah]
command = "node"
args = ["path/to/ptah-mcp-server.js"]
enabled = true
enabled_tools = ["workspace_analyze", "search_symbols", "get_diagnostics"]
```

### Key Integration Points

1. **Process Management**: Reuse `AgentProcessManager` patterns for Codex process lifecycle
2. **Event Transformation**: Map Codex JSONL events to Ptah's 94 message types
3. **Session Persistence**: Leverage Codex's built-in session management in `~/.codex/sessions/`
4. **Approval Handling**: Map Codex approval requests to Ptah's UI approval flow
5. **MCP Bridge**: Connect Ptah's MCP server to Codex for workspace intelligence

---

## 12. Risk Analysis

### Critical Risks

| Risk                                           | Probability | Impact | Mitigation                         |
| ---------------------------------------------- | ----------- | ------ | ---------------------------------- |
| Windows support is experimental                | 40%         | HIGH   | WSL fallback, test thoroughly      |
| CLI binary distribution via npm adds ~50MB     | 30%         | MEDIUM | Lazy download on first use         |
| JSONL event schema may change between versions | 20%         | HIGH   | Pin SDK version, use adapter layer |
| Approval mode integration complexity           | 25%         | MEDIUM | Start with `--full-auto` for MVP   |

### Windows Consideration

Codex on Windows relies on WSL. For Ptah (a VS Code extension), this means:

- Users must have WSL installed
- Or Ptah provides a fallback to the `codex exec` CLI mode
- The VS Code extension for Codex can "keep the agent inside WSL whenever available"

---

## 13. Sources

### Primary Sources (Official)

1. [Codex CLI Documentation](https://developers.openai.com/codex/cli/) - Official CLI guide
2. [Command Line Reference](https://developers.openai.com/codex/cli/reference/) - Complete flag catalog
3. [Non-Interactive Mode](https://developers.openai.com/codex/noninteractive) - Automation guide
4. [Codex SDK Documentation](https://developers.openai.com/codex/sdk/) - TypeScript SDK
5. [Configuration Reference](https://developers.openai.com/codex/config-reference/) - Full config options
6. [MCP Support](https://developers.openai.com/codex/mcp) - MCP integration guide
7. [Security Model](https://developers.openai.com/codex/security/) - Sandbox details
8. [CLI Features](https://developers.openai.com/codex/cli/features/) - Built-in tools
9. [Codex Changelog](https://developers.openai.com/codex/changelog/) - Version history

### Secondary Sources

10. [@openai/codex on npm](https://www.npmjs.com/package/@openai/codex) - CLI package
11. [@openai/codex-sdk on npm](https://www.npmjs.com/package/@openai/codex-sdk) - SDK package
12. [GitHub Repository](https://github.com/openai/codex) - Source code
13. [SDK TypeScript README](https://github.com/openai/codex/blob/main/sdk/typescript/README.md) - SDK examples
