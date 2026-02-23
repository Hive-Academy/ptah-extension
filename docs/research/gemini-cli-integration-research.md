# Gemini CLI Integration Research Report

**Research Date**: 2026-02-23
**Confidence Level**: 92% (based on 20+ primary sources including official docs, GitHub source, and DeepWiki analysis)
**Key Insight**: Gemini CLI has first-class headless/non-interactive support with structured JSON streaming output, making it highly suitable for programmatic VS Code extension integration -- comparable to Claude CLI but with different protocols.

---

## 1. Interactive Mode vs Headless Mode

### Mode Selection

Gemini CLI determines execution mode during initialization based on **TTY detection** and input availability. The decision occurs in the `main()` function after configuration loading.

**Interactive Mode** (default when TTY detected):

- Full React-based terminal UI with rich rendering
- User types prompts, sees formatted output with ANSI codes
- Supports slash commands (`/resume`, `/memory`, `/compress`, `/chat`)
- Keyboard shortcuts (Ctrl+Y to toggle YOLO mode)

**Headless Mode** (non-interactive) activates when:

1. stdin is **not a TTY** (piped input)
2. The `--prompt` or `-p` flag is used
3. A positional argument is provided without the `--prompt-interactive` flag

### Input Sources (precedence order)

1. **Stdin pipe**: Reads piped data until EOF (`cat file.txt | gemini "summarize this"`)
2. **--prompt / -p flag**: Direct prompt text (`gemini -p "explain this code"`)
3. **Positional argument**: `gemini "what is 2+2"`
4. **--resume flag**: Loads previous conversation state

### Key Flags for Non-Interactive Use

| Flag                          | Short | Description                                   |
| ----------------------------- | ----- | --------------------------------------------- |
| `--prompt <text>`             | `-p`  | Run single prompt, exit after response        |
| `--prompt-interactive <text>` | `-i`  | Start interactive session with initial prompt |
| `--output-format <fmt>`       |       | `text`, `json`, or `stream-json`              |
| `--yolo`                      |       | Auto-approve all tool calls                   |
| `--approval-mode <mode>`      |       | `default`, `auto_edit`, or `yolo`             |
| `--sandbox`                   | `-s`  | Enable sandboxed execution                    |
| `--model <name>`              | `-m`  | Specify model                                 |
| `--allowed-tools <list>`      |       | Comma-separated tool whitelist                |
| `--checkpointing`             |       | Enable git-based checkpointing                |

---

## 2. Built-In Tools / Function Calling

Gemini CLI ships with a comprehensive set of built-in tools that the model can invoke autonomously:

### File System Tools

| Tool Name             | Description                                           |
| --------------------- | ----------------------------------------------------- |
| `read_file`           | Reads content of a specific file                      |
| `read_many_files`     | Reads multiple files or directories at once           |
| `write_file`          | Creates or overwrites a file with new content         |
| `replace`             | Performs precise edits within a file (search/replace) |
| `list_directory`      | Lists files and subdirectories                        |
| `glob`                | Finds files matching a glob pattern                   |
| `search_file_content` | Searches for text within files (grep/ripgrep)         |

### Execution Tools

| Tool Name           | Description                           |
| ------------------- | ------------------------------------- |
| `run_shell_command` | Executes shell commands on the system |

### Information Gathering Tools

| Tool Name           | Description                                |
| ------------------- | ------------------------------------------ |
| `web_fetch`         | Retrieves and processes content from URLs  |
| `google_web_search` | Performs Google Search for up-to-date info |

### Agent Coordination Tools

| Tool Name           | Description                                   |
| ------------------- | --------------------------------------------- |
| `ask_user`          | Requests clarification via interactive dialog |
| `save_memory`       | Stores facts to long-term memory (GEMINI.md)  |
| `write_todos`       | Manages subtask lists for complex plans       |
| `activate_skill`    | Loads specialized procedural expertise        |
| `get_internal_docs` | Accesses Gemini CLI's own documentation       |

