# Code Logic Review — `TASK_2026_471_c054`

## Summary

| Metric              | Value    |
| ------------------- | -------- |
| Overall score       | 8/10     |
| Assessment          | APPROVED |
| Blocking issues     | 0        |
| Serious issues      | 0        |
| Moderate issues     | 3        |
| Failure modes found | 3        |

## Five logic questions

### 1. How does this fail silently?

- `libs/frontend/tasks-ui/src/lib/services/task-agent-discovery.service.ts:47-55`: If either `autocomplete:agents` or `agent:detectClis` fails or times out, the service discards all data from both and falls back to `[ORCHESTRATOR_TARGET]`. Discovered specialist agents are silently dropped if CLI detection fails.
- `libs/frontend/tasks-ui/src/lib/services/task-start.service.ts:148-166`: If a `targetAgent` is passed with `category: 'specialist'` but missing `role`, or `category: 'lane'` but missing `cli`, the prompt generator silently falls through to `/orchestrate ${taskId}` without indicating that the role or lane parameter was skipped.

### 2. What user action produces unexpected behaviour?

- `libs/frontend/tasks-ui/src/lib/components/board/task-list.component.ts:569`: Tabbing through the task list with the keyboard will land on `<summary>Assign to agent…</summary>` on all startable rows because `<summary>` lacks `[attr.tabindex]="rovingTabIndex(task.id)"`, breaking the single-tab-stop roving tabindex navigation.
- `libs/frontend/tasks-ui/src/lib/components/board/task-list.component.ts:587,615,644`: In list view, selecting an agent always runs with `isolate: false`, with no user option to launch an assigned agent into an isolated git worktree.

### 3. What input data produces a wrong answer?

- `libs/frontend/tasks-ui/src/lib/services/task-agent-discovery.service.ts:66`: If `agent:detectClis` returns a payload where `clis` is nullish, calling `clisResult.data.clis.filter(...)` throws a `TypeError` (caught by `catch (error: unknown)` and collapsed to orchestrator).
- `libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts:450`: If `agentTargets` is empty array `[]`, the menu renders an empty section with just the "Orchestrator" header and zero items.

### 4. What happens when a dependency fails?

- `ClaudeRpcService`: If `autocomplete:agents` or `agent:detectClis` fails or rejects, `TaskAgentDiscoveryService` catches the error, logs a console warning, and falls back to `[ORCHESTRATOR_TARGET]`.
- `AppStateManager.requestChatPrompt`: If the chat session does not resolve within 30 seconds, `RESOLVE_GUARD_TIMEOUT_MS` triggers, setting `success: false` and clearing the busy lock.

### 5. What is missing that the requirements never mentioned?

- Cache invalidation on `TaskAgentDiscoveryService`: The service caches its discovery promise permanently. If new agent files or rival CLIs are installed during a session, the roster is not updated until restart.
- Worktree isolation option for agent assignments in list view.

## Failure modes

### Coupled RPC Discovery Failure

- Trigger: Host machine has a transient error or permission restriction executing `agent:detectClis`.
- Symptom: No specialist agents appear in the card or list assignment dropdowns; only "Full Orchestrator" is available.
- Evidence: `libs/frontend/tasks-ui/src/lib/services/task-agent-discovery.service.ts:47-55`
- Current handling: If either RPC fails, both are discarded and reset to `[ORCHESTRATOR_TARGET]`.
- Recommendation: Resolve both queries independently so specialist subagents remain available even if rival CLI detection fails.

### Roving Tabindex Leak on Summary

- Trigger: User navigates the task list using the Tab key.
- Symptom: Tab focus lands on the nested `<summary>` element of startable rows despite the row not being focused.
- Evidence: `libs/frontend/tasks-ui/src/lib/components/board/task-list.component.ts:569`
- Current handling: `<summary>Assign to agent…</summary>` has no `tabindex` attribute and retains default browser tabindex 0.
- Recommendation: Add `[attr.tabindex]="rovingTabIndex(task.id)"`.

### Nullish CLIs Array on RPC Success

