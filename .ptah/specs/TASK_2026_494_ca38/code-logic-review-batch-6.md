# Code Logic Review — Batch 6, `TASK_2026_494`

Scope: `libs/frontend/declarative-dashboard/src/lib/view-model/surface-view-model.ts` (+spec),
`libs/frontend/declarative-dashboard/src/lib/components/dashboard-table.component.ts` (+spec),
`libs/frontend/declarative-dashboard/src/lib/components/surface-layout.component.ts` (+spec). Read in full.
Cross-checked against `implementation-plan.md:749-790`, `batches.md` Batch 6 / Batch 3-5 outcomes, plan-validation R5,
`handoff-494.md` section (c) `:130-160`, `task-description.md` Req 4.x-7.x, and `prototype/index.html` (deploy
table, layout, rollback form submit JS).

## Summary

| Metric              | Value                                |
| -------------------- | ------------------------------------ |
| Overall score        | 8/10                                  |
| Assessment            | APPROVED                              |
| Blocking issues       | 0                                     |
| Serious issues        | 0                                     |
| Moderate issues       | 2                                     |
| Failure modes found   | 1 (defended, not a defect)            |

Verification re-run: `npx nx run-many -t lint,typecheck,test -p @ptah-extension/declarative-dashboard --skip-nx-cache`
→ 3/3 targets green, 9/9 suites, 74/74 tests, lint 0 errors / 33 warnings (all `no-non-null-assertion`, spec-only),
typecheck clean. `readSurfacePath` (`libs/shared/src/mcp-apps-contracts/surface-data-model.ts:79-103`) and
`checkDraftValue` (`surface-bindings.ts:201-238`) read directly to verify deviation 1.

## Deviation rulings

### 1. Missing path gives the empty value with no draft error — ACCEPT

`readSurfacePath(dataModel, input.path, input.kind)` is always called with `input.kind` set
(`surface-view-model.ts:65`). Reading the function itself: when a segment is absent, it returns
`{ ok: true, value: SURFACE_INPUT_EMPTY_VALUES[kind] }` (`surface-data-model.ts:88-96`) — not `ok:false` and not
`value: undefined`. `SURFACE_INPUT_EMPTY_VALUES` (`''`, `null`, `null`, `false`, `surface-catalog.ts:61-66`) all pass
`checkDraftValue` unconditionally (`surface-bindings.ts:205,216,220,223`), so `hostValueOf`
(`surface-view-model.ts:63-70`) returns `{ hostValue: empty }` with no `draftError`. A parse/path failure
(`ok:false`) and a stored value that fails `checkDraftValue` (wrong type, unknown option) both add `draftError`
(`:66,69`). This is exactly what `handoff-494.md:138-140` and plan `:751-753` state, and matches
`surface-view-model.spec.ts:62-91`, which pins all three branches (missing → empty, no error; denied/invalid path →
empty + error; wrong-typed stored value → empty + error). The batches.md pin text ("missing path: empty value")
undersold the case but is satisfied; the fuller three-way split is the correct reading of the contract, not a
weakening of it.

### 2. `buildSurfaceViewModel` never throws; v1 passed through unchanged — ACCEPT, with a carry-forward to B8

`buildSurfaceViewModel` wraps the whole build in one `try/catch` (`surface-view-model.ts:177-190`) and for
`contract: 'dashboard-spec/1'` calls `buildDashboardViewModel(renderable.spec)` (`:181`) with no modification to that
function. `dashboard-view-model.ts` is untouched by this batch (confirmed by `git status`: not in the changed-file
set) and still throws `TypeError` on the same invalid shapes it always did (`:92-99,107-111`); the wrapper only
changes who catches that throw. `surface-view-model.spec.ts:149-156` ("still builds v1 content") proves a valid v1
spec still produces the same node list. Nothing in v1 behaviour changed; only the failure-reporting mechanism at the
top of the new v2-aware entry point changed, and only there.

