# Implementation Plan: Assign Task to AI Agent from Tasks List and Kanban Board

## Feasibility

Yes, this feature is fully feasible and directly aligns with the repository's established architecture. The necessary launch and execution seams already exist: `TaskStartService` in `libs/frontend/tasks-ui` already bridges task execution to `AppStateManager.chatPromptRequest`, which `TaskPromptBridgeService` in `libs/frontend/chat` consumes to spawn a new chat tab and invoke `chat:start` without violating module boundaries (NFR-11). Furthermore, agent discovery is already implemented through `autocomplete:agents` (`AgentDiscoveryService` scanning `.claude/agents/*.md`) and `agent:detectClis` (`CliDetectionService` detecting installed rival CLIs). The Tasks board can offer an agent assignment picker alongside the existing Start action on cards and rows, building a structured orchestrator prompt that targets the chosen agent or lane while leaving full document ingestion and checkpoint execution to the chat conductor.

## Existing seams

| Seam | file:line | What it already gives us |
| --- | --- | --- |
| `TaskStartService` | [`libs/frontend/tasks-ui/src/lib/services/task-start.service.ts:49-141`](../../../libs/frontend/tasks-ui/src/lib/services/task-start.service.ts#L49-L141) | Orchestration launch flow for tasks. **Pre-change state, since superseded**: it set `appState.requestChatPrompt` behind a 30s resolve guard and updated status to `in_progress` on success. This task removed both — the guard is gone and the AGENT owns the status transition. |
| `TaskPromptBridgeService` | [`libs/frontend/chat/src/lib/services/chat-store/task-prompt-bridge.service.ts:33-90`](../../../libs/frontend/chat/src/lib/services/chat-store/task-prompt-bridge.service.ts#L33-L90) | Reactive consumer of `chatPromptRequest`; creates tabs via `TabManagerService`, switches view to chat, adopts canvas tiles in grid mode. **Pre-change state, since superseded**: it sent via `MessageSenderService`. This task replaced the send with `appState.requestComposerPrefill(...)`. |
| `MessageSenderService` | [`libs/frontend/chat/src/lib/services/message-sender.service.ts:329-420`](../../../libs/frontend/chat/src/lib/services/message-sender.service.ts#L329-L420) | Handles `chat:start` RPC invocation, transport errors, model selection, effort level, and stream initialization. **No longer on the launch path**: Start prefills the composer, so this service runs only when the USER presses send. |
| `PromptSuggestionsComponent` | [`libs/frontend/chat-ui/src/lib/molecules/setup-plugins/prompt-suggestions.component.ts:168-203, 342-345`](../../../libs/frontend/chat-ui/src/lib/molecules/setup-plugins/prompt-suggestions.component.ts#L168-L203) | Reference pattern for categorized prompt launches; emits `promptSelected` into chat input. |
| `TaskCardComponent` | [`libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts:403-432, 831-836`](../../../libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts#L403-L432) | Kanban card start action UI (`onStart`, `isolate` toggle, `canStart` predicate, `busyTaskId` rendering). |
| `TaskListComponent` | [`libs/frontend/tasks-ui/src/lib/components/board/task-list.component.ts:520-586, 953-956`](../../../libs/frontend/tasks-ui/src/lib/components/board/task-list.component.ts#L520-L586) | List view row action controls (`Start` button and `MoreVerticalIcon` dropdown with `Start isolated`). |
| `TasksStore.applyMetadata` | [`libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts:1447-1520`](../../../libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts#L1447-L1520) | Single client mutation funnel; issues serialized `tasks:updateMetadata` RPC and reloads authoritative board state. |
| `TasksRpcHandlers` | [`libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts:64-99`](../../../libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts#L64-L99) | `tasks:*` RPC namespace handling `tasks:board`, `tasks:get`, `tasks:getArtifact`, `tasks:updateMetadata`, and `tasks:changed` push broadcasting on file system index changes. |
| `AutocompleteRpcHandlers` | [`libs/backend/rpc-handlers/src/lib/handlers/autocomplete-rpc.handlers.ts:43-120`](../../../libs/backend/rpc-handlers/src/lib/handlers/autocomplete-rpc.handlers.ts#L43-L120) | Exposes `autocomplete:agents` RPC method to query discovered specialist roles from `.claude/agents/*.md`. |
| `AgentDiscoveryService` | [`libs/backend/workspace-intelligence/src/autocomplete/agent-discovery.service.ts:90-140`](../../../libs/backend/workspace-intelligence/src/autocomplete/agent-discovery.service.ts#L90-L140) | Scans workspace and user `.claude/agents/` directories, parses frontmatter metadata, and provides real-time file watching cache invalidation. |
| `AgentRpcHandlers` | [`libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts:65-80`](../../../libs/backend/rpc-handlers/src/lib/handlers/agent-rpc.handlers.ts#L65-L80) | Exposes `agent:detectClis` to check installed rival CLIs (Codex, Copilot, Cursor, Antigravity, OpenCode, Pi). |
| `Orchestration Skill` | [`.claude/skills/orchestration/SKILL.md:41-73`](../../../.claude/skills/orchestration/SKILL.md#L41-L73) | Defines `/orchestrate TASK_YYYY_NNN` continuation conventions, Gate 0.1 CLI lane discovery, subagent role handoffs, and deliverable verification. |
| `Lane Assignment Spec` | [`.claude/skills/orchestration/references/lane-assignment.md:1-75`](../../../.claude/skills/orchestration/references/lane-assignment.md#L1-L75) | Dictates how roles and phases map to subagents vs CLI lanes (Codex, Claude, Ollama GLM, Copilot). |

## Gaps

1. **No Agent Selection in `TaskStartRequest` or `TaskStartService`**:
   [`libs/frontend/tasks-ui/src/lib/services/task-start.service.ts:73-102`](../../../libs/frontend/tasks-ui/src/lib/services/task-start.service.ts#L73-L102)
   `TaskStartRequest` only contains `{ taskId: string; isolate: boolean }`. It has no concept of an assigned agent target (`agentId`, `role`, or `lane`), and `launchPrompt` hardcodes `${ORCHESTRATE_COMMAND} ${taskId}`. It needs an optional `targetAgent?: TaskAgentTarget` parameter to format agent-specific prompts.
2. **Missing Agent Roster Discovery Service in `tasks-ui`**:
   [`libs/frontend/tasks-ui/src/lib/services/`](../../../libs/frontend/tasks-ui/src/lib/services/)
   `tasks-ui` has no service querying available agents. A lightweight `TaskAgentDiscoveryService` is needed in `tasks-ui` to call existing RPC methods (`autocomplete:agents` for subagent roles and `agent:detectClis` for rival CLI lanes) and cache the roster for quick dropdown presentation.
3. **Task Card Start UI is a Single Direct Action Button**:
   [`libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts:422-432`](../../../libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts#L422-L432)
   The Kanban card has only a single `<button (click)="onStart()">Start</button>`. It lacks a split-button dropdown or secondary "Assign..." action to pick an agent target.
4. **Task List Row Actions Dropdown Lacks Agent Picker**:
   [`libs/frontend/tasks-ui/src/lib/components/board/task-list.component.ts:545-585`](../../../libs/frontend/tasks-ui/src/lib/components/board/task-list.component.ts#L545-L585)
   The `MoreVerticalIcon` dropdown menu in `TaskListComponent` only contains "Start isolated" and "Move to [status]". It needs an "Assign to agent..." submenu or modal trigger.
5. **No Visual Representation of Assigned/Running Agent on Task Card/Row**:
   [`libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts:443-452`](../../../libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts#L443-L452)
   While `busyTaskId` shows a spinner during the initial launch handshake, once the session is streaming, the task card/row only shows the generic `in_progress` badge. An indicator showing active execution with a link/click handler to focus the active chat tab does not exist.

## Proposed design

### 1. Agent Target Contract and Roster Resolution
Define a lightweight agent target model in `libs/frontend/tasks-ui/src/lib/types/task-agent.types.ts`:
```ts
export type AgentCategory = 'orchestrator' | 'specialist' | 'lane';

export interface TaskAgentTarget {
  readonly id: string;
  readonly name: string;
  readonly category: AgentCategory;
  readonly description?: string;
  readonly role?: string; // e.g. 'software-architect', 'backend-developer'
  readonly cli?: string;  // e.g. 'codex', 'copilot', 'cursor'
}
```
A new `TaskAgentDiscoveryService` in `tasks-ui`:
- Calls `autocomplete:agents` (`query: ''`) to discover `.claude/agents/*.md` roles (`software-architect`, `backend-developer`, `senior-tester`, `code-logic-reviewer`, `devops-engineer`, etc.).
- Calls `agent:detectClis` to discover detected rival CLIs on the host machine.
- Provides a computed signal `availableAgents` grouped by category:
  1. **Full Orchestrator** (Default: `/orchestrate <taskId>` full pipeline)
  2. **Specialist Roles** (In-app subagents: Architect, Backend, Frontend, Tester, Reviewer)
  3. **CLI Agent Lanes** (Rival CLIs: Codex, Copilot, Cursor)

### 2. Prompt Construction (Task Body and Directives)
In `TaskStartService.launchPrompt(taskId, isolate, agentTarget)`:
- The task body (`task.md`, `context.md`, `batches.md`) is **not** duplicated or inlined into the client-side prompt. Inlining large markdown files into the launch string would waste prompt tokens and drift from disk.
- Instead, following `orchestration/SKILL.md § Continuation`, the prompt references the task ID and specs folder:
  - If `category === 'orchestrator'`:
    `prompt = /orchestrate ${taskId}`
  - If `category === 'specialist'`:
    `prompt = /orchestrate ${taskId} --agent ${agentTarget.role}\n\nExecute phase for task ${taskId} using role @${agentTarget.role}. Refer to .ptah/specs/${taskId}/ for requirements and context.`
  - If `category === 'lane'`:
    `prompt = /orchestrate ${taskId} --lane ${agentTarget.cli}\n\nAssign task ${taskId} execution to background CLI lane ${agentTarget.cli} per agent-lanes guidelines. Deliverables belong in .ptah/specs/${taskId}/.`
- If `isolate === true`, append `ISOLATION_DIRECTIVE` (requesting agent-managed git worktree isolation).

### 3. Execution Data Flow: Click to Running Agent
1. **User Action**: The user clicks the "Assign to Agent" split button on a card or selects an agent from the row context menu in `task-list`.
2. **UI Event**: Card/Row emits `startTask({ taskId, isolate, targetAgent })` up to `TasksViewComponent`.
3. **Launch Initiation**: `TasksViewComponent.onStartTask` calls `TaskStartService.start(taskId, isolate, targetAgent)`.
4. **Busy State**: `TaskStartService` sets `_busyTaskId.set(taskId)`. All cards/rows for this task render a loading spinner and disable duplicate clicks.
5. **Prompt Dispatch**: `TaskStartService` builds the tailored prompt and invokes `AppStateManager.requestChatPrompt({ prompt, sessionName: taskId, resolve })`.
6. **Chat Bridge Adoption**: `TaskPromptBridgeService` (in `libs/frontend/chat`):
   - Creates a new chat tab via `TabManagerService.createTab(taskId)`.
   - Navigates view to `chat` via `appState.setCurrentView('chat')`.
   - In grid layout, adopts the tab as a canvas tile via `appState.requestCanvasTab(tabId, taskId)`.
   - Publishes the prompt via `appState.requestComposerPrefill(prompt, tabId)`. **Nothing is sent.** In grid layout the request carries the created tab id; in single layout it carries `null`, which scopes it to the main panel (only a canvas tile provides `SESSION_CONTEXT`).
7. **Composer Prefill**:
   - `ChatViewComponent` consumes the request on the surface whose `SESSION_CONTEXT` matches, and calls `restoreContentToInput(prompt)` — the same seam the Get Started panel uses.
   - When the composer has not mounted yet, the request stays PENDING and applies as soon as the input exists. It is cleared only after it is applied, so a recreated surface cannot replay it.
   - The prompt now sits in the composer. **The user reviews it and presses send.**
8. **Status Transition**:
   - The board writes NO status. `TaskStartService` issues no `tasks:updateMetadata` RPC and the card does not move on Start.
   - **The AGENT owns the status transition**, once it begins the work.

### 4. Running State and Agent Completion
- **Running State Representation**:
  - `TasksStore` tracks active session associations (mapping `taskId` to `tabId` via `TabManagerService`).
  - In `in_progress` status, the card/row displays an animated pulse badge and an affordance "View session" that calls `appState.setCurrentView('chat')` with the corresponding tab activated.
- **Completion Transition**:
  - The agent in the chat session conducts the task, runs verification, and edits the `status:` line in `task.md` directly (`status: in_review` or `status: done`).
  - `TaskIndexService` file watcher detects the change, triggers `onDidChangeIndex`, and broadcasts `tasks:changed` over RPC.
  - `TasksStore` receives `tasks:changed`, runs `refreshBoard()`, and re-renders the task in its new column (`in_review` or `done`) without manual page refresh.

## Files to change

| File | Change | Layer |
| --- | --- | --- |
| `libs/frontend/tasks-ui/src/lib/types/task-agent.types.ts` | CREATE: Defines `TaskAgentTarget`, `AgentCategory`, and extends `TaskStartRequest` with `targetAgent?: TaskAgentTarget`. | Frontend (`tasks-ui`) |
| `libs/frontend/tasks-ui/src/lib/services/task-agent-discovery.service.ts` | CREATE: Injects `ClaudeRpcService`, calls `autocomplete:agents` and `agent:detectClis`, exposing signal `availableAgents`. | Frontend (`tasks-ui`) |
| `libs/frontend/tasks-ui/src/lib/services/task-start.service.ts` | MODIFY: Updates `start()` and `launchPrompt()` to accept `targetAgent` and format agent/lane directives in the `/orchestrate` prompt. | Frontend (`tasks-ui`) |
| `libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts` | MODIFY: Replaces solitary Start button with a split button / dropdown menu for agent selection; wires `targetAgent` emission. | Frontend (`tasks-ui`) |
| `libs/frontend/tasks-ui/src/lib/components/board/task-list.component.ts` | MODIFY: Updates row dropdown menu (`MoreVerticalIcon`) to add an "Assign to agent..." sub-menu with available agents. | Frontend (`tasks-ui`) |
| `libs/frontend/tasks-ui/src/lib/components/board/task-card.component.html` (or inline template) | MODIFY: Adds active session link and running indicator for `in_progress` tasks. | Frontend (`tasks-ui`) |
| `libs/frontend/tasks-ui/src/index.ts` | MODIFY: Exports `TaskAgentDiscoveryService` and `TaskAgentTarget`. | Frontend (`tasks-ui`) |

## Out of scope v1

- **Bulk Agent Assignment**: Assigning multiple selected tasks in bulk from `task-bulk-bar`. Starting simultaneous agent sessions violates agent concurrency bounds (max 3 CLI lanes, 1 active foreground chat turn) and violates Guideline 6 of `tasks-ui/CLAUDE.md`.
- **Headless Background CLI Spawn without Chat Conductor**: Spawning CLI lanes directly via a new backend RPC method without a chat session. Background CLI agents cannot ask user questions, cannot approve human checkpoints (Gate 1 requirements, Gate 2 architecture), and lack an interactive streaming transcript.
- **Modifying `task.md` Frontmatter Schema**: Adding custom fields (like `assigned_agent:` or `lane:`) to `TASK_METADATA_PATCH_SHAPE` in `task-view.schemas.ts`. Preserving the strict shared frontmatter schema maintains parity across CLI, MCP, RPC, and extension.
- **Automated Worktree Merges**: Automatic git merges or branch deletions upon agent completion. Merging remains gated on user review and human QA.
- **In-Card Embedded Terminal / Streaming Output**: Rendering raw xterm or stdout streams directly inside Kanban cards. Detailed turn progress remains in the dedicated Chat/Canvas surface.