### User-Triggered Shortcuts

- **`@` prefix**: `@path/to/file` triggers `read_many_files`
- **`!` prefix**: `!ls -la` triggers `run_shell_command`

### Tool Control

Tools can be whitelisted/blacklisted:

- CLI: `--allowed-tools read_file,write_file,run_shell_command`
- Settings: `tools.allowed` and `tools.exclude` arrays in `settings.json`

---

## 3. Sandbox Mode

Gemini CLI provides two sandboxing mechanisms:

### Container-based Sandbox (Docker/Podman) -- Cross-platform

- Complete process isolation via Docker or Podman containers
- All system-modifying operations (`write_file`, `run_shell_command`, `replace`) execute inside the container
- Requires building a sandbox image locally or using an organizational registry image

### macOS Seatbelt (macOS only)

Lightweight approach using `sandbox-exec` with configurable profiles:

| Profile                     | Write Restrictions  | Network   |
| --------------------------- | ------------------- | --------- |
| `permissive-open` (default) | Outside project dir | Allowed   |
| `permissive-proxied`        | Outside project dir | Via proxy |
| `restrictive-open`          | Strict              | Allowed   |
| `restrictive-proxied`       | Strict              | Via proxy |
| `strict-open`               | Read + write        | Allowed   |
| `strict-proxied`            | Read + write        | Via proxy |

### Enabling Sandbox

Priority order:

1. **CLI flag**: `-s` or `--sandbox`
2. **Environment variable**: `GEMINI_SANDBOX=true|docker|podman|sandbox-exec`
3. **Settings file**: `"tools": { "sandbox": true }` in `settings.json`

**Important**: `--yolo` mode enables sandbox by default as a safety measure.

### Environment Variables for Sandbox

```bash
GEMINI_SANDBOX=true                    # Enable (auto-detect Docker/Podman)
GEMINI_SANDBOX=docker                  # Force Docker
GEMINI_SANDBOX=podman                  # Force Podman
SEATBELT_PROFILE=restrictive-open      # macOS profile selection
SANDBOX_FLAGS="--security-opt label=disable"  # Custom container flags
SANDBOX_SET_UID_GID=true               # Force host UID/GID mapping (Linux)
```

---

## 4. Session Management

### Automatic Session Saving

Every interaction is automatically saved in the background. Sessions store at:

```
~/.gemini/tmp/<project_hash>/chats/
```

Each session records:

- Complete conversation history (prompts + responses)
- Tool executions (inputs and outputs)
- Token usage statistics

### Resuming Sessions

**From CLI**:

```bash
gemini --resume              # Resume most recent session
gemini --resume 1            # Resume by index (from --list-sessions)
gemini --resume a1b2c3d4-... # Resume by UUID
gemini --list-sessions       # List available sessions
```

**From Interactive Mode**:

- `/resume` command opens Session Browser with search, scroll, select, and delete

### Session Configuration

```json
{
  "general": {
    "sessionRetention": {
      "enabled": true,
      "maxAge": "30d",
      "maxCount": 50
    }
  },
  "model": {
    "maxSessionTurns": -1 // -1 = unlimited, positive number = limit
  }
}
```

### Checkpointing

When enabled (`--checkpointing`), each file-modifying tool call creates a checkpoint containing:

- Git snapshot of the complete project state
- The entire conversation up to that point
- The specific tool call being executed

This enables rollback via `/undo` during interactive sessions.

### Programmatic Session Access

Sessions are stored as JSONL files and can be read programmatically. The `--resume` flag in headless mode restores full conversation context, allowing multi-turn automation workflows.

**Limitation**: As of late 2025, stdin and positional arguments don't fully work with `--resume` flag (GitHub issue #14180), meaning you cannot easily send follow-up messages to a resumed session in headless mode.

---

## 5. Output Format

### Text Output (default)

