# Batch 4 report — TASK_2026_705_9d53

## Task 4.1 — chat-ui dead components

- DELETED libs/frontend/chat-ui/src/lib/molecules/session/tab-item.component.ts
- DELETED libs/frontend/chat-ui/src/lib/atoms/awaiting-background-indicator/ (component, spec, folder)
- MODIFIED libs/frontend/chat-ui/src/index.ts — removed the `AwaitingBackgroundIndicatorComponent`
  and `TabItemComponent` exports.
- Grep of `libs/` and `apps/` for `TabItemComponent|ptah-tab-item|AwaitingBackgroundIndicator|
  awaiting-background-indicator|tab-item.component`: only the deleted files and the two barrel lines
  matched before the change. There are zero matches after it, so no other consumers exist.

## Task 4.2 — e2e / showcase

- MODIFIED apps/ptah-electron-e2e/src/specs/canvas/canvas.spec.ts — renamed the test to
  "Electron ignores a stale ptah-layout-mode value and opens the Rail board". The body is unchanged.
- MODIFIED apps/ptah-electron-e2e/src/showcase/lane-console-review.scene.ts — removed the
  `if (!visible(grid))` "Toggle canvas grid / single chat" click from `goToCanvas` and kept the
  30 s `grid.waitFor`. `visible` is still used elsewhere (lines ~144, 243, 336, 408), so I kept it.

## Decisions

- I removed the `director` parameter from `goToCanvas` and updated its one call site
  (`goToCanvas(page)`). Removing the toggle left that parameter unused, and
  `@typescript-eslint/no-unused-vars` would flag it. Other functions still use the `Director` type
  import. The other option was to keep an unused param. This is reversible.

## Verification

No checks were run, as the orchestrator instructed. The scoped check is pending: chat-ui test/lint
and ptah-electron-e2e typecheck/lint.
