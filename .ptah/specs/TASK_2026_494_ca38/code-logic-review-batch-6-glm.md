# Code-logic review — Batch 6 (TASK_2026_494) — GLM review lane

Reviewer: code-logic-reviewer (GLM lane, read-only). Date: 2026-09-25.
Files reviewed (all new, under `libs/frontend/declarative-dashboard/src/lib/`):
`view-model/surface-view-model.ts` (+spec), `components/dashboard-table.component.ts` (+spec),
`components/surface-layout.component.ts` (+spec). No source file was edited. No git was run.

**Score: 8/10**
**Verdict: APPROVED** — 0 blocking findings, 1 minor fix, 3 non-blocking notes carried forward.

Verification re-run (worktree root):
`npx nx run-many -t test -p @ptah-extension/declarative-dashboard --skip-nx-cache`
Result: 9/9 suites green, 74/74 tests green. This matches the executor report.

---

## 1. View model (`view-model/surface-view-model.ts`)

All hunted behaviours hold:

- **Host value from `readSurfacePath`**: `hostValueOf` calls
  `readSurfacePath(dataModel, input.path, input.kind)` at `surface-view-model.ts:65`. The spec pins
  real reads for all four kinds (`surface-view-model.spec.ts:48-60`).
- **Read failure → empty value + draft error**: `surface-view-model.ts:66`
  (`if (!read.ok) return { hostValue: empty, draftError: read.reason }`). A wrong-type stored value
  is caught by `checkDraftValue` and falls back the same way at `:68-69`. Both are pinned
  (`surface-view-model.spec.ts:72-91`).
- **Two inputs sharing a path show one value**: `readSurfacePath` reads the data model, not the
  input, so both inputs get the same host value; pinned at `surface-view-model.spec.ts:93-102`.
- **Selectable only with `dashboard.select`**: `declaresSelect` at `surface-view-model.ts:48-50`
  compares `action.action === 'dashboard.select'` only. The spec iterates every id in
  `SURFACE_ACTIONS` and asserts only `dashboard.select` sets `selectable`
  (`surface-view-model.spec.ts:104-116`). Inputs are always `selectable: false` (`:76`).
- **Non-submit actions render nothing**: `submitActionsOf` (`surface-view-model.ts:53-56`) keeps
  only well-formed `surface.submit` actions; every other `SURFACE_ACTIONS` id and unknown ids are
  dropped. Pinned at `surface-view-model.spec.ts:118-126`. The layout filters a second time
  (`surface-layout.component.ts:105-111`), so a node that skipped the view model cannot smuggle
  another id into a control either — pinned at `surface-layout.component.spec.ts:128-137`.
- **Never throws; `renderFailed` on failure**: the whole build runs inside one try/catch
  (`surface-view-model.ts:177-191`). Malformed shapes throw fixed-text `TypeError`s which become
  `{ renderFailed: true, reason, viewModel: null }`. The exotic-getter case is pinned with a Proxy
  that throws, and asserts the message is not echoed (`surface-view-model.spec.ts:158-178`).
- **v1 content reaches the v1 builder unchanged**:
  `buildSurfaceViewModel` delegates to the committed `buildDashboardViewModel` at
  `surface-view-model.ts:180-181`; the v1 builder file is not in this batch. Pinned at
  `surface-view-model.spec.ts:149-156`.
- **B3 carry-over tightened**: `checkDisplayShape` (`surface-view-model.ts:94-106`) now rejects
  malformed `list.items` and chart `series` before the shared `mapDisplayNode`; both are pinned in
  the never-throws case list (`surface-view-model.spec.ts:167-168`).
- **Bounds**: children beyond `maxTreeDepth` map to `[]` (`:150`), so a cyclic tree stays finite
  (pinned at `surface-view-model.spec.ts:180-187`); more than `maxComponents` mapped nodes fail
  closed (`:128`, pinned at `:188-189`).

## 2. Table (`components/dashboard-table.component.ts`)

- **Reuse, no duplicate logic**: `tableRows`, `nextTableSort`, `cellText` are imported from the
  committed `table/table-rows.ts` (`dashboard-table.component.ts:5`); paging is `pageSlice`
  inside `tableRows`. No local sort, filter or page logic exists.
- **≤ 25 rows in the DOM**: the template iterates `page().items`
  (`dashboard-table.component.ts:71`), which is the `pageSlice` result capped at
  `SURFACE_PAGE_SIZE = 25`. Pinned for 5,000 rows (`dashboard-table.component.spec.ts:62-74`).
- **`aria-sort` follows the sort cycle**: `ariaSort` (`:131-135`) maps none/ascending/descending;
  `nextTableSort` cycles asc → desc → original. Pinned through all three clicks
  (`dashboard-table.component.spec.ts:27-44`).
- **The filter resets the page**: `setFilter` emits `page: 0` (`:139`); sorting also resets
  (`:137`). Pinned (`dashboard-table.component.spec.ts:46-60`).
