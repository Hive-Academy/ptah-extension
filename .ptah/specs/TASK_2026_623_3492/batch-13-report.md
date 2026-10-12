# Frontend implementation — `TASK_2026_623_3492`, batch 13

Verdict: both tasks are done. `@ptah-extension/declarative-dashboard` typecheck is green again (decision #21 is closed). The layout spec passes 20/20 and lint has 0 errors. One gap is left for Batch 14: the avatar node switch (see Plan deviations 1).

**Tasks completed**: 13.1 (view model for `accordion`, `avatar`, stat `trend`/`spark`), 13.2 (`layoutWidth`, container grid, accordion and section collapse, spec).

## Files

- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\lib\view-model\view-model.types.ts
  - `LayoutNode` now includes `accordion`.
  - The stat `DisplayNode` carries optional `trend` and `spark`, typed from `SurfaceStatComponent`.
  - New `AvatarNode` type (name and subtitle only), added to `SurfaceNode`.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\lib\view-model\surface-view-model.ts
  - The envelope accepts `dashboard-catalog/3` or `/4`.
  - A `/3` surface with `accordion`, `avatar`, or a stat `trend`/`spark` gives `renderFailed`. The reason names the kind or the fields.
  - `accordion` maps as a layout and needs a rich-text title.
  - `mapAvatar` copies only `id`, `kind`, `name` and `subtitle`. `name` must be a non-blank string.
  - `checkTrend` checks the closed direction and polarity enums, a finite amount of 0 or more, and a boolean `percent`.
  - `checkSpark` needs finite numbers, between `SURFACE_SPARK_MIN_POINTS` and `SURFACE_LIMITS.maxSeriesPoints` points.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\lib\components\surface-layout.component.ts
  - New exports: `SurfaceLayoutWidth` and `SURFACE_CONTAINER_GRID_STYLES`.
  - New inputs and output: `layoutWidth` (default `'viewport'`), `expanded`, and `expandedChange`.
  - One collapse pattern for `accordion` (both modes) and `section` (container mode only).
  - Container grid classes: `dp-grid dp-cols-N dp-gap-*`, plus `dp-grid--stats`.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\lib\components\surface-node.component.ts
  - `accordion` is added to `SURFACE_NODE_KINDS` (now 20 kinds) and to the switch.
  - `layoutWidth` passes down through the recursive child template.
  - Layout expansion is written as `viewState.components[id].expanded` (`writeExpanded`).
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\lib\components\surface-renderer.component.ts
  - New `layoutWidth = input<SurfaceLayoutWidth>('viewport')`.
  - In container mode the host gets `.dp-root` (`container-type:inline-size; container-name:dp`). The root grid becomes the stat-grid variant.
  - The `--dp-*` tokens are defined once on `:host` (D17), with a `:host-context([data-theme='anubis-light'])` override. `--dp-hl` is theme `primary` (decision #12).
  - `accordion` is added to the renderer's `LAYOUT_KINDS` shape check.
- MODIFIED D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\lib\components\surface-layout.component.spec.ts
  - The host gains `layoutWidth`, `expanded` and feed-back.
  - 11 new cases (listed under Verification).
- MODIFIED (outside the batch file list) D:\projects\ptah-extension\.claude-worktrees\task-623-display-panel\libs\frontend\declarative-dashboard\src\lib\components\surface-node.component.spec.ts
  - The existing case pinned `SURFACE_NODE_KINDS.size === 19`. Adding `accordion` to the node switch is a plan requirement (plan:587), and it made that case fail.
  - Minimal fix: `v2Nodes` takes an optional catalog version, the kind loop builds under `/4`, the count is now 20, and an `accordion` entry is added.
  - One new case: an accordion toggle writes `{componentId, state:{expanded:true}}`.
  - Accepting this out-of-list edit is the team-leader's call.

## Stack observed

- Angular 22.1.7, from the root `package.json`.
- Standalone components, OnPush, signal `input()`/`output()`, and `computed`/`linkedSignal`. Read from `surface-renderer.component.ts` and `dashboard-stat.component.ts`.
- Tailwind 3.4 and DaisyUI 4.12, from the root `package.json`.
- Component `styles` with `@container`: precedent in `libs/frontend/chat-ui/src/lib/molecules/change-set/change-set-card.component.ts:373`.
- Escape-to-collapse and refocus pattern: `dashboard-stat.component.ts:61`.
- The Jest preset strips component styles, so the specs check style wiring from source. The existing spec already reads source this way.

## Design fidelity

Sources: design-spec.md sections 3, 7 and 8, plus the prototype token block (`prototype/index.html:28-55`).

- Collapse follows design section 7:
  - a header `<button>` inside an `h3`, with `aria-expanded` and `aria-controls`, at least 32 px tall;
  - the body is `inert`, with `visibility:hidden` and `grid-template-rows 0fr→1fr` (220 ms);
  - the chevron rotates with a `transform` (200 ms);
  - both animations run only under `prefers-reduced-motion: no-preference`;
  - DaisyUI `collapse` is not used (design decision 4).
- Grid follows D9:
  - one column below 360 px;
  - from 360 px, `repeat(auto-fit, minmax(min(100%, max(128px, <width at the column ceiling>)), 1fr))`. The extra `max(…)` term is how `columns` becomes a ceiling;
  - from 700 px, a stat grid has 3 columns, or its ceiling if lower.
- Deviations:
  - **Section collapse is container-mode only.** Viewport mode keeps the Apps page `<section><h3>` markup, so the Apps page is unchanged (D9, NFR). R9 lists panel display cards only.
  - **Root stat grid.** In container mode the renderer root uses the stat-grid rules with a ceiling of 3. The old `auto-fill minmax(9rem)` root would give 2 columns at 300 px, which breaks R3.5.

## States covered

- Accordion starts closed and section starts open (R4.6, R9.4).
- Expansion is stored per id in `SurfaceViewState.components[id].expanded`, so it survives an in-place update and a re-render (R9.4).
- Enter and Space come from the native `<button type="button">`. Escape inside an open body collapses it, refocuses the toggle and stops propagation, so nested accordions close one level at a time. Escape on a closed body is not consumed.
- A collapsed body is `inert`, so it has no tab stops and is not read.
- Focus ring: `2px solid base-content`, 2 px offset.
- Titles and descriptions render through interpolation only (literal text). No `[style]` attribute: column ceilings are classes, not inline styles.

## Risks and how each was handled

- **Decision #21 (typecheck red since Batch 1).**
  - Before: one error, `surface-view-model.ts:210` (`accordion`/`avatar` passed to `mapDisplayNode`).
  - Fix: explicit `avatar` and `stat` cases, `accordion` routed to `mapLayout`, and `DisplayComponent` now excludes `SurfaceAvatarComponent`.
  - Typecheck now passes. No error remains from any file outside the batch.
- **`/3` regression (risk table, HIGH; Task 13.1 mitigation).**
  - `layoutWidth` defaults to `'viewport'`. The viewport grid and section markup are byte-identical in behaviour; the existing layout cases are unchanged and pass.
  - A `/3` surface that carries `/4` kinds or fields fails closed in the view model, in addition to the shared validator.
- **Decision #26 (`target?: 'display'`).** Not touched by this batch; only consumers branch on it. The renderer has no knowledge of fence targets.
- **Decision #30 (lazy agents source, not in the eager barrel).** No barrel or index export was added (`src/index.ts` is untouched). The new exports live in the component file the renderer already imports, so there is no new eager surface.
- **Decision #32 (`PtahUiLimitsInput` pending state).** Not in this batch's surface; no change.
- **Spark points against `maxSeriesPoints` (A7).** The view model caps a spark at `SURFACE_LIMITS.maxSeriesPoints`, counted per component.

## Verification

1. `npx jest -c libs/frontend/declarative-dashboard/jest.config.ts libs/frontend/declarative-dashboard/src/lib/components/surface-layout.component.spec.ts --coverage=false --maxWorkers=2`
   - Result: **1 suite, 20/20 passed** (9 existing, 11 new).
   - The `marked` mapper was not needed.
   - New cases:
     - `/3` rejects `accordion`;
     - closed by default, with ARIA, `inert` and children inside the region;
     - toggle, emit, focus kept;
     - toggle without feed-back;
     - Escape collapses, refocuses and stops propagation (and is a no-op when closed);
     - expansion survives an in-place update, and a reset closes it;
     - literal title;
     - section collapsible only in container mode, open by default;
     - container grid classes, ceiling and stat variant;
     - viewport grid unchanged;
     - container stack;
     - container style rules and their wiring.
2. `npx nx typecheck @ptah-extension/declarative-dashboard --parallel=1`: **Successfully ran target typecheck**.
3. `npx nx lint @ptah-extension/declarative-dashboard --parallel=1`: **0 errors, 115 warnings**, target succeeded.
   - Changed production files have 0 warnings.
   - The changed specs have 22 `no-non-null-assertion` warnings (layout 14, node 8). They follow the `!` pattern both specs already use.
   - The lint summary line was read from a second, Nx-cached run, because the first filter missed it.
4. Extra regression run (same Jest flags) on specs whose sources this batch touched: `surface-renderer.component.spec.ts`, `surface-node.component.spec.ts`, `view-model/surface-view-model.spec.ts`, `trust-boundary.spec.ts`, `budget-render.spec.ts`.
   - First run: 102/103. The failure was the node spec's 19-kind pin, fixed above.
   - Node spec rerun: **8/8 passed**.
5. Not applicable: build, serve and e2e (CLAUDE.md). Real `@container` column counts need a browser. Batch 15 (`surface-container-width.spec.ts`) and V1 are the checks for that, as the plan's verification seam states.

## Plan deviations

1. **The avatar node switch is not wired.**
   - The `avatar` view-model node exists, but `SURFACE_NODE_KINDS` does not include `avatar` yet. A surface with an avatar fails closed (`renderFailed` → "could not display"); it never renders silently empty.
   - Reason: the atom `dashboard-avatar.component.ts` is created in Batch 14. Rendering it here would mean a stand-in.
   - **Gap:** Task 14.2's file list does not include `surface-node.component.ts`, so nothing wires the atom into the switch. That file needs to be added to Batch 14: import `DashboardAvatarComponent`, add `'avatar'` to `SURFACE_NODE_KINDS`, add an `@case ('avatar')`, and move the node spec count to 21.
2. **Section collapse is container-mode only.** See Design fidelity.
3. **Out-of-list edit to `surface-node.component.spec.ts`.** See Files.

## Out-of-scope observations

- `ptah-ui-block` and the display panel must pass `layoutWidth="container"` (plan Integration). Those are Batch 16 and later files.
- Batch 14 stat work can use `--dp-su-text`, `--dp-er-text`, `--dp-hl`, `--dp-bar-dim` and `--dp-er-fill`, which are already defined on the renderer root.
