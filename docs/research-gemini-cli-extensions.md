# Research Report: Gemini CLI Extension, Plugin, and Tool Mechanisms

**Date**: 2026-02-28
**Scope**: Gemini CLI extensibility for programmatic/headless spawning
**Confidence Level**: 95% (based on official docs + GitHub source analysis)
**CLI Version Context**: v0.30.1+ (latest stable as of Feb 2026)

---

## Executive Summary

Gemini CLI has a rich, multi-layered extensibility system that goes well beyond MCP servers alone. It supports **six distinct extension mechanisms**: MCP Servers, Extensions (bundles), Agent Skills, Subagents, Hooks, and Policies. For programmatic/headless spawning, the key flags are `--extensions/-e` (select extensions by name), `--model/-m`, `--output-format`, `--yolo/-y`, and `--approval-mode`. MCP servers remain the primary mechanism for adding custom **tools**, but skills, subagents, hooks, and context files provide complementary capabilities for instructions, workflows, and behavioral control.

---

## 1. Complete CLI Flags Reference (Relevant to Extensibility)

### Core Flags

| Flag                         | Alias | Type    | Default   | Description                                               |
| ---------------------------- | ----- | ------- | --------- | --------------------------------------------------------- |
| `--model`                    | `-m`  | string  | `auto`    | Model to use                                              |
| `--debug`                    | `-d`  | boolean | `false`   | Verbose logging                                           |
| `--sandbox`                  | `-s`  | boolean | `false`   | Sandboxed execution                                       |
| `--approval-mode`            | —     | string  | `default` | `default`, `auto_edit`, `yolo`                            |
| `--yolo`                     | `-y`  | boolean | `false`   | Auto-approve all (deprecated; use `--approval-mode=yolo`) |
| `--output-format`            | `-o`  | string  | `text`    | `text`, `json`, `stream-json`                             |
| `--prompt-interactive`       | `-i`  | —       | —         | Execute prompt then continue interactively                |
| `--extensions`               | `-e`  | array   | —         | **Specify extensions to use by name**                     |
| `--allowed-mcp-server-names` | —     | array   | —         | Whitelist MCP servers for session                         |
| `--include-directories`      | —     | array   | —         | Additional workspace directories                          |
| `--resume`                   | `-r`  | string  | —         | Resume session by ID or "latest"                          |
| `--screen-reader`            | —     | boolean | —         | Accessibility mode                                        |
| `--experimental-acp`         | —     | —       | —         | Agent Code Pilot mode                                     |

### Key Finding: `--extensions / -e` Flag

The `--extensions` flag accepts an **array of extension names** to enable for a session. It was fixed in PRs #8797 and #9994 to properly override `disabledExtensions` in settings.json, allowing extensions disabled by default to be activated on-demand for specific invocations.

**Usage**:

```bash
gemini -e my-extension -p "do something"
gemini --extensions my-extension --extensions another-ext -p "prompt"
```

### Key Finding: No `--tools`, `--plugins`, or `--agents` Flags

There are **no CLI flags** for:

- `--tools` (tools come from MCP servers or built-in)
- `--plugins` (no plugin concept; use extensions)
- `--agents` (subagents are file-based, not flag-based)

---

## 2. Extension System (Bundles)

Gemini CLI Extensions are **bundles** that package multiple capabilities together. They are the primary distribution mechanism for third-party functionality.

### Extension Manifest (`gemini-extension.json`)

```json
{
  "name": "my-extension",
  "version": "1.0.0",
  "description": "What this extension does",
  "mcpServers": {
    "myServer": {
      "command": "node",
      "args": ["${extensionPath}${/}server.js"],
      "cwd": "${extensionPath}"
    }
  },
  "contextFileName": "GEMINI.md",
  "excludeTools": ["dangerous_tool"],
  "settings": [
    {
      "name": "API Key",
      "description": "Required API key",
      "envVar": "MY_API_KEY",
      "sensitive": true
    }
  ],
  "themes": []
}
```

### Extension Directory Structure

```
my-extension/
├── gemini-extension.json    # Manifest (required)
├── GEMINI.md                # Context instructions
├── package.json             # Node dependencies
├── server.js                # MCP server implementation
├── commands/                # Custom slash commands (TOML)
│   └── my-cmd.toml
├── skills/                  # Agent skills
│   └── security-audit/
│       └── SKILL.md
├── agents/                  # Subagent definitions
│   └── reviewer.md
├── hooks/                   # Lifecycle hooks
│   └── hooks.json
├── policies/                # Policy rules (TOML)
│   └── safety.toml
└── themes/                  # UI themes
```

### Extension Components (Six Types)

