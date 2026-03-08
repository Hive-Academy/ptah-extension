# Plan 1: Codex Enhancements + UI Consistency Improvements

## Context

Investigation of all CLI agent integrations (Gemini, Codex, Copilot, Ptah CLI) revealed several inconsistencies and missing features. This plan covers the UI and backend improvements that are independent from the plugin integration work.

## Exploration Findings Summary

### Architecture Overview

- 4 CLI adapters: Gemini (external subprocess), Codex (in-process SDK), Copilot (in-process SDK), Ptah CLI (in-process SDK)
- All implement `CliAdapter` interface in `libs/backend/llm-abstraction/src/lib/services/cli-adapters/`
- Unified `AgentProcessManager` orchestrates lifecycle, buffering, and concurrent limits
- Frontend: `AgentMonitorStore` + per-CLI output components + `AgentMonitorTreeBuilderService`

### Key Findings

1. **Codex rendering divergent**: Only CLI using direct `@switch` segment rendering instead of ExecutionNode tree
2. **Stats bar only on Gemini**: Copilot and Ptah CLI have stats data but don't display it
3. **Codex has no session resume**: SDK now supports `resumeThread(threadId)`
4. **Permission bridge not configurable**: Hard-coded auto-approval rules in Copilot permission bridge

---

## Part 1: Unify Codex Rendering to ExecutionNode Tree

### Problem

Codex uses direct `@switch(segment.type)` rendering. All other CLIs use `buildTreeFromSegments()` → `ExecutionNode[]` → `ExecutionNodeComponent`.

### Files to Modify

**`D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\codex-output.component.ts`**

- Rewrite to match Copilot pattern
- Input: `segments: CliOutputSegment[]`, `agentId: string`, `isStreaming: boolean`
- Inject `AgentMonitorTreeBuilderService`, use `buildTreeFromSegments()`
- Render via `ExecutionNodeComponent`
- Remove direct segment rendering, NgClass, custom templates

**`D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\agent-card.component.ts`**

- Update Codex `@case` to pass `agent().segments` + `agentId` + `isStreaming` instead of `parsedOutput()`

---

## Part 2: Add Stats Bars to Copilot and Ptah CLI

### Problem

Only Gemini displays model, tokens, duration. Copilot and Ptah CLI have the data but don't show it.

### New File

**`D:\projects\ptah-extension\libs\frontend\chat\src\lib\components\molecules\agent-card\stats-bar.utils.ts`**

- `CliAgentStats` interface: `{ model?, inputTokens?, outputTokens?, cost?, durationMs? }`
- `formatTokens(n)`: Format with "k" notation
- `formatDuration(ms)`: Format as ms/s/m:s

### Files to Modify

**`copilot-output.component.ts`**

- Add `modelStats` computed from `info` segments (regex: `"Usage: model, N input, N output, $cost, Ns"`)
- Add stats bar template (~20 lines)

**`ptah-cli-output.component.ts`**

- Add `modelStats` computed from `MessageCompleteEvent` in `streamEvents` (structured, no regex)
- Add stats bar template

**`gemini-output.component.ts`**

- Refactor to use shared `formatTokens`/`formatDuration` from `stats-bar.utils.ts`

---

## Part 3: Add Session Resume to Codex

### Problem

Codex SDK now supports `codex.resumeThread(threadId)` but adapter only calls `startThread()`.

### File to Modify

**`D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\codex-cli.adapter.ts`**

1. Extend local `CodexClient` type: add `resumeThread?(threadId: string, options?): CodexThread`
2. In `runSdk()`: check `options.resumeSessionId` → use `resumeThread()` if available, else `startThread()`
3. Capture `thread_id` from `thread.started` event → return via `getSessionId` on `SdkHandle`
4. When resuming, send continuation prompt instead of full task

---

## Part 4: Standardize Permission Granularity

### Problem

`CopilotPermissionBridge` has hard-coded auto-approval. No configurable policy.

### File to Modify

**`D:\projects\ptah-extension\libs\backend\llm-abstraction\src\lib\services\cli-adapters\copilot-permission-bridge.ts`**

1. Define `PermissionPolicy` interface: `{ name, autoApproveTools, autoApproveKinds, autoApproveAll }`
2. Create presets: `readOnly`, `safeWrite`, `fullAuto`
3. Replace `_autoApprove: boolean` with `_policy: PermissionPolicy`
4. Keep `setAutoApprove()` for backward compat
5. Add `setPolicy(policy)` for fine-grained control

---

## Implementation Order

1. Part 1 (Codex ExecutionNode) — frontend only
2. Part 2 (Stats bars) — frontend only, parallel with Part 1
3. Part 3 (Codex resume) — backend, independent
4. Part 4 (Permissions) — backend, independent

## Verification

- Spawn Codex agent → verify ExecutionNode tree rendering
- Spawn each CLI → verify stats bar appears
- Spawn + resume Codex → verify thread continuation
- Test Copilot with readOnly vs fullAuto policy
- `npm run typecheck:all && npm run lint:all` passes
