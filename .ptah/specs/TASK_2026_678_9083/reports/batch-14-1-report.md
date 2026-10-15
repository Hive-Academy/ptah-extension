# Batch 14.1 report — CommandOverlayComponent

## Files written

- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/components/command-overlay.component.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/components/command-overlay-positioner.ts` — helper split out because the component exceeded about 350 lines.
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/components/command-overlay.component.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/.ptah/specs/TASK_2026_678_9083/reports/batch-14-1-report.md`

## Requirements and evidence

| Requirement | Evidence |
| --- | --- |
| Standalone OnPush Angular component; injectable Floating UI provider | `command-overlay.component.ts:29-37` |
| One shared node card, stable node ID, node/provider/parent/state text, branded mark or unknown monogram | `command-overlay.component.ts:79-118,131-135,214-223` |
| Exported 150 ms open and 200 ms close delays; one timer of each kind | `command-overlay.component.ts:26-27,147-148,298-344,363-377` |
| Label/card/scene hover union; moving or hidden label does not close while scene hover remains | `command-overlay.component.ts:163-167,226-255,317-344` |
| Invisible pointer bridge and delayed safe travel | `command-overlay.component.ts:66-73,248-255`; `command-overlay-positioner.ts:79-90` |
| Label anchor while visible, sphere anchor when hidden | `command-overlay-positioner.ts:59-69`; `command-overlay.component.ts:209-211` |
| Click/Enter pin, replacement pin, Escape/close/selection unpin; destroy clears timers and positioning without outputs | `command-overlay.component.ts:49-54,111-115,168-182,257-296` |
| Focus stays on trigger at pin; passive tooltip and pinned named region; focus restoration/fallback | `command-overlay.component.ts:46-48,86-90,111-115,283-296` |
| Floating UI offset/flip/shift, one frame coalescer, changed-anchor guard, cleanup | `command-overlay-positioner.ts:21-43,46-76` |
| Reduced motion disables card transition | `command-overlay.component.ts:85` |
| No frame-driven Angular signal writes or change detection | `command-overlay.component.ts:173-177`; `command-overlay-positioner.ts:21-29,59-76` |
| Theme-aware chips, 44 px label/close targets and focus rings | `command-overlay.component.ts:42-44,111-114` |

The bridge is rebuilt after each Floating UI position promise resolves. The service remains the owner of its scroll/resize `autoUpdate`; transform-only movement is watched by the helper's `MutationObserver`.

## Spec cases

| Case | Spec location |
| --- | --- |
| Open at 150 ms and cancel early leave | `command-overlay.component.spec.ts:64` |
| Dense label move/hide under unchanged scene hover | `command-overlay.component.spec.ts:83` |
| Close at 200 ms; card, trigger and bridge cancel close | `command-overlay.component.spec.ts:101` |
| Click/Enter pin, hover survival, close/Escape/selection/destroy | `command-overlay.component.spec.ts:124` |
| One card re-key and hidden-label focus fallback | `command-overlay.component.spec.ts:164` |
| Edge middleware options and one reposition for two anchor writes | `command-overlay.component.spec.ts:186` |
| Reduced motion removes transition class | `command-overlay.component.spec.ts:207` |

## A-D31 and page wiring

**A-D31 holds.** `command-scene.component.ts:221-235` accepts the one card anchor and measured labels. `command-scene-renderer.ts:302-312` writes the anchor's sphere-centre transform in its frame write, alongside label display/transform writes at `:283-294`. No B12 file was edited.

Task 14.2 must bind `projection`, `hoveredNodeId`, `selectedId`, and `reducedMotion` (`command-overlay.component.ts:124-127`); handle `pinNode`, `unpinNode`, and `focusWorkListRow` (`:128-130`); and call the overlay's `getOverlayLabels()` after render and on projection changes for `scene.setOverlayLabels(...)` (`:187-207`). It must pass `getCardAnchor()` and `activeNodeId()` to `scene.setCardAnchor(element, nodeId)` (`:131,209-211`). A canvas node trigger can call public `pin(nodeId)` (`:263`). `focusWorkListRow` carries the node ID so the page can focus the matching row when its label is hidden.

## Verification and limits

- `npx eslint` on the three new TypeScript files: exit 0, no output.
- `npx prettier --write` on the three new TypeScript files: completed. Final `npx prettier --check` reported `All matched files use Prettier code style!`.
- Scoped `ptah_get_diagnostics`: no diagnostics in the three requested files. Seven pre-existing sibling errors were reported in `tribunal-run-coordinator.spec.ts` and `capability-id-codec.ts`; those files were not edited.
- Nx, Jest, git, build, serve and e2e were not run, per lane instructions. The orchestrator owns the Jest check; interactions and Floating UI geometry therefore remain unverified at runtime in this lane.
- No `catch` or `.catch` sites were added in non-spec code; the degradation-audit classification is **none**.
- Task 14.2 page wiring and Electron B18 interaction tuning are outside this lane.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Use a single shared card and a zero-size sphere anchor | Per-label cards; one shared card | D31 and renderer support at `command-scene-renderer.ts:302-312` | Yes |
| Use a rectangular pointer bridge plus 200 ms grace | Trajectory triangle; rectangular bridge | D31 explicitly permits the bridge method; `command-overlay-positioner.ts:79-90` | Yes |
| Watch only the active label and sphere anchor for style changes | Poll every frame; watch all labels; watch active anchors | Renderer writes transforms directly; `command-overlay-positioner.ts:46-56` | Yes |
| Split positioning into one helper file | Keep a roughly 440-line component; extract positioning | Component size requirement; `command-overlay-positioner.ts:1-91` | Yes |

## Correction round

| Defect | Cause and fix |
| --- | --- |
| Strict template TS2345 for key handlers | Angular's strict template event binding supplies `Event`. `command-overlay.component.ts:257-261,277-281` now accepts `Event` and narrows with `instanceof KeyboardEvent` before keyboard behavior. The three bindings remain at `:56-57,84`. |
| Reposition spec saw zero calls after a moved anchor | The test advanced synchronous fake rAF while the `MutationObserver` notification was pending; adding two immediate Promise awaits still left the notification pending in the Zone/Jest environment. `command-overlay.component.spec.ts:186-205` now uses `jest.advanceTimersByTimeAsync(32)` to flush the observer microtask before the next frame and retains the exact `count + 1` assertion. The production observer and one-frame coalescer remain at `command-overlay-positioner.ts:21-28,46-59`; its changed-rect guard is at `:68-74`. This final test change has **not been rerun** under the invocation cap. |
| NG0953 destroyed OutputRef warning | `command-overlay.component.ts:178-182` no longer calls `unpin()` in `DestroyRef.onDestroy`; it marks destroyed, clears both timers, and destroys the positioner, whose `stop()` calls `FloatingUIService.cleanup()` (`command-overlay-positioner.ts:31-43`). Thus teardown does not emit `unpinNode`. |

Final permitted Jest run **before** the asynchronous timer edit: `Test Suites: 1 failed, 1 total; Tests: 1 failed, 6 passed, 7 total`; the sole failure was the moved-anchor assertion. The first Windows PowerShell invocation did not execute Jest because `tail` was unavailable; the two subsequent Bash invocations executed Jest. No further Jest invocation was made to stay within the three-command limit.

Final `npx tsc -p libs/frontend/command-center/tsconfig.lib.json --noEmit 2>&1 | grep command-overlay | head -20`: no matching output. Final `npx eslint` on the three overlay files: exit 0, no output. Final `npx prettier --check` on the three overlay files: `All matched files use Prettier code style!`.
