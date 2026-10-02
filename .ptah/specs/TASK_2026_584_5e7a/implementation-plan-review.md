# Implementation Plan Review: TASK_2026_584_5e7a

VERDICT: REVISE

## 1. Executive Summary
The implementation plan is exceptionally thorough and grounded in verified codebase evidence. Its hexagonal structure, reuse of existing infrastructure ([`AgentReportRouter`](file:///D:/projects/ptah-extension/.claude-worktrees/main-latest/libs/backend/cli-agent-runtime/src/lib/cli-agents/agent-report-router.service.ts), [`LaneCompletionNotifier`](file:///D:/projects/ptah-extension/.claude-worktrees/main-latest/libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts), [`execGit`](file:///D:/projects/ptah-extension/.claude-worktrees/main-latest/libs/backend/vscode-core/src/utils/exec-git.ts)), and coordination with TASK_2026_580 (keeping child links in-memory) are architecturally sound. However, a revision is required for two major contract gaps: an argument omission in `SdkAgentAdapter.startChatSession` that breaks sidebar grouping, and an unhandled frontend tab hang when child session startup fails after the adoption broadcast.

## 2. Defects

### Defect 1 (Major) - `SdkAgentAdapter.startChatSession` ignores `workspaceId`
- **Plan Section**: Component 1 (lines 225-227), Component 5 (lines 504-507), Decision D3 (line 148).
- **Evidence**: [`sdk-agent-adapter.ts:768-775`](file:///D:/projects/ptah-extension/.claude-worktrees/main-latest/libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts#L768-L775)
- **Detail**: In `sdk-agent-adapter.ts:768-775`, `startChatSession` calls `this.createSessionIdCallback(resolvedProjectPath, ...)`, passing `resolvedProjectPath` (which is `config.projectPath`, the child's worktree) as `workspaceId`. Component 1 specifies passing `workingDirectory` as an optional 4th parameter to `SessionMetadataStore.create`, but omits specifying that `startChatSession` at line 770 must be updated to pass `config.workspaceId ?? resolvedProjectPath` as `workspaceId`. Without this, `metadataStore.create` continues receiving the worktree path as `workspaceId`, breaking sidebar grouping under the parent workspace (D3).
- **Fix**: Update `startChatSession` to read `config.workspaceId ?? resolvedProjectPath` and forward both distinct `workspaceId` and `workingDirectory` through `createSessionIdCallback`.

### Defect 2 (Major) - Webview tab left permanently streaming on child start failure
- **Plan Section**: Component 5 (lines 515-518), Integration Architecture (lines 883-884).
- **Evidence**: [`chat-session.service.ts:583-594`](file:///D:/projects/ptah-extension/.claude-worktrees/main-latest/libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts#L583-L594); [`tab-manager.service.ts:697-698`](file:///D:/projects/ptah-extension/.claude-worktrees/main-latest/libs/frontend/chat-state/src/lib/tab-manager.service.ts#L697-L698).
- **Detail**: `ChildChatSessionHostAdapter` broadcasts `AGENT_SESSION_OPENED` to the webview, causing `TabManagerService.adoptAgentSessionTab` to instantiate the child tab in `status: 'streaming'`. If `startAgentChildSession` fails or throws, the backend initiates rollback (worktree/branch/policy/link cleanup), but no `chat:error` or `chat:complete` message is ever broadcast to `tabId` because `streamEventsToWebview` was never reached. Since `chat:agent-sessions` is only invoked on initial bootstrap or workspace switch, the adopted tab is permanently orphaned with a spinning loader.
- **Fix**: `ChildChatSessionHostAdapter` must catch launch failures and explicitly broadcast `sendChatError(tabId, ...)` to transition the adopted tab into an error state.

### Defect 3 (Minor) - Ambiguity in deliverable modification timestamp check
- **Plan Section**: Component 3 (lines 403-408, 417), Component 6 (lines 581-582).
- **Evidence**: [`lane-completion-notifier.service.ts:281-284`](file:///D:/projects/ptah-extension/.claude-worktrees/main-latest/libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-completion-notifier.service.ts#L281-L284).
- **Detail**: `checkDeliverables` evaluates `stat.mtime >= startedMs`. In child chat sessions where a worktree is created at `startedMs`, starter files checked out from the git base commit may have mtimes close to or earlier than `startedMs`, potentially triggering a false `NOT written by this run` flag.
- **Fix**: Clarify that deliverable checks evaluate against child session `startedAt` timestamp and account for worktree checkout timestamps across settled turns.

## 3. Judgement on Disagreements

1. **Auto-allow Ptah MCP tools for children (`mcp__ptah__*`)**
   - **Judgement**: SOUND.
   - **Reason**: Literal `auto-edit` in [`sdk-permission-handler.ts:587-592`](file:///D:/projects/ptah-extension/.claude-worktrees/main-latest/libs/backend/agent-sdk/src/lib/sdk-permission-handler.ts#L587-L592) routes all MCP tools to `requestUserPermission`. For an unattended child, prompting the user for internal tools causes stalls or timeouts. Specifically, `ptah_agent_report` is the child's lifeline to the parent; auto-allowing `mcp__ptah__*` while keeping foreign MCP tools behind bounded prompts is essential for autonomous operation without compromising security.

2. **"Parent ends" = inactive for 30 seconds**
   - **Judgement**: SOUND.
   - **Reason**: `SessionEnd` in [`session-lifecycle-manager.ts:593-595`](file:///D:/projects/ptah-extension/.claude-worktrees/main-latest/libs/backend/agent-sdk/src/lib/helpers/session-lifecycle-manager.ts#L593-L595) and [`session-control.service.ts:211-299`](file:///D:/projects/ptah-extension/.claude-worktrees/main-latest/libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-control.service.ts#L211-L299) fires not only on termination, but on `/compact`, `/clear`, turn aborts, and slash-command re-queries. Terminating children instantly upon `SessionEnd` would kill all running child worktrees during routine parent maintenance. The 30s grace window prevents catastrophic collateral termination while reliably reaping orphaned children if the parent remains inactive.

3. **Child tabs do not take focus**
   - **Judgement**: SOUND.
   - **Reason**: Normal tab creation ([`tab-manager.service.ts:843`](file:///D:/projects/ptah-extension/.claude-worktrees/main-latest/libs/frontend/chat-state/src/lib/tab-manager.service.ts#L843)) forces active focus. If a parent orchestrates 3 children concurrently, three sudden focus shifts would snatch keyboard input and active scroll position away from the user in the parent tab. Opening adjacent tabs with clear badging and origin banners preserves non-disruptive UX.

4. **No permission argument on `ptah_session_start`**
   - **Judgement**: SOUND.
   - **Reason**: Context user decisions bindingly fixed unattended permissions (auto-edit + Bash allowlist). Permitting an LLM parent to specify permissions (e.g. `yolo`) via tool parameters would violate least-privilege principles and create an escalation vector. The host environment and settings must govern security policy.

## 4. Architectural Strengths & Solid Decisions
- **Hexagonal Integrity**: Placing ports and spawner in `cli-agent-runtime` and the UI adapter in `rpc-handlers` perfectly adheres to the dependency lattice ([`eslint.config.mjs:254-380`](file:///D:/projects/ptah-extension/.claude-worktrees/main-latest/eslint.config.mjs#L254-L380)) with zero reverse imports or illegal cross-boundary leaks.
- **TASK_2026_580 Coordination**: Keeping `SessionChildRegistry` purely in-memory in 584 avoids establishing conflicting SQLite schemas or corrupting `SessionMetadata` via the `_saveInternal` 4-field carry-over ([`session-metadata-store.ts:451-468`](file:///D:/projects/ptah-extension/.claude-worktrees/main-latest/libs/backend/agent-sdk/src/lib/session-metadata-store.ts#L451-L468)).
- **Channel Reuse**: Reusing `AgentReportRouter` (TASK_2026_402) and `LaneCompletionNotifier` (TASK_2026_515) with `peer` message origins prevents duplicate transport logic.
- **Fail-Safe Boundaries**: Strict enforcement of `depth: 1` (`registry.isChild`), host-wide concurrency caps (default 3), command sanitization in `evaluateUnattendedBash`, and worktree containment via `isPathWithinRoots` completely eliminate grandchild spawning and directory traversal.
- **Batch Disjointness**: The 9-batch decomposition maintains strict file disjointness across parallel tracks (B1, B2, B3 independent; B7 parallel with B5/B6).