1. **MCP Servers** - Custom tools exposed to the model
2. **Custom Commands** - Slash commands (TOML files with prompt templates)
3. **Context Files (GEMINI.md)** - Persistent model instructions
4. **Agent Skills** - Specialized workflows activated contextually
5. **Hooks** - Lifecycle event interceptors
6. **Custom Themes** - UI color definitions

### Extension Management Commands

```bash
gemini extensions install <github-url-or-path>
gemini extensions link <local-path>       # Dev mode
gemini extensions list
gemini extensions enable <name>
gemini extensions disable <name>
gemini extensions new <name> <template>   # Scaffolding
```

### Variable Substitution in Extensions

- `${extensionPath}` - Extension directory absolute path
- `${workspacePath}` - Current workspace absolute path
- `${/}` - Platform-specific path separator

---

## 3. MCP Servers (Primary Tool Extension Mechanism)

MCP servers are the **primary way to add custom tools** to Gemini CLI. They are configured via `settings.json` or bundled inside extensions.

### Configuration in `~/.gemini/settings.json`

```json
{
  "mcpServers": {
    "ptah": {
      "httpUrl": "http://localhost:3000",
      "trust": true,
      "timeout": 30000
    },
    "custom-server": {
      "command": "node",
      "args": ["./my-server.js"],
      "env": { "API_KEY": "$MY_TOKEN" },
      "cwd": "./server-dir",
      "timeout": 600000,
      "includeTools": ["tool_a", "tool_b"],
      "excludeTools": ["dangerous_tool"]
    },
    "remote-sse": {
      "url": "https://my-server.com/sse"
    }
  }
}
```

### Supported Transports

1. **Stdio** - `command` + `args` (spawns subprocess)
2. **SSE** - `url` (Server-Sent Events endpoint)
3. **HTTP Streaming** - `httpUrl` (HTTP streaming endpoint)

### MCP CLI Management

```bash
gemini mcp add <name> <commandOrUrl> [args...]
gemini mcp list
gemini mcp remove <name>
gemini mcp enable <name>
gemini mcp disable <name>
# Options: -e/--env, -H/--header, --timeout, --trust, --include-tools, --exclude-tools
```

### Headless Mode Note

MCP servers that require OAuth authentication will **not work** in headless environments without browser access. Stdio and token-based auth servers work fine.

---

## 4. Agent Skills

Skills provide **specialized instructions and workflows** that the model activates contextually. They save context tokens by loading only when needed.

### SKILL.md Format

```yaml
---
name: security-audit
description: "Expertise in auditing code for security vulnerabilities. Use when the user asks to 'check for security issues' or 'audit' their changes."
---
# Security Auditor

You are an expert security researcher. When activated:

1. Analyze code for common vulnerabilities (SQL injection, XSS, etc.)
2. Check for hardcoded credentials
3. Review file permissions and access patterns
4. Report findings with severity ratings

## Tools Available
You have access to `read_file`, `grep_search`, and `glob` tools.
```

### Skill Locations

| Location   | Path                                       | Scope                        |
| ---------- | ------------------------------------------ | ---------------------------- |
| Workspace  | `.gemini/skills/` or `.agents/skills/`     | Project-shared (git-tracked) |
| User       | `~/.gemini/skills/` or `~/.agents/skills/` | Personal, all workspaces     |
| Extensions | Inside installed extensions                | Extension-bundled            |

### Skill Activation

The model **autonomously decides** when to activate a skill by calling the built-in `activate_skill` tool. Activation requires user consent via confirmation prompt (in interactive mode). After activation, the skill's full instructions are injected into context and the skill gains permission to read bundled assets in its directory.

### Skill Management

```bash
gemini skills install <url>
gemini skills uninstall <name>
gemini skills enable <name>
gemini skills disable <name>
# Interactive: /skills list, /skills link, /skills enable, /skills disable, /skills reload
```

---

## 5. Subagents (Experimental)

Subagents are **specialized agents** that operate within the main session, with their own system prompts, tool access, and model configurations.

### Agent Definition Format (Markdown with YAML Frontmatter)

```markdown
---
name: security-auditor
description: 'Specialized in finding security vulnerabilities in code.'
kind: local
tools:
  - read_file
  - grep_search
model: gemini-2.5-pro
temperature: 0.2
max_turns: 10
timeout_mins: 5
---

You are a ruthless Security Auditor. Analyze code for vulnerabilities.

Focus on:

1. SQL Injection
2. XSS (Cross-Site Scripting)
3. Hardcoded credentials
4. Unsafe file operations

Report findings; do not fix them yourself.
```

### Frontmatter Schema

