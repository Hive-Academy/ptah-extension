# Code Logic Review — PR #784 visual fix

Review family: codex reviewing Glm

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | REVISE |
| Blocking issues | 0 |
| Serious issues | 2 |
| Moderate issues | 2 |
| Failure modes found | 3 |

The score reflects two user-visible acceptance failures and two bounded risks. It is above the 3–4 band because the four named no-window status cases, action retention, theme classes, and icon path are implemented and covered. It is below the 7–8 band because a stale quota tile still has duplicate status copy and a long qualifier remains visibly truncated. The supplied targeted Jest run passed 74/74; I ran no checks under the held machine slot. No fresh Electron render exists for these edits.

## Five logic questions

### 1. How does this fail silently?

A stale owner with a valid quota window shows a successful-looking bar and also two descriptions of the same cached state: `Cached data` and `Showing cached account data; refresh failed…`. The model creates both at `plan-tile-view.model.ts:532-533,573-581,950-954,968-970`; the template renders both at `provider-account-tile.component.html:138-162`. The new stale test checks only the chip at `plan-tile-view.model.spec.ts:957-969`, so 74 passing tests do not detect the duplication.

### 2. What user action produces unexpected behaviour?

At the 3–4 column desktop layout, a user scanning an account with multiple qualifiers can see the qualifier cut off. The second line explicitly uses `truncate` at `provider-account-tile.component.html:27-30`; the grid allows 16rem columns at `provider-account-card.component.ts:70-71`. The complete name remains only in a mouse tooltip at `provider-account-tile.component.html:19-22`, so keyboard or touch users cannot rely on the visible two-line title.

### 3. What input data produces a wrong answer?

A stale snapshot with at least one eligible window and `staleSince` produces the duplicate cached-state message described above (`plan-tile-view.model.ts:573-581,918-931,950-954`). A long owner label with two parenthesized qualifiers is split into one second-line string by `tileTitleLines` at `plan-tile-view.model.ts:136-146`, then clipped by the template at `provider-account-tile.component.html:27-30`. The tested Claude example at `plan-tile-view.model.spec.ts:845-851` has exactly that shape.

### 4. What happens when a dependency fails?

A failed refresh with held data remains signaled: the card's load-error notice at `provider-account-card.component.ts:198-207`, stale notice at `plan-tile-view.model.ts:573-581`, and cooldown at `plan-tile-view.model.ts:974-977` survive. For a stale owner with windows, however, the generic chip duplicates the more useful failure notice (`plan-tile-view.model.ts:950-954`). A windowless owner uses the status pill and retains a distinct action (`plan-tile-view.model.ts:941-954,970-977`).

### 5. What is missing that the requirements never mentioned?

The new grid has no content budget for unusually many windows or evidence records. The model emits every secondary window and every evidence notice at `plan-tile-view.model.ts:895-916,973`; the template wraps chips and renders all notices at `provider-account-tile.component.html:103-119,177-188`. Since `grid-auto-rows: 1fr` at `provider-account-card.component.ts:71` makes every row as tall as the largest tile, one large owner can make all rows excessive. The requested compactness needs either a bounded visible set with details access or a visual check with the largest supported snapshot.

## Numbered defects

1. **Serious — stale quota tiles repeat one status.** `plan-tile-view.model.ts:532-533,573-581,950-954`; `provider-account-tile.component.html:138-162`. With an eligible window and `status: 'stale'`, `statusChip` says “Cached data” and `statusNotice` says “Showing cached account data; refresh failed…”. The pill-based condition only handles tiles without a bar. Choose one visible stale message based on status kind while preserving the failure time, cooldown and window facts. Add a DOM assertion for chip *and* notice; the present spec at `plan-tile-view.model.spec.ts:957-969` asserts only the chip.

2. **Serious — the meaningful second title line can still be cut off.** `provider-account-tile.component.html:24-30`; `provider-account-card.component.ts:70-71`. The code moves all parenthesized qualifiers into a single line but applies `truncate` to that line. With a 16rem column and two qualifiers such as the tested “(owner unknown) (key unavailable)”, the trailing qualifier can disappear. Permit wrapping within the title block or use a layout that visibly preserves both qualifiers while keeping refresh aligned; verify at the narrowest multi-column width.

3. **Moderate — a large owner can make the entire grid tall.** `plan-tile-view.model.ts:895-916,973`; `provider-account-tile.component.html:103-119,177-188`; `provider-account-card.component.ts:71`. Chips and evidence have no visible bound, so `1fr` propagates one large tile's height to every row. Bound visible detail with access to the remainder, or establish and test an upstream cap. This is a size-dependent risk, not evidence of clipping in the six-owner screenshot.

4. **Moderate — criterion 2 lacks regression coverage for real quota providers and distinct failure notices.** `plan-tile-view.model.spec.ts:877-969`; `provider-account-tile.component.spec.ts:430-468`. The new cases cover the four named no-window providers and a stale chip, but do not assert that Codex/OpenCode secondary quota chips remain present or that stale, cooldown, and error text is neither lost nor duplicated. Add focused model/DOM cases for these state combinations; the existing generic two-window DOM test at `provider-account-tile.component.spec.ts:81-114` does not identify either provider.