- **Selection uses the original index across pages**: rows carry `originalIndex` from
  `tableRows`; the emit is `{ componentId, target: { kind: 'table-row', rowIndex } }`
  (`:155`), guarded by `node.selectable` and the row range (`:152-157`). Pinned on page 2 under
  descending sort, where page 2 starts at original row 14
  (`dashboard-table.component.spec.ts:76-98`).
- **Data-reference notice**: `role="status"` with the rowCount, and no table, filter or pager
  (`dashboard-table.component.ts:48-49`). Pinned (`dashboard-table.component.spec.ts:100-105`).
- **Expansion and Escape**: icon button with `aria-expanded` and a per-instance `aria-controls`;
  Escape collapses and returns focus to the button (`:142-147`). Pinned
  (`dashboard-table.component.spec.ts:107-124`).
- **Defensive rendering**: malformed columns keep their position, rows and cells normalise to
  scalars (`:107-124`); pinned without "[object Object]"
  (`dashboard-table.component.spec.ts:146-153`).

## 3. Layout (`components/surface-layout.component.ts`)

- **section / card / stack / grid**: all four kinds are rendered per the plan
  (`surface-layout.component.ts:69-92`); stack direction and the gap enum are pinned
  (`surface-layout.component.spec.ts:89-97`).
- **Grid ≤ 4 columns, one column below `sm`**: `gridColumns` clamps to
  `[1, SURFACE_LIMITS.maxGridColumns]` and maps non-finite values to 1 (`:128-132`); the class
  list is `grid grid-cols-1 sm:grid-cols-N` with literal class names (`:19, :124`). Pinned for
  columns 3, 9 (clamped to 4) and `NaN` (`surface-layout.component.spec.ts:77-87`).
- **Submit disabled while `submitDisabled` or pending, with `role="status"`**:
  `isSubmitDisabled` (`:137-139`) and the status span (`:65`); `invoke()` re-checks before emitting
  (`:140-142`). Pinned including the blocked-click case
  (`surface-layout.component.spec.ts:99-126`).
- **R5 holds**: `SurfaceLayoutComponent` imports only `NgTemplateOutlet`
  (`surface-layout.component.ts:1,51`); children arrive through the required
  `childTemplate` TemplateRef input (`:98`, context at `:11-14`). The spec reads the component
  source and asserts no `SurfaceNodeComponent|surface-node` match, and asserts the DOM holds no
  node component (`surface-layout.component.spec.ts:54-62`). No import cycle is possible: the
  direction is node → layout only.
- **Per-instance ids**: `instanceId` from a module counter (`:96, :16`); status ids pinned unique
  across two instances (`surface-layout.component.spec.ts:148-157`). The table's
  `contentId`/`filterId` are per-instance the same way
  (`dashboard-table.component.ts:102-103`, pinned at `:135-144`).
- **No style anywhere**: grep for `style=`, `[style]`, `innerHTML`, `bypassSecurityTrust`,
  `DomSanitizer` and `text-base-content/NN` over the lib finds matches only in spec assertions.
  Both literal-text specs assert no `style`/`[style]` element
  (`dashboard-table.component.spec.ts:132`, `surface-layout.component.spec.ts:145`).
- **Literal text**: the 538 fixture renders into section/card title and description, a submit
  label and a table title/description/column/cell; each is asserted to render literally with no
  `img`/`script` element (`surface-view-model.spec.ts:141-147`,
  `dashboard-table.component.spec.ts:126-133`, `surface-layout.component.spec.ts:139-146`).
  All bindings are interpolation or attribute bindings.

## 4. Per-deviation rulings

| # | Deviation | Ruling | Evidence |
| --- | --- | --- | --- |
| 1 | A missing path gives the empty value WITHOUT a draft error; only a real read failure or a wrong type gives one | **ACCEPT** | The contract settles this. `readSurfacePath` documents "Missing paths return the input kind's empty value when kind is supplied" (`surface-data-model.ts:74-77`) and returns `ok: true` with the empty value (`:93-97`); `checkDraftValue`'s doc says the absent-path value "is always a valid draft" (`surface-bindings.ts:193-196`). Plan:751-753 requires a draft error only for a read failure (`ok: false`), and the handoff (c) says a missing path reads as the kind's empty value. Flagging a missing path would mark every unfilled field as invalid, a real UX defect. All three branches are pinned (`surface-view-model.spec.ts:62-91`). The batches.md pin "missing path → empty value" is met as written. |
| 2 | `buildSurfaceViewModel` returns a result union and never throws; v1 content goes to the v1 builder | **ACCEPT** | `surface-view-model.ts:24-25, 177-191`: one try/catch, `{ renderFailed: false, viewModel }` or `{ renderFailed: true, reason, viewModel: null }`, so nothing partial renders. v1 delegates unchanged to `buildDashboardViewModel` (`:180-181`). The plan's "if that throws" wording (implementation-plan.md:739-740) described the B8 seam; a never-throwing builder that reports `renderFailed` is strictly safer and preserves the seam. B8 must read `result.renderFailed` instead of catching — already recorded in the report's "Notes for B8". Pinned at `surface-view-model.spec.ts:149-178`. |
| 3 | The submit status uses neutral text (`text-base-content`) instead of the prototype's green "Sent" | **ACCEPT** | `surface-layout.component.ts:65`. Req 7.5 and the design-spec contrast rule on small coloured text apply; Batch 5 already ruled "a uniform text-primary is correct because the contract has no tone field" and "coloured text on neutral surface only" (batches.md, Batch 5 verification). Consistent with the committed stat/list treatment. |
| 4 | `no-non-null-assertion` lint warnings appear in the specs | **ACCEPT** | Verified by source: the two new specs use `!` assertions (for example `dashboard-table.component.spec.ts:22,49,67`, `surface-layout.component.spec.ts:70,101-102`), and the three production files contain none (grep for postfix `!` hits spec files only). This is the same rule level and pattern as the committed chart, stat and list specs (`dashboard-chart.component.spec.ts:36,59`, `dashboard-list.component.spec.ts:15,59`). Warnings, not errors. Non-blocking. |

