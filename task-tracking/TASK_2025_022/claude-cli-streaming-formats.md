# Claude CLI Streaming Formats Reference

**Last Updated**: 2025-11-23
**Claude CLI Version**: v0.3+ (with `--output-format stream-json` support)

---

## Overview

Claude CLI outputs data in **two distinct formats** depending on context:

1. **Real-Time Streaming** (stdout): Token-by-token with `--output-format stream-json --include-partial-messages`
2. **Session Files** (.jsonl): Complete message objects stored in `.claude_sessions/`

Understanding both formats is critical for implementing streaming and historical message loading.

---

## Format 1: Real-Time Streaming (stdout)

### CLI Invocation

```bash
claude \
  -p \
  --output-format stream-json \
  --verbose \
  --include-partial-messages \
  --model claude-sonnet-4-5-20250929
```

**Key Flags**:

- `-p`: Read message from stdin (NOT argument)
- `--output-format stream-json`: Output JSONL format
- `--verbose`: **REQUIRED** with `stream-json` (CLI requirement)
- `--include-partial-messages`: Enable token-by-token streaming events

### stdout Output Format

**Each line is a separate JSON object** (JSONL = JSON Lines):

```jsonl
{"type":"stream_event","event":{"type":"message_start","message":{"model":"claude-sonnet-4-5-20250929","id":"msg_01ABC..."}}}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}}
{"type":"stream_event","event":{"type":"message_stop"}}
{"type":"result","subtype":"success","duration_ms":1234,"total_cost_usd":0.0015,"usage":{"input_tokens":100,"output_tokens":50}}
```

### Message Types in Streaming Output

#### 1. System Messages (Initialization)

```json
{
  "type": "system",
  "subtype": "init",
  "session_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "model": "claude-sonnet-4-5-20250929",
  "tools": [...],
  "cwd": "/path/to/workspace"
}
```

**When**: First message in session
**Purpose**: Initialize session metadata

#### 2. Stream Events (--include-partial-messages)

```json
{
  "type": "stream_event",
  "event": {
    "type": "message_start",
    "message": {
      "model": "claude-sonnet-4-5-20250929",
      "id": "msg_01ABC123..."
    }
  },
  "session_id": "a1b2c3d4-..."
}
```

```json
{
  "type": "stream_event",
  "event": {
    "type": "content_block_delta",
    "index": 0,
    "delta": {
      "type": "text_delta",
      "text": "Hello"
    }
  }
}
```

```json
{
  "type": "stream_event",
  "event": {
    "type": "message_stop"
  }
}
```

**Event Types**:

- `message_start`: Begin assistant response
- `content_block_delta`: Incremental text chunks (word-by-word)
- `message_stop`: **CRITICAL** - End of streaming (parser.onMessageStop callback)

#### 3. Assistant Messages (Complete Content)

```json
{
  "type": "assistant",
  "message": {
    "model": "claude-sonnet-4-5-20250929",
    "id": "msg_01ABC123...",
    "role": "assistant",
    "content": [
      {
        "type": "text",
        "text": "I'll help you with that."
      },
      {
        "type": "tool_use",
        "id": "toolu_01XYZ789...",
        "name": "Read",
        "input": {
          "file_path": "/path/to/file.ts"
        }
      }
    ]
  }
}
```

**Key Insight**: `message.content` is an **array** containing text AND tool_use blocks together.

#### 4. Tool Messages (Execution Lifecycle)

**Tool Start**:

```json
{
  "type": "tool",
  "subtype": "start",
  "tool_call_id": "toolu_01XYZ789...",
  "tool": "Read",
  "args": {
    "file_path": "/path/to/file.ts"
  },
  "parent_tool_use_id": null
}
```

**Tool Result**:

```json
{
  "type": "tool",
  "subtype": "result",
  "tool_call_id": "toolu_01XYZ789...",
  "output": "File contents here..."
}
```

**Tool Error**:

```json
{
  "type": "tool",
  "subtype": "error",
  "tool_call_id": "toolu_01XYZ789...",
  "error": "File not found"
}
```

#### 5. Permission Messages (Tool Permission Requests)

```json
{
  "type": "permission",
  "subtype": "request",
  "tool_call_id": "toolu_01XYZ789...",
  "tool": "Bash",
  "args": {
    "command": "rm -rf /"
  },
  "description": "This command will delete all files recursively."
}
```

**User Response** (sent to CLI stdin):

```json
{
  "type": "permission",
  "subtype": "response",
  "tool_call_id": "toolu_01XYZ789...",
  "decision": "allow"
}
```

#### 6. Result Messages (Final Metrics)