**Minor code hygiene:** New source comments embed “PR 784 visual review defect” at `provider-account-card.component.ts:57`, `plan-tile-view.model.ts:130,511,944`, `provider-account-tile.component.ts:118`, and `provider-account-tile.component.html:14,82,145`. The request explicitly excludes task/PR IDs in code comments. Remove the review references; keep only comments that explain enduring behavior. This is a style finding, separate from the logic score.

## Data flow

1. `ProviderAccountCardComponent` selects snapshot owners, passes a shared clock and routes refresh/actions (`provider-account-card.component.ts:174-190,133-143,214-232`): **OK**.
2. `buildPlanTile` classifies windows, selects a bar and emits other-window chips (`plan-tile-view.model.ts:874-916,918-931`): **OK** for the reviewed path; all secondary windows can enlarge the tile.
3. It derives the pill, status chip, notice and action (`plan-tile-view.model.ts:941-977`): **gap** for stale owners with a bar.
4. The template renders header, bar/pill, chips, status, evidence and cooldown (`provider-account-tile.component.html:19-30,52-119,138-198`): **gap** for truncated qualifiers and repeated stale status.
5. CSS stretches every grid row to the same fractional size (`provider-account-card.component.ts:66-76`): **OK** for uniform row sizing; compactness under large input remains unverified.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Equal row height without clipping, compact | PARTIAL | CSS mechanism present; no visual measurement after edit or large-content bound (`provider-account-card.component.ts:71`). |
| One semantic status message, actions retained | PARTIAL | Named no-window cases pass; stale windowed case duplicates (`plan-tile-view.model.ts:532-533,573-581,950-954`). |
| Subtle rounded theme border | COMPLETE in code | Theme class at `provider-account-tile.component.html:5`; dark/light post-edit render pending. |
| Two-line title and wrapping reset | PARTIAL | Reset line wraps at `provider-account-tile.component.html:84-86`; qualifier line truncates at :28. |
| Tree-shakable decorative lucide icons | COMPLETE in code | Direct icon imports and standalone module at `provider-account-tile.component.ts:16,37,121-127`; decorative icon hidden at `provider-account-tile.component.html:147-151`. |
| Stable test IDs and signal inputs | COMPLETE in code | IDs at `provider-account-tile.component.html:8,194`; inputs/computed at `provider-account-tile.component.ts:96-130`. |

## Edge cases and verification

| Case | Result | Evidence |
| --- | --- | --- |
| Claude/Provider CLI API key, Ollama missing key, Antigravity unavailable | Handled | `plan-tile-view.model.spec.ts:877-955`; action retained at :915-936. |
| Eligible bar with stale snapshot | Defect | `plan-tile-view.model.ts:532-533,573-581,950-954`. |
| Cooldown after dependency failure | Retained | `plan-tile-view.model.ts:974-977`; `provider-account-tile.component.html:190-197`. |
| Long two-qualifier title | Defect | `plan-tile-view.model.ts:136-146`; `provider-account-tile.component.html:27-30`. |
| Very many windows/evidence notices | Risk | `plan-tile-view.model.ts:895-916,973`; `provider-account-card.component.ts:71`. |
| Null/empty snapshot | Card placeholder retained | `provider-account-card.component.ts:117-152,174-190`. |

The implementer reports 74/74 targeted Jest tests passing in `batch-pr784-visual-fix.md`. I reviewed the changed diff, full production components/template and model, changed spec cases, the task intent/plan and the prior visual evidence. I did not run tests, diagnostics, typecheck, lint, build, e2e or a live render, as requested. No `any`, `@ts-ignore`, or `console.*` was introduced in the changed source; the read text showed no UTF-8 corruption.

## Decisions

1. **REVISE for semantic stale duplication.** Options: approve the no-window fix, or require one status message for the windowed stale case. The acceptance criterion covers stale states, and the model emits two cached-state messages (`plan-tile-view.model.ts:532-533,573-581,950-954`). Reversible: yes.
2. **Require visible qualifier text at compact width.** Options: retain truncation with tooltip, or wrap/fit the second line. The explicit “no truncation of the meaningful part” criterion and `truncate` at `provider-account-tile.component.html:28` support wrapping/fitting. Reversible: yes.
3. **Treat compactness as unverified until large-content visual evidence.** Options: infer it from `1fr`, or assess a tile with many chips/notices. The unbounded rendering at `plan-tile-view.model.ts:895-916,973` makes the latter necessary. Reversible: yes.

## Verdict

- Recommendation: **REVISE**
- Confidence: **MEDIUM** — model/template paths are explicit; rendered widths and row heights await the allowed visual review.
- Top risk: the new status rule still duplicates stale failure information on real quota tiles.
- A robust fix would deduplicate by semantic status, show both title qualifiers at supported widths, cover named quota/error states, and verify compactness with the largest supported tile.
