# Phase 3 code-logic review — Batches 13–15

**Score: 6/10**  
**Verdict: REVISE**

The default `/4` surface mapping correctly rejects rich-text avatar fields, unknown kinds, malformed trend enums, invalid spark data, and out-of-contract catalog versions before rendering. Accordion state, inert closed bodies, container layout behavior, and the no-sink boundary were traced through the changed implementation and targeted tests. However, the renderer advertises a second defensive boundary for an overridden view-model builder, and that guard does not validate the new atom fields. A malformed successful builder result can therefore render rather than fail closed.

## Findings

1. **Serious — malformed successful builder results bypass avatar and stat `/4` validation instead of failing closed.**

   Evidence: `libs/frontend/declarative-dashboard/src/lib/components/surface-renderer.component.ts:137-154` accepts every known non-input, non-layout kind when it has a string `id`, boolean `selectable`, and no invalid `children`; it has no `avatar.name`/`avatar.subtitle`, `stat.trend`, or `stat.spark` shape checks. `attemptBuild()` treats that guard as the decisive malformed-result gate at `surface-renderer.component.ts:163-179` and renders it when it returns true at `:171-173`. The avatar template then directly interpolates the unchecked fields at `components/dashboard-avatar.component.ts:75-77`; the stat component indexes the unchecked trend enums and sends spark data to geometry at `components/dashboard-stat.component.ts:98-105,65-67`.

   Failure scenario: a host or test override of the public `SURFACE_VIEW_MODEL_BUILDER` returns `{ renderFailed: false, viewModel }` with `{ kind: 'avatar', id: 'a', selectable: false, name: { text: 'Agent' }, subtitle: { text: 'x' } }`. It passes `isRenderableNode`, so the renderer does not emit `renderFailed`; Angular renders object coercions rather than rejecting the surface. Likewise an override can return `trend: { direction: 'sideways', polarity: 'danger' }` or a `spark` containing `NaN`/`Infinity` or an extremely long series. The former degrades to missing CSS/SVG attributes; the latter can yield invalid geometry or throw during `Math.min(...points)` in `charts/sparkline-geometry.ts:25-36`, outside the renderer's failure signal. This violates the documented guarantee that a malformed builder result renders nothing and emits `renderFailed`, and defeats the `/4` fail-closed requirement at this dependency boundary.

   Required correction: extend `isRenderableNode()` (or validate the successful builder result with the same closed projection checks) to require plain-string avatar name/optional subtitle, closed finite trend fields, and finite bounded spark arrays before returning a view model. Add renderer-level override tests for rejected rich-text avatar fields and malformed trend/spark values, asserting no rendered node and one `renderFailed`.

## Five logic questions

1. **Silent failure:** the finding above turns malformed builder output into success-looking rendered text or malformed SVG instead of `renderFailed` (`surface-renderer.component.ts:171-173`). The default mapper otherwise returns `{ renderFailed: true, viewModel: null }` on shape failure (`view-model/surface-view-model.ts:315-328`).
2. **Unexpected user action:** toggling an accordion behaves as specified: it starts closed, writes `expanded`, and restores stored state (`surface-layout.component.ts:207-216,258-270`); container-mode sections start open and viewport sections remain non-collapsible (`:168-180`). No additional user-action defect found.
3. **Wrong-answer input:** direct agent content with an avatar rich-text object, invalid trend enum, non-finite spark point, too few spark points, or too many points is rejected by `mapAvatar`, `checkTrend`, and `checkSpark` (`surface-view-model.ts:180-224,271-277`). The wrong-result path is the malformed successful builder result described in finding 1.
4. **Dependency failure/shape:** a throwing builder is caught and reported (`surface-renderer.component.ts:163-179,333-336`), but a non-throwing builder with malformed new atom fields passes as described in finding 1.
5. **Requirement gap:** `sparklineGeometry()` is a public pure helper but has no independent malformed-input guard (`charts/sparkline-geometry.ts:25-36`). The trusted mapper’s limits make normal rendering safe; the renderer override boundary exposes this missing ownership decision. The correction above resolves it without changing the agent-content contract.

## Verified behavior and evidence

- `/4` default mapping rejects object-valued avatar name/subtitle and gives avatars `selectable: false` (`view-model/surface-view-model.ts:215-224`); both new kinds are in the 21-kind node catalog and the node's unknown-kind effect reports failure (`components/surface-node.component.ts:68-78,333-339`).
- Closed accordion bodies carry `inert`, `data-open='false'`, and hidden visibility; `aria-expanded` and `aria-controls` are bound to the same local state (`components/surface-layout.component.ts:66-77,140-166,207-216`).
- Normal sparkline input is bounded and finite (`view-model/surface-view-model.ts:192-199`); the geometry handles valid all-equal, negative, zero, and `Number.MAX_VALUE` inputs without overflow through scaling (`charts/sparkline-geometry.ts:25-36`). A `bad` trend selects the error fill (`components/dashboard-stat.component.ts:65-67`, `components/dashboard-sparkline.component.ts:59-62`), matching decision #51.
- Container mode is opt-in, preserves viewport mode, has a one-column rule below 360 px, enforces the column ceiling, and applies three stat columns from 700 px (`components/surface-renderer.component.ts:241-242,271-292`; `components/surface-layout.component.ts:39-58,239-256`). The dedicated spec parses the actual exported `SURFACE_CONTAINER_GRID_STYLES`, requires non-empty matched rules, applies selector/cascade order, and exercises rendered narrow/wide grids (`components/surface-container-width.spec.ts:40-75,220-260`), so it cannot pass solely on an unrelated local CSS copy.
- The changed templates contain no `[style]`, `[href]`, `[src]`, or `[innerHTML]` bindings. The trust-boundary suite scans source and checks the `/4` atoms specifically (`trust-boundary.spec.ts:425-443`). No TODO/PLACEHOLDER/STUB marker, empty implementation body, mock-runtime data, timer, listener, or unobserved async operation was found in the reviewed production files.

## Verification

- Scoped Jest command required by `CLAUDE.md`: 6 suites, 82 tests passed (the six changed requested spec paths; `--coverage=false --maxWorkers=2`).
- Scoped diagnostics found no diagnostics in requested files. It reported two pre-existing sibling target errors in `libs/shared/src/lib/types/capability-id-codec.ts:262-263` (BigInt target mismatch), not in the reviewed paths.
- Review scope: the 15 changed production/spec files under `libs/frontend/declarative-dashboard/src/lib/` in `e05d8250f..5bfbb8b00`, plus required Phase 3 plan/context/batch/decision material. `code-style-review.md` does not exist, so no style finding was duplicated.

## Decisions

- Decision #51 is implemented consistently: `trend.polarity === 'bad'` is the available failing signal and selects `--dp-er-fill`. No new product decision is needed; the required change is defensive validation at the existing builder boundary.

## Score rationale

The score is above 5 because the normal untrusted surface-content path has concrete closed validation and all targeted tests pass. It is below 7 because the renderer explicitly promises that malformed override output fails closed, but the new `/4` fields escape that guard and can render misleading or invalid results. Closing finding 1 and testing that boundary would support the 7–8 sound band; the issue is not a blocking data-loss or executable-markup path, so it does not belong in the 3–4 band.
