# TASK_2025_173 — Manual Testing Guide

## Fixes to Verify

### Fix 1: Event Duplication (4-5x repeated content)

**Root cause**: `ptah-cli-registry.ts` transformed ALL SDK message types (stream events, assistant messages, user messages) into FlatStreamEventUnion. The SDK sends streaming deltas AND then a complete assistant message with the same content — both were transformed, causing 2-5x duplication.

**Fix**: Only transform `isStreamEvent` and `isUserMessage` directly. For `isAssistantMessage`, only extract `agent_start` and `background_agent_started` events.

**How to test**:

1. Open Ptah, start a chat session
2. Trigger a Ptah CLI agent (any task that uses a ptah-cli provider)
3. Watch the agent monitor panel — text and tool calls should appear exactly once
4. If you see duplicated text blocks or repeated tool call entries, the fix is broken

---

### Fix 2: Empty Subagents

**Root cause**: `agent-monitor-tree-builder.service.ts` filtered tools with `!ts.parentToolUseId`, which excluded ALL tools inside subagent messages (since subagent events have `parentToolUseId` set to the Task tool's ID).

**Fix**: Removed the `!ts.parentToolUseId` filter. The `messageId` filter alone is sufficient since each message has a unique ID.

**How to test**:

1. Start a Ptah CLI agent with a complex task that spawns sub-agents (e.g., orchestration tasks, multi-file tasks that use the Agent/Task tool)
2. In the agent monitor, subagent cards should show their internal tool calls and text content
3. Before the fix: subagents showed "Starting agent execution" but were empty inside
4. After the fix: subagents show their thinking, tool calls, and text output

---

### Fix 3: Concurrent Agent State Corruption

**Root cause**: `SdkMessageTransformer` was a singleton with mutable state maps (`currentMessageIdByContext`, `toolCallIdByContextAndBlock`) shared between ALL concurrent Ptah CLI agent streams. When two agents ran simultaneously, one agent's `message_stop` cleared state needed by the other agent.

**Symptom**: Log warnings like `content_block_start but no active message for context: root`

**Fix**: Added `createIsolated()` factory method to `SdkMessageTransformer`. Each `spawnHeadless()` stream now gets its own transformer instance.

**How to test**:

1. Spawn 2+ Ptah CLI agents simultaneously (e.g., from orchestration or manual multi-agent tasks)
2. Both agents should stream their content independently without warnings in the extension log
3. Check the log (`vscode-app-*.log`) for `content_block_start but no active message` warnings — there should be none

---

### Fix 4: Copilot Permission Requests Not Showing

**Root cause**: `CopilotSdkAdapter.runSdk()` set `agentIdForPermissions = sessionId` (a `ptah-{timestamp}` string) in its permission hook closures. But the frontend's `AgentMonitorStore` tracks agents by the `AgentProcessManager`-generated agentId (a UUID). When a permission request arrived, `store.onPermissionRequest()` tried `map.get(request.agentId)` with the wrong ID and silently failed — no permission UI was shown.

**Fix**: Added `setAgentId` to `SdkHandle` interface. `AgentProcessManager.trackSdkHandle()` calls `sdkHandle.setAgentId?.(agentId)` after assigning the real agentId, updating the closure so future permission requests use the correct ID.

**How to test**:

1. Configure a Copilot CLI agent (requires GitHub Copilot subscription + `copilot` CLI installed)
2. Spawn a Copilot agent with a task that requires file writes or shell commands (non-read-only tools)
3. The agent monitor card should show a yellow "Permission" banner with tool name, args, and Allow/Deny buttons
4. Click "Allow" — the agent should continue execution
5. Click "Deny" — the agent should receive a denial and either stop or try an alternative
6. Auto-approved tools (Read, Glob, Grep, View, etc.) should NOT trigger a permission prompt

---

### Fix 5: Stream Event Persistence (Session Reload)

**Root cause**: `accumulatedStreamEvents` was not being persisted with CLI session references, so reloaded sessions lost their rich rendering and fell back to generic output.

**Fix**: Added persistence accumulation in `accumulateStreamEvent()`, smart capping with `capStreamEvents()` preserving landmark events, and `streamEvents` field in `readOutputForPersistence()` and `persistCliSessionReference()`.

**How to test**:

1. Run a Ptah CLI agent and let it complete
2. Close and reopen VS Code (or reload the window)
3. Navigate to the session that had the CLI agent
4. The agent monitor card should show rich rendering (tool calls with expandable sections, text blocks, thinking) instead of raw text output

---

## Files Changed

| File                                                                                  | Change                                                            |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `libs/backend/agent-sdk/src/lib/ptah-cli/ptah-cli-registry.ts`                        | Dedup: filter assistant messages, isolated transformer per stream |
| `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts`                           | Added `createIsolated()` factory                                  |
| `libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts`           | Removed `!ts.parentToolUseId` filter                              |
| `libs/backend/llm-abstraction/src/lib/services/cli-adapters/cli-adapter.interface.ts` | Added `setAgentId` to `SdkHandle`                                 |
| `libs/backend/llm-abstraction/src/lib/services/cli-adapters/copilot-sdk.adapter.ts`   | Implemented `setAgentId`, mutable `agentIdForPermissions`         |
| `libs/backend/llm-abstraction/src/lib/services/agent-process-manager.service.ts`      | Calls `setAgentId`, persistence wiring, smart capping             |
| `apps/ptah-extension-vscode/src/services/rpc/rpc-method-registration.service.ts`      | Stream events in persistence, warning log on missing output       |

## Quick Smoke Test

1. **Build**: `npm run build:all`
2. **Launch**: F5 to open Extension Development Host
3. **Ptah CLI test**: Send a message that triggers a Ptah CLI agent → verify no duplication, subagents render content
4. **Copilot test** (if available): Spawn a Copilot agent with a write task → verify permission UI appears
5. **Concurrent test**: Spawn 2+ agents simultaneously → verify no cross-contamination in output
6. **Persistence test**: Complete an agent, reload window → verify rich rendering persists