| Field          | Type   | Required | Default   | Description                                        |
| -------------- | ------ | -------- | --------- | -------------------------------------------------- |
| `name`         | string | Yes      | —         | Unique identifier (lowercase, hyphens/underscores) |
| `description`  | string | Yes      | —         | Helps main agent decide when to invoke             |
| `kind`         | string | No       | `local`   | `local` or `remote`                                |
| `tools`        | array  | No       | —         | List of accessible tools                           |
| `model`        | string | No       | Inherited | Specific model for this agent                      |
| `temperature`  | number | No       | —         | 0.0 to 2.0                                         |
| `max_turns`    | number | No       | 15        | Conversation turn limit                            |
| `timeout_mins` | number | No       | 5         | Execution timeout in minutes                       |

### Agent File Locations

| Location | Path                    | Scope       |
| -------- | ----------------------- | ----------- |
| Project  | `.gemini/agents/*.md`   | Team-shared |
| User     | `~/.gemini/agents/*.md` | Personal    |

### Enablement

Requires experimental flag in settings.json:

```json
{
  "experimental": {
    "enableAgents": true
  }
}
```

**Warning**: Subagents operate in YOLO mode (auto-approve tool calls).

### Built-in Subagents

- `codebase_investigator` - Analyzes code dependencies
- `cli_help` - Gemini CLI knowledge
- `generalist_agent` - Routes to specialists
- `browser_agent` - Web automation (experimental)

---

## 6. Hooks System

Hooks are **lifecycle event interceptors** that run scripts at specific points in the agent loop.

### Supported Hook Events

| Category  | Events                                                      |
| --------- | ----------------------------------------------------------- |
| Tool      | `BeforeTool`, `AfterTool`                                   |
| Agent     | `BeforeAgent`, `AfterAgent`                                 |
| Model     | `BeforeModel`, `BeforeToolSelection`, `AfterModel`          |
| Lifecycle | `SessionStart`, `SessionEnd`, `Notification`, `PreCompress` |

### Configuration in `settings.json`

```json
{
  "hooks": {
    "BeforeTool": [
      {
        "matcher": "run_shell_command",
        "sequential": true,
        "hooks": [
          {
            "type": "command",
            "command": "node validate-command.js",
            "name": "command-validator",
            "timeout": 60000,
            "description": "Validates shell commands before execution"
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node inject-context.js",
            "name": "context-injector"
          }
        ]
      }
    ]
  }
}
```

### Key Hook Capabilities

- **BeforeTool**: Validate arguments, block dangerous operations (`decision: "deny"`)
- **AfterTool**: Audit results, filter sensitive output, chain tool calls (`tailToolCallRequest`)
- **BeforeAgent**: Inject context, validate prompts
- **AfterAgent**: Validate outputs, force retries
- **BeforeModel**: Override model/temperature, provide synthetic responses
- **BeforeToolSelection**: Filter available tools, force/disable tool usage
- **AfterModel**: Redact PII, modify response chunks (fires per streaming chunk)
- **SessionStart**: Load initial context (injectable via `additionalContext`)

### Hooks Communication Protocol

