# Research Report: Gemini CLI Session Management System

## Executive Summary

**Research Classification**: TECHNICAL DEEP-DIVE
**Confidence Level**: 90% (based on 20+ sources including official docs, GitHub issues/PRs, source code analysis)
**Key Insight**: Gemini CLI has a fully functional session management system that automatically saves conversations, supports resumption by UUID or index, and -- critically for our VS Code extension -- emits the `session_id` in the `init` event of the `--output-format stream-json` JSONL stream. This means our existing `GeminiCliAdapter` already parses the event that contains the session ID, but currently discards it.

---

## 1. Session Storage

### 1.1 Storage Location

Sessions are stored at:

```
~/.gemini/tmp/<project_hash>/chats/
```

Where `<project_hash>` is a deterministic hash derived from the project's root directory (the `cwd` where Gemini CLI was invoked). This means sessions are **project-scoped** -- switching directories switches session history.

On Windows, this resolves to:

```
C:\Users\<username>\.gemini\tmp\<project_hash>\chats\
```

### 1.2 Session File Naming

Session files follow the pattern:

```
session-<ISO-timestamp>-<short-hash>.json
```

Example:

```
session-2025-09-18T02-45-3b44bc68.json
```

The `<short-hash>` is an 8-character hex string that serves as the unique session identifier fragment.

### 1.3 Session File Format

**Current format: Monolithic JSON**

Each session file is a single JSON file containing the complete conversation. The structure includes:

```json
{
  "role": "user" | "model",
  "parts": [
    { "text": "..." }
  ]
}
```

Each message object represents a conversation turn with a `role` and `parts` array containing the message content. The file also includes metadata about tool executions, token usage, and reasoning traces.

**Known performance issue**: The current format uses a "read-modify-rewrite" cycle where every new message triggers a full rewrite of the session file. For large sessions (~400MB), this causes ~6.8 seconds per message write.

