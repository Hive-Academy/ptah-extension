## Files changed

| File | Created or modified | What it does now |
| --- | --- | --- |
| `libs/frontend/tasks-ui/src/lib/types/task-agent.types.ts` | Created | Defines `AgentCategory`, `TaskAgentTarget`, and the extended `TaskStartRequest` with optional `targetAgent`. |
| `libs/frontend/tasks-ui/src/lib/services/task-agent-discovery.service.ts` | Created | Loads specialist roles and installed, enabled CLI lanes through the two existing RPC methods, caches the category-ordered roster, and falls back to Full Orchestrator on failure. |
| `libs/frontend/tasks-ui/src/lib/services/task-agent-discovery.service.spec.ts` | Created | Covers roster mapping, installed-lane filtering, caching, resolved RPC failure, and rejected transport fallback. |
| `libs/frontend/tasks-ui/src/lib/services/task-start.service.ts` | Modified | Accepts an optional target and constructs the exact orchestrator, specialist, or CLI-lane prompt while preserving the original no-target prompt. |
| `libs/frontend/tasks-ui/src/lib/services/task-start.service.spec.ts` | Modified | Covers the exact specialist, lane, explicit-orchestrator, no-target, and isolation prompt behavior. |
| `libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts` | Modified | Replaces the single Start control with a split action whose secondary button opens the category-grouped roster and emits the selected target. |
| `libs/frontend/tasks-ui/src/lib/components/board/task-card.component.spec.ts` | Modified | Covers emitting a selected specialist target from the card assignment menu. |
| `libs/frontend/tasks-ui/src/lib/components/board/task-column.component.ts` | Modified | Passes the discovered roster to every task card. |
| `libs/frontend/tasks-ui/src/lib/components/board/task-board.component.ts` | Modified | Accepts and forwards the same roster used by list view. |
| `libs/frontend/tasks-ui/src/lib/components/board/task-board.component.spec.ts` | Modified | Updates the roving-tabindex invariant for the split button's two added focusable elements. |
| `libs/frontend/tasks-ui/src/lib/components/board/task-list.component.ts` | Modified | Adds an “Assign to agent…” submenu to each startable row's overflow menu and emits the selected target. |
| `libs/frontend/tasks-ui/src/lib/components/board/task-list.component.spec.ts` | Modified | Covers emitting a selected CLI lane from the row assignment submenu. |
| `libs/frontend/tasks-ui/src/lib/components/tasks-view.component.ts` | Modified | Loads the cached roster, supplies it to both interchangeable layouts, and passes the selected target into `TaskStartService`. |
| `libs/frontend/tasks-ui/src/index.ts` | Modified | Exports the discovery service and new task-agent types. |

## Prompt formats

Orchestrator target (`isolate === false`):

```text
/orchestrate ${taskId}
```

Specialist target (`isolate === false`):

```text
/orchestrate ${taskId} --agent ${agentTarget.role}

Execute phase for task ${taskId} using role @${agentTarget.role}. Refer to .ptah/specs/${taskId}/ for requirements and context.
```

CLI lane target (`isolate === false`):

```text
/orchestrate ${taskId} --lane ${agentTarget.cli}

Assign task ${taskId} execution to background CLI lane ${agentTarget.cli} per agent-lanes guidelines. Deliverables belong in .ptah/specs/${taskId}/.
```

No target (`isolate === false`, byte-identical to the previous behavior):

```text
/orchestrate ${taskId}
```

For any category when `isolate === true`, the following exact suffix is appended to its prompt:

```text


Isolate all implementation for this task in a dedicated git worktree — delegate file-editing work to worktree-isolated subagents so changes stay off the main working tree until reviewed.
```

## Deviations from the plan

none

## Verification

```text
> npx nx run-many -t typecheck -p @ptah-extension/tasks-ui

 NX   Running target typecheck for project @ptah-extension/tasks-ui:

- @ptah-extension/tasks-ui

> nx run @ptah-extension/tasks-ui:typecheck

> npx ngc --noEmit --project libs/frontend/tasks-ui/tsconfig.lib.json

(node:7488) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:23052) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

 NX   Successfully ran target typecheck for project @ptah-extension/tasks-ui

Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.
```

```text
> npx nx run-many -t lint -p @ptah-extension/tasks-ui

 NX   Running target lint for project @ptah-extension/tasks-ui:

- @ptah-extension/tasks-ui

> nx run @ptah-extension/tasks-ui:lint

(node:13608) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

Linting "@ptah-extension/tasks-ui"...

D:\projects\ptah-extension\.claude-worktrees\tasks-page-agents\libs\frontend\tasks-ui\src\lib\components\board\task-list.component.ts
  836:1  warning  File has too many lines (936). Maximum allowed is 700  max-lines

D:\projects\ptah-extension\.claude-worktrees\tasks-page-agents\libs\frontend\tasks-ui\src\lib\components\tasks-view.component.ts
  756:1  warning  File has too many lines (1092). Maximum allowed is 700  max-lines

D:\projects\ptah-extension\.claude-worktrees\tasks-page-agents\libs\frontend\tasks-ui\src\lib\services\tasks-store.service.ts
  1901:1  warning  File has too many lines (1066). Maximum allowed is 700  max-lines

✖ 3 problems (0 errors, 3 warnings)

 NX   Successfully ran target lint for project @ptah-extension/tasks-ui

Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.
```

```text
> npx nx run-many -t test -p @ptah-extension/tasks-ui

 NX   Running target test for project @ptah-extension/tasks-ui:

- @ptah-extension/tasks-ui

> nx run @ptah-extension/tasks-ui:test

(node:15404) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:34796) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:30556) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:38084) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:30776) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:32904) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:14496) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:4132) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:36004) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:18280) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:22920) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:31540) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:21600) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:16020) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:26364) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:35376) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

Test Suites: 18 passed, 18 total
Tests:       597 passed, 597 total
Snapshots:   0 total
Time:        12.33 s
Ran all test suites.

 NX   Successfully ran target test for project @ptah-extension/tasks-ui

Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.
```
