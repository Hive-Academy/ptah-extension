# TASK_2025_211: Fix Pre-Existing Extension Bugs (Found During TASK_2025_208 Testing)

## Strategy

**Type**: BUGFIX
**Workflow**: Partial (Architect → Team-Leader → Developers)
**Complexity**: Medium (5 independent bugs)

## Bug List

### Bug 1: Pricing shows $0.0000 — parent session doesn't aggregate subagent costs

**Symptom**: Header shows TOKENS: 3, COST: $0.0000 for parent session while subagent (software-architect) actually used 392 tokens / $0.0056
**Root Cause**: `SESSION_STATS` events from the SDK only contain the parent session's direct token/cost usage. Subagent costs are tracked separately in their own sessions but never aggregated into the parent's metadata.
**Key Files**:

- `libs/backend/agent-sdk/src/lib/session-metadata-store.ts` — `addStats()` method
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` — where SESSION_STATS is handled
- `libs/frontend/chat/src/lib/services/chat-store/` — where cost is displayed
  **Log Evidence**: Parent session `tab_1774128415834_809h31a` shows 3 tokens, but subagent `a4137181d543dcc15` (software-architect) shows 392 tokens at $0.0056

### Bug 2: Plugin skills/commands duplication

**Symptom**: Claude Agent sees duplicate commands/skills because both the plugin system AND the SkillJunctionService create entries in `.claude/commands/` and `.claude/skills/`. When Claude tries to read a skill, it looks in the wrong workspace's `.claude/` directory and gets "File does not exist".
**Root Cause**: Two systems creating the same artifacts:

1. Plugin system (PluginLoaderService) creates symlinks from plugin packages to `.claude/commands/` and `.claude/skills/`
2. SkillJunctionService also syncs junctions for the same commands/skills
   **Key Files**:

- `libs/backend/agent-sdk/src/lib/plugins/plugin-loader.service.ts`
- `libs/backend/agent-sdk/src/lib/skill-junction/skill-junction.service.ts`
- `.claude/commands/` and `.claude/skills/` directories
  **Log Evidence**: `[SkillJunctionService] Junctions and commands synced: {"created":16,"skipped":7}` — 16+7=23 entries total, many are duplicates

### Bug 3: Session stop fails — "Cannot end session - not found"

**Symptom**: User clicks stop button, gets `[SessionLifecycle] Cannot end session - not found: 7d32bb53-...`. The session still eventually stops but with a warning.
**Root Cause**: `chat:abort` is called with the subagent's sessionId (7d32bb53), but `SessionLifecycleManager` only tracks the parent session (tab_1774128415834_809h31a). The abort still works because `SdkAgentAdapter.interruptSession()` handles it, but the lifecycle cleanup fails.
**Key Files**:

- `libs/frontend/chat/src/lib/services/chat-store/conversation.service.ts` — `abortWithConfirmation()`
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts` — `endSession()`
- `libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts` — `interruptSession()`
  **Log Evidence**: Line 216-220 — "no running agents, aborting immediately" then "Cannot end session - not found"

### Bug 4: Subagent watcher race condition (PARTIAL FIX APPLIED)

**Symptom**: First subagent's streaming text doesn't show in the UI. Second and subsequent subagents work fine.
**Root Cause**: When the first subagent starts, the SDK hasn't created the session directory yet. `watchSubagentDirectories()` finds no session directory and gives up. The main watcher sees the directory being created but its handler only looks for `agent-*` files, not new session directories.
**Partial Fix Applied**: Added a re-check in the main watcher handler: when a non-file rename event occurs (UUID-like directory name), call `watchSubagentDirectories()` again.
**Location of Fix**: `libs/backend/vscode-core/src/services/agent-session-watcher.service.ts` line ~494-500
**What Still Needs Verification**: The partial fix may not handle all edge cases (e.g., timing between directory creation and subagents/ subdirectory creation). Need to test with actual subagent sessions.

### Bug 5: vscode-lm provider not found — "No import map entry for provider: vscode-lm"

