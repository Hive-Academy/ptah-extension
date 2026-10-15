# CI fix e2e round 2 - PR 730 (head 7dbb2d6bc, run 38664216103)

## Verdicts

- Spec 1, `canvas.spec.ts` "Swap panes changes only the visual order" (shard 1): **SPEC-ONLY**. No product defect.
- Spec 2, `task-337-agent-card-refresh.spec.ts` (shard 4): **SPEC-ONLY**. No product defect.

## Spec 1 - evidence and fix

- Failure: `canvas.spec.ts:172` `expect(firstAfter).not.toBe(firstBefore)`, got `left`. The spec read
  `style.order` once, right after the menu click, with no retry.
- Product rule (`implementation-plan-rail-r9-split.md:26`): Swap only changes the `visualOrder` signal that
  drives the wrappers' CSS `order`. `activeSide`, tab ids, hosts and ChatViews stay put.
  `canvas-rail-board.component.ts:617-624` (`swapPanes`) and `:158` (`[style.order]="visualOrder().indexOf(side)"`)
  follow that rule.
- The CI failure snapshot (`error-context.md`, shard 1) shows the swap did take effect: the active pane is labelled
  "Top session ... active" and the other "Bottom session", i.e. the order flipped. The assertion simply read the
  DOM before Angular rendered the new `order` (a signal write is applied on the next render, not synchronously).
  This is a read-before-render race, not a wrong order.
- Fix (`apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts`): new non-throwing helper `visualSide(page, position)`;
  `firstBefore` uses it, and the assertion is now `await expect.poll(() => visualSide(page, 0)).not.toBe(firstBefore)`.
  The same race existed in the "stacked split after a swap tabs ..." case (`visualPane(page, 0)` read right after the
  Swap click); it now polls for the order change before taking the top pane. No fixed sleeps.

## Spec 2 - evidence and fix

- Failure: `task-337-agent-card-refresh.spec.ts:211` `toHaveCount(1)` for `ptah-inline-agent-bubble` in
  `ptah-canvas-focus-area`, got 0.
- Cause: the Rail transcript renders agents with `agentTileMode=true` (`chat-transcript.component.html:50`), which
  renders `ptah-subagent-tile` (`execution-node.component.ts:340-345`). The full card (`ptah-inline-agent-bubble`)
  renders only with tile mode off, i.e. in the sub-agent lane (`canvas-lane-view.component.ts:149-153`).
- Fix (`apps/ptah-electron-e2e/src/specs/task-337-agent-card-refresh.spec.ts`): wait for the tile in the focus area,
  assert its agent type, click its `[data-testid="subagent-open"]` button (opens the lane through
  `SESSION_CARD_ACTIONS.openLane`; the monitor record needed by the lane comes from the same `agent_start` chunk via
  `accumulator-core.service.ts:498`), then keep every original assertion on `ptah-inline-agent-bubble`
  (summary appends, `1 tools` -> `2 tools`). The test intent (the agent card re-renders on summary / tool count) is
  unchanged. All waits are Playwright auto-wait locators.
- Note: I could not run e2e (forbidden). The lane-open step is derived from source; if the lane does not open in CI,
  the tile click is the first place to look (`canvas-detail.service` `open()` returning false shows an unavailable notice).

## Checks (via `.ptah/tmp/check-run.mjs`)

- `npx nx typecheck ptah-electron-e2e --parallel=1 --skip-nx-cache`: pass.
- `npx nx lint ptah-electron-e2e --parallel=1 --skip-nx-cache`: pass, 0 errors (17 pre-existing warnings, none in the two edited files).
- E2E not run (not allowed).

## Files changed

- `apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts`
- `apps/ptah-electron-e2e/src/specs/task-337-agent-card-refresh.spec.ts`
