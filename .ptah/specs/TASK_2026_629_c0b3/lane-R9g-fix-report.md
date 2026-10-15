# R9g fix report

## Fixes

1. **Module boundary:** `libs/frontend/chat-ui/src/index.ts:39` now exports `formatAgentElapsed`; `libs/frontend/chat/src/lib/components/organisms/execution/subagent-tile.component.ts:5` imports it from `@ptah-extension/chat-ui`. The execution tile has no cross-library relative import.
2. **Status:** `subagent-tile.component.ts:64-74` resolves record and node terminal states before the persistent background flag. `resumed` displays **Stopped** with the stopped icon. New cases at `subagent-tile.component.spec.ts:59-99` cover completed background, resumed, failed/stopped/killed records, and a node error; terminal cases assert no loader icon.
3. **Lane key:** `subagent-tile.component.ts:7,101` uses the existing `laneKey` function and the same `record.status === 'background'` predicate as `compact-lane-rows.ts`. A completed or running record on a background node opens `sub:task-1`; a record whose status is `background` opens `bg:task-1`. The permission-click case at `subagent-tile.component.spec.ts:110` compares the opened key with `buildLaneSummary`'s row id. The no-provider case at `:124` confirms disabled buttons and a safe click.

## Checks

- `node .ptah/tmp/check-run.mjs fix-R9g -- npx nx test chat --testFile=subagent-tile.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: **11 passed**.
- `node .ptah/tmp/check-run.mjs fix-R9g -- npx nx test chat --testFile=execution-node.ptah-ui.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: **30 passed**.
- `node .ptah/tmp/check-run.mjs fix-R9g -- npx nx test chat --testFile=message-bubble.component.spec.ts --coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`: **18 passed**.
- Scoped `ptah_get_diagnostics`: no diagnostics in the three changed source/spec files. It also reported 266 errors in sibling project files; this is not a project-wide typecheck pass.

## Decisions

- Kept the permission badge disabled when `SESSION_CARD_ACTIONS` is absent, as required by the R9g contract. The permission dead end remains the R9n acceptance gate and was not changed here.
- Used the already exported `laneKey` from the chat library so the prefix definition stays with the lane builder; only the record-status predicate is repeated, matching that builder's existing rule.