- **Input**: JSON via stdin (includes `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `timestamp`)
- **Output**: JSON via stdout (fields vary by event type)
- **Exit codes**: 0 = success, 2 = system block, other = warning

---

## 7. Policy Engine

Policies provide **fine-grained tool execution control** via TOML rules.

### Policy File Format

```toml
[[rule]]
toolName = "run_shell_command"
commandPrefix = "rm -rf"
decision = "deny"
priority = 500
deny_message = "Destructive operations are not allowed."

[[rule]]
toolName = ["read_file", "glob", "list_directory"]
decision = "allow"
priority = 100

[[rule]]
mcpName = "untrusted-server"
decision = "deny"
priority = 900
deny_message = "This MCP server is blocked by policy."

[[rule]]
toolName = "run_shell_command"
commandRegex = "git (status|log|diff)"
decision = "allow"
priority = 200
```

### Policy Locations

- **Default**: Built-in policies
- **User**: `~/.gemini/policies/*.toml`
- **Workspace**: `.gemini/policies/*.toml`
- **Admin**: OS-specific secure directories (highest priority)

### Headless Mode Behavior

In non-interactive (headless) mode, `ask_user` decisions are automatically treated as `deny`. This ensures safe unattended operation.

---

## 8. Context Files (GEMINI.md / Custom Instructions)

### Discovery Hierarchy

1. **Global**: `~/.gemini/GEMINI.md`
2. **Workspace**: Scans workspace directories and parent directories
3. **JIT (Just-in-Time)**: Auto-discovered when tools access files/directories

### Custom File Names (settings.json)

```json
{
  "context": {
    "fileName": ["AGENTS.md", "CONTEXT.md", "GEMINI.md"]
  }
}
```

### Modularization with Imports

```markdown
# Main GEMINI.md

@coding-style.md
@project-rules.md
@team-conventions.md
```

---

## 9. settings.json Complete Configuration Schema

```json
{
  "policyPaths": [],
  "general": { "approvalMode": "default", "checkpointing": true },
  "output": {},
  "ui": { "theme": "default" },
  "model": { "model": "auto", "sessionTurnLimit": 100 },
  "tools": { "sandbox": false, "excludeTools": [] },
  "context": { "fileName": ["GEMINI.md"], "fileFiltering": true },
  "mcpServers": {},
  "mcp": { "allowed": [], "excluded": [] },
  "security": { "envRedaction": true },
  "hooks": {},
  "hooksConfig": {},
  "skills": {},
  "agents": {},
  "experimental": { "enableAgents": false },
  "advanced": {},
  "telemetry": {},
  "admin": {}
}
```

---

## 10. Google AI / Vertex AI Extensions

Gemini CLI does **not** natively integrate Google AI Extensions or Vertex AI Extensions as a built-in feature. However:

- A community extension exists (`gemini-cli-extensions/vertex`) that wraps Vertex AI prompt management as MCP tools
- Gemini CLI can connect to any Vertex AI-hosted MCP server via the `httpUrl` transport
- The extension gallery at `geminicli.com/extensions` serves as the marketplace/registry

---

## 11. Implications for Ptah's Gemini CLI Adapter

### Current Implementation Status

The existing `GeminiCliAdapter` in `libs/backend/llm-abstraction/src/lib/services/cli-adapters/gemini-cli.adapter.ts` already:

- Configures MCP server in `~/.gemini/settings.json` (ptah MCP entry)
- Trusts workspace folder via `~/.gemini/trustedFolders.json`
- Uses `--output-format stream-json` for structured output
- Uses `--yolo` for auto-approve in headless context
- Supports `--model` for model selection

### Opportunities for Enhancement

1. **`--extensions` flag**: Could pass pre-installed extensions by name when spawning
2. **Skills**: Could create `.gemini/skills/` in workspace with Ptah-specific skills
3. **Subagents**: Could define `.gemini/agents/` files for specialized sub-tasks
4. **Hooks**: Could configure `SessionStart` hooks to inject context programmatically
5. **Policies**: Could set up `.gemini/policies/` TOML files for safety guardrails
6. **`--allowed-mcp-server-names`**: Could whitelist only the ptah MCP server

### Recommended Priority

1. **MCP Servers** (already implemented) - Primary tool mechanism
2. **Context files (GEMINI.md)** - Inject project-specific instructions
3. **Skills** - Package complex workflows
4. **Policies** - Safety control in headless mode
5. **`--extensions` flag** - Enable specific extensions per invocation
6. **Subagents** - Advanced multi-agent orchestration (experimental)

---

## Sources

- [Gemini CLI Cheatsheet / CLI Reference](https://geminicli.com/docs/cli/cli-reference/)
- [Headless Mode Reference](https://geminicli.com/docs/cli/headless/)
- [Extension Reference](https://geminicli.com/docs/extensions/reference/)
- [Build Extensions Guide](https://geminicli.com/docs/extensions/writing-extensions/)
- [Extensions Overview](https://geminicli.com/docs/extensions/)
- [MCP Server Configuration](https://geminicli.com/docs/tools/mcp-server/)
- [Configuration Reference](https://geminicli.com/docs/reference/configuration/)
- [Agent Skills](https://geminicli.com/docs/cli/skills/)
- [Creating Skills](https://geminicli.com/docs/cli/creating-skills/)
- [Subagents (Experimental)](https://geminicli.com/docs/core/subagents/)
- [Hooks Reference](https://geminicli.com/docs/hooks/reference/)
- [Policy Engine](https://geminicli.com/docs/reference/policy-engine/)
- [GEMINI.md Context Files](https://geminicli.com/docs/cli/gemini-md/)
- [Extensions Gallery](https://geminicli.com/extensions/)
- [GitHub: --extensions flag issue #8752](https://github.com/google-gemini/gemini-cli/issues/8752)
- [GitHub: gemini-cli repository](https://github.com/google-gemini/gemini-cli)
- [Google Developers Blog: Extensions](https://developers.googleblog.com/making-gemini-cli-extensions-easier-to-use/)
- [Google Developers Blog: Hooks](https://developers.googleblog.com/tailor-gemini-cli-to-your-workflow-with-hooks/)