## 5. Findings

### F1 (minor, fix) — missing space in the data-reference notice

`dashboard-table.component.ts:49`:

```html
<p role="status">Data is not available in this view.@if (data.rowCount !== undefined) { {{ data.rowCount }} rows. }</p>
```

The `@if` block sits directly after the full stop with no whitespace, so the rendered text is
"Data is not available in this view.1200 rows." The spec asserts `toContain('1200 rows')` and
`toContain('not available')`, so it passes either way and does not falsify the join.

Fix: `…in this view. @if …` (one space), or keep the sentence pieces as two text nodes with a
space between them.

### F2 (note, carry to B8) — duplicate ids would break `@for` tracking, but validated content cannot carry them

`surface-layout.component.ts:55` tracks children by `child.id` and `:60` tracks submit actions
by `action.id`. Angular's `@for` requires unique keys. The v2 validator rejects duplicate
component ids and duplicate action ids (`surface.validator.ts:445,450`), so accepted content is
safe. A hostile in-process node that skips the view model could still carry duplicates. This is
the same accepted-risk class as Batch 11's F1 (payloads arrive via structured clone, so hostile
getters and crafted objects are out of process). No action required for this batch; B8's node
composition should keep it in mind if it ever renders a children list that did not pass through
`buildSurfaceViewModel`.

### F3 (note) — `reason` echoes any `TypeError` message, not only the builder's fixed texts

`surface-view-model.ts:189` echoes `error.message` for every `TypeError`. All throws inside this
module are fixed-text `TypeError`s, so for real payloads the reason is one of our own strings. An
exotic in-process getter that throws `new TypeError('…')` would have its message echoed into
`reason`. The renderer shows `reason` as plain text (B15 mono fallback), so this is a text leak at
worst, and the transport (structured clone) cannot deliver throwing getters. Same accepted-risk
class as F2. The never-throws spec uses a plain `Error` for the exotic case and so does not pin
this edge; a `TypeError`-throwing exotic would be the falsifying case if B8 ever wants it.

### F4 (note) — `read.value === undefined` is unreachable with `kind` supplied

`surface-view-model.ts:67`. With `kind` supplied, `readSurfacePath` returns the kind's empty value
for a missing path (`surface-data-model.ts:93-97`), and a stored value can never be `undefined`
(`SurfaceDataValue` has no undefined member, `surface.types.ts:114-120`). The branch is harmless
defensive code that keeps the function total if a future caller omits `kind`. No action.

### F5 (note) — Escape anywhere inside the table collapses it

`(keydown.escape)` is bound on the whole section (`dashboard-table.component.ts:34`), so Escape
while focus is on a sort button or a Select button also collapses, not only from the filter. This
is the committed Batch 5 list pattern (batches.md, Batch 5: "Escape in the list filter also
collapses the list" — optional, non-blocking). Consistent behaviour across display kinds.

## 6. Exact fix list

1. **`dashboard-table.component.ts:49`** — add one space before the `@if` rowCount block (or
   between the two text pieces) so the notice reads "Data is not available in this view. 1200
   rows." Cosmetic; no behaviour change; the existing spec keeps passing.

No other change is required. F2-F5 are notes for B8 and the record, not fixes for this batch.

## 7. Conclusion

Batch 6 meets its brief and the plan lines it cites (implementation-plan.md:749-763, 776-779).
Every spec pin claimed in `batch-6-report.md` exists in the spec files and asserts what the report
says. All four executor deviations are contract-faithful and are accepted. R5 is satisfied by
design: the layout imports only `NgTemplateOutlet`, children arrive through a TemplateRef input,
and the import direction stays node → layout. The one finding is cosmetic.

**Score: 8/10 — APPROVED.**