**Proposed future format: JSONL** (GitHub Issue #15292)

There is an active proposal to switch to JSONL (JSON Lines) format with three record types:

```jsonl
{"type": "session_metadata", "session_id": "...", "created_at": "..."}
{"type": "user", "id": "msg_001", "content": "..."}
{"type": "gemini", "id": "msg_002", "content": "..."}
{"type": "message_update", "id": "msg_002", "tokens": {...}}
```

This would make writes append-only (O(1)) instead of O(N). Not yet implemented as of the research date.

### 1.4 Session ID Format

The session ID used in CLI flags like `--resume <UUID>` follows the standard UUID format:

```
a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

This UUID is distinct from the filename pattern. The session listing (`--list-sessions`) shows both a numeric index and a hash/UUID for each session.

---

## 2. Resuming Sessions Programmatically

### 2.1 CLI Flags for Session Resumption

| Flag               | Usage                                                    | Description                                                                                   |
| ------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `--resume` or `-r` | `gemini --resume`                                        | Resume the most recent session                                                                |
| `--resume <index>` | `gemini --resume 5`                                      | Resume by session index (1-based, from `--list-sessions`)                                     |
| `--resume <UUID>`  | `gemini --resume a1b2c3d4-...`                           | Resume by full session UUID                                                                   |
| `--list-sessions`  | `gemini --list-sessions`                                 | Display all sessions for the current project (index, hash, date, message count, first prompt) |
| `--delete-session` | `gemini --delete-session 1` or `--delete-session <UUID>` | Remove a session by index or UUID                                                             |

### 2.2 Programmatic Resumption (Spawn with --resume)

To resume a Gemini CLI session from a VS Code extension:

```typescript
// Resume a specific session by its UUID
const args = [
  '--resume',
  sessionUuid, // e.g., 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
  '--output-format',
  'stream-json',
  '--yolo',
];

const child = spawnCli('gemini', args, { cwd: workingDirectory });
```

The `--resume` flag is compatible with `--output-format stream-json` and `--yolo`, meaning you can resume a session in headless mode with structured output.

### 2.3 Interactive Commands (Not Relevant for Programmatic Use)

Inside an interactive Gemini CLI session, these slash commands exist:

- `/resume` -- Opens the interactive Session Browser (not usable in headless mode)
- `/chat save [name]` -- Save a named checkpoint
- `/chat resume [name]` -- Resume a named checkpoint
- `/chat list` -- List named checkpoints
- `/chat delete [name]` -- Delete a named checkpoint

These are only useful for human-interactive sessions, not for programmatic spawning.

---

## 3. Getting the Session ID from Running/Completed Sessions

### 3.1 From Stream-JSON Output (PRIMARY METHOD)

When spawning Gemini CLI with `--output-format stream-json`, the **first event** in the JSONL stream is the `init` event, which contains the `session_id`:

```json
{ "type": "init", "timestamp": "2025-10-10T12:00:00.000Z", "session_id": "abc123", "model": "gemini-2.0-flash-exp" }
```

**This is the definitive method for capturing the session ID programmatically.**

The `session_id` field was added in PR #14504 (merged December 2025), specifically to support headless mode workflows and multi-step automation. The corresponding issue (#14435) was created precisely for our use case: "Gemini Headless Mode JSON Output must mention Session ID for later resume."

### 3.2 From JSON Output (Single Response)

When using `--output-format json` (non-streaming), the response object also includes `session_id`:

```json
{
  "session_id": "abc123",
  "response": "...",
  "stats": {
    "input_tokens": 150,
    "output_tokens": 300,
    "duration_ms": 2500
  }
}
```

### 3.3 From File System (FRAGILE -- NOT RECOMMENDED)

Session files in `~/.gemini/tmp/<project_hash>/chats/` can be listed to discover sessions. However, the `<project_hash>` is not documented publicly and would need to be reverse-engineered. This approach is fragile and unnecessary given the `init` event method.

### 3.4 From --list-sessions (Batch Discovery)

Running `gemini --list-sessions` outputs a table with:

- **Index**: Numeric position (1, 2, 3...)
- **Hash/UUID**: Unique session identifier
- **Date**: When the session was created
- **Message Count**: Number of conversation turns
- **Preview**: First user message text

This could be parsed programmatically for session discovery, but is not needed for the capture-and-resume workflow.

---

## 4. Complete Stream-JSON Event Schema

### 4.1 Event Types

The `--output-format stream-json` flag produces a JSONL stream with 6 event types:

#### init (First Event)

```json
{
  "type": "init",
  "timestamp": "2025-10-10T12:00:00.000Z",
  "session_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "model": "gemini-2.5-pro"
}
```

- Always the first event in the stream
- Contains the session_id needed for later resumption
- Contains the model name being used

#### message (Content Chunks)

```json
{
  "type": "message",
  "role": "user" | "assistant",
  "content": "text content here"
}
```

- Emitted for both user prompts and assistant responses
- Content may be chunked (multiple message events for one response)

#### tool_use (Tool Call Requests)

```json
{
  "type": "tool_use",
  "tool_name": "read_file",
  "tool_input": { "path": "/src/index.ts" },
  "tool_call_id": "call_abc123"
}
```

- Emitted when the model requests a tool execution
- `tool_input` contains the arguments for the tool

#### tool_result (Tool Execution Results)

```json
{
  "type": "tool_result",
  "tool_call_id": "call_abc123",
  "output": "file contents here...",
  "status": "success" | "error"
}
```

- Emitted after a tool completes execution
- Contains the output and success/error status

#### error (Non-Fatal Errors)

```json
{
  "type": "error",
  "message": "Rate limit exceeded",
  "code": 429
}
```

- Non-fatal warnings and system errors
- Does not terminate the session

#### result (Final Event)

```json
{
  "type": "result",
  "response": "Final text response...",
  "stats": {
    "input_tokens": 1500,
    "output_tokens": 800,
    "duration_ms": 15000
  }
}
```

- Always the last event in the stream
- Contains aggregated statistics for the entire session

---

## 5. Configuration Options

### 5.1 Session Retention (settings.json)

Located at `~/.gemini/settings.json`:

```json
{
  "general": {
    "sessionRetention": {
      "enabled": true,
      "maxAge": "30d",
      "maxCount": 50,
      "minRetention": "1d",
      "warningAcknowledged": false
    }
  },
  "model": {
    "maxSessionTurns": 100
  }
}
```

| Setting                         | Type    | Default   | Description                                                      |
| ------------------------------- | ------- | --------- | ---------------------------------------------------------------- |
| `sessionRetention.enabled`      | boolean | `false`   | Enable automatic session cleanup                                 |
| `sessionRetention.maxAge`       | string  | undefined | Delete sessions older than this (e.g., "30d", "7d", "24h", "1w") |
| `sessionRetention.maxCount`     | number  | undefined | Keep only the N most recent sessions                             |
| `sessionRetention.minRetention` | string  | `"1d"`    | Safety floor -- never delete sessions younger than this          |
| `model.maxSessionTurns`         | number  | `-1`      | Maximum turns per session (-1 = unlimited)                       |

### 5.2 Version Requirements

Session management is available and **on by default** starting from Gemini CLI **v0.20.0+**. The `session_id` field in JSON output was added in **v0.25.0+** (PR #14504, December 2025).

---

## 6. Implementation Plan for Ptah Extension

### 6.1 Current State of Our GeminiCliAdapter

Our `GeminiCliAdapter` at `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\gemini-cli.adapter.ts` already:

1. Spawns Gemini CLI with `--output-format stream-json`
2. Parses all 6 JSONL event types in `handleJsonLine()`
3. Handles the `init` event (currently extracts `model` but **ignores `session_id`**)
4. Emits structured `CliOutputSegment` objects via `onSegment`

### 6.2 Changes Required to Capture Session ID

**Minimal change in handleJsonLine() for the `init` case:**

The adapter already parses the `init` event and has the `GeminiStreamEvent` interface with `session_id?: string`. The fix is to:

1. Store the captured `session_id` on the adapter instance or expose it through the `SdkHandle`
2. Emit it as a structured segment so consumers can capture it

Specifically, in the `case 'init':` block (line 426-430), the `event.session_id` value is available but not used. It should be:

- Stored in a variable accessible to the caller
- Emitted as a segment with a new type (e.g., `'session-id'`) or as metadata on the `SdkHandle`

**Option A: Add sessionId to SdkHandle**

Extend the `SdkHandle` interface with an optional `sessionId` property:

```typescript
export interface SdkHandle {
  readonly abort: AbortController;
  readonly done: Promise<number>;
  readonly onOutput: (callback: (data: string) => void) => void;
  readonly onSegment?: (callback: (segment: CliOutputSegment) => void) => void;
  /** CLI-native session ID for resumption (Gemini CLI only currently) */
  readonly sessionId?: string | Promise<string | undefined>;
}
```

**Option B: Emit session_id as a CliOutputSegment**

Add a `'session-init'` segment type that carries the session_id:

```typescript
// In handleJsonLine, case 'init':
if (event.session_id) {
  emitSegment({ type: 'session-init', content: event.session_id });
}
```

**Option A is recommended** because the session ID is metadata about the process, not output content. It should be a first-class property on the handle.

### 6.3 Changes Required for Session Resumption

Add `resumeSessionId` to `CliCommandOptions`:

```typescript
export interface CliCommandOptions {
  readonly task: string;
  readonly workingDirectory: string;
  // ... existing fields ...
  /** Session ID to resume (Gemini CLI: UUID passed to --resume) */
  readonly resumeSessionId?: string;
}
```

Then in `GeminiCliAdapter.runSdk()`, add the `--resume` flag when `resumeSessionId` is provided:

```typescript
const args = ['--prompt=', '--output-format', 'stream-json', '--yolo'];

if (options.resumeSessionId) {
  args.push('--resume', options.resumeSessionId);
}

if (options.model) {
  args.push('--model', options.model);
}
```

### 6.4 End-to-End Flow

```
1. User starts a task via Ptah
2. AgentProcessManager spawns Gemini CLI with --output-format stream-json
3. GeminiCliAdapter parses the first JSONL event (init)
4. init event contains: {"type":"init","session_id":"abc-uuid-123","model":"gemini-2.5-pro"}
5. Adapter stores session_id and exposes it on SdkHandle
6. AgentProcessManager stores the sessionId in TrackedAgent metadata
7. Session completes, Gemini CLI exits
8. Later: User wants to resume or Ptah needs follow-up
9. AgentProcessManager spawns Gemini CLI with --resume abc-uuid-123
10. Gemini CLI restores full conversation context and continues
```

---

## 7. Risk Analysis

### 7.1 Low Risk: session_id Availability

The `session_id` field in stream-json output was added in December 2025 (PR #14504) and is now part of the stable Gemini CLI release. It is tested and documented. Risk of regression is low.

**Mitigation**: Version-check Gemini CLI during detection. If version < 0.25.0, disable session resumption features.

### 7.2 Low Risk: --resume Compatibility with --output-format

The `--resume` flag is compatible with `--output-format stream-json` and `--yolo`. This combination works in headless mode.

**Mitigation**: Test the combination during CI with a smoke test.

### 7.3 Medium Risk: Session File Retention

If the user has `sessionRetention.enabled: true` with aggressive cleanup (e.g., `maxAge: "1d"`), sessions may be deleted before Ptah attempts to resume them.

**Mitigation**: When storing a session ID for later resumption, also store the timestamp. Before attempting `--resume`, check if enough time has passed that the session might have been cleaned up. Show a user-friendly error if resumption fails.

### 7.4 Low Risk: Project-Scoped Sessions

Sessions are scoped to the project directory (via `<project_hash>`). Resuming a session requires spawning Gemini CLI from the same `cwd` where the original session was created.

**Mitigation**: Our `GeminiCliAdapter` already receives `workingDirectory` in `CliCommandOptions` and passes it as `cwd`. As long as we use the same working directory for resumption, this is a non-issue.

### 7.5 Medium Risk: JSONL Format Migration

The proposed JSONL storage format (Issue #15292) could change session file internals. However, since we only interact with sessions through CLI flags (`--resume`, `--list-sessions`) and stream-json output (not by reading session files directly), this migration would be transparent to us.

**Mitigation**: Do not read session files directly. Always use CLI flags.

---

## 8. Comparison with Other CLI Session Management

| Feature                      | Gemini CLI                                    | Claude CLI                          | Copilot CLI                                |
| ---------------------------- | --------------------------------------------- | ----------------------------------- | ------------------------------------------ |
| Automatic session saving     | Yes (v0.20.0+)                                | Yes (always)                        | No                                         |
| Session resume by ID         | `--resume <UUID>`                             | `--resume` (latest only)            | No                                         |
| Session ID in output         | Yes (stream-json `init` event)                | Not in stdout (file-based only)     | No                                         |
| Session storage              | `~/.gemini/tmp/<hash>/chats/`                 | `~/.claude/projects/<hash>/`        | No persistent sessions                     |
| Structured event stream      | Yes (JSONL via `--output-format stream-json`) | JSONL in session files (not stdout) | No                                         |
| MCP-compatible headless mode | Yes (`--yolo` + `--output-format`)            | Yes (`--print` + MCP)               | Yes (`--yolo` + `--additional-mcp-config`) |

**Gemini CLI has the most programmatically accessible session management of the three CLIs we support.**

---

## 9. Sources

### Primary Sources (Official)

1. [Session Management Documentation](https://geminicli.com/docs/cli/session-management/) - Official Gemini CLI session management reference
2. [Headless Mode Reference](https://geminicli.com/docs/cli/headless/) - Structured output format documentation
3. [CLI Commands Reference](https://google-gemini.github.io/gemini-cli/docs/cli/commands.html) - Complete CLI command listing
4. [Configuration Reference](https://geminicli.com/docs/reference/configuration/) - settings.json options
5. [Session Management Tutorial](https://geminicli.com/docs/cli/tutorials/session-management/) - Step-by-step tutorial
6. [Google Developers Blog: Session Management](https://developers.googleblog.com/pick-up-exactly-where-you-left-off-with-session-management-in-gemini-cli/) - Official announcement

### GitHub Issues and PRs

7. [Issue #8944: Provide easy way to retrieve session_id](https://github.com/google-gemini/gemini-cli/issues/8944) - Original feature request (closed, not planned; superseded by #14435)
8. [Issue #13823: Return session_id for programmatic clients](https://github.com/google-gemini/gemini-cli/issues/13823) - P1 feature request for non-interactive session ID
9. [Issue #14435: Headless JSON must mention session ID](https://github.com/google-gemini/gemini-cli/issues/14435) - Closed as completed (implemented)
10. [PR #14504: Adding session_id to JSON output](https://github.com/google-gemini/gemini-cli/pull/14504) - Merged implementation
11. [Issue #15292: Switch to JSONL for session storage](https://github.com/google-gemini/gemini-cli/issues/15292) - Proposed format change
12. [Issue #19379: Show resume message on exit](https://github.com/google-gemini/gemini-cli/issues/19379) - UX improvement (open)
13. [Issue #8203: Add stream-json output format](https://github.com/google-gemini/gemini-cli/issues/8203) - Implemented (closed)

### Source Code References (Internal)

14. `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\gemini-cli.adapter.ts` - Current Gemini CLI adapter
15. `D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\cli-adapter.interface.ts` - Adapter interfaces (SdkHandle, CliCommandOptions)
16. `D:\projects\ptah-extension\docs\research-cli-session-linking-architecture.md` - Existing session linking research

### Secondary Sources

17. [Habr: Step-by-Step Guide to Gemini CLI Session Management](https://habr.com/en/articles/977390/)
18. [DEV.to: Gemini CLI Hidden Features - Automatic Session Saving](https://dev.to/proflead/gemini-cli-hidden-features-automatic-session-saving-1267)
19. [GitHub Discussion #4974: Chat Storage and Evaluation](https://github.com/google-gemini/gemini-cli/discussions/4974)
20. [Session Management source doc on GitHub](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/session-management.md)
