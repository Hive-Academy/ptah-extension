# Research Report - TASK_2025_177

## Codex CLI Adapter: SDK-Only Migration Feasibility

**Research Classification**: MIGRATION_ANALYSIS
**Confidence Level**: 95% (based on SDK source analysis, installed package inspection, and existing adapter code review)
**Date**: 2026-03-04

---

## Executive Summary

The current `CodexCliAdapter` already uses the `@openai/codex-sdk` (v0.104.0, installed) for its `runSdk()` path. The migration goal is to bring it to feature parity with the Copilot SDK adapter pattern, specifically: session resume support, permission hooks, model listing, MCP server config, system prompt injection, and enriched segment types for the agent monitor UI.

**Key Finding**: The Codex SDK has a fundamentally different architecture than the Copilot SDK. The Copilot SDK provides a rich event-driven session model with permission hooks, `onPreToolUse`, `onPermissionRequest`, and session lifecycle events. The Codex SDK is a thin wrapper around the `codex exec` CLI subprocess communicating via JSONL over stdin/stdout. It has **no permission hook system**, **no session-level events** (only thread/turn/item events), and **no model listing API**. This means a 1:1 port of the Copilot pattern is not possible -- the migration must adapt to Codex SDK constraints.

---

## 1. SDK API Surface Analysis

### 1.1 Installed Package

- **Package**: `@openai/codex-sdk` v0.104.0
- **Module Type**: ESM only (`"type": "module"`)
- **Entry**: `dist/index.js` / `dist/index.d.ts`
- **Dependencies**: `@modelcontextprotocol/sdk` (for `ContentBlock` type in MCP tool results)

### 1.2 Core Classes

**`Codex` class** (entry point):

```typescript
constructor(options?: CodexOptions)
startThread(options?: ThreadOptions): Thread
resumeThread(id: string, options?: ThreadOptions): Thread
```

**`Thread` class** (conversation session):

```typescript
get id(): string | null  // populated after first turn starts
run(input: Input, turnOptions?: TurnOptions): Promise<Turn>
runStreamed(input: Input, turnOptions?: TurnOptions): Promise<StreamedTurn>
```

### 1.3 Configuration Types

```typescript
type CodexOptions = {
  codexPathOverride?: string; // Custom CLI binary path
  baseUrl?: string; // Custom API base URL
  apiKey?: string; // OpenAI API key
  config?: CodexConfigObject; // --config key=value overrides (flattened to TOML)
  env?: Record<string, string>; // Environment variables for CLI process
};

type ThreadOptions = {
  model?: string;
  sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
  workingDirectory?: string;
  skipGitRepoCheck?: boolean;
  modelReasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  networkAccessEnabled?: boolean;
  webSearchMode?: 'disabled' | 'cached' | 'live';
  webSearchEnabled?: boolean;
  approvalPolicy?: 'never' | 'on-request' | 'on-failure' | 'untrusted';
  additionalDirectories?: string[];
};

type TurnOptions = {
  outputSchema?: unknown; // JSON schema for structured output
  signal?: AbortSignal; // Cancellation
};
```

### 1.4 Event Types (ThreadEvent union)

| Event Type       | Payload                  | When Emitted                |
| ---------------- | ------------------------ | --------------------------- |
| `thread.started` | `{ thread_id: string }`  | First event of a new thread |
| `turn.started`   | (none)                   | When a new turn begins      |
| `turn.completed` | `{ usage: Usage }`       | Turn finished successfully  |
| `turn.failed`    | `{ error: { message } }` | Turn failed                 |
| `item.started`   | `{ item: ThreadItem }`   | Item begins processing      |
| `item.updated`   | `{ item: ThreadItem }`   | Item state change           |
| `item.completed` | `{ item: ThreadItem }`   | Item reached terminal state |
| `error`          | `{ message: string }`    | Unrecoverable stream error  |

### 1.5 Item Types (ThreadItem union)

| Item Type           | Key Fields                                             | Maps to CliOutputSegment                          |
| ------------------- | ------------------------------------------------------ | ------------------------------------------------- |
| `agent_message`     | `id, text`                                             | `text`                                            |
| `reasoning`         | `id, text`                                             | `thinking` (was `info`)                           |
| `command_execution` | `id, command, aggregated_output, exit_code, status`    | `command`                                         |
| `file_change`       | `id, changes[{path, kind}], status`                    | `file-change`                                     |
| `mcp_tool_call`     | `id, server, tool, arguments, result?, error?, status` | `tool-call` / `tool-result` / `tool-result-error` |
| `web_search`        | `id, query`                                            | `info`                                            |
| `todo_list`         | `id, items[{text, completed}]`                         | `info`                                            |
| `error`             | `id, message`                                          | `error`                                           |