```json
{
  "type": "result",
  "subtype": "success",
  "session_id": "a1b2c3d4-...",
  "duration_ms": 12345,
  "duration_api_ms": 10000,
  "num_turns": 5,
  "total_cost_usd": 0.0234,
  "usage": {
    "input_tokens": 1000,
    "output_tokens": 500,
    "cache_read_input_tokens": 5000,
    "cache_creation_input_tokens": 2000
  },
  "modelUsage": {
    "claude-sonnet-4-5-20250929": {
      "inputTokens": 1000,
      "outputTokens": 500,
      "cacheReadInputTokens": 5000,
      "cacheCreationInputTokens": 2000,
      "costUSD": 0.0234
    }
  }
}
```

**When**: End of CLI process (after `message_stop`)
**Purpose**: Cost tracking, performance metrics

---

## Format 2: Session Files (.jsonl)

### File Location

```
<workspace-root>/.claude_sessions/<session-id>.jsonl
```

**Example**: `.claude_sessions/a1b2c3d4-e5f6-7890-abcd-ef1234567890.jsonl`

### .jsonl File Format

**Each line = one complete message** (NOT streaming chunks):

```jsonl
{"type":"system","subtype":"init","session_id":"a1b2c3d4-...","model":"claude-sonnet-4-5-20250929","timestamp":"2025-11-23T10:00:00.000Z"}
{"parentUuid":null,"type":"user","message":{"role":"user","content":"Hello"},"uuid":"msg-user-001","timestamp":"2025-11-23T10:00:01.000Z"}
{"parentUuid":"msg-user-001","type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hi there!"}]},"uuid":"msg-asst-001","timestamp":"2025-11-23T10:00:03.000Z"}
```

### Session File Message Types

**User Message**:

```json
{
  "parentUuid": null,
  "type": "user",
  "message": {
    "role": "user",
    "content": "Implement user authentication"
  },
  "uuid": "317c2943-26cb-4254-8972-733ea3d889c2",
  "timestamp": "2025-11-20T10:23:13.347Z",
  "sessionId": "0a32ee44-4d5c-409a-8047-3ee94a591dcb",
  "cwd": "D:\\projects\\ptah-extension",
  "gitBranch": "feature/auth"
}
```

**Assistant Message (with contentBlocks)**:

```json
{
  "parentUuid": "317c2943-26cb-4254-8972-733ea3d889c2",
  "type": "assistant",
  "message": {
    "model": "claude-sonnet-4-5-20250929",
    "id": "msg_01ABC123...",
    "role": "assistant",
    "content": [
      {
        "type": "text",
        "text": "I'll implement authentication using JWT tokens."
      },
      {
        "type": "tool_use",
        "id": "toolu_01XYZ789...",
        "name": "Write",
        "input": {
          "file_path": "src/auth/auth.service.ts",
          "content": "export class AuthService { ... }"
        }
      }
    ],
    "stop_reason": "tool_use",
    "usage": {
      "input_tokens": 1234,
      "output_tokens": 567
    }
  },
  "uuid": "d73026fe-1ea3-4f88-8dbf-cc2d6e0e054d",
  "timestamp": "2025-11-20T10:23:17.847Z"
}
```

**Key Differences from Streaming**:

- Complete message objects (no deltas)
- UUID linking via `parentUuid`
- Session metadata embedded
- Full `usage` stats included

---

## Agent Detection Special Case

**Only Task tool creates agents**. Regular tools with `parent_tool_use_id` are NOT agents.

### Task Tool (Creates Agent)

```json
{
  "type": "tool",
  "subtype": "start",
  "tool_call_id": "toolu_01AGENT123",
  "tool": "Task",
  "args": {
    "subagent_type": "backend-developer",
    "description": "Implement user authentication service",
    "prompt": "Create AuthService with JWT support",
    "model": "claude-sonnet-4-5-20250929"
  }
}
```

**Parser Action**: Adds to `activeAgents` Map:

```typescript
// jsonl-stream-parser.ts lines 517-526
const metadata: AgentMetadata = {
  agentId: msg.tool_call_id,
  subagentType: 'backend-developer',
  description: 'Implement user authentication service',
  prompt: 'Create AuthService with JWT support',
  model: 'claude-sonnet-4-5-20250929',
  startTime: timestamp,
};
this.activeAgents.set(msg.tool_call_id, metadata);
```

### Regular Tool with parent_tool_use_id (NOT an Agent)

```json
{
  "type": "tool",
  "subtype": "start",
  "tool_call_id": "toolu_01READ456",
  "tool": "Read",
  "args": {
    "file_path": "src/auth/auth.service.ts"
  },
  "parent_tool_use_id": "toolu_01AGENT123"
}
```

**Parser Action**: Checks if `parent_tool_use_id` is in `activeAgents` Map:

