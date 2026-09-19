## Fixes

1. `libs/frontend/tasks-ui/src/lib/components/board/task-list.component.ts:570` — added `[attr.tabindex]="rovingTabIndex(task.id)"` to the assignment `<summary>`, so every row except the roving-focus owner receives `tabindex="-1"`.
2. `libs/frontend/tasks-ui/src/lib/services/task-agent-discovery.service.ts:48` and `:60` — replaced the coupled failure guard with independent mappings: `agentsResult.success && agentsResult.data !== undefined ? ... : []` for specialists and `clisResult.success && clisResult.data !== undefined ? ... : []` for lanes. The final roster is now `[ORCHESTRATOR_TARGET, ...specialists, ...lanes]`, preserving whichever RPC succeeded and becoming orchestrator-only only when neither yielded entries.
3. `libs/frontend/tasks-ui/src/lib/services/task-agent-discovery.service.ts:61` — changed lane mapping to `(clisResult.data.clis ?? []).filter(...)`, so a successful response with no `clis` field resolves to an empty lane list instead of throwing.
4. `libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts:450` and `libs/frontend/tasks-ui/src/lib/components/board/task-list.component.ts:575` — wrapped each Orchestrator title and its entries in `@if (orchestratorAgents().length > 0) { ... }`, matching the specialist and lane sections and suppressing empty headers.

## Tests added

`libs/frontend/tasks-ui/src/lib/services/task-agent-discovery.service.spec.ts`

- `keeps specialists when CLI detection fails`
- `keeps CLI lanes when agent discovery fails`
- `handles a successful CLI response with no clis field`

## Verification

```text
> npx nx run-many -t typecheck -p @ptah-extension/tasks-ui

 NX   Running target typecheck for project @ptah-extension/tasks-ui:

- @ptah-extension/tasks-ui

> nx run @ptah-extension/tasks-ui:typecheck

> npx ngc --noEmit --project libs/frontend/tasks-ui/tsconfig.lib.json

(node:21244) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:16244) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

 NX   Successfully ran target typecheck for project @ptah-extension/tasks-ui

Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.
```

```text
> npx nx run-many -t lint -p @ptah-extension/tasks-ui

 NX   Running target lint for project @ptah-extension/tasks-ui:

- @ptah-extension/tasks-ui

> nx run @ptah-extension/tasks-ui:lint

(node:10224) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

Linting "@ptah-extension/tasks-ui"...

D:\projects\ptah-extension\.claude-worktrees\tasks-page-agents\libs\frontend\tasks-ui\src\lib\components\board\task-list.component.ts
  836:1  warning  File has too many lines (944). Maximum allowed is 700  max-lines

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

(node:1908) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:7072) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:23732) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:12452) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:13860) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:31192) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:36544) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:30584) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:26500) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:22056) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:11840) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:32604) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:18936) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:29832) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:35088) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)
(node:23096) Warning: The 'NO_COLOR' env is ignored due to the 'FORCE_COLOR' env being set.
(Use `node --trace-warnings ...` to show where the warning was created)

Test Suites: 18 passed, 18 total
Tests:       599 passed, 599 total
Snapshots:   0 total
Time:        12.135 s
Ran all test suites.

 NX   Successfully ran target test for project @ptah-extension/tasks-ui

Your AI agent configuration is outdated. Run "nx configure-ai-agents" to update.
```
