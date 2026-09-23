# Singleton tile resize — TASK_2026_534_lane_console

Implemented the requested canvas-only follow-up. A full-height singleton honours its stored width and supports horizontal resize; Layout Focus still fills it and pauses gestures.

## Files changed

Workspace root: `D:/projects/ptah-extension/.claude-worktrees/feat-task-2026-534-resizable-lane-console-438e420c2e66`.

- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/feat-task-2026-534-resizable-lane-console-438e420c2e66/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts` — remove forced singleton width and resize suppression; preserve height, reorder restrictions, focus and lock behaviour.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/feat-task-2026-534-resizable-lane-console-438e420c2e66/libs/frontend/canvas/src/lib/canvas-workspace-grid.component.spec.ts` — singleton width, resize, restoration, focus, lock and transition regressions.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/feat-task-2026-534-resizable-lane-console-438e420c2e66/libs/frontend/canvas/src/lib/canvas-layout-controls.component.ts` — enable the dock and lock/unlock for one tile; keep presets disabled.
- MODIFIED `D:/projects/ptah-extension/.claude-worktrees/feat-task-2026-534-resizable-lane-console-438e420c2e66/libs/frontend/canvas/src/lib/canvas-layout-controls.component.spec.ts` — lock/unlock and two-to-one-to-zero dock transitions.
- CREATED `D:/projects/ptah-extension/.claude-worktrees/feat-task-2026-534-resizable-lane-console-438e420c2e66/.ptah/specs/TASK_2026_534_lane_console/singleton-tile-resize.md` — this report.

No changes to chat-ui, Electron E2E, another worktree, or git state through git commands. `canvas-tile.component.ts` needed no edit: it already exposes width/focus actions, guards lock, and disables row placement for the first tile.

## Acceptance evidence

Paths below are relative to the workspace root.

| Criterion | Implementation and regression evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1        | `libs/frontend/canvas/src/lib/canvas-workspace-grid.component.ts:149` retains only the full-height override, leaving width to Gridstack. `:202` retains e/w handles. `:311` separates noMove from noResize; `:459` rejects singleton drag only; `:624` applies menu spans; `:805` allows singleton resize. Specs at `canvas-workspace-grid.component.spec.ts:1219` cover all four menu spans, `:1251` covers snapping an edge resize to two-thirds, and `:1324` checks Full default and enabled engine resize. Existing responsive minimum-width promotion remains identical to multi-tile canvases. |
| S2        | `canvas-workspace-grid.component.ts:255`, `:311`, `:459`, `:805` retain focus height and gesture guards. Existing layout projection supplies 12-column width. Spec `canvas-workspace-grid.component.spec.ts:1271` checks Full during focus, rejected resize, and restored half-width/resize on exit. Compact/tall focus coverage remains in the singleton suite.                                                                                                                                                                                                                                     |
| S3        | Existing auto/span discriminator is the width-choice signal; no persistence migration. Detailed rule and evidence below. Spec `canvas-workspace-grid.component.spec.ts:1236` hydrates default and legacy-weight auto records at Full and explicit third/half records at their chosen widths.                                                                                                                                                                                                                                                                                                         |
| S4        | `canvas-layout-controls.component.ts:145` disables the dock only for zero tiles; `:146` keeps presets disabled at one tile or under lock; `:149` and `:182` enable and guard lock/unlock. Specs `canvas-layout-controls.component.spec.ts:72` and `:101` cover locked/unlocked singletons and count transitions. Grid spec `canvas-workspace-grid.component.spec.ts:1297` verifies lock blocks both menu writes and resize, then restores resize on unlock.                                                                                                                                          |
| S5        | Removed `isSingletonExpanded`, `singleton-expanded`, forced singleton width/position, and the blanket singleton handle-hiding selector. `canvas-workspace-grid.component.ts:149` retains needed full-height CSS, `:158` retains the compact pixel-height workaround, and `:164` hides genuinely disabled handles. `isSingleton` remains for height classification and meaningless reorder suppression.                                                                                                                                                                                               |
| S6        | Updated prior frozen/fill assertions and 1→2→1 option-identity assertions. Added 11 grid cases and a net 2 control cases. Final project result: 9 suites and 189 tests passed.                                                                                                                                                                                                                                                                                                                                                                                                                       |

## S3 rule: preserve implicit Full and honour explicit choices

The stored default is `{ kind: 'auto', weight: 1 }`, not a hidden named third or half (`canvas-layout-intent.ts:41`, `:50`). Both newly appended/reconciled tiles (`:207`) and store-created tiles (`canvas.store.ts:500`) use that default. A full-height auto singleton receives all 12 columns through `finishPreferredRow` and apportionment (`canvas-layout-intent.ts:416`, `:434`, `:446`), including legacy non-unit auto weights.

Named spans already record deliberate layout choices: `CanvasStore.setTileSpan` writes `kind: 'span'` (`canvas.store.ts:313`); resize delegates to it (`:309`). Explicit presets also write named widths (`canvas-layout-intent.ts:576`). The v2 storage schema preserves that distinction (`canvas-layout-persistence.service.ts:23`, `:192`), while v1 migration preserves weights as auto widths (`:104`). Hydration reconciles these records without fabricating spans (`canvas.store.ts:420`).

Therefore untouched/new/legacy-auto singletons remain Full with no upgrade shrink. Existing explicit named spans are honoured, including a span deliberately selected while the former CSS override concealed its effect. This rule treats the existing named-span discriminator as the explicit-choice signal; it does not claim that storage records whether the chosen width was previously visible. Resetting all named singleton spans would discard explicit choices and valid compact widths. No new marker, version bump, migration, or default change was introduced.

## Control choices and states

- Lock/unlock and the Layout dock are meaningful for a singleton because resizing now changes its layout.
- Presets stay disabled for one tile: they arrange groups, while singleton width has its own menu.
- Reorder drag stays disabled for one tile because there is no reorder target.
- Row placement stays disabled for the first tile (`canvas-tile.component.ts:278`, `:572`), which includes every singleton.
- Layout Focus remains available because it temporarily expands a deliberately narrow singleton.
- Zero tiles close/disable the dock; multi-tile behaviour is retained.
- Existing native buttons, labels, menu keyboard handling, and popover focus return remain in use. The obsolete singleton-unavailable trigger label was replaced with “Layout options.” No new loading, external-data, or error states were introduced.

The interaction effect now tracks lock/focus/count/view signals before checking engine availability (`canvas-workspace-grid.component.ts:424`), ensuring lock changes reapply engine flags even when the engine attaches after the initial effect.

## Stack and boundaries

Angular 22.1.7 comes from root `package.json`; standalone imports, OnPush, signals/computed/effect follow the existing grid, tile and dock. Styling remains existing component CSS and Tailwind/daisyUI classes, with the existing NativePopover. No new dependency, shared primitive, token, external access or markup-rendering path. Canvas is `scope:webview`, `type:feature` in `libs/frontend/canvas/project.json`; the enforced boundaries are in `eslint.config.mjs:254`. Current user instructions supersede the older lane assignments in read-only `task.md`; no separate batch, plan or design handoff existed in this task folder.

## Verification

- Ran `npx prettier --write` on all four changed TypeScript files, and again on the grid after the lock-effect fix.
- Ran the requested `npx nx run-many -t test,lint,typecheck -p @ptah-extension/canvas --skip-nx-cache` with tailed output. Initial result: 188/189 tests passed, lint/typecheck passed. After the lock-effect fix, reran the same targets with `--output-style=static`, saved output to the temporary log, and displayed the last 30 lines.
- Final: **9/9 suites, 189/189 tests, 0 snapshots; lint passed; Angular typecheck passed; Nx exit 0.** Final Nx duration 31.4 seconds; Jest duration 13.244 seconds.
- Supplemental `ptah_get_diagnostics` on changed files reports zero findings in those files but 6 errors in untouched files: `canvas-layout.service.spec.ts:311`, `canvas.store.spec.ts:45`, and `git-ui/src/lib/services/monaco-loader.service.ts:112`, `:150`, `:170`, `:186`. These were not changed. This broader diagnostic result is not claimed clean.
- Nonfatal final-run warnings: Jest force-exited a worker for open handles; Angular NG8107 in untouched `mcp-directory-browser.component.ts:175` and `peer-session-send-dialog.component.ts:181`.
- Angular fixture DOM, menu output propagation and engine-state/geometry behaviour were verified by specs. The grid suite uses its established Gridstack stub. No live Electron pointer-drag or screenshot verification was performed in this lane; that remains a verification limitation.

No required Nx gate remains failing. The persistence/default investigation required no source change. The only implementation addition beyond separating singleton width from height was making the existing interaction effect robust to delayed engine attachment.