- Streamed to stdout with ANSI escape codes for formatting
- Contains markdown-formatted responses
- Tool call outputs interleaved with model responses
- Not suitable for programmatic parsing

### JSON Output (`--output-format json`)

Returns a **single JSON object** after completion:

```json
{
  "response": "The model's final answer as a string",
  "stats": {
    "tokenUsage": { "input": 150, "output": 200 },
    "apiLatency": 1234
  },
  "error": {
    "type": "ERROR_TYPE",
    "message": "Error description",
    "code": 1
  }
}
```

- `response`: The model's final textual answer
- `stats`: Token usage and API latency metrics
- `error`: Present only if the request failed (optional)

### Streaming JSON Output (`--output-format stream-json`)

Returns **newline-delimited JSON (JSONL)** with real-time events:

| Event Type    | Description                               | When Emitted            |
| ------------- | ----------------------------------------- | ----------------------- |
| `init`        | Session metadata (session ID, model name) | At session start        |
| `message`     | User and assistant message chunks         | During conversation     |
| `tool_use`    | Tool call requests with arguments         | When model calls a tool |
| `tool_result` | Output from executed tools                | After tool execution    |
| `error`       | Non-fatal warnings and system errors      | On recoverable errors   |
| `result`      | Final outcome with aggregated statistics  | At session end          |

The `StreamJsonFormatter` emits events via `emitEvent()` for each conversation milestone.

### Implementation Note