---

## 2. Copilot SDK Adapter Pattern Analysis (Gold Standard)

The Copilot SDK adapter (`copilot-sdk.adapter.ts`, 936 lines) implements the following patterns that we want to replicate where possible:

### 2.1 Architecture Pattern

| Pattern                   | Copilot Implementation                               | Codex Feasibility                                                                               |
| ------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **Singleton client**      | `CopilotClient` created once, reused across sessions | Not applicable -- `Codex` class is lightweight, creates CLI subprocess per thread               |
| **Session create/resume** | `client.createSession()` / `client.resumeSession()`  | YES -- `codex.startThread()` / `codex.resumeThread(id)`                                         |
| **Session ID tracking**   | `session.sessionId` available immediately            | PARTIAL -- `thread.id` is `null` until first turn starts, populated from `thread.started` event |
| **Permission hooks**      | `hooks.onPreToolUse` + `onPermissionRequest`         | NO -- Codex SDK has no permission hook API. Uses `approvalPolicy` config instead.               |
| **Model listing**         | `client.listModels()`                                | NO -- Codex SDK has no `listModels()` method. Must use static list or CLI.                      |
| **System prompt**         | `sessionConfig.systemMessage`                        | NO -- No system message in ThreadOptions. Must prepend to task prompt (current approach).       |
| **MCP server config**     | `sessionConfig.mcpServers`                           | YES -- via `config.mcp_servers` in CodexOptions (current approach works)                        |
| **Streaming events**      | `session.on('event.type', handler)` event-driven     | `thread.runStreamed()` returns `AsyncGenerator<ThreadEvent>` -- pull-based                      |
| **Abort**                 | `session.abort()` + `session.destroy()`              | `TurnOptions.signal` (AbortSignal) -- simpler                                                   |
| **Dispose**               | `client.stop()` / `client.forceStop()`               | Not needed -- no persistent client process                                                      |

### 2.2 Event-to-Segment Mapping in Copilot

The Copilot adapter maps SDK events to `CliOutputSegment` types:

| Copilot SDK Event                               | CliOutputSegment Type                     |
| ----------------------------------------------- | ----------------------------------------- |
| `session.start`                                 | `info`                                    |
| `assistant.message_delta`                       | `text` (streaming)                        |
| `assistant.message`                             | `text` (full, skipped if deltas received) |
| `assistant.reasoning_delta`                     | `thinking`                                |
| `assistant.reasoning`                           | `thinking` (skipped if deltas received)   |
| `tool.execution_start`                          | `tool-call`                               |
| `tool.execution_complete` (success, shell tool) | `command`                                 |
| `tool.execution_complete` (success, file tool)  | `file-change`                             |
| `tool.execution_complete` (success, other)      | `tool-result`                             |
| `tool.execution_complete` (error)               | `tool-result-error`                       |
| `session.error`                                 | `error`                                   |
| `assistant.usage`                               | `info`                                    |
| `session.compaction_start/complete`             | `info`                                    |
| `session.idle`                                  | resolves done promise                     |
| `session.shutdown`                              | resolves done promise                     |

---

## 3. Gap Analysis: Current Codex Adapter vs Target

### 3.1 What Already Works

The current `CodexCliAdapter` (413 lines) already handles:

- [x] CLI detection (`detect()`)
- [x] SDK dynamic import with caching (`getCodexSdk()`)
- [x] Thread creation with working directory
- [x] Streamed event iteration via `AsyncGenerator`
- [x] Event-to-segment mapping for: `agent_message`, `reasoning`, `command_execution`, `file_change`, `error`
- [x] Usage tracking from `turn.completed`
- [x] Abort via `AbortController` signal
- [x] Output + segment buffering pattern
- [x] MCP server config via `config.mcp_servers`

### 3.2 Gaps to Fill