- Trigger: Backend returns `{ success: true, data: {} }` or `{ clis: undefined }`.
- Symptom: Discovery throws a TypeError and degrades to orchestrator-only.
- Evidence: `libs/frontend/tasks-ui/src/lib/services/task-agent-discovery.service.ts:66`
- Current handling: `clisResult.data.clis.filter(...)` without fallback.
- Recommendation: Use `(clisResult.data.clis ?? []).filter(...)`.

## Blocking issues

none

## Serious issues

none

## Moderate and minor issues

- `libs/frontend/tasks-ui/src/lib/components/board/task-list.component.ts:569`: Missing roving tabindex on `<summary>` element.
- `libs/frontend/tasks-ui/src/lib/services/task-agent-discovery.service.ts:47-55`: Coupled RPC failure handling discards specialist subagents when CLI detection fails.
- `libs/frontend/tasks-ui/src/lib/services/task-agent-discovery.service.ts:66`: Missing nullish fallback on `clisResult.data.clis`.
- `libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts:450`: Unconditional rendering of Orchestrator section header when targets are empty.
- `libs/frontend/tasks-ui/src/lib/components/board/task-list.component.ts:587`: List view cannot start an assigned agent with worktree isolation.
- `libs/backend/task-specs/src/lib/task-doctor.service.ts:353`: Missing DI metadata reflection test for `TaskDoctorService.writer`.

## Data flow

1. `TasksViewComponent.ngOnInit` triggers `agentDiscovery.load()` [OK]
2. `TaskAgentDiscoveryService` issues concurrent `autocomplete:agents` and `agent:detectClis` RPCs [OK, safe fallback]
3. Roster signal `availableAgents` feeds into `TaskBoardComponent` and `TaskListComponent` inputs [OK]
4. User selects agent target from card split dropdown or list row submenu [OK]
5. Event `startTask` emitted with `{ taskId, isolate, targetAgent }` up to `TasksViewComponent` [OK]
6. `TaskStartService.start` sets busy indicator and constructs targeted `/orchestrate` prompt [OK]
7. `appState.requestChatPrompt` dispatches prompt to chat conductor [OK]
8. On success, `TasksStore.updateStatus(taskId, 'in_progress')` commits metadata update [OK]

## Requirements fulfilment

| Requirement                       | Status   | Gap                                                    |
| --------------------------------- | -------- | ------------------------------------------------------ |
| Batch 0 DI Token Fixes            | COMPLETE | Resolved bundling crash; test added for scanner token  |
| Batch A Get Started Cards Refresh | COMPLETE | All 28 cards mapped to valid disk commands/skills      |
| Batch B Agent Assignment Roster   | COMPLETE | Discovered via existing RPCs, cached, category-ordered |
| Batch B Card Split Button UI      | COMPLETE | Dropdown with orchestrator, specialists, and CLI lanes |
| Batch B List View Submenu         | COMPLETE | Assign submenu in row actions menu                     |
| Boundary Invariants (NFR-11)      | COMPLETE | No backend imports in frontend, no new RPC methods     |

Implicit requirements not addressed: Isolation support in list view agent assignment.

## Edge cases

| Case                              | Handled | How                                              | Concern                             |
| --------------------------------- | ------- | ------------------------------------------------ | ----------------------------------- |
| RPC failure during discovery      | YES     | Falls back to Full Orchestrator                  | Drops specialists if only CLIs fail |
| RPC transport rejection           | YES     | Catch block warns and sets default roster        | None                                |
| Uninstalled CLI tools             | YES     | Filtered out by `cli.installed && !cli.disabled` | None                                |
| Card clicked while launch pending | YES     | Guarded by `_busyTaskId` in `TaskStartService`   | None                                |
| Empty agent targets array         | PARTIAL | Renders header with 0 items                      | Cosmetic empty header               |
| Keyboard navigation across cards  | YES     | Roving tabindex preserved on card and controls   | `<summary>` in list view            |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: In list view, `<summary>` element on startable rows retains default tabindex 0 instead of roving tabindex.
- What a robust implementation would add: Independent resolution of specialist agents vs CLI detection; roving tabindex on `<summary>` in list view; worktree isolation option in list view agent assignment.
