# Batch 6 report - TASK_2026_494

Executor: frontend-developer. Task 6.1 (`buildSurfaceViewModel`, `DashboardTableComponent`, `SurfaceLayoutComponent`).
No committed file, `src/index.ts`, config, other library or `mcp-apps-page` file was touched. No git was run.

## Files (all CREATED)

Root: `D:\projects\ptah-extension\.claude-worktrees\feat-task-494-apps-page-98c5a1802772\libs\frontend\declarative-dashboard\src\lib\`

| File | Lines |
| --- | --- |
| `...\lib\view-model\surface-view-model.ts` | 191 |
| `...\lib\view-model\surface-view-model.spec.ts` | 191 |
| `...\lib\components\dashboard-table.component.ts` | 158 |
| `...\lib\components\dashboard-table.component.spec.ts` | 154 |
| `...\lib\components\surface-layout.component.ts` | 143 |
| `...\lib\components\surface-layout.component.spec.ts` | 158 |

## Requirements: how each one is met

### View model (`surface-view-model.ts`)

- `buildSurfaceViewModel(renderable: SurfaceRenderable): SurfaceViewModelBuild` accepts both contracts. v1 delegates to
  the committed `buildDashboardViewModel` (unchanged). v2 is mapped here. It returns
  `{ renderFailed: false, viewModel }` or `{ renderFailed: true, reason, viewModel: null }` and never throws: the whole
  build runs inside one try/catch. `reason` echoes only our own `TypeError` text, so an exotic getter's message is not
  leaked. An empty subtree is `viewModel: null`, which means nothing partial is rendered.
- Input host value: `readSurfacePath(dataModel, input.path, input.kind)`. When the read returns `ok: false`, the node
  gets `SURFACE_INPUT_EMPTY_VALUES[kind]` and `draftError = read.reason`. A stored value of the wrong type for the kind
  is checked with `checkDraftValue` and falls back the same way.
- `selectable` comes from `declaresSelect`, which is true only for `action === 'dashboard.select'` (Req 4.6). Inputs are
  always `selectable: false`.
- Layout `submitActions` holds only well-formed `surface.submit` actions (string `id`, rich-text `label`). Every other
  `SURFACE_ACTIONS` id and every unknown id is dropped.
- B3 carry-over: `checkDisplayShape` tightens `list.items` (an array of objects) and chart `series` (`name` string,
  `points` an array of `{x: string|number, y: number}`) before the shared `mapDisplayNode`. The v1 builder is untouched.
- Bounds: children beyond `SURFACE_LIMITS.maxTreeDepth` map to `[]`, so a cyclic tree stays finite. More than
  `SURFACE_LIMITS.maxComponents` mapped nodes fails closed.

### Table (`dashboard-table.component.ts`)

- It reuses `tableRows`, `nextTableSort`, `pageSlice` (through `tableRows`) and `cellText`. There is no duplicate
  sort, filter or page logic.
- Scroll viewport: `div.overflow-auto` with `max-h-96` while collapsed. `pageSlice` keeps at most 25 rows in the DOM.
- Each column header is a `<button>` inside `<th scope="col" [attr.aria-sort]>` (`ascending`/`descending`/`none`).
  Clicking cycles asc, desc, original through `nextTableSort`, and sorting resets the page to 0, as the prototype does.
- The filter is `type="search"` with a per-instance `label for`/`id`. It matches visible text (through `tableRows`) and
  sets `page: 0`. A `role="status"` line reads "N results". Paging uses `DashboardPagerComponent`.
- Selection: the per-row Select button renders only when `selectable`, with `aria-pressed`. It emits
  `{ componentId, target: { kind: 'table-row', rowIndex: originalIndex } }` (`surface.types.ts:174-186`) and is guarded
  by the row range.
- A data reference shows "Data is not available in this view. {rowCount} rows." in `role="status"`, with no
  table, filter or pager.
- Expansion: an icon button labelled "Expand/Collapse {title}" with `aria-expanded` and a per-instance
  `aria-controls`. `Escape` collapses and returns focus to it (list pattern).
- Defensive rendering: malformed columns keep their position, and malformed rows and cells are normalised to scalars.
  Nothing renders "[object Object]".

### Layout (`surface-layout.component.ts`)

- `section`: `<section>` with an `<h3>` and a muted description `<p>`.
- `card`: `card card-bordered bg-base-100` with an optional title and description.
- `stack`: `flex flex-col`, or `flex flex-row flex-wrap` when horizontal, with the gap enum
  (`none|small|medium|large` to `gap-0|2|4|6`, default `gap-4`).
- `grid`: `grid grid-cols-1 sm:grid-cols-N`, where N is clamped to `[1, SURFACE_LIMITS.maxGridColumns]` (4). Non-finite
  values become 1. Every class is a literal string, so the Tailwind scanner emits it.
- Children render in spec order.
- `surface.submit` renders as `<button type="button" class="btn btn-primary btn-sm">{{ label.text }}</button>`. It is
  disabled while `submitDisabled` or while that action's state is `pending`. Its state text sits in
  `<span role="status">` with a per-instance id, and the button's `aria-describedby` points at it.
- State texts follow the plan's Component 5 state table: Sending… / Sent / stale-revision / submit-invalid / busy /
  session-unavailable / indeterminate / unknown, and `detail` as text otherwise.
- `invoke()` emits `actionInvoke({ actionId })` only for an enabled `surface.submit`.
- The component filters `submitActions` a second time, so no other action id can become a control even if a node skips
  the view model.

### Across all three

- There is no `style` attribute, style binding or `<style>` anywhere, and no `text-base-content/NN`: muted text uses
  `text-base-content-muted`.
- All producer text is bound by interpolation, with no `innerHTML`.
- Every `aria-controls`, `aria-describedby` and `for`/`id` pair uses module-counter ids.
- Every control carries `data-apps-focus-key="{surfaceId}:{componentId}:{control}"`.
- All components are standalone and OnPush, and use signal inputs and outputs.

## R5 mechanism

`SurfaceLayoutComponent` takes `childTemplate = input.required<TemplateRef<SurfaceLayoutChildContext>>()`, where the
context is `{ $implicit: SurfaceNode; index: number }`. It renders each child with `ngTemplateOutlet`. It imports only
`NgTemplateOutlet`.

Why a TemplateRef input and not `<ng-content>`:

- The layout owns iteration, so it guarantees spec order and a per-child slot inside the grid or stack container.
- B8's `SurfaceNodeComponent` can pass `<ng-template #child let-child><ptah-surface-node [node]="child" …/></ng-template>`
  from its own template, so the import runs one way only (node imports layout).