| Gap                                          | Priority | Effort | Notes                                                                                                                                                |
| -------------------------------------------- | -------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Session resume** (`resumeThread`)          | HIGH     | Small  | Codex SDK supports `resumeThread(id)`. Need to capture `thread_id` from `thread.started` event and wire `getSessionId`.                              |
| **Enriched MCP tool-call segments**          | HIGH     | Medium | Current adapter ignores `mcp_tool_call` items. Need to emit `tool-call` on `item.started`, `tool-result` or `tool-result-error` on `item.completed`. |
| **`item.started` / `item.updated` handling** | MEDIUM   | Medium | Current adapter only handles `item.completed`. Need progressive updates for command_execution and mcp_tool_call (show tool name before completion).  |
| **`getSessionId` on SdkHandle**              | HIGH     | Small  | Need to return thread ID from `thread.started` event. Currently not implemented.                                                                     |
| **`setAgentId` on SdkHandle**                | LOW      | Tiny   | Not needed for Codex (no permission hooks), but should be a no-op for interface consistency.                                                         |
| **Model listing**                            | MEDIUM   | Small  | Static model list (like Copilot fallback). Codex CLI models: `o4-mini`, `codex-mini`, `o3`, `gpt-4.1`.                                               |
| **Reasoning -> `thinking` segment**          | LOW      | Tiny   | Current adapter maps `reasoning` to `info`. Should map to `thinking` for consistency with Copilot.                                                   |
| **Thread options enrichment**                | MEDIUM   | Small  | Pass `model`, `approvalPolicy`, `sandboxMode` from CliCommandOptions.                                                                                |
| **`codexPathOverride`**                      | HIGH     | Small  | Use `binaryPath` from detection to set `codexPathOverride` in CodexOptions.                                                                          |
| **Dispose method**                           | LOW      | Tiny   | No persistent client, but add for interface consistency.                                                                                             |
| **Web search item handling**                 | LOW      | Tiny   | Emit `info` segment for web_search items.                                                                                                            |
| **Todo list item handling**                  | LOW      | Tiny   | Emit `info` segment for todo_list items.                                                                                                             |

### 3.3 Not Possible (SDK Limitations)

| Feature                               | Why Not Possible                              | Workaround                                                                                                                                 |
| ------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Permission hooks** (`onPreToolUse`) | Codex SDK has no hook API                     | Use `approvalPolicy: 'never'` (auto-approve all) since Ptah runs in trusted workspace context. Alternative: `'on-failure'` for safer mode. |
| **Permission bridge**                 | No permission callback system                 | Not needed if approvalPolicy handles it. Future: could intercept JSONL events if Codex adds permission events.                             |
| **Dynamic model listing**             | No `listModels()` API                         | Static model list. Could shell out to `codex --help` to parse models.                                                                      |
| **System prompt injection**           | No `systemMessage` in ThreadOptions           | Continue prepending to task prompt via `buildTaskPrompt()`.                                                                                |
| **Streaming text deltas**             | `agent_message` only appears as complete item | `item.updated` events may contain partial text -- needs testing.                                                                           |

---

## 4. Authentication Analysis

### Codex SDK Auth

The Codex SDK authenticates via:

1. **`apiKey` option** in `CodexOptions` -- explicit API key
2. **`OPENAI_API_KEY` environment variable** -- standard OpenAI auth
3. **Auto-injection**: SDK docs state it "automatically injects `OPENAI_BASE_URL` and `CODEX_API_KEY`"

**Current implementation**: The adapter does not pass an API key. It relies on the environment variable being set. This works because VS Code inherits the user's shell environment.

**Recommendation**: Add explicit API key support via VS Code SecretStorage (similar to how other providers handle keys). The adapter should check:

1. VS Code secret storage for `openai-api-key`
2. Fall back to `OPENAI_API_KEY` environment variable (current behavior)

---

## 5. Event-to-Segment Mapping Table (Proposed)

### Thread-Level Events

| Codex ThreadEvent | CliOutputSegment | Notes                                                                   |
| ----------------- | ---------------- | ----------------------------------------------------------------------- |
| `thread.started`  | `info`           | Capture `thread_id` for session resume. Content: "Thread started: {id}" |
| `turn.started`    | (none)           | No segment needed                                                       |
| `turn.completed`  | `info`           | Usage summary: "{input_tokens} input, {output_tokens} output"           |
| `turn.failed`     | `error`          | Content: error message                                                  |
| `error`           | `error`          | Content: error message                                                  |

### Item Events (item.started)

| Item Type           | CliOutputSegment on `item.started` | Notes                                                   |
| ------------------- | ---------------------------------- | ------------------------------------------------------- |
| `command_execution` | `tool-call`                        | Show command being executed: toolName=command           |
| `mcp_tool_call`     | `tool-call`                        | Show server + tool name                                 |
| `file_change`       | (none)                             | Wait for completion                                     |
| `agent_message`     | (none)                             | Wait for completion or use `item.updated` for streaming |
| `reasoning`         | (none)                             | Wait for completion or use `item.updated` for streaming |

### Item Events (item.updated)

