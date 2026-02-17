# Agent Session Issues Analysis

**Date**: 2026-02-15
**Session ID**: `74ac83d2-65d4-40a1-a1af-dd83f3687793`
**Log File**: `vscode-app-1768436443449.log`

---

## Issues Identified

### 1. **Sub-agent Not Found Warnings** (Critical)

**Occurrences**: 3 times at the end of the session

```
[WARN] [SubagentRegistryService.update] Subagent not found: {"toolCallId":"cc9347fe-a90b-47d6-94ae-ab0e94352f55"}
[WARN] [SubagentRegistryService.update] Subagent not found: {"toolCallId":"e1534a41-d9b4-4475-ac8d-135bafb8abe0"}
[WARN] [SubagentRegistryService.update] Subagent not found: {"toolCallId":"622cb148-c6fc-47d3-b934-2db8f04df45f"}
```

**Root Cause**: When the `SubagentStop` hook is invoked, the system tries to update the subagent status in the registry, but the subagent has already been removed or was never registered with that specific `toolCallId`.

**Location**: `libs/backend/agent-sdk/src/lib/internal-query/subagent-hook-handler.ts`

**Impact**: The subagent completes successfully (you can see "Subagent marked as completed" logs), but the warning indicates a race condition or registration mismatch.

---

### 2. **Skill File Loading Displayed in UI** (UX Issue)

**Problem**: When the agent loads skill files using the `Read` tool (e.g., reading `.claude/skills/orchestration/SKILL.md`), these file reads are being displayed as individual execution nodes in the UI.

**Evidence from Screenshots**: Multiple "Skill" entries shown in the chat UI with checkmarks.

**Root Cause**: The SDK is treating skill file reads as regular tool calls, which get rendered as execution nodes in the chat interface.

**Location**:

- Skill loading: `libs/backend/agent-sdk/src/lib/helpers/plugin-skill-discovery.ts` (if it exists)
- Execution node rendering: `libs/frontend/chat/src/lib/components/execution-node/`

**Expected Behavior**: Skill loading should happen silently in the background without creating visible execution nodes.

---

### 3. **Message Disappeared After Completion** (Critical UX Bug)

**Problem**: After the agent finished streaming and all work was done, the final message disappeared from the UI.

**Evidence**: Screenshots show only "Skill" execution nodes without the actual agent response text.

**Potential Causes**:

1. The assistant message block was never created or was replaced
2. The `SESSION_STATS` event triggered a UI state reset
3. The final `chat:complete` event cleared the message buffer

**Location**:

- Message rendering: `libs/frontend/chat/src/lib/services/chat-store.service.ts`
- Streaming handler: `libs/frontend/chat/src/lib/services/streaming-handler.service.ts` (lines 271-272 in log)

---

### 4. **Context Window Overflow** (Critical)

**Metrics** (Line 650-652):

```json
{
  "contextUsed": 1826626,
  "contextWindow": 200000,
  "contextPercent": 913.3
}
```

**Problem**: The context usage is calculated as **913.3%** of the window (1.8M tokens used vs 200K limit).

**Root Cause**: The calculation likely includes:

- Cumulative token counts across all sub-agents
- Cache read tokens being added to input tokens
- Multiple sessions being counted together

**Actual Usage** (from session stats):

```json
{
  "inputTokens": 329013,
  "outputTokens": 12813,
  "cacheReadInputTokens": 1484800
}
```

**Total Real Tokens**: ~342K tokens (excluding cache reads)

**Location**:

- Token calculation: `libs/frontend/chat/src/lib/services/chat-store.service.ts:270`
- Session stats: `libs/backend/agent-sdk/src/lib/stream-processing/sdk-stream-processor.ts`

---

### 5. **Sessions Directory Not Found** (Minor Warning)

**Warning** (Lines 339, 361, 383):

```
[WARN] [AgentSessionWatcher] Sessions directory NOT FOUND!
Expected: "d--projects-brand_force"
```

