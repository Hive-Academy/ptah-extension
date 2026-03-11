# Research: CLI Session Linking & Copilot SDK Integration

## Executive Summary

Two major enhancements investigated:

1. **Gemini CLI Session Linking** — The infrastructure is 95% in place. The Gemini CLI already emits `session_id` in its `init` JSONL event, and our `GeminiCliAdapter` already _parses_ it but _discards_ it. Adding session linking requires capturing this ID, persisting it in `SessionMetadata`, and passing `--resume <session_id>` on subsequent spawns. Estimated effort: ~6-8 hours.

2. **Copilot SDK Migration** — The `@github/copilot-sdk` (v0.1.29, Technical Preview) is a significant upgrade over CLI spawning. It provides typed streaming events (40+ types), programmatic permission hooks (`onPreToolUse`), session management with resume, custom tool injection, and crash recovery. It eliminates every pain point in the current `CopilotCliAdapter`. Estimated effort: ~16-24 hours for full migration.

---

## Part 1: Gemini CLI Session Linking

### 1.1 How Gemini CLI Sessions Work

**Storage**: `~/.gemini/tmp/<project_hash>/chats/`

- Project hash derived from workspace root directory
- Files named: `session-2025-09-18T02-45-3b44bc68.json`
- Format: Monolithic JSON with conversation turns (JSONL migration proposed in Issue #15292)

**Session ID in Streaming Output**:
When using `--output-format stream-json`, the **first event** is:

```json
{ "type": "init", "timestamp": "2025-10-10T12:00:00.000Z", "session_id": "abc123", "model": "gemini-2.5-pro" }
```

This was added in **PR #14504** (December 2025) specifically for programmatic headless workflows.

**Resume CLI Flags**:
| Flag | Example | Purpose |
|------|---------|---------|
| `--resume` | `gemini --resume` | Resume most recent session |
| `--resume <UUID>` | `gemini --resume a1b2c3d4` | Resume by session UUID |
| `--resume <index>` | `gemini --resume 5` | Resume by index |
| `--list-sessions` | `gemini --list-sessions` | List all sessions |

**Key fact**: `--resume` is **compatible** with `--output-format stream-json` and `--yolo`, so headless resumption with structured output works perfectly.

### 1.2 Current State in Our Codebase

**GeminiCliAdapter** (`gemini-cli.adapter.ts`):

- Lines 44-69: `GeminiStreamEvent` interface already has `session_id?: string`
- Lines 425-431: `case 'init':` handler extracts `event.model` but **discards `event.session_id`**
- No resume flags in spawn arguments
- No session persistence

**AgentProcessInfo** (`agent-process.types.ts`):

- No `sessionId` field
- No `parentSessionId` field

**SpawnAgentRequest** (`agent-process.types.ts`):

- No `resumeSessionId` field

### 1.3 Implementation Plan

#### Step 1: Extend Types (`agent-process.types.ts`)

```typescript
// AgentProcessInfo
export interface AgentProcessInfo {
  // ... existing fields ...
  readonly cliSessionId?: string; // Gemini's own session UUID
  readonly parentSessionId?: string; // Ptah Claude SDK session that spawned this
}

// SpawnAgentRequest
export interface SpawnAgentRequest {
  // ... existing fields ...
  readonly resumeSessionId?: string; // Resume a previous CLI session
  readonly parentSessionId?: string; // Link to parent Ptah session
}

// SpawnAgentResult
export interface SpawnAgentResult {
  // ... existing fields ...
  readonly cliSessionId?: string; // Captured from CLI init event
}
```

#### Step 2: Capture session_id in GeminiCliAdapter

In `handleJsonLine()`, `case 'init':` block:

```typescript
case 'init':
  if (event.session_id) {
    // Emit a special segment so AgentProcessManager can capture it
    emitSegment({ type: 'info', content: `session_id:${event.session_id}` });
    // Also store on the handle for direct access
    this._lastSessionId = event.session_id;
  }
  // ... existing model handling ...
  break;
```

Alternatively, extend `SdkHandle` with an optional `sessionId` property:

```typescript
export interface SdkHandle {
  // ... existing fields ...
  readonly getSessionId?: () => string | undefined;
}
```

#### Step 3: Pass `--resume` flag when resuming

In `GeminiCliAdapter.runSdk()`, before building args:

```typescript
const args = ['--output-format', 'stream-json', '--yolo'];

if (options.resumeSessionId) {
  args.push('--resume', options.resumeSessionId);
} else {
  args.push('--prompt='); // Fresh session
}
```

#### Step 4: Persist CLI Session ID in SessionMetadata

Extend `SessionMetadata` to include a `cliSessions` array:

```typescript
export interface SessionMetadata {
  // ... existing fields ...
  cliSessions?: CliSessionReference[];
}

export interface CliSessionReference {
  cliSessionId: string; // Gemini's session UUID
  cli: CliType; // 'gemini' | 'codex' | 'copilot'
  agentId: string; // Ptah's AgentId
  task: string; // What was the agent asked to do
  startedAt: string; // ISO timestamp
  status: AgentStatus; // final status
}
```

When a Gemini agent completes, the `cliSessionId` is persisted to the parent session's metadata.

#### Step 5: Expose Resume via MCP Tool

Extend `ptah_agent_spawn` tool parameters:

```typescript
properties: {
  // ... existing ...
  resume_session_id: {
    type: 'string',
    description: 'Resume a previous CLI agent session by its session ID'
  }
}
```

#### Step 6: Frontend Display

When loading a session, display linked CLI sessions:

- Show in session history sidebar or inline in chat
- Each CLI session card shows: CLI type, task, status, session ID
- Click to view full output
- "Resume" button that triggers `ptah_agent_spawn` with `resume_session_id`

### 1.4 Session Resume Flow

```
User opens saved Ptah session
  → Frontend: SessionLoaderService.switchSession(sessionId)
  → Backend: chat:resume RPC
  → SessionHistoryReader reads JSONL
  → SessionMetadata includes cliSessions[]
  → Frontend displays CLI session cards

User clicks "Resume" on a Gemini CLI session
  → Frontend sends RPC: agent:spawn with resumeSessionId
  → OR: User asks Claude agent "resume the Gemini session"
  → Claude calls ptah_agent_spawn(resume_session_id: "abc123", cli: "gemini")
  → GeminiCliAdapter builds: gemini --resume abc123 --output-format stream-json --yolo
  → Agent output streams to frontend as normal
  → New output appended to the same CLI session context
```

### 1.5 Risk Analysis

| Risk                                                                       | Level  | Mitigation                           |
| -------------------------------------------------------------------------- | ------ | ------------------------------------ |
| Session deleted by Gemini retention cleanup                                | Medium | Check before resume, graceful error  |
| `--resume` + `--output-format` incompatibility in future versions          | Low    | Gemini team explicitly supports this |
| Race condition: session_id arrives before AgentProcessManager is listening | Low    | Already handled by buffer pattern    |
| Multiple concurrent Gemini agents                                          | Low    | Each gets its own session_id         |

---

## Part 2: Copilot SDK Integration

### 2.1 What is the Copilot SDK?

- **Package**: `@github/copilot-sdk` (v0.1.29, published 2026-02-27)
- **Status**: Technical Preview (breaking changes possible)
- **Architecture**: Spawns Copilot CLI in `--headless --stdio` mode, communicates via JSON-RPC 2.0
- **Dependency**: Requires Copilot CLI installed separately (`@github/copilot`)

### 2.2 SDK vs Current CLI Spawning

| Problem with CLI Spawning                      | SDK Solution                                   |
| ---------------------------------------------- | ---------------------------------------------- |
| Raw text output, fragile ANSI stripping        | 40+ typed structured events                    |
| No tool interception (`--yolo` approves all)   | `onPreToolUse` hook with allow/deny/modify     |
| No session persistence or resume               | `sessionId` + `resumeSession()`                |
| One process per task                           | Multiple concurrent sessions on one client     |
| Manual folder trust (`~/.copilot/config.json`) | SDK handles via session config                 |
| No custom tool injection                       | Zod-validated custom tools with async handlers |
| No crash recovery                              | `autoRestart: true`                            |
| Windows `.cmd` workarounds                     | SDK handles internally                         |
| No token/cost data                             | Structured usage events                        |
| `--no-ask-user` blocks all interaction         | `onAskUserInput` hook routes to UI             |

### 2.3 Core SDK API

```typescript
import { CopilotClient } from '@github/copilot-sdk';

// Create client (manages CLI process lifecycle)
const client = new CopilotClient({
  githubToken: token,        // or reads from gh auth
  autoRestart: true,         // Crash recovery
  cliPath: '/path/to/copilot',
});

// Create session
const session = await client.createSession({
  sessionId: 'ptah-agent-123',  // Custom ID for linking!
  model: 'claude-sonnet-4.6',
  streaming: true,
  tools: [                       // Custom tool definitions
    {
      name: 'ptah_workspace_analyze',
      description: '...',
      parameters: z.object({ ... }),
      handler: async (args) => { ... },
    }
  ],
  hooks: {
    onPreToolUse: async (toolCall) => {
      // Route permission to Ptah UI instead of auto-approving
      return { permissionDecision: 'allow' };
    },
    onAskUserInput: async (prompt) => {
      // Route Copilot's user questions to Ptah's chat
      return await routeToUserViaRpc(prompt);
    },
  },
});

// Send message (non-blocking with events)
await session.send({ prompt: 'Analyze this codebase' });

// Listen for events
session.on('assistant.message_delta', (event) => {
  // Streaming token
});

session.on('tool.execution_start', (event) => {
  // Tool call started
});

session.on('session.idle', () => {
  // Session finished processing
});

// Resume later
const resumed = await client.resumeSession('ptah-agent-123');
```

### 2.4 Key SDK Features for Ptah

#### Permission Hooks (The Biggest Win)

Currently, `--yolo` auto-approves everything. The SDK's `onPreToolUse` hook lets us:

1. **Route permissions to the Ptah sidebar** — show "Copilot wants to edit file X" in the agent monitor panel
2. **Auto-approve safe operations** (read-only tools) while prompting for writes
3. **Let the main Claude agent decide** — Claude can approve/deny Copilot's tool calls
4. **Block dangerous operations** — prevent rm -rf, etc.

#### User Input Routing

The `onAskUserInput` hook intercepts Copilot's questions:

1. Display the question in the Ptah agent monitor panel
2. Let the user type a response directly
3. OR let the main Claude agent answer on behalf of the user
4. Return the response to Copilot programmatically

This solves the current issue where `--no-ask-user` blocks ALL user interaction.

#### Custom Tool Injection (Bypass MCP Entirely)

Instead of the complex MCP server routing (disable IDE bridge → re-add as HTTP), we can inject Ptah tools directly:

```typescript
tools: [
  {
    name: 'ptah_workspace_analyze',
    parameters: z.object({ category: z.string() }),
    handler: async (args) => {
      return await ptahAPI.workspace.analyze(args);
    },
  },
  // ... all other ptah_* tools
];
```

This eliminates:

- `--disable-mcp-server` flags
- `--additional-mcp-config` JSON
- MCP HTTP server overhead for Copilot connections
- IDE bridge permission blocking issues

#### Session Management

```typescript
// Create with custom ID
const session = await client.createSession({
  sessionId: `ptah-${agentId}`, // Link to Ptah's AgentId
});

// Resume later
const resumed = await client.resumeSession(`ptah-${agentId}`);
```

Sessions support:

- Custom IDs (for linking to Ptah sessions)
- Resume capability
- Infinite context (background compaction)
- Multiple concurrent sessions per client

### 2.5 Implementation Plan: CopilotSdkAdapter

#### New File: `copilot-sdk.adapter.ts`

```typescript
export class CopilotSdkAdapter implements CliAdapter {
  readonly name = 'copilot' as const;
  readonly displayName = 'Copilot SDK';

  private client: CopilotClient | null = null;
  private sessions = new Map<string, CopilotSession>();

  async runSdk(options: CliCommandOptions): Promise<SdkHandle> {
    await this.ensureClient(options);

    const session = await this.client.createSession({
      sessionId: options.agentId, // Link to Ptah agent
      model: options.model,
      streaming: true,
      tools: this.buildPtahTools(options.mcpPort),
      hooks: {
        onPreToolUse: (call) => this.handlePermission(call, options),
        onAskUserInput: (prompt) => this.handleUserInput(prompt, options),
      },
    });

    this.sessions.set(options.agentId, session);

    // Wire up event-based streaming
    const abort = new AbortController();
    const outputCallbacks: Array<(data: string) => void> = [];
    const segmentCallbacks: Array<(seg: CliOutputSegment) => void> = [];

    session.on('assistant.message_delta', (e) => {
      for (const cb of outputCallbacks) cb(e.content);
      for (const cb of segmentCallbacks) cb({ type: 'text', content: e.content });
    });

    session.on('tool.execution_start', (e) => {
      for (const cb of segmentCallbacks)
        cb({
          type: 'tool-call',
          content: e.toolName,
          toolName: e.toolName,
          toolArgs: JSON.stringify(e.toolInput),
        });
    });

    // ... more event handlers

    await session.send({ prompt: options.task });

    const done = new Promise<number>((resolve) => {
      session.on('session.idle', () => resolve(0));
      session.on('session.error', () => resolve(1));
    });

    return {
      abort,
      done,
      onOutput: (cb) => outputCallbacks.push(cb),
      onSegment: (cb) => segmentCallbacks.push(cb),
      getSessionId: () => options.agentId,
    };
  }

  async resumeSession(sessionId: string): Promise<SdkHandle> {
    const session = await this.client.resumeSession(sessionId);
    // ... same event wiring
  }
}
```

#### Permission Routing

```typescript
private async handlePermission(
  toolCall: ToolCallEvent,
  options: CliCommandOptions
): Promise<PermissionDecision> {
  // Auto-approve read-only operations
  if (isReadOnlyTool(toolCall.toolName)) {
    return { permissionDecision: 'allow' };
  }

  // Route to Ptah UI via RPC
  const decision = await this.permissionBridge.requestPermission({
    agentId: options.agentId,
    toolName: toolCall.toolName,
    toolArgs: toolCall.toolInput,
    description: `Copilot wants to ${toolCall.toolName}`,
  });

  return { permissionDecision: decision };
}
```

#### User Input Routing

```typescript
private async handleUserInput(
  prompt: string,
  options: CliCommandOptions
): Promise<string> {
  // Emit event to frontend
  this.events.emit('agent:user-input-requested', {
    agentId: options.agentId,
    prompt,
    timestamp: Date.now(),
  });

  // Wait for user response via RPC
  const response = await this.inputBridge.waitForUserInput(options.agentId);
  return response;
}
```

### 2.6 Migration Strategy

**Phase 1: Add SDK as Alternative** (keep CLI adapter)

1. Install `@github/copilot-sdk` as optional dependency
2. Create `CopilotSdkAdapter` alongside existing `CopilotCliAdapter`
3. Feature flag: `ptah.copilot.useSdk: true/false`
4. Register in `CliDetectionService` based on flag + SDK availability

**Phase 2: Wire Permission & Input Routing**

1. Add `AGENT_MONITOR_PERMISSION_REQUEST` message type
2. Add `AGENT_MONITOR_USER_INPUT_REQUEST` message type
3. Frontend: Permission dialog in agent card
4. Frontend: Input field in agent card

**Phase 3: Replace MCP with Direct Tools**

1. Build Ptah tool definitions as Zod schemas
2. Inject directly via SDK `tools` config
3. Remove MCP server routing for Copilot
4. Keep MCP for Gemini (which doesn't have an SDK)

**Phase 4: Session Management**

1. Capture session IDs from SDK
2. Persist to SessionMetadata
3. Enable resume via `resumeSession()`
4. Frontend: Resume button on Copilot agent cards

### 2.7 Risk Analysis

| Risk                                               | Level  | Mitigation                                      |
| -------------------------------------------------- | ------ | ----------------------------------------------- |
| SDK is Technical Preview (v0.1.x)                  | High   | Keep CLI adapter as fallback, feature flag      |
| Breaking API changes                               | Medium | Pin SDK version, test on upgrade                |
| SDK requires CLI installed separately              | Low    | Already required for current approach           |
| JSON-RPC 2.0 transport issues on Windows           | Low    | SDK handles internally                          |
| Auth complexity (GitHub token)                     | Low    | VS Code's GitHub auth extension provides tokens |
| Custom tool injection may not support MCP protocol | Medium | Can still use MCP as fallback                   |

### 2.8 Authentication

The SDK supports multiple auth methods:

1. **Default**: Reads from `gh auth token` (GitHub CLI)
2. **Explicit token**: `new CopilotClient({ githubToken: '...' })`
3. **Environment variables**: `COPILOT_GITHUB_TOKEN` / `GH_TOKEN` / `GITHUB_TOKEN`
4. **VS Code integration**: Use `vscode.authentication.getSession('github', ['copilot'])` to get token

For Ptah, option 4 is ideal — the user is already authenticated via VS Code.

---

## Part 3: Combined Architecture Vision

### 3.1 Unified Session Linking

```
Ptah Claude SDK Session (parent)
├── Chat History (JSONL file)
├── Subagent Sessions (Claude SDK Task tool)
│   ├── agent-{id1}.jsonl (Explore agent)
│   └── agent-{id2}.jsonl (Plan agent)
└── CLI Sessions (NEW - stored in SessionMetadata)
    ├── Gemini Session: uuid-abc (task: "Analyze auth module")
    │   ├── Status: completed
    │   ├── Resumable: yes (--resume uuid-abc)
    │   └── Output: cached in AgentProcessManager
    └── Copilot Session: ptah-agent-456 (task: "Add unit tests")
        ├── Status: running
        ├── Resumable: yes (via SDK resumeSession())
        └── Output: streaming via events
```

### 3.2 Frontend Integration

When user opens a saved session:

1. Session history loads (existing flow)
2. CLI sessions load from metadata (new)
3. Each CLI session shows as a card in the agent monitor panel
4. Cards show: CLI type icon, task description, status badge, session ID
5. Actions per card:
   - **View Output** — expand to see full transcript
   - **Resume** — send follow-up prompt to the same session
   - **Stop** — kill running agent

### 3.3 Priority Recommendation

1. **Gemini Session Linking** — Do this first. Low effort, high value. Most of the code exists.
2. **Copilot SDK Phase 1** — Install SDK, create adapter, feature flag. Medium effort, validate SDK stability.
3. **Copilot SDK Phase 2-3** — Permission routing and direct tools. Higher effort, transformative UX.
4. **Copilot SDK Phase 4** — Session management. Depends on Phase 1-3 being stable.

---

## Sources

### Gemini CLI

- [Session Management Docs](https://geminicli.com/docs/cli/tutorials/session-management/)
- [Google Blog: Session Management](https://developers.googleblog.com/pick-up-exactly-where-you-left-off-with-session-management-in-gemini-cli/)
- [PR #14504: session_id in JSON output](https://github.com/google-gemini/gemini-cli/pull/14504)
- [Issue #13823: session_id for programmatic clients](https://github.com/google-gemini/gemini-cli/issues/13823)

### Copilot SDK

- [SDK Getting Started](https://docs.github.com/en/copilot/how-tos/copilot-sdk/sdk-getting-started)
- [GitHub Repository](https://github.com/github/copilot-sdk)
- [npm: @github/copilot-sdk](https://www.npmjs.com/package/@github/copilot-sdk)
- [Copilot SDK Announcement](https://github.blog/changelog/2026-01-14-copilot-sdk-in-technical-preview/)
- [Build Agents with SDK](https://github.blog/news-insights/company-news/build-an-agent-into-any-app-with-the-github-copilot-sdk/)
- [DeepWiki Architecture](https://deepwiki.com/github/copilot-sdk)