| Item Type           | CliOutputSegment on `item.updated` | Notes                                                  |
| ------------------- | ---------------------------------- | ------------------------------------------------------ |
| `agent_message`     | `text`                             | Emit delta text (diff against previous `item.updated`) |
| `reasoning`         | `thinking`                         | Emit delta text                                        |
| `command_execution` | (none)                             | Wait for completion                                    |
| `mcp_tool_call`     | (none)                             | Wait for completion                                    |

### Item Events (item.completed)

| Item Type                 | CliOutputSegment on `item.completed` | Notes                                                             |
| ------------------------- | ------------------------------------ | ----------------------------------------------------------------- |
| `agent_message`           | `text`                               | Full text (skip if streaming deltas were sent via `item.updated`) |
| `reasoning`               | `thinking`                           | Full text (skip if streaming deltas were sent)                    |
| `command_execution`       | `command`                            | Content: aggregated_output, exitCode, toolName: command           |
| `file_change`             | `file-change`                        | One segment per change: content=path, changeKind=kind             |
| `mcp_tool_call` (success) | `tool-result`                        | Content: result payload                                           |
| `mcp_tool_call` (failed)  | `tool-result-error`                  | Content: error message                                            |
| `web_search`              | `info`                               | Content: "Web search: {query}"                                    |
| `todo_list`               | `info`                               | Content: formatted todo items                                     |
| `error`                   | `error`                              | Content: error message                                            |

---

## 6. Session Management Comparison

### Session Lifecycle

| Phase              | Copilot SDK                                                  | Codex SDK                                                        |
| ------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------- |
| **Create**         | `client.createSession({ sessionId, streaming, model, ... })` | `codex.startThread({ model, workingDirectory, ... })`            |
| **Resume**         | `client.resumeSession(sessionId, config)`                    | `codex.resumeThread(threadId, options)`                          |
| **Send prompt**    | `session.send({ prompt })` (fire & forget)                   | `thread.runStreamed(input, { signal })` (returns AsyncGenerator) |
| **Get ID**         | `session.sessionId` (immediate)                              | `thread.id` (null until `thread.started` event)                  |
| **Abort**          | `session.abort()` + `session.destroy()`                      | `AbortController.abort()` via signal                             |
| **Idle detection** | `session.idle` event                                         | Generator exhaustion (for loop ends)                             |
| **Multi-turn**     | New `session.send()` on existing session                     | New `thread.run()` / `thread.runStreamed()` on existing thread   |
| **Persistence**    | SDK-managed                                                  | `~/.codex/sessions` directory                                    |

### Implementation for Resume

```
1. On thread.started event: capture thread_id, store in SdkHandle.getSessionId()
2. AgentProcessManager stores cliSessionId in AgentProcessInfo
3. On resume: pass cliSessionId as resumeSessionId in CliCommandOptions
4. CodexCliAdapter checks options.resumeSessionId:
   - If present: codex.resumeThread(resumeSessionId, threadOptions)
   - If absent: codex.startThread(threadOptions)
5. On resumed thread, call thread.runStreamed() with new prompt
```

---

## 7. Risk Assessment

### Low Risk

- **Session resume**: `resumeThread()` is a documented, first-class API. Thread IDs persist in `~/.codex/sessions`.
- **Event mapping**: All event types are well-typed in the SDK. The mapping is straightforward.
- **MCP config**: Already working via `config.mcp_servers`.

### Medium Risk

- **Streaming text deltas via `item.updated`**: The SDK emits `item.updated` events but the documentation does not specify whether `agent_message.text` contains incremental or full text. Need to test whether each `item.updated` contains the full accumulated text or just the delta. The adapter must handle both cases (delta tracking with last-seen text diffing).
- **Windows `.cmd` resolution**: The Codex SDK accepts `codexPathOverride` but spawns the process internally. If the SDK uses bare `spawn()` instead of `cross-spawn`, Windows `.cmd` wrappers may fail. Need to test or pass the resolved binary path.

### Low-Medium Risk

- **No permission hooks**: Running with `approvalPolicy: 'never'` means auto-approving all tool use. This is acceptable for Ptah's use case (user-initiated tasks in their own workspace) but should be clearly documented.
- **No dynamic model list**: Static list needs manual updates when OpenAI releases new Codex models. Low impact since models change infrequently.

---

## 8. Implementation Plan

### Files to Modify

| File                                                                              | Changes                                                                                                      | Estimated LOC                           |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| `libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-cli.adapter.ts` | Major rewrite of `runSdk()`, add `listModels()`, add `dispose()`, enhance event handling, add session resume | ~350 lines (current: 413, target: ~500) |