**Symptom**: Warning at startup: `[LlmService.initializeDefaultProvider] Failed to initialize default provider: {"error":"No import map entry for provider: vscode-lm"}`
**Root Cause**: TASK_2025_209 removed VsCodeLmProvider and its entry from `provider-import-map.ts`, but user's persisted config still has `vscode-lm` as the default provider. The import map no longer has an entry for it.
**Key Files**:

- `libs/backend/llm-abstraction/src/lib/registry/provider-import-map.ts` — missing vscode-lm entry
- `libs/backend/llm-abstraction/src/lib/services/llm.service.ts` — `initializeDefaultProvider()`
  **Fix Options**:
  a. Clear stale provider config on startup (migration)
  b. Fall back gracefully when configured provider doesn't exist in import map
  c. Both

### Bug 6: Subagent streaming UI shows nested tool wrapper instead of direct content

**Symptom**: When a subagent (e.g., backend-developer) is streaming, the UI wraps it inside a tool execution block showing "Agent > Executing Agent..." with an "Input" section and nested content. The subagent should display directly without the tool wrapper and tool input — similar to how it worked before.
**Root Cause**: The subagent execution is being rendered as a `tool_use`/`tool_result` execution node in the chat UI, which causes it to appear nested inside a collapsible tool block. The subagent's streaming content should be rendered at the same level as other chat content, not wrapped in a tool execution container.
**Key Files**:

- `libs/frontend/chat/src/lib/` — ExecutionNode architecture, message rendering components
- Chat components that handle `tool_use` blocks and subagent rendering
  **Visual Evidence**: Screenshot shows backend-developer subagent nested inside "Agent > Executing Agent..." tool block with "Input" toggle, instead of showing the subagent content directly inline.

### Bug 7 (CRITICAL): SDK renamed "Task" tool to "Agent" — breaks entire subagent pipeline

**Symptom**: Subagents show wrapped in tool execution container with "Input"/"Output" sections instead of inline agent bubble. On session reload, last subagent doesn't show. `resumableSubagentCount: 0`.
**Root Cause**: Claude Agent SDK v2.1.x renamed the `"Task"` tool to `"Agent"`. The Ptah codebase had 11 hardcoded `=== 'Task'` checks across 8 files. These all failed for the new `"Agent"` tool name, causing:

1. `isTaskTool: false` during streaming → tool rendered as regular tool wrapper
2. `extractTaskToolUses()` skips `"Agent"` tools → empty correlation map → `resumableSubagentCount: 0`
3. `SessionReplayService` skips `"Agent"` blocks → no `agent_start` events → subagent content lost on reload
   **Fix Applied**: Created shared `isAgentDispatchTool()` helper in `@ptah-extension/shared` that checks for `'Task'`, `'Agent'`, `'dispatch_agent'`, `'dispatch_subagent'`. Updated all 8 affected files to use it.
   **Files Modified**:

- `libs/shared/src/lib/type-guards/tool-input-guards.ts` (new helper)
- `libs/shared/src/lib/types/execution-node.types.ts` (isTaskToolMessage)
- `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts` (2 locations)
- `libs/backend/agent-sdk/src/lib/helpers/history/agent-correlation.service.ts`
- `libs/backend/agent-sdk/src/lib/helpers/history/session-replay.service.ts`
- `libs/backend/agent-sdk/src/lib/helpers/history/history-event-factory.ts` (2 locations)
- `libs/frontend/chat/src/lib/services/execution-tree-builder.service.ts`
- `libs/frontend/chat/src/lib/services/agent-monitor-tree-builder.service.ts`
- `libs/frontend/chat/src/lib/components/molecules/tool-execution/tool-call-header.component.ts`

## Related Log Files

- `d:\projects\ptah-extension\tmp\logs\vscode-app-1774128946829.log` (bugs 1-5)
- `d:\projects\ptah-extension\tmp\logs\vscode-app-1774129393331.log` (bug 4 detailed trace)

## Dependencies

- TASK_2025_208 (multi-workspace isolation) — complete, changes uncommitted
- TASK_2025_209 (platform unification) — complete, changes uncommitted
- Bug 5 is a direct consequence of TASK_2025_209