**Impact**: Harmless warning for new sessions, but indicates the directory watcher is trying to watch a directory that doesn't exist yet.

**Location**: `libs/backend/vscode-core/src/services/agent-session-watcher.service.ts`

**Recommendation**: Suppress this warning for new sessions or create the directory proactively.

---

## Performance Metrics

- **Total Events**: 2,713 execution nodes streamed
- **Duration**: 201.7 seconds (~3.4 minutes)
- **Cost**: $1.62 USD
- **Subagents Launched**: 3 Explore agents
- **Tool Calls**: Hundreds (Glob, Grep, Read, Bash)

---

## Recommendations

### Immediate Fixes (P0)

1. **Fix Sub-agent Registry Mismatch**

   - File: `libs/backend/agent-sdk/src/lib/internal-query/subagent-hook-handler.ts`
   - Add defensive check: If subagent not found in registry, log debug instead of warning
   - Ensure `SubagentStart` and `SubagentStop` use the same `toolCallId` mapping

2. **Hide Skill Loading from UI**

   - File: `libs/backend/agent-sdk/src/lib/helpers/plugin-skill-discovery.ts`
   - Mark skill-related tool calls with a `metadata.isInternal = true` flag
   - File: `libs/frontend/chat/src/lib/services/streaming-handler.service.ts`
   - Skip rendering execution nodes where `metadata.isInternal === true`

3. **Fix Message Disappearing Bug**

   - File: `libs/frontend/chat/src/lib/services/streaming-handler.service.ts:272`
   - Ensure `finalize streaming` doesn't clear the assistant message
   - Add logging to track when messages are removed from the DOM

4. **Fix Context Percentage Calculation**
   - File: `libs/frontend/chat/src/lib/services/chat-store.service.ts:270`
   - Use only `inputTokens + outputTokens` for context calculation
   - Exclude `cacheReadInputTokens` from the percentage (cache doesn't consume context)

### Medium Priority (P1)

5. **Suppress Session Directory Warning**

   - File: `libs/backend/vscode-core/src/services/agent-session-watcher.service.ts`
   - Create sessions directory lazily when first agent starts
   - Or downgrade log level to `debug` for expected case

6. **Optimize Skill Loading**
   - Consider caching skill content after first load
   - Load skills once at session start instead of per-request

### Low Priority (P2)

7. **Add Telemetry for Subagent Lifecycle**
   - Track subagent start/stop events to debug mismatches
   - Log the full lifecycle: register → start → stop → cleanup

---

## Test Plan

1. **Reproduce the Issue**:

   - Start a new session
   - Trigger skill loading (e.g., use `/orchestrate` command)
   - Verify skill files appear as execution nodes

2. **Verify Fix**:

   - After implementing `isInternal` flag, skill loading should be silent
   - Final message should remain visible in the UI
   - Context percentage should never exceed 100%

3. **Regression Test**:
   - Ensure normal tool calls (Read, Glob, Grep) still show in UI
   - Verify sub-agent execution nodes still appear correctly
   - Test with multiple concurrent sub-agents

---

## Files to Investigate

1. `libs/backend/agent-sdk/src/lib/internal-query/subagent-hook-handler.ts` - Subagent lifecycle hooks
2. `libs/backend/agent-sdk/src/lib/helpers/plugin-skill-discovery.ts` - Skill loading logic
3. `libs/frontend/chat/src/lib/services/streaming-handler.service.ts:271-272` - Message finalization
4. `libs/frontend/chat/src/lib/services/chat-store.service.ts:270` - Context calculation
5. `libs/backend/vscode-core/src/services/agent-session-watcher.service.ts:339` - Directory watching
6. `libs/frontend/chat/src/lib/components/execution-node/` - Execution node rendering logic

---

## Next Steps

1. Review this analysis with the team
2. Prioritize fixes based on user impact
3. Create GitHub issues for each bug with detailed reproduction steps
4. Implement fixes in order of priority
5. Add integration tests to prevent regressions