```typescript
// jsonl-stream-parser.ts lines 599-609
const agent = this.activeAgents.get(parentToolUseId);
if (!agent) {
  // NOT an error - regular tools can have parent_tool_use_id without being agents
  // Only Task tools create agents tracked in activeAgents map
  // Silently skip correlation if parent is not an active agent
  return;
}
```

**Result**: Regular tool with `parent_tool_use_id` = "toolu_01AGENT123" emits `agent_activity` event because parent IS in `activeAgents`.

---

## When to Use Each Format

### Use Streaming Format (stdout) When:

- ✅ Implementing real-time chat UI
- ✅ Need word-by-word typing effect
- ✅ Showing live tool execution
- ✅ Detecting end of streaming (`message_stop` event)

**Implementation**: Parser callbacks in `claude-cli-launcher.ts`

### Use Session File Format (.jsonl) When:

- ✅ Loading historical sessions
- ✅ Displaying session list
- ✅ Exporting conversations
- ✅ Frontend needs direct file access (no backend needed)

**Implementation**: Frontend `ClaudeFileService` reads `.jsonl` directly via VS Code FileSystem API

---

## Parser Input vs Frontend File Reads

**Critical Distinction**:

### Parser Processes stdout (Streaming)

```typescript
// Backend: claude-cli-launcher.ts
childProcess.stdout.on('data', (chunk: Buffer) => {
  parser.processChunk(chunk); // ← Parser consumes stdout
});
```

**Output**: Parser callbacks (onContent, onThinking, onTool, etc.)

### Frontend Reads .jsonl Files (Historical)

```typescript
// Frontend: claude-file.service.ts
const fileUri = vscode.Uri.file(`.claude_sessions/${sessionId}.jsonl`);
const fileBytes = await vscode.workspace.fs.readFile(fileUri);
const lines = fileBytes.toString().split('\n');
const messages = lines.map((line) => JSON.parse(line));
```

**Output**: Array of complete `ProcessedClaudeMessage` objects

**No Overlap**: Parser never reads .jsonl files, Frontend never processes stdout.

---

## Example: Complete Streaming Flow

**CLI stdout**:

```jsonl
{"type":"system","subtype":"init","session_id":"abc123","model":"claude-sonnet-4-5-20250929"}
{"type":"stream_event","event":{"type":"message_start","message":{"id":"msg_01"}}}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"I'll"}}}
{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" help"}}}
{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"I'll help"},{"type":"tool_use","id":"toolu_01","name":"Read","input":{...}}]}}
{"type":"tool","subtype":"start","tool_call_id":"toolu_01","tool":"Read","args":{...}}
{"type":"tool","subtype":"result","tool_call_id":"toolu_01","output":"File contents..."}
{"type":"stream_event","event":{"type":"message_stop"}}
{"type":"result","subtype":"success","duration_ms":5000,"total_cost_usd":0.01}
```

**Parser Callbacks Triggered**:

1. `onSessionInit("abc123", "claude-sonnet-4-5-20250929")`
2. `onContent({ blocks: [{ type: 'text', text: "I'll" }] })`
3. `onContent({ blocks: [{ type: 'text', text: " help" }] })`
4. `onContent({ blocks: [{ type: 'text', text: "I'll help" }, { type: 'tool_use', id: "toolu_01", name: "Read", input: {...} }] })`
5. `onTool({ type: 'start', toolCallId: "toolu_01", tool: "Read", args: {...} })`
6. `onTool({ type: 'result', toolCallId: "toolu_01", output: "File contents..." })`
7. `onMessageStop()`
8. `onResult({ subtype: "success", duration_ms: 5000, total_cost_usd: 0.01, usage: {...} })`

---

## Summary Table

| Aspect                 | Streaming (stdout)                         | Session Files (.jsonl)             |
| ---------------------- | ------------------------------------------ | ---------------------------------- |
| **Format**             | JSONL (one object per line)                | JSONL (one message per line)       |
| **Content**            | Deltas + complete messages                 | Complete messages only             |
| **Real-time**          | Yes (token-by-token)                       | No (historical)                    |
| **Consumer**           | JSONLStreamParser (backend)                | ClaudeFileService (frontend)       |
| **Purpose**            | Real-time chat UX                          | Session loading, history           |
| **Enables**            | Word-by-word typing, live tools, thinking  | Session list, export, replay       |
| **message_stop event** | Yes (critical for detecting streaming end) | No (not needed)                    |
| **result message**     | Yes (cost/usage/duration)                  | Yes (embedded in last message)     |
| **Agent detection**    | Yes (Task tool → activeAgents Map)         | Yes (Task tool in message history) |

---

**Next Steps**: See `jsonl-stream-parser-integration.md` for parser callback patterns.
