# Code Logic Review — `TASK_2026_494` Batch 5

Scope: `libs/frontend/declarative-dashboard/src/lib/components/dashboard-stat.component.ts` (+ spec),
`dashboard-list.component.ts` (+ spec), `dashboard-pager.component.ts` (covered by the list spec). Read in full.
Cross-checked against `batches.md` Batch 5, `implementation-plan.md:776-790`, `task-description.md` Req 4.1/4.4/4.5/
5.2/5.3/7.1/7.2/7.5, `batch-5-report.md`, `surface.types.ts:174-186` (`SurfaceSelectionTarget`/`SurfaceSelection`),
`dashboard-view-model.ts:62-69` (`mapDisplayNode`'s `list` case), and `prototype/index.html:162-177`.
`npx nx run-many -t lint,typecheck,test -p @ptah-extension/declarative-dashboard --skip-nx-cache` re-run: all
green. `ptah_get_diagnostics` flagged 2 TS4029 findings on `dashboard-list.component.ts:81` and
`dashboard-stat.component.ts:42` that the project's own typecheck command does not reproduce — see "Diagnostics
discrepancy" below; treated as non-blocking.

## Summary

| Metric              | Value                                |
| ------------------- | ------------------------------------ |
| Overall score       | 8/10                                 |
| Assessment          | APPROVED                             |
| Blocking issues     | 0                                    |
| Serious issues      | 0                                    |
| Moderate issues     | 1                                    |
| Failure modes found | 1                                    |

## Fix list

No required fixes — 0 blocking, 0 serious issues.

Optional, non-blocking (see evidence and reasoning below):

1. `dashboard-list.component.ts:44-51` — Escape inside the `type="search"` filter input both collapses the list
   (via the section-level `(keydown.escape)`) and may trigger the browser's native search-field clear on the same
   keypress. Consider `stopPropagation` when `event.target` is the filter input, or accept as-is (no requirement
   forbids it). Not required.
2. `dashboard-stat.component.ts:35-38` vs `dashboard-list.component.ts:44-51` — stat hides its description entirely
   behind `[hidden]` while list keeps its description always visible and only truncates (scrollable, not hidden)
   its item list. Both are individually compliant; consider documenting this as an intentional per-kind difference
   so a future reader of one component doesn't assume the other's pattern. Not required.
3. `table-rows.ts`/list filter duplication — the list's own inline filter/page computed (`dashboard-list.component.ts:103-107`)
   re-implements the same "join visible fields, lowercase, includes" shape as `tableRows` in `table-rows.ts:32-49`
   without sharing code (acceptable — list items are a different shape than table rows — flagged only as a future
   dedup opportunity, not a defect).

## Five logic questions

### 1. How does this fail silently?

- `DashboardListComponent.items` (`dashboard-list.component.ts:92-102`) silently drops any array element that is
  not a plain object, or is an object with no displayable `text`/`detail`/`url` field, rather than surfacing a
  count of dropped items. This is the intended defensive boundary (never throws), and it is the correct trade-off
  given `mapDisplayNode`'s `list` case (`dashboard-view-model.ts:62-69`) passes `component.items` through with no
  shape check — but a producer sending garbage gets a silently shorter list with no diagnostic. Matches the
  established pattern from Batch 3/4 (never throws, fails closed) and is consistent with how this task treats
  malformed input elsewhere.
- `DashboardPagerComponent.move()` (`dashboard-pager.component.ts:33-37`) silently no-ops if the computed `next`
  page equals the current page (e.g. a stray click on a disabled-looking button before Angular re-renders
  `[disabled]`) — correct behaviour, not a defect.

### 2. What user action produces unexpected behaviour?

- Pressing `Escape` while typing in the list's filter input collapses the whole list (see Fix list item 1). The
  event bubbles from `<input>` up to the `<section>`'s `(keydown.escape)` handler (`dashboard-list.component.ts:31`),
  and `collapse()` only guards on `viewState().expanded`, not on which element had focus. This is explicitly asked
  about — see "Escape inside filter" analysis below.
- Selecting a stat, then toggling something else that changes `node()` (e.g. producer re-sends a spec with the
  same `id`) does not reset `selection` locally — but selection is driven entirely by the `selection` input from
  the parent (Rule: parent feeds state back), so this is out of this batch's control surface, same controlled
  pattern as Batch 4's chart. Not a defect here.

### 3. What input data produces a wrong answer?

- None found that produces a *wrong* (as opposed to defensively empty) answer. `items()` and `page()` are pure,
  deterministic and covered by dedicated malformed-input, paging and filtering specs
  (`dashboard-list.component.spec.ts:32-56,120-137`).

### 4. What happens when a dependency fails?

- No RPC, transport or timer dependency exists in any of the three files; all three are pure input/output Angular
  components. `DashboardListComponent` depends only on `pageSlice` (pure, already reviewed in Batch 4) and its own
  local `items`/`page` computeds.

### 5. What is missing that the requirements never mentioned?

- No requirement specifies where nulls/malformed rows should be reported (a count of skipped items, for instance);
  the list silently narrows. Not a stated acceptance criterion, so not a gap against any requirement — noted only
  as a residual observability gap, matching the same class of note carried from Batch 4's table sort.

## Point-by-point findings (team-leader's checklist)

### 1. Carry-overs from B3 and B4

- **`mapDisplayNode` does not shape-check `list.items`, never throws**: confirmed still true —
  `dashboard-view-model.ts:62-69` passes `items: component.items` through untyped/unchecked. The actual boundary
  is `DashboardListComponent.items` (`dashboard-list.component.ts:92-102`), which treats the value as `unknown`,
  guards `Array.isArray`, and `flatMap`s away anything that is not a record or has no displayable field. The
  malformed-input spec (`dashboard-list.component.spec.ts:120-137`) exercises `null`, `2`, `{}`, non-string nested
  `text`/`detail`/`url`, and non-array `items` values (`undefined`, `null`, `{}`, `'not-an-array'`) and asserts no
  throw and no lost original indices for the surviving items. This closes the non-blocking note carried from the
  Batch 3 review ("B6 may tighten it when the v2 builder reuses the mapper" — it is tightened here at the
  component boundary instead, which is an equally valid place for the fail-closed guard).
- **Ids unique per instance**: confirmed. `detailsId` (`dashboard-stat.component.ts:49`,
  `ptah-stat-details-${nextStatInstance++}`) and `contentId`/`filterId`
  (`dashboard-list.component.ts:88-89`, `ptah-list-content-${nextListInstance++}` /
  `${contentId}-filter`) are module-level monotonic counters, independent of the producer's `node.id` — two
  instances rendering nodes with the same `id` get distinct DOM ids, verified by
  `dashboard-stat.component.spec.ts:69-75` and `dashboard-list.component.spec.ts:111-119` (both also check the
  `<label for>`/`<input id>` pairing survives the per-instance id).
- **Selection uses the ORIGINAL index across pages and after filtering**: confirmed.
  `dashboard-list.component.spec.ts:72-89` pages to page 2 (`itemIndex 25`), selects, then filters to a single
  remaining row (`itemIndex 29`) and selects again — both selections carry the pre-filter, pre-page
  `originalIndex` assigned once in `items()` (`dashboard-list.component.ts:95`, `originalIndex` from the source
  `flatMap` index, never recomputed after filter/sort/page). `selectItem` (`:125-129`) additionally guards against
  a stale/nonexistent index (`items().some(item => item.originalIndex === itemIndex)`), tested with
  `selectItem(999)` producing no new emission (`:88`).

### 2. Expansion

- **`aria-expanded`/`aria-controls`**: correct in both components — `aria-expanded` is bound to
  `!!viewState().expanded` and `aria-controls` to the component's own unique id
  (`dashboard-stat.component.ts:19`, `dashboard-list.component.ts:36`); both ids resolve to a real element in the
  DOM (`dashboard-stat.component.spec.ts:49`, `dashboard-list.component.spec.ts:94`).
- **Escape collapses and returns focus**: confirmed by both specs
  (`dashboard-stat.component.spec.ts:58-63`, `dashboard-list.component.spec.ts:102-106`), including the check that
  the `<section>` carries no `role`/`tabindex` (`:64-65`, `:107-108`) — satisfying Req 7.1's "When it nests an
  interactive control, the container shall carry no role, tabindex" clause. The container *does* carry a key
  handler (`(keydown.escape)`), but Req 7.1's "no key handler" clause reads, in context, as forbidding the
  *activation* key handler from the alternative pattern in the same acceptance criterion (making the whole
  container an Enter/Space-activatable button when there is no nested interactive control) — not as forbidding the
  distinct Escape-to-collapse handler that Req 7.2 separately requires. Since both components here nest
  interactive controls (buttons, and for list, the filter input), the "container-as-button" pattern correctly does
  not apply, and no `role`/`tabindex`/Enter-Space handler was added. Reading "no key handler" as also forbidding
  the AC2 Escape handler would make AC1 and AC2 mutually unsatisfiable for any expandable component that nests a
  control, which cannot be the intended reading. **Acceptable.**
- **Escape inside the filter input also collapses**: confirmed this is what happens —
  `(keydown.escape)` sits on `<section>` (`dashboard-list.component.ts:31`), the filter `<input>` is a descendant,
  and `keydown` bubbles, so `collapse()` fires regardless of which focused element inside the section raised the
  event. This is **acceptable against the written requirements**: Req 7.2 ("When an expanded component is open and
  the user presses Escape, it shall close...") names no carve-out for a focused input, and the spec is explicit
  that the handler must work from any focus position inside the component (the stat's own Escape test focuses the
  *select* button, not the expand button, before pressing Escape, and still expects collapse —
  `dashboard-stat.component.spec.ts:58-59`). The only residual concern is a native-browser one: `<input
  type="search">` (`dashboard-list.component.ts:49`) may itself react to Escape (clearing its value) in some
  browsers, layering a native behaviour on top of the collapse — a UX nuance, not a coded defect, and not
  addressed by any acceptance criterion. Flagged as Fix-list item 1 (optional).
- **Stat description hidden by default**: confirmed — `description` (and any projected `<ng-content>`) sits inside
  the `[hidden]` block (`dashboard-stat.component.ts:35-38`), invisible until expanded. This is **acceptable**:
  Req 4.1's stat acceptance criterion (`task-description.md:107`) enumerates exactly "label, value, `unit` and
  `delta`" as the required-visible fields — `description` is not in that list, so gating it behind the same
  Expand affordance the plan specifies generically ("expansion with icon buttons and Escape",
  `implementation-plan.md:777`) is a legitimate design choice, not a shortfall against any acceptance criterion.
  Noted only as an asymmetry with the list component (whose `description` is always visible, only its item list is
  truncated-but-scrollable when collapsed) — see Fix-list item 2.

### 3. Pager

- **Bounds and clamping**: `move()` (`dashboard-pager.component.ts:33-37`) clamps `page + delta` to
  `[0, pageCount - 1]` before emitting, and only emits when the result actually differs from the current page —
  matches `pageSlice`'s own clamp contract (Batch 4) so the two never disagree. `[disabled]` bindings
  (`:18,20`) independently gate the buttons at both ends, tested at page 1/3 and page 3/3
  (`dashboard-list.component.spec.ts:37-38,47-48`).
- **"Page X of Y"**: `role="status"` text renders `pagination().page + 1` of `pagination().pageCount`
  (`dashboard-pager.component.ts:16`); tested across three pages including a clamp-from-999 case
  (`dashboard-list.component.spec.ts:36,42,47`).
- **Page resets to 0 after a filter reduces the result set**: confirmed — `setFilter()`
  (`dashboard-list.component.ts:112`) always emits `page: 0` alongside the new filter value in the same state
  object, so a filter change and a page reset are atomic (no intermediate render with a stale out-of-range page).
  Tested from `page: 99` down to `page: 0` across three different queries
  (`dashboard-list.component.spec.ts:60-66`).

### 4. Contract

- **`SurfaceSelection` target shapes**: `dashboard-stat.component.ts:61` emits
  `{ componentId: node().id, target: { kind: 'stat' } }` and `dashboard-list.component.ts:127` emits
  `{ componentId: node().id, target: { kind: 'list-item', itemIndex } }` — both match
  `SurfaceSelectionTarget` at `surface.types.ts:175,177` exactly (no extra or missing fields), and the enclosing
  `SurfaceSelection` shape at `:183-186`. Confirmed by direct type comparison; no `as`/unsafe cast is used.
- **`aria-pressed` on the stat compares only the kind — is that sufficient?** The premise undercounts what the
  code does: `dashboard-stat.component.ts:32` compares **both** `selection()?.componentId === node().id` **and**
  `selection()?.target?.kind === 'stat'`. Since the `stat` target variant carries no further discriminating field
  (`{ readonly kind: 'stat' }`, no index), `componentId` is the only other axis that could distinguish one stat's
  selection from another's, and it is checked. This is sufficient and correctly mirrors the `list-item`/`chart-point`
  variants' pattern of checking `componentId` plus every field the target shape actually has.
- **`url` is plain text, never a link**: confirmed — `dashboard-list.component.ts:58` renders
  `<p class="break-all ...">{{ item.url }}</p>`, no `<a>`/`href` anywhere in either file; asserted by
  `element.querySelector('a, [href], img, style, [style]')).toBeNull()` (`dashboard-list.component.spec.ts:27`).
- **`ol start` correct across pages**: confirmed — `[start]="page().page * pageSize + 1"`
  (`dashboard-list.component.ts:69`) with `pageSize = SURFACE_PAGE_SIZE` (25); page 1 (index 1) yields `start=26`,
  tested directly (`dashboard-list.component.spec.ts:43`).
- **CSP**: no `style` attribute, binding or element in either file — confirmed by source read and by the retained
  `style, [style]` null assertions in both rendering specs (`dashboard-list.component.spec.ts:27`,
  `dashboard-stat.component.spec.ts:22`). `[class.max-h-64]` and `[hidden]` are attribute/property bindings, not
  style injection, consistent with the CSP boundary established in Batch 4.

### 5. Prototype fidelity (`prototype/index.html:162-177`)

- **Uniform `text-primary` value colour vs the prototype's per-stat semantic hues (success/info/warning)**: not a
  gap. `StatNode`/the v1-v2 contract carries no tone/semantic-colour field (only `value`, `unit`, `delta`,
  `title`, `description`), so there is no producer signal to select `text-success`/`text-info`/`text-warning`
  from — the prototype's per-tile colouring was a static illustrative choice, not contract-backed. A single
  `text-primary` (`dashboard-stat.component.ts:26`) is the only compliant option (Req 7.5: "coloured text on a
  neutral surface", satisfied) without inventing a colour-selection rule the contract does not define.
- **Density (text-lg vs text-sm, p-3 vs px-2 py-1.5), full-size Expand button, "Change: +N" on its own line vs
  inline "(Δ +1 …)"**: these are visual density/typography choices with no behavioural consequence and no
  acceptance criterion naming exact type scale or spacing. This is the same class of finding as Batch 4's chart
  hue/pattern fidelity note: the plan's Mode-3 rendered-visual-evidence gate (R10) runs against the assembled Apps
  page after Batch 17/20, not per pure-component batch, and Batch 5 does not compose stat/list into the actual
  grid layout the prototype shows (that is a later batch's job). Recommend the team-leader carry this forward as a
  decision point for that visual gate (tighten spacing/type scale toward the prototype, or formally accept the
  current density) rather than treating it as a Batch 5 defect. **Not a required fix now.**

## Diagnostics discrepancy

`ptah_get_diagnostics` reported TS4029 ("has or is using name 'DisplayNodeFields' ... but cannot be named") on
`dashboard-list.component.ts:81` and `dashboard-stat.component.ts:42` (the `node = input.required<...Node>()`
declarations). `DisplayNodeFields` is an unexported interface in `view-model.types.ts:14-19`, used inside a mapped
conditional type (`DisplayOf<T>`) whose result is re-exported by name as `DisplayNode` (`view-model.types.ts:25`).
Independently re-running the project's actual typecheck command,
`npx ngc --noEmit --project libs/frontend/declarative-dashboard/tsconfig.lib.json` (the exact command the
`typecheck` Nx target runs, against `tsconfig.lib.json`, which does set `"declaration": true`), exits `0` with no
diagnostics of any kind, and `npx nx run-many -t lint,typecheck,test ...` (re-run independently for this review)
is green. Since `ChartNode`/ `TableNode` from Batch 3/4 use the identical `Extract<DisplayNode, {...}>` pattern and
did not trigger this in the earlier review's diagnostics check either, and the authoritative compiler invocation
disagrees with the IDE-side tool, this is treated as a stale/non-reproducing artifact of the diagnostics tool
rather than a real compile error. Not counted against the score; noted for transparency.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

- Moderate: none directly attributable to this batch's own logic. (The one item that would otherwise be Moderate —
  Escape colliding with a native `input[type=search]` clear-on-Escape — is UX friction, not a functional defect,
  and is listed as optional Fix-list item 1.)
- Minor: stat vs list asymmetric "hidden vs always-visible+truncated" expansion pattern (Fix-list item 2).
- Minor: list's inline filter/page logic duplicates the shape of `tableRows`'s filter without sharing code
  (Fix-list item 3) — acceptable given the different item shape, flagged only as a future dedup opportunity.

## Data flow

1. `node().items` (`unknown` at the type boundary since the upstream `mapDisplayNode` does not shape-check it) →
   `DashboardListComponent.items` computed — OK, defensively narrows to `ListItem[]` with a preserved
   `originalIndex`, never throws.
2. `items()` → `page()` computed: lowercase substring filter over joined visible fields, then `pageSlice` — OK,
   filter always resets to page 0 via `setFilter`'s atomic emission, `pageSlice` clamps any stale/invalid page.
3. `page().items` → template `@for` loop, tracked by `originalIndex` — OK, stable across re-renders; selection
   buttons carry `originalIndex`, independent of the current page or filter.
4. User toggles expand/select/filter/page → component reads current `viewState()`/`selection()` fresh and emits a
   new object via `viewStateChange`/`selectionChange` — OK for the documented controlled-component contract,
   consistent with Batch 4's chart component; the parent round trip itself is out of this batch's scope.
5. `DashboardPagerComponent` receives only the `{ page, pageCount, total }` slice of `pageSlice`'s result and
   re-derives nothing else — OK, no duplicate paging logic between list and pager.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Req 4.1 (stat label/value/unit/delta; list ordered + detail line) | COMPLETE | none |
| Req 4.4 (data-reference notice with rowCount, no empty list/filter/pager) | COMPLETE | none |
| Req 4.5 (URL as plain text, never a link) | COMPLETE | none |
| Req 5.2 (filter visible text, case-insensitive, result count, resets page) | COMPLETE | none |
| Req 5.3 (page size 25, clamped, native Previous/Next, status text) | COMPLETE | none |
| Req 7.1 (container role/tabindex/key-handler rules when nesting a control) | COMPLETE | see Escape-handler reading above |
| Req 7.2 (Escape closes, focus returns to the opening control) | COMPLETE | none |
| Req 7.5 (coloured text on neutral surface, no alpha utilities) | COMPLETE | none |
| Selection target shapes match `surface.types.ts` | COMPLETE | none |
| Selection uses original index across paging/filtering | COMPLETE | none |
| CSP: attributes/classes only, no style | COMPLETE | none |

Implicit requirements not addressed: none identified beyond the Batch 4 carry-over class (observability of
dropped/malformed input).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Non-array / null / primitive `items` | YES | `Array.isArray` guard, empty result | none |
| Malformed item objects (missing/non-string fields) | YES | per-field `plainText`/`typeof` guards, item dropped only if fully empty | none |
| Original index preserved through drop/filter/page | YES | index assigned once in `flatMap`, never recomputed | none |
| Selection on a stale/nonexistent index | YES | `items().some(...)` guard before emit | none |
| Selection on non-selectable node | YES | template hides control; method re-guards | none |
| Filter resets page to 0 | YES | atomic `{ filter, page: 0 }` emission | none |
| Page index NaN/negative/overshoot | YES | `pageSlice` clamp, tested | none |
| `ol start` across pages | YES | `page * pageSize + 1` | none |
| Two instances, same producer node id | YES | per-instance id counters | none |
| Data-reference list (no inline items) | YES | notice + rowCount, no filter/pager rendered | none |
| Escape while filter input focused | YES (collapses) | bubbled keydown on `<section>` | native `input[type=search]` clear-on-Escape may layer on top (Minor, optional) |
| Stat with no `description` and no projected content | YES | `@if` guards, empty-but-valid expansion region | none |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none rising to Serious; the only genuinely open question (Escape colliding with native search-clear)
  is a UX nuance with no behavioural or data-correctness consequence.
- What a robust implementation would add: an optional `stopPropagation`-on-filter-target refinement for the Escape
  handler; a one-line comment noting the stat-vs-list hidden/visible asymmetry is intentional; carrying the
  density/typography fidelity gap to the R10 visual-review gate as an explicit decision point rather than leaving
  it implicit.