### Files Unchanged

| File                               | Reason                                                   |
| ---------------------------------- | -------------------------------------------------------- |
| `cli-adapter.interface.ts`         | No new interface methods needed                          |
| `cli-adapter.utils.ts`             | Existing utilities sufficient                            |
| `copilot-permission-bridge.ts`     | Not used by Codex (no permission hooks)                  |
| `agent-process-manager.service.ts` | Already handles SdkHandle generically                    |
| `shared/agent-process.types.ts`    | CliOutputSegment types already cover all needed segments |

### Implementation Steps

1. **Update local SDK types** to match installed v0.104.0 (add missing types: `ThreadOptions.approvalPolicy`, `ThreadOptions.sandboxMode`, `McpToolCallItem.result/error`, `ItemStartedEvent`, `ItemUpdatedEvent`)

2. **Refactor `runSdk()`** to follow Copilot pattern:

   - Add session resume via `resumeThread()` when `options.resumeSessionId` is set
   - Track `thread_id` from `thread.started` event for `getSessionId()`
   - Pass `model` and other options via `ThreadOptions`
   - Pass `codexPathOverride` from `options.binaryPath`
   - Add `setAgentId` no-op for interface consistency

3. **Enhance event handling** (`handleStreamEvent`):

   - Handle `item.started` for `command_execution` and `mcp_tool_call` (emit `tool-call`)
   - Handle `item.updated` for `agent_message` and `reasoning` (streaming deltas with text diffing)
   - Handle `item.completed` for `mcp_tool_call` (emit `tool-result` / `tool-result-error`)
   - Handle `web_search` and `todo_list` items
   - Map `reasoning` to `thinking` segment type (currently `info`)

4. **Add `listModels()`** with static model list:

   - `o4-mini`, `codex-mini`, `o3`, `gpt-4.1` (current Codex-supported models)

5. **Add `dispose()`** as no-op for interface consistency

6. **Move `Codex` client creation to instance level** instead of module-level cache, for cleaner lifecycle management and testability

### Estimated Effort

- **Implementation**: 3-4 hours
- **Testing**: 1-2 hours
- **Total**: 4-6 hours

---

## 9. Architectural Recommendation

### Recommended Approach: Pragmatic Adaptation

Do NOT attempt a 1:1 copy of the Copilot adapter pattern. The SDKs are fundamentally different:

- **Copilot SDK**: Rich event-driven session model with push-based events via `.on()`, permission hooks, session lifecycle management, singleton client
- **Codex SDK**: Thin CLI wrapper with pull-based events via `AsyncGenerator`, no permission system, stateless client, thread-based sessions

The adapter should:

1. **Keep the `AsyncGenerator` iteration pattern** (current approach) rather than trying to create an event-driven wrapper
2. **Add session resume** as the primary new capability
3. **Enhance segment emission** for richer agent monitor UI
4. **Skip permission bridge integration** -- Codex SDK does not support it
5. **Use `approvalPolicy: 'never'`** for automatic approval (Ptah-controlled workspace)

### What NOT to Do

- Do NOT create a singleton `Codex` client -- it is not needed (lightweight, no persistent process)
- Do NOT create a `CodexPermissionBridge` -- the SDK has no permission API
- Do NOT try to wrap `AsyncGenerator` in `.on()` event emitter pattern -- it adds complexity for no benefit
- Do NOT implement `systemMessage` via config hacks -- continue using `buildTaskPrompt()` prepend

---

## 10. Appendix: SDK Source References

### Installed Package

- **Path**: `node_modules/@openai/codex-sdk/`
- **Version**: 0.104.0
- **Types**: `dist/index.d.ts` (273 lines, fully typed)

### GitHub Repository

- **URL**: https://github.com/openai/codex/tree/main/sdk/typescript
- **Key files**: `src/codex.ts` (client), `src/thread.ts` (session), `src/index.ts` (exports)

### Copilot SDK Adapter (reference implementation)

- **Path**: `libs/backend/llm-abstraction/src/lib/services/cli-adapters/copilot-sdk.adapter.ts`
- **Lines**: 936
- **Key patterns**: singleton client, session create/resume, event-to-segment mapping, permission hooks, abort handling

### Current Codex Adapter (migration target)

- **Path**: `libs/backend/llm-abstraction/src/lib/services/cli-adapters/codex-cli.adapter.ts`
- **Lines**: 413
- **Key gaps**: no session resume, no getSessionId, no item.started/updated handling, no MCP tool-call segments, reasoning mapped to wrong segment type