The plan text (`implementation-plan.md:739-740`) describes the *renderer* catching a throw from
`SURFACE_VIEW_MODEL_BUILDER`. This batch's default implementation for that token instead never throws and returns a
discriminated union, which is a reasonable, arguably safer design (it does not rely on exceptions for control flow
across a DI boundary, and it keeps the "reason" text scrubbed to known-safe strings — verified by the "never throws"
test's exotic-`Proxy` case not leaking "secret diagnostics", `surface-view-model.spec.ts:158-178`). It does create an
open question for Batch 8: the `SURFACE_VIEW_MODEL_BUILDER` DI token must still support a *caller-supplied* override
that throws (Batch 15's spec pin "builder override throws → mono fallback" implies exactly that), so
`SurfaceRendererComponent` needs to wrap **any** call to the token — default or override — in its own try/catch and
treat a thrown exception and a returned `{renderFailed:true}` identically. That is B8's job, not a defect in this
batch, but it should be named explicitly in B8's brief so the two failure paths are not accidentally left divergent.

### 3a. Submit status text is neutral, not the prototype's `text-success` "Sent" — ACCEPT (non-blocking, carried to R10)

`submitStatusText`/the template render every status, including `applied` → `'Sent'`, in the same
`class="text-xs text-base-content"` span (`surface-layout.component.ts:33,65`), where the prototype colours only the
`applied` case with `text-success` (`prototype/index.html:589-591`). Req 7.5 reads: "When a stat or state value is
shown in colour, it shall be coloured text on a neutral surface. No readable text shall sit on a filled
`badge-success`/`badge-info`, and small body text shall not use raw `text-error` or `text-info`" — it permits colour
on a neutral surface, and explicitly bars only `text-error`/`text-info` for small text, not `text-success`. No
component in `libs/frontend/declarative-dashboard/src` uses `text-success`/`text-error`/`text-info` anywhere
(confirmed by a repo grep across the whole lib), so the neutral choice here is consistent with every other batch
(B4's chart status text, B5's stat delta — "uniform text-primary is correct because the contract has no tone field").
The batch-6-report's stated justification ("the design-spec contrast rule on small coloured text") over-reaches: no
`design-spec.md` exists in this task folder (confirmed absent by Batch 20's own note), so that citation is
inaccurate — the rule actually cited lives in `task-description.md` Req 7.5 itself and does not forbid this. Ruling:
accept the neutral rendering as a safe default absent a confirmed contrast table for `text-success` on both themes,
but the fidelity gap against the approved prototype is real and belongs with the other colour/density carry-overs
already queued for the R10 visual gate (stat density, delta phrasing). Recommend, not require: bind
`[class.text-success]="status?.status === 'applied'"` on the status span once contrast is confirmed for both themes.

### 3b. `aria-pressed` on the table's Select button, not `aria-selected` on `<tr>` — ACCEPT

The prototype's deploy table uses `role="row"` `<tr>` elements with `aria-selected`
(`prototype/index.html:503-510`), a grid/listbox selection pattern. This implementation instead renders a plain
`<table>` (no `role="grid"` on the table, no `role="row"` on `<tr>`) with an explicit `<button>Select</button>` per
row carrying `aria-pressed` (`dashboard-table.component.ts:77-81`). Applying `aria-selected` to a `<tr>` inside a
table that does not carry `role="grid"` is itself non-conforming ARIA (per WAI-ARIA, `aria-selected` is valid only on
elements with a role that supports it — `row` within `grid`/`treegrid`, or `option`/`gridcell`/`tab`, etc.). Given
this component uses a toggle-button interaction (matching `DashboardChartComponent`'s chart-as-table toggle,
`dashboard-list.component.ts:61` and `dashboard-stat.component.ts:32`, all already-approved in Batches 4-5),
`aria-pressed` on a real `<button>` is the ARIA-correct choice for that widget, and it is consistent across chart,
list, stat and now table. Ruling: accept — it is both the more standards-correct binding for the actual markup used
here and consistent with the codebase's already-reviewed precedent.

### 4. `no-non-null-assertion` lint warnings confined to the two new spec files — ACCEPT

Re-ran `nx run declarative-dashboard:lint --skip-nx-cache`: 33 warnings, 0 errors, all
`@typescript-eslint/no-non-null-assertion`, all inside `dashboard-table.component.spec.ts` and
`surface-layout.component.spec.ts`. The production files (`surface-view-model.ts`, `dashboard-table.component.ts`,
`surface-layout.component.ts`) carry none. The existing `dashboard-chart.component.spec.ts`,
`dashboard-list.component.spec.ts` and `dashboard-stat.component.spec.ts` already use the same `!.` pattern at the
same rule severity (confirmed by grep), so this is the established test-authoring convention for this lib, not a new
relaxation.

## Five logic questions

### 1. How does this fail silently?

`buildSurfaceViewModel`'s single `catch` (`surface-view-model.ts:187-190`) turns any thrown error — including a real
programming defect elsewhere in the call graph, not just a content-shape violation — into a generic
`renderFailed: true` with `BUILD_FAILED` text. This is deliberate (Req 3.6 seam; keeps exotic getter diagnostics from
leaking, tested at `surface-view-model.spec.ts:158-178`) and was already the documented failure contract for
`buildDashboardViewModel` since Batch 3 (`dashboard-view-model.ts:85-88`'s own doc comment). It is not a new silent
failure introduced by this batch; noted for completeness rather than as a finding.

### 2. What user action produces unexpected behaviour?

None found that isn't defended and tested. Sorting, filtering, paging, selecting on a later page, expanding/Escape,
and submit-state transitions are each covered by a spec that asserts the exact DOM/output, not just "no crash"
(`dashboard-table.component.spec.ts:27-153`, `surface-layout.component.spec.ts:77-157`).

### 3. What input data produces a wrong answer?

A layout node's raw `actions` field is copied through unfiltered (`surface-view-model.ts:151`, `common.actions:
component.actions`) alongside the filtered `submitActions`. `SurfaceLayoutComponent` only ever reads
`node().submitActions` for rendering (`surface-layout.component.ts:105-111`) and re-filters it a second time
defensively (proven by `surface-layout.component.spec.ts:128-137`, "renders no control for unknown or unsupported
actions" — even a node with unfiltered `submitActions` cannot produce an extra button). No wrong-answer path found.

### 4. What happens when a dependency fails?

`readSurfacePath` itself catches exotic-object property-access throws internally and returns `{ok:false, reason}`
rather than throwing (`surface-data-model.ts:97-100`), so a hostile or malformed `dataModel` cannot crash
`buildSurfaceViewModel`; it surfaces as a per-input draft error instead, verified end to end by the `denied`/`invalid`
cases in `surface-view-model.spec.ts:72-80`.

### 5. What is missing that the requirements never mentioned?

The `applied` → `'Sent'` status-text branch (`surface-layout.component.ts:32`) is exercised only implicitly through
the switch's default coverage; no spec asserts `status().textContent === 'Sent'` for `status: 'applied'` the way
every other status value is asserted in `surface-layout.component.spec.ts:99-126`. Minor coverage gap, not a defect
(the string is simple and the switch is exhaustive over a closed union), but worth a one-line addition when B15 wires
real submit flows.

## Failure modes

### Unreachable defensive branch in `hostValueOf`

- Trigger: none reachable through the current call site.
- Symptom: none — dead code, not a runtime failure mode.
- Evidence: `surface-view-model.ts:63-70`. `hostValueOf` is only ever called with `input.kind` defined
  (`mapInput`, `:72-91`), and `readSurfacePath` never returns `value: undefined` when `kind` is supplied
  (`surface-data-model.ts:88-96`: the `kind === undefined ? undefined : SURFACE_INPUT_EMPTY_VALUES[kind]` ternary
  always takes the empty-value branch here). So line 67 (`if (read.value === undefined) return { hostValue: empty
  };`) can never execute today.
- Current handling: harmless defensive code; does not affect behaviour or test outcomes.
- Recommendation: leave as-is (cheap insurance against a future `readSurfacePath` change) or remove with a comment
  explaining why; not worth a fix round on its own.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

- Moderate: batch-6-report.md's justification for deviation 3a cites a "design-spec.md measured-contrast rule" that
  does not exist in this task folder; the actual applicable rule is `task-description.md` Req 7.5, which permits
  `text-success` here. Recommend correcting the citation and deciding the colour question explicitly at the R10
  visual gate rather than by an inaccurate reference (`surface-layout.component.ts:33`).
- Minor: no direct spec assertion for the `applied` → `'Sent'` status text (`surface-layout.component.ts:32`; see
  Five logic questions #5).
- Minor: dead defensive branch in `hostValueOf` (`surface-view-model.ts:67`; see Failure modes).

## Data flow

1. `SurfaceRenderable` (v1 or v2) enters `buildSurfaceViewModel` — OK, discriminated by `contract`.
2. v1 → `buildDashboardViewModel(spec)`, unchanged since Batch 3 — OK, throws on invalid shape, caught by the new
   wrapper's `try/catch` — OK, same outward `renderFailed` contract the plan describes for the renderer.
3. v2 → `buildSurface(content)`: envelope shape-checked (`:110-119`), then `mapComponents` walks the tree
   depth-first, capping at `SURFACE_LIMITS.maxComponents` (`:128`) and `maxTreeDepth` (`:150`) — OK, finite even for a
   self-referential/cyclic input (tested, `:180-186`).
4. Each input node's host value is read through `readSurfacePath` + `checkDraftValue` — OK, three-way outcome
   (present/valid, missing, invalid) all tested.
5. Each layout node's `submitActions` is pre-filtered to well-formed `surface.submit` actions only — OK, re-filtered
   again by the consuming component — OK, defense in depth confirmed by test.
6. `SurfaceLayoutComponent` renders chrome and projects `node().children` through a caller-supplied `TemplateRef`,
   never importing `SurfaceNodeComponent` — OK, R5 satisfied and pinned by source-scan + DOM assertion.
7. `DashboardTableComponent` derives `columns`/`safeNode` defensively from `node()`, feeds `tableRows`/`nextTableSort`
   for sort/filter/page, and renders at most `SURFACE_PAGE_SIZE` rows regardless of input size — OK, tested at 5,000
   rows.
8. Selection and submit events leave the components as typed outputs (`selectionChange`, `actionInvoke`,
   `viewStateChange`) with no RPC or I/O anywhere in this batch — OK, matches "pure view, no I/O" contract; nothing in
   these three files imports an RPC/VSCode service.

No step hides a silent loss, duplication or stale read within this batch's scope.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Host value from `readSurfacePath`; read failure → empty + draft error (plan:751-753) | COMPLETE | none — three-way split is the correct reading (see deviation 1) |
| Table reuses `tableRows`/`nextTableSort`/`pageSlice`, ≤25 rows in DOM for 5,000 rows | COMPLETE | none, tested |
| `aria-sort` cycles asc/desc/none on the table header | COMPLETE | tested |
| Filter resets the page | COMPLETE | tested |
| Selection uses the original index on page 2 | COMPLETE | tested |
| `data` reference notice with `rowCount` | COMPLETE | tested |
| Expansion + `Escape` returns focus | COMPLETE | tested |
| Grid caps at 4 columns, one column below `sm` | COMPLETE | tested |
| `surface.submit` disabled while `submitDisabled` or pending, status in `role="status"` | COMPLETE | 'Sent' text branch untested directly (minor) |
| R5: no `SurfaceNodeComponent` import; children via `TemplateRef` input | COMPLETE | tested (source scan + DOM) |
| `selectable` true only with `dashboard.select` | COMPLETE | tested across every `SURFACE_ACTIONS` id |
| Non-submit actions render no control | COMPLETE | tested for both layout and (implicitly, via `selectable`) table |
| Per-instance ids | COMPLETE | tested for both components |
| No `style` anywhere | COMPLETE | tested |
| Literal text (no HTML injection) | COMPLETE | tested with the trust-boundary fixture string |
| B3 carry-over: tightened `list.items`/series checks in the v2 mapper only | COMPLETE | v1 mapper (`dashboard-view-model.ts`) confirmed untouched |
| Req 7.5 colour-on-neutral-surface fidelity to prototype's green "Sent" | PARTIAL | neutral text used instead of `text-success`; not required by Req 7.5, but the fidelity gap is real (see deviation 3a) |

Implicit requirements not addressed: none found beyond the minor coverage/citation notes above.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Missing input path | YES | empty value, no draft error | none |
| Unreadable/denied path (`__proto__`, bad segment) | YES | empty value + draft error | none |
| Stored value of wrong type/invalid option | YES | empty value + draft error | none |
| Two inputs sharing one path | YES | same host value | none |
| Cyclic v2 component tree | YES | bounded by `maxTreeDepth`, finite | none |
| Oversize component count (>`maxComponents`) | YES | `renderFailed` | none |
| Unknown/mystery component kind | YES | `renderFailed` via `mapDisplayNode`'s `default` throw | none |
| Malformed table rows/cells/columns | YES | normalised to scalars, position preserved, no `[object Object]` | none |
| 5,000-row table | YES | ≤25 rows in DOM, pager shows "Page 1 of 200" | none |
| Selection on page 2 after descending sort | YES | uses original row index | none |
| Data-reference table (`data` present) | YES | notice only, no table/filter/pager | none |
| Grid `columns` non-finite or out of range | YES | clamped to `[1,4]` defensively in the component, independent of the builder | none |
| Submit action states (pending/rejected variants/indeterminate) | YES | exact status text per state, tested | `applied`→"Sent" text untested directly (minor) |
| Two component instances on one page | YES | unique `contentId`/status ids | none |
| Trust-boundary markup in every text field | YES | rendered literally, no `img`/`script`/`style` element | none |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none blocking; the only material forward risk is that B8's `SurfaceRendererComponent` must be built to
  catch a throwing `SURFACE_VIEW_MODEL_BUILDER` override the same way it treats this batch's non-throwing default
  (`renderFailed: true`) — both paths must converge on identical renderer behaviour, or the "builder override throws"
  spec pin at Batch 15 will not hold.
- What a robust implementation would add: (1) a direct assertion for the `applied` → `"Sent"` status text; (2) an
  explicit, correctly-cited decision (not a reference to a non-existent `design-spec.md`) on whether `text-success`
  should differentiate a successful submit from the other neutral states, resolved at the R10 visual gate alongside
  the other queued colour/density carry-overs; (3) removing or annotating the now-dead `read.value === undefined`
  branch in `hostValueOf`.
