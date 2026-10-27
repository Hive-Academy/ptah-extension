# Code logic review — Revision 2, round 1 addendum

Review family: Glm (Ollama Cloud)
Implementer family: Claude

Verdict: **APPROVED** — score **9/10**

Scope: the bounded correction after `code-logic-review-rev2-round1.md`. That review
approved Revision 2 (9/10) with one minor defect: the rail strip's key-normalization
effect emitted `laneSelected`, the dock mapped it to `selectRailAgent`, and the sidebar
auto-expanded without a user action. This addendum checks only that correction.

## Scope examined

- `libs/frontend/canvas/src/lib/canvas-detail/canvas-lane-tabs.component.ts` (full read)
- `libs/frontend/canvas/src/lib/canvas-rail/canvas-inspector-dock.component.ts` (full read)
- `libs/frontend/canvas/src/lib/canvas-detail/canvas-detail.service.ts` (full read)
- Rail tests in `canvas-lane-tabs.component.spec.ts` (lines 140-239)
- Grep for `ptah-canvas-lane-tabs` and `CanvasLaneTabsComponent` across `libs/`:
  the inspector dock is the only template consumer of the component.

Verification (already run, not repeated): `npm run verify -p @ptah-extension/canvas`
passes lint, typecheck and 475 tests.

## The defect is fixed

| # | Check | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Key normalization no longer expands the sidebar | Pass | The normalization effect still emits `laneSelected` (`canvas-lane-tabs.component.ts:382-386`), but the dock maps that output to `detail.selectLaneFor(id, $event)` (`canvas-inspector-dock.component.ts:150`). `selectLaneFor` only writes the lane-key map and returns (`canvas-detail.service.ts:31-49`); it never calls `expandInspector` and never changes `dockOpen`. |
| 2 | Regression test pins the failure | Pass | 'rail key normalization updates the selection without a user pick' (`canvas-lane-tabs.component.spec.ts:224-239`): a stale `laneKey` ('cli:gone') emits `laneSelected` with the corrected key, and `railPicked` is never emitted. |
| 3 | Click in the rail still selects and expands | Pass | `(click)` → `onTabClick` → `pick` → `railPicked` (`canvas-lane-tabs.component.ts:196,409-411,418-422`) → `selectRailAgent` (`canvas-inspector-dock.component.ts:151,333-336`), which selects then calls `expandInspector('agents')`. Spec: click emits `railPicked` once with 'cli:c4' and `laneSelected` not at all (`canvas-lane-tabs.component.spec.ts:216-219`). |
| 4 | Enter / Space still select and expand | Pass | `onKeydown` intercepts only ArrowLeft, ArrowRight, Home and End (`canvas-lane-tabs.component.ts:424-448`); Enter falls through, so the native button activation fires `click` → the same `pick` path. Spec: the Enter keydown is not default-prevented, then the click emits `railPicked` (`canvas-lane-tabs.component.spec.ts:214-218`). |
| 5 | Hidden agents in the rail still expand the sidebar | Pass | The rail renders a `+N` button instead of the overflow menu (`canvas-lane-tabs.component.ts:238-242`; the menu is excluded by `@if (!rail() && ...)` at line 217). It emits `expandRequested`, bound to `expandInspector('agents')` (`canvas-inspector-dock.component.ts:152`). Spec: `canvas-lane-tabs.component.spec.ts:153-159`. |
| 6 | Arrow keys in the rail still move focus only | Pass | `onKeydown` sets `railFocusKey` in rail mode and emits nothing (`canvas-lane-tabs.component.ts:444-445`). Spec: `select` and `expand` not called, focus moves to the next tab (`canvas-lane-tabs.component.spec.ts:198-205`). |
| 7 | Non-rail (sidebar) strip behavior unchanged | Pass | `pick` emits `laneSelected` when `rail()` is false (`canvas-lane-tabs.component.ts:419-422`), the same emission the handlers made before the task (`onTabClick` / `onMenuSelect` emitted `laneSelected` directly). The sidebar strip binds only `(laneSelected)="detail.selectLaneFor(id, $event)"` (`canvas-inspector-dock.component.ts:121-129`), and non-rail arrow keys still emit `laneSelected` directly (`canvas-lane-tabs.component.ts:446`). |
| 8 | No other consumer misses rail selections | Pass | Grep over `libs/`: `CanvasLaneTabsComponent` appears only in the component, its spec and the inspector dock. Both dock instances that are not the rail strip are `[sidebar]="true"` (never rail), so no consumer binds `laneSelected` alone in rail mode. |
| 9 | No emission loop from the split | Pass | After a rail pick, `selectRailAgent` writes the lane key (`canvas-detail.service.ts:48`), so the `[laneKey]` input converges to the picked key and the normalization effect condition `laneKey() !== selectedKey()` (`canvas-lane-tabs.component.ts:383`) stops holding. One pick produces one selection write and one expand; a rejected normalization write is idempotent and cannot loop, because emitting an output changes no tracked effect dependency. |

## New findings

None. The correction is minimal, the user-pick path and the normalization path are now
separate outputs with explicit dock bindings, and the regression test fails on the exact
old behaviour (normalization reaching `selectRailAgent`). The `pick` doc comment
(`canvas-lane-tabs.component.ts:418`) states the invariant.

## Decisions

- No decision needed for this correction; it matches the recommendation in
  `code-logic-review-rev2-round1.md`.
- Naming note, no action: the rail has no overflow menu (the `+N` button expands the
  sidebar instead), so `onMenuSelect` is unreachable in rail mode today. It still routes
  through `pick`, so a future rail menu cannot bypass the split.

## Score justification

9/10: the one open minor defect from round 1 is fixed with direct evidence at every
step of the trace (effect → binding → store method), the fix adds a regression test
that distinguishes normalization from user picks, and no other consumer or mode changed
behaviour. The score stays at the round-1 level: the underlying two-output split is the
right design, and nothing in this correction lowers confidence in the rest of Revision 2.