There have been reports (GitHub issues #8022, #9009) that `--output-format` may not be recognized in some CLI versions. This appears to be version-dependent -- ensure you're on a recent version.

### Persistent Output Configuration

In `settings.json`:

```json
{
  "output": {
    "format": "json" // "text" (default) or "json"
  }
}
```

---

## 6. Exit Codes and Error Handling

### Exit Code Table

| Code | Constant                     | Meaning                                       |
| ---- | ---------------------------- | --------------------------------------------- |
| 0    | `SUCCESS`                    | Normal completion                             |
| 1    | General error                | API failure or unhandled error                |
| 41   | `FATAL_AUTHENTICATION_ERROR` | Auth failed or not configured                 |
| 42   | `FATAL_INPUT_ERROR`          | Invalid prompt, file not found, bad arguments |
| 52   | `CANCELLATION`               | User cancelled via Ctrl+C                     |
| 53   | `MAX_TURNS_EXCEEDED`         | Turn limit (`maxSessionTurns`) exceeded       |
| 54   | `TOOL_EXECUTION_ERROR`       | Critical tool execution failure               |

### Internal Event Processing

The turn processing loop handles events from an async generator yielding `ServerGeminiStreamEvent` objects:

| Event Type                              | Action                      |
| --------------------------------------- | --------------------------- |
| `GeminiEventType.Content`               | Write to output formatter   |
| `GeminiEventType.ToolCallRequest`       | Add to `toolCallRequests[]` |
| `GeminiEventType.Error`                 | Throw error                 |
| `GeminiEventType.AgentExecutionStopped` | Exit loop                   |
| `GeminiEventType.AgentExecutionBlocked` | Log warning, continue       |

### Error Output

- **JSON mode**: Errors appear in the `error` field of the JSON response
- **Text mode**: Errors written to stderr
- **Stream-JSON mode**: `error` events emitted as JSONL lines

---

## 7. Configuration

### Configuration Hierarchy (highest to lowest precedence)

1. **Command-line arguments** (highest)
2. **Environment variables**
3. **System settings file** (`/etc/gemini-cli/settings.json`)
4. **Project settings** (`.gemini/settings.json`)
5. **User settings** (`~/.gemini/settings.json`)
6. **System defaults** (`/etc/gemini-cli/system-defaults.json`)
7. **Hardcoded defaults** (lowest)

### Key Environment Variables

**Authentication**:

```bash
GEMINI_API_KEY          # API key for Gemini
GOOGLE_API_KEY          # Google Cloud API key
GOOGLE_APPLICATION_CREDENTIALS  # Path to credentials JSON
GOOGLE_CLOUD_PROJECT    # GCP Project ID
GOOGLE_CLOUD_LOCATION   # GCP location (e.g., us-central1)
```

**Model and Behavior**:

```bash
GEMINI_MODEL            # Default model to use
GEMINI_SANDBOX          # Enable sandboxing (true/docker/podman)
NO_COLOR                # Disable colored output
DEBUG=1                 # Enable verbose logging
```

**Telemetry**:

```bash
GEMINI_TELEMETRY_ENABLED
GEMINI_TELEMETRY_TARGET
GEMINI_TELEMETRY_OTLP_ENDPOINT
GEMINI_CLI_ACTIVITY_LOG_TARGET  # JSONL activity log file path
```

### Settings.json Structure

```json
{
  "general": {
    "checkpointing": { "enabled": true },
    "sessionRetention": { "enabled": true, "maxAge": "30d", "maxCount": 50 }
  },
  "output": {
    "format": "text"
  },
  "model": {
    "name": "gemini-2.5-pro",
    "maxSessionTurns": -1,
    "summarizeToolOutput": {},
    "chatCompression": { "contextPercentageThreshold": 0.7 }
  },
  "context": {
    "fileName": "GEMINI.md",
    "discoveryMaxDirs": 200,
    "fileFiltering": {
      "respectGitIgnore": true,
      "respectGeminiIgnore": true
    }
  },
  "tools": {
    "sandbox": false,
    "shell": { "enableInteractiveShell": false },
    "allowed": [],
    "exclude": []
  },
  "security": {
    "folderTrust": { "enabled": true },
    "auth": { "selectedType": "", "enforcedType": "", "useExternal": false }
  },
  "mcpServers": {},
  "telemetry": { "enabled": false }
}
```

### .env File Loading Order

1. `.env` in current working directory
2. Parent directories (up to project root or home)
3. `~/.env` in home directory
4. `.gemini/.env` (bypasses exclusion rules)

### Context Files (GEMINI.md)

Hierarchical loading similar to Claude's CLAUDE.md:

1. **Global**: `~/.gemini/GEMINI.md`
2. **Project + ancestors**: Upward search to `.git` or home
3. **Subdirectories**: Downward scan (limited to 200 dirs by default)

---

## 8. MCP (Model Context Protocol) Support

Gemini CLI has **full MCP client support** -- it can connect to external MCP servers and use their tools.

### Transport Mechanisms

| Transport          | Config Key         | Description                                      |
| ------------------ | ------------------ | ------------------------------------------------ |
| **Stdio**          | `command` + `args` | Spawns subprocess, communicates via stdin/stdout |
| **SSE**            | `url`              | Connects to Server-Sent Events endpoint          |
| **HTTP Streaming** | `httpUrl`          | Connects to streamable HTTP endpoint             |

### Configuration in settings.json

```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["path/to/server.js"],
      "env": { "API_KEY": "$MY_API_TOKEN" },
      "cwd": "./directory",
      "timeout": 30000,
      "trust": false,
      "includeTools": ["tool_a", "tool_b"],
      "excludeTools": ["dangerous_tool"]
    },
    "remote-server": {
      "url": "http://localhost:8080/sse",
      "headers": { "Authorization": "Bearer $TOKEN" }
    },
    "http-server": {
      "httpUrl": "https://api.example.com/mcp"
    }
  }
}
```

### MCP Management CLI

```bash
gemini mcp add <name> <commandOrUrl> [args...]   # Add server
gemini mcp add --transport http http-srv https://api.example.com/mcp
gemini mcp add --transport sse sse-srv https://api.example.com/sse
gemini mcp add -e API_KEY=123 -s user my-srv python server.py
gemini mcp list                                    # List all servers
gemini mcp remove <name>                           # Remove server
gemini mcp enable <name>                           # Enable disabled server
gemini mcp disable <name>                          # Disable without removing
```

### Tool Management

- `includeTools`: Allowlist specific tools by name
- `excludeTools`: Blocklist specific tools (takes precedence over include)
- Tool naming: Auto-sanitized, conflicts resolved via `serverName__toolName` prefixing
- Names exceeding 63 characters are truncated

### OAuth 2.0 Authentication for Remote MCP Servers

- Dynamic OAuth discovery with browser-based auth flow
- Tokens stored at `~/.gemini/mcp-oauth-tokens.json`
- Auto-refresh on expiry
- Supports Google ADC and service account impersonation

### MCP Prompts as Slash Commands

MCP servers can expose prompts that become slash commands:

```bash
/poem-writer --title="Gemini CLI" --mood="reverent"
```

### Key Insight for Ptah Integration

Gemini CLI can connect to Ptah's existing MCP server (`vscode-lm-tools`) using stdio transport. This means Gemini CLI agents could use Ptah's workspace, search, symbols, diagnostics, git, AI, files, and commands APIs natively.

---

## 9. Non-Interactive Automation Flags -- Complete Reference

### Essential Automation Flags

| Flag                           | Description                           |
| ------------------------------ | ------------------------------------- |
| `--prompt <text>` / `-p`       | Single prompt, exit after response    |
| `--output-format json`         | Single JSON response object           |
| `--output-format stream-json`  | JSONL streaming events                |
| `--yolo`                       | Auto-approve all tool calls           |
| `--approval-mode yolo`         | Same as --yolo (unified syntax)       |
| `--approval-mode auto_edit`    | Auto-approve edits, prompt for others |
| `--sandbox` / `-s`             | Enable sandboxed execution            |
| `--model <name>` / `-m`        | Specify model                         |
| `--allowed-tools <list>`       | Comma-separated tool whitelist        |
| `--all-files` / `-a`           | Include all files as context          |
| `--include-directories <dirs>` | Multi-directory support (max 5)       |
| `--checkpointing`              | Enable git checkpointing              |
| `--resume [id]` / `-r`         | Resume previous session               |
| `--list-sessions`              | List available sessions               |
| `--debug` / `-d`               | Enable debug output                   |

### Authentication for Automation

Non-interactive mode requires pre-configured credentials (no interactive OAuth):

- `GEMINI_API_KEY` environment variable (simplest)
- Application Default Credentials (Google Cloud)
- Vertex AI credentials
- External auth server

### Piping Patterns

```bash
# Pipe file content
cat error.log | gemini "Explain why this failed"

# Pipe git diff
git diff | gemini "Write a commit message"

# Chain with jq for structured extraction
gemini --output-format json -p "List 5 colors" | jq -r '.response'

# Save streaming events
gemini --output-format stream-json -p "Analyze code" > events.jsonl
```

### Activity Logging for Debugging

```bash
GEMINI_CLI_ACTIVITY_LOG_TARGET=./debug.jsonl gemini -p "test"
```

Records all API interactions and tool executions as JSONL for debugging.

---

## Comparative Analysis: Gemini CLI vs Claude CLI for VS Code Integration

| Feature            | Gemini CLI                            | Claude CLI                       |
| ------------------ | ------------------------------------- | -------------------------------- |
| **Headless mode**  | Yes (`--prompt`, auto-detect non-TTY) | Yes (`--print`, `-p`)            |
| **JSON output**    | `--output-format json` (single)       | `--output-format json`           |
| **Streaming JSON** | `--output-format stream-json` (JSONL) | `--output-format stream-json`    |
| **Auto-approve**   | `--yolo`, `--approval-mode`           | `--dangerously-skip-permissions` |
| **Sandbox**        | Docker/Podman/Seatbelt                | Not built-in                     |
| **MCP client**     | Full support (stdio/SSE/HTTP)         | Full support (stdio/SSE)         |
| **Session resume** | `--resume` with UUID/index            | Limited                          |
| **Built-in tools** | 14+ (file, shell, web, search)        | Similar set                      |
| **Exit codes**     | 0, 1, 41, 42, 52, 53, 54              | 0, 1                             |
| **Context files**  | `GEMINI.md` (hierarchical)            | `CLAUDE.md` (hierarchical)       |
| **Turn limits**    | `maxSessionTurns` configurable        | Configurable                     |
| **Tool filtering** | `--allowed-tools`, include/exclude    | `--allowedTools`                 |

### Integration Architecture Recommendation

For Ptah's VS Code extension integration, the recommended approach:

1. **Spawn process**: Use Node.js `child_process.spawn('gemini', [...args])` with non-TTY stdin
2. **Use stream-json**: Parse JSONL events for real-time UI updates (message chunks, tool calls, results)
3. **Set approval mode**: Use `--yolo` or `--approval-mode auto_edit` with sandbox for safety
4. **Pass prompt via flag**: Use `-p "prompt text"` rather than stdin piping for reliability
5. **Set GEMINI_API_KEY**: Via environment variable in the spawn options
6. **Connect Ptah MCP server**: Configure `.gemini/settings.json` with Ptah's MCP server for workspace tools
7. **Parse exit codes**: Handle 0 (success), 41 (auth error), 42 (input error), 53 (turn limit), 54 (tool error)
8. **Activity logging**: Enable `GEMINI_CLI_ACTIVITY_LOG_TARGET` for debugging

### Key Risk: JSON Output Stability

GitHub issues #8022 and #9009 report that `--output-format` may not be recognized in some CLI versions. This is a risk for production integration -- version pinning and validation are recommended.

---

## Sources

### Primary (Official Documentation)

1. [Headless Mode Reference](https://geminicli.com/docs/cli/headless/) - Official headless mode documentation
2. [Gemini CLI Tools](https://geminicli.com/docs/tools/) - Built-in tools reference
3. [Sandboxing Guide](https://geminicli.com/docs/cli/sandbox/) - Sandbox configuration
4. [Session Management](https://geminicli.com/docs/cli/session-management/) - Session save/resume
5. [MCP Server Support](https://geminicli.com/docs/tools/mcp-server/) - MCP client configuration
6. [Automation Tutorial](https://geminicli.com/docs/cli/tutorials/automation/) - Scripting patterns
7. [Configuration Reference](https://google-gemini.github.io/gemini-cli/docs/get-started/configuration.html) - Full settings reference
8. [Authentication Setup](https://geminicli.com/docs/get-started/authentication/) - API key and auth methods

### Secondary (GitHub & Community)

9. [GitHub Repository](https://github.com/google-gemini/gemini-cli) - Source code and issues
10. [DeepWiki: Non-Interactive Mode](https://deepwiki.com/google-gemini/gemini-cli/3.8-ide-integration) - Internal architecture analysis
11. [DeepWiki: MCP Integration](https://deepwiki.com/google-gemini/gemini-cli/3.7-mcp-server-integration) - MCP deep dive
12. [JSON Output Issue #8022](https://github.com/google-gemini/gemini-cli/issues/8022) - Structured output discussions
13. [JSON Output Issue #9009](https://github.com/google-gemini/gemini-cli/issues/9009) - Output format compatibility
14. [Stream JSON Issue #8203](https://github.com/google-gemini/gemini-cli/issues/8203) - Stream-json format proposal
15. [Addy Osmani Tips](https://addyosmani.com/blog/gemini-cli/) - Practical usage patterns
16. [Phil Schmid Cheatsheet](https://www.philschmid.de/gemini-cli-cheatsheet) - Quick reference
17. [FastMCP Blog Post](https://developers.googleblog.com/gemini-cli-fastmcp-simplifying-mcp-server-development/) - MCP + FastMCP integration
18. [Resume Flag Issue #14180](https://github.com/google-gemini/gemini-cli/issues/14180) - stdin + resume limitation
