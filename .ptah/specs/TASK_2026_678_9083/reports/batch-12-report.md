# Batch 12 report

## Work completed

- Task 12.1: `command-scene-renderer.ts:28,59,132,256,336` implements immutable scene snapshots, prepared sprite lookup, Canvas 2D dots/orbits/Bezier links, bounded particles, status marks, Tribunal phase arc, distinct Ptah voice ring and selection halo, and overflow chip backing. Idle work draws once; active work uses rAF; hidden pages pause. Labels and the optional D31 card anchor receive transforms in the frame write (`:81,225`). Hit testing uses the last scene geometry (`:108`). The meter is throttled to 500 ms (`:91,242`).
- Task 12.2: `command-scene.component.ts:93,226,252,271,310` is standalone and OnPush with signal inputs, outputs, `inject()`, `afterNextRender`, one ResizeObserver, visibility and reduced-motion listeners, capped DPR, pointer hit-test coalescing, and teardown. Theme-aware sprite palettes and cache pruning run on changed snapshots (`:119,146,176`). `setOverlayLabels` accepts Batch 14's measured DOM labels (`:222`); `setCardAnchor` supports its shared card (`:210`). Canvas failure emits `canvasUnavailable` (`:230`). Selection emits on canvas click (`:301`).

## Files written

- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/scene/command-scene-renderer.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/scene/command-scene-renderer.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/scene/command-scene.component.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/libs/frontend/command-center/src/lib/scene/command-scene.component.spec.ts`
- `D:/projects/ptah-extension/.claude-worktrees/command-center/.ptah/specs/TASK_2026_678_9083/reports/batch-12-report.md`

## Specs and verification

- `command-scene-renderer.spec.ts:123,142,155` asserts one sprite draw per node, no frame gradient creation, label and anchor transforms, idle stop, visibility pause/resume, and sphere hit testing.
- `command-scene.component.spec.ts:85,126,148` asserts one hover emission for repeated moves, null on moving off, no frame-based hover emission, selection, teardown, and Canvas 2D unavailability.
- `ptah_get_diagnostics` reported no errors in the four requested files. It also reported seven errors in sibling files outside this batch, including `tribunal-run-coordinator.spec.ts` and `capability-id-codec.ts`.
- `npx prettier --check` output: `All matched files use Prettier code style!`
- No Nx or Jest commands were run, per lane rules. The orchestrator owns the scoped verification. The Electron p95 draw and sustained FPS targets remain unmeasured until the planned B18 gate.

## Catch sites and degradation audit

No `catch` or `.catch` sites were added in non-spec code; there are no degradation-audit classifications or markers.

## Needed changes outside the batch

None. Batch 14 should pass its measured label elements to `setOverlayLabels` and its shared card anchor to `setCardAnchor` during planned page integration.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep DOM labels in Batch 14's overlay and expose `setOverlayLabels` on the scene | Scene owns labels; overlay owns labels | `implementation-plan.md:46` assigns DOM labels to `CommandOverlayComponent`; D31 Task 14.1 needs the shared card anchor | Yes |
| Use stable theme and provider palette records for sprite requests | Resolve palette per frame; predefine theme palettes | Design spec scene grammar maps provider hues; `SpriteCache.get` caches by palette identity; frame path forbids style reads | Yes |
| Use the layout's fixed projected spheres for hit testing and card anchoring | Reproject during pointer events; use last layout | D31 asks for last projected spheres and a sphere-centre anchor; `scene-layout.ts` provides coordinates | Yes |

## Orchestrator fix round

- Defect 1: `command-scene.component.ts:142,207` now separates the layout/sprite effect from the voice-level effect. The layout effect tracks projection, selection, viewport, theme, overlay labels and reduced motion. The voice effect calls `CommandSceneRenderer.setVoice` (`command-scene-renderer.ts:94`), which updates only voice fields, recomputes active state (`:159`) and invalidates without rebuilding maps or replacing layout. New specs at `command-scene.component.spec.ts:163` assert that a level change retains the layout object, makes no new sprite requests and invalidates once, while a projection change relayouts; `command-scene-renderer.spec.ts:193` asserts voice activation schedules frames.
- Defect 2: `command-scene-renderer.ts:48,283,309` caches the last display/transform per label element and the card anchor transform. Unchanged active frames skip those DOM style writes. The cache clears on layout snapshots and teardown, avoiding retained elements. The new spec at `command-scene-renderer.spec.ts:155` asserts two unchanged active frames write each label and anchor transform once.
- Scoped `ptah_get_diagnostics` found no errors in the four edited files. It still reports seven unrelated sibling errors outside this batch. No Nx or Jest command was run under the lane rules.
- Final `npx prettier --check`: `All matched files use Prettier code style!`
- No new non-spec `catch` or `.catch` sites were introduced.