- Content projection would force the node component to build the children list itself, outside the layout's container
  markup.

The spec pins R5 in "projects children through the host template in spec order, without importing
SurfaceNodeComponent". A host component supplies the template, and the test scans the layout's source for
`SurfaceNodeComponent|surface-node`.

## Spec pins (spec file: test name)

| Pin | Where |
| --- | --- |
| missing path: empty value; unreadable path: empty plus draft error | `surface-view-model.spec.ts`: "a missing path reads as the kind empty value, and an unreadable path adds a draft error"; plus "a stored value of the wrong type falls back to the empty value with a draft error" |
| shared path: same value | "gives two inputs sharing a path the same host value" |
| selectable only with `dashboard.select` | "marks a node selectable only when it declares dashboard.select" (iterates every `SURFACE_ACTIONS` id) |
| unknown and unsupported actions: no control | view model: "keeps only surface.submit as a layout submit action; unknown and unsupported ids are dropped"; layout: "renders no control for unknown or unsupported actions" |
| never throws, renderFailed, empty subtree | "never throws: malformed content yields renderFailed and no view model"; "bounds the mapped tree…" |
| sort cycle and `aria-sort` | `dashboard-table.component.spec.ts`: "sorts through ascending, descending and original order with aria-sort on the header" |
| visible-text filter | "filters over visible cell text, resets the page and shows the result count" |
| at most 25 rows in the DOM for 5,000 rows | "keeps at most 25 rows in the DOM for 5,000 rows inside a scroll viewport, with the pager" |
| selection by original index on page 2 | "selects by original row index on page 2, only when selectable, with the table-row target" (sorted desc, so page 2's first row is original row 14) |
| data-reference notice | "shows the not-available notice with rowCount for a data reference" |
| expansion and Escape | "expands through controlled state and Escape returns focus to the icon button" |
| grid column cap and one column below `sm` | `surface-layout.component.spec.ts`: "caps the grid at four columns and collapses to one column below sm" |
| submit disabled while pending, with status text | "renders surface.submit as btn btn-primary btn-sm, disabled while pending with the state text in role=status" |
| children projected without SurfaceNodeComponent | "projects children through the host template in spec order, without importing SurfaceNodeComponent" |
| literal text (`<img src=x onerror=…>`) | view model: "keeps producer text literal"; table and layout: "renders producer text literally…" (asserts no `img`/`script`) |
| no style in the DOM | table and layout literal-text tests assert no `style` or `[style]` element |
| unique ids across two instances | table: "uses unique content and filter ids across two instances"; layout: "uses unique status ids across two instances" |

## Contract names used (file:line, under `libs/shared/src/mcp-apps-contracts/`)

- `readSurfacePath` at `surface-data-model.ts:79`, exported by `surface.index.ts:55`.
- `SurfacePathReadResult` at `surface-data-model.ts:26-28`.
- `SURFACE_INPUT_EMPTY_VALUES` at `surface-catalog.ts:61-66`.
- `SURFACE_ACTIONS` at `surface-catalog.ts:41-44`.
- `SURFACE_LIMITS.maxGridColumns`, `.maxTreeDepth` and `.maxComponents` at `surface-catalog.ts:83-91`.
- `checkDraftValue` at `surface-bindings.ts:201`, exported by `surface.index.ts:62`.
- `SurfaceAction` at `surface.types.ts:19-22`.
- `SurfaceComponent` and the layout and input interfaces at `surface.types.ts:24-111`.
- `SurfaceDataModel` and `SurfaceDataValue` at `surface.types.ts:114-121`.
- `SurfaceSelectionTarget` (`table-row`, `rowIndex`) at `surface.types.ts:174-186`.
- `SurfaceContent` at `surface.types.ts:187-196`.
- `DashboardSeriesPoint` and `DashboardTableCell` at `dashboard-spec.types.ts:96-99,115`, re-exported by
  `libs/shared/src/index.ts:34`.
- Committed renderer modules, used unchanged:
  - `mapDisplayNode` and `buildDashboardViewModel` (`dashboard-view-model.ts:14,89`);
  - `tableRows`, `nextTableSort` and `cellText` (`table-rows.ts:41,24,11`);
  - `SurfaceActionUiState` and `SurfaceActionInvoke` (`surface-interaction.ts:8,28`);
  - `DashboardPagerComponent`;
  - the node types in `view-model.types.ts`.

## Deviations

1. **Missing path does not raise a draft error.** The brief says "missing path: empty value plus draft error". The
   contract says a missing path reads as the kind's empty value with `ok: true` (`surface-data-model.ts:74-77,93-97`),
   and that the empty value is "always a valid draft" (`surface-bindings.ts:193-196`). Flagging a missing path would
   mark every unfilled field as invalid. So:
   - a missing path gives the empty value with no error;
   - a real read failure (`ok: false`, for example a denied or invalid path) gives the empty value plus a draft error;
   - a stored value of the wrong type gives the empty value plus a draft error.

   All three are pinned. The batches.md pin ("missing path: empty value") is met as written.
2. **The builder returns a result union instead of throwing.** The brief says "pure, never throws". The plan's older
   wording (implementation-plan.md:739) says the renderer catches a throw. B8 should read `result.renderFailed` rather
   than catch. It also accepts v1 content, so the renderer needs a single builder.
3. **Submit status text colour is neutral** (`text-base-content`), not the prototype's `text-success` for "Sent". This
   follows Req 7.5 and the design-spec contrast rule on small coloured text.
4. **No `aria-selected` on `<tr>`.** It is invalid outside grid roles. The per-row Select button carries `aria-pressed`,
   as the list and chart do.
5. **Lint warnings:** the two new specs add `no-non-null-assertion` warnings (0 errors). This is the same pattern and
   rule level as the committed chart, list and stat specs.

## Verification

Command (from the worktree root):
`npx nx run-many -t lint,typecheck,test -p @ptah-extension/declarative-dashboard --skip-nx-cache --parallel=2 --output-style=static`

Results:

- Test Suites: 9 passed, 9 total.
- Tests: 74 passed, 74 total.
- Lint: 0 errors, 33 warnings, all `no-non-null-assertion` in spec files.
- Typecheck (ngc `--noEmit`): clean.

Last 10 lines:

```
 NX   Successfully ran targets lint, typecheck, test for project @ptah-extension/declarative-dashboard


  Run duration:      10.1s
  Cache:             Skipped (--skip-nx-cache)
  Critical path:     9.3s (1 task)
  Recoverable time:  754ms (7% of the run)
```

## Notes for B8

- Compose as `<ptah-surface-layout [node] [childTemplate]="child" [surfaceId] [actionStates]="interaction.actions"
  [submitDisabled]="interaction.submitDisabled" (actionInvoke)>`.
- `DashboardTableComponent` (`ptah-dashboard-table`) has the same inputs and outputs as the list.
- Neither file is exported from `src/index.ts` yet; B8 owns that.
