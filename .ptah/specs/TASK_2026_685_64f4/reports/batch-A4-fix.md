# Batch A4 fix

## Failures and fixes

1. **Live progress assertion** — The component already passes `subagentProgressText(record)` to the shared header's `peek` input. `TurnDisclosureRowComponent` renders the peek with `aria-hidden="true"` and intentionally excludes it from the accessible name, so the spec was asserting the wrong surface. The spec now checks the visible peek text and confirms it is omitted from the stable accessible name. `libs/frontend/chat/src/lib/components/organisms/subagent-lane/subagent-lane.component.spec.ts:105-111`.
2. **Execution node and Stop** — The canvas spec's override removed `SubagentLaneComponent` from the lane view's imports. Its old root-node assertion also predated A4's child-node contract. The spec now imports the real lane, checks that it receives the agent's children and renders the child execution node, then clicks the lane header's Stop button and verifies `stopAgent('task-1', 'owner')`. `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.spec.ts:758-835`.
3. **Nested Copy** — This spec had the same override and root-node assumption. It now mounts the real lane and asserts that the child execution node and its nested Copy control render. `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-view.component.spec.ts:873-936`.

## Decisions

- Kept live progress out of the row's accessible name because the shared disclosure component explicitly keeps its live peek `aria-hidden` to avoid repeated announcements. The alternative was changing a shared component outside A4 ownership. This test correction is reversible.
- Used the existing `SessionAgentTrayService` in the canvas integration test so Stop still exercises the route to `AgentMonitorStore.stopAgent`. The alternative was a mocked tray that would only check a callback. This is reversible.

## Verification

- Did not run tests, typecheck, lint, or build, as directed. Scoped `ptah_get_diagnostics` was attempted on the two edited specs; its TypeScript check timed out after 45 seconds and reported both files unchecked.
- Orchestrator check: `npx nx run-many -t test -p @ptah-extension/chat @ptah-extension/canvas --parallel=1` (with Jest `--maxWorkers=2` in the project configuration or scoped Jest invocation).

## Files changed

- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\chat\src\lib\components\organisms\subagent-lane\subagent-lane.component.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\libs\frontend\canvas\src\lib\canvas-detail\canvas-lane-view.component.spec.ts`
- `D:\projects\ptah-extension\.claude-worktrees\lane-execution-stream\.ptah\specs\TASK_2026_685_64f4\reports\batch-A4-fix.md`
