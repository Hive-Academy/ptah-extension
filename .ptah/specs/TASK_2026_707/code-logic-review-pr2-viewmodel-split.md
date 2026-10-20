# Code logic review — PR 2 view-model split (TASK_2026_707)

Review family: Glm (Ollama Cloud) reviewing codex.

Scope: the behavior-preserving split of `usage-summary.view-model.ts` (~707 lines)
into `usage-formatting.ts` (145), `usage-summary-fold.ts` (278) and
`usage-summary.view-model.ts` (295), plus the import updates in the same folder.
Read-only review. This reviewer ran no test, typecheck, lint or build: the machine
check slot is held by another session. Every check result cited below comes from the
orchestrator or the lane report.

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Verdict | APPROVE WITH FIXES |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 1 |
| Minor issues | 2 |
| Failure modes found | 0 |

The split preserves every executable behavior I could anchor. The dependency graph is
clean and one-way. No shim exists. The defects that remain are one corrupted comment
and two move leftovers in the export surface and comment layer. Each fix is one line.

## Verification of the five mandated points

### 1. Verbatim move

The pre-split file cannot be recovered. It is absent from HEAD (uncommitted work) and
from both stash entries: `git show "stash@{0}:<path>"` and `"stash@{1}:<path>"` both
fail (a lint-staged backup and an older main stash, neither holding the file).
Byte-level proof is therefore impossible. I verified the move against four anchors:

1. Symbol inventory. All symbols listed in `batch-pr2-viewmodel-split.md:20-22`
   exist in the target files: the 8 formatting helpers in `usage-formatting.ts`;
   `shareOf`, `finalizeCost`, `finalizeSavings`, `foldUsageSummary`, `buildDayRows`,
   `KEY_SEPARATOR` and the accumulator types in `usage-summary-fold.ts`; `buildUsageViewModel`
   and the 8 view-model types in `usage-summary.view-model.ts`. The line counts match
   the lane report exactly (145 / 278 / 295; spec 382).
2. Pre-split line anchors. `code-logic-review-pr2-frontend-r2.md` cited the original at
   `:593-603` (savings multiple), `:528-537,553-566,669-677` (model/day shares) and
   `:465-479` (cost-unknown preservation). The same logic now sits at
   `usage-summary.view-model.ts:235-242`, `usage-summary-fold.ts:266`,
   `usage-summary.view-model.ts:283` and `usage-summary-fold.ts:157`. The content agrees
   with that review's descriptions.
3. Runtime string literals and constants. The en dash in `daySpanLabel`
   (`usage-formatting.ts:102,108-109`) is valid UTF-8, and the passing spec asserts the
   exact outputs (`usage-summary.view-model.spec.ts:69,75,109,252`;
   `usage-dashboard.component.spec.ts:121,236`). The constants are ASCII-safe and
   unchanged in meaning: `KEY_SEPARATOR = '\u0000'` (`usage-summary-fold.ts:5`),
   `MAX_WINDOW_DAYS = 400` (`usage-formatting.ts:5`), `DAY_MS` (`usage-formatting.ts:2`).
4. Behavior. The orchestrator reports 51/51 scoped Jest and typecheck dashboard pass
   after the dash repair. The lane-time run was 45/51 with 6 failures
   (`batch-pr2-viewmodel-split.md:29-33`), which the dash repair then resolved.

Residual: comment text outside test coverage cannot be byte-verified. Two comment-level
divergences exist (defects 1 and 3 below). "Verbatim" holds for every executable path I
could anchor.

### 2. Import cycles

None. `usage-formatting.ts` imports nothing. `usage-summary-fold.ts` imports only
`@ptah-extension/shared` (`:2-3`). `usage-summary.view-model.ts` imports shared,
`../provider-account-card/provider-accent` (`:4`), `./usage-formatting` (`:5`) and
`./usage-summary-fold` (`:6-9`). Neither new module imports the view-model. All seven
importers point one way (search across all of `libs/frontend`):
`usage-kpi-strip.component.ts:16-17`, `usage-dashboard.component.ts:33-34`,
`usage-cost-summary.component.ts:19-20`, `usage-cost-quality.component.ts:15-16`,
`usage-breakdown-table.component.ts:20-21`, `stacked-area-chart.component.ts:42`,
`usage-summary.view-model.spec.ts:10-11`. No file outside the folder imports any of the
three modules.

### 3. Re-export shim and dead exports

No shim. The view-model contains no `export ... from './usage-formatting'` or
`'./usage-summary-fold'` line. Importers take the moved symbols from their new homes
directly. Every moved value export has a live consumer: the 8 formatting functions are
imported by the view-model, the spec and five components; the fold's 6 values are
imported by the view-model (`usage-summary.view-model.ts:6-9`).

Dead exports found: the three accumulator types (defect 2). `ProviderDailySeries`
(`usage-summary.view-model.ts:74`) also has no external importer, but it names a public
field of `UsageViewModel` (`:135`), so I count it as public API, not dead code.

### 4. One clear responsibility per file

Holds. `usage-formatting.ts` holds pure, stateless display helpers; its only module
state is `Intl` formatters and a const name map. `usage-summary-fold.ts` holds
accumulation and grouping only and imports no display helper. `usage-summary.view-model.ts`
holds the exported shapes and the composition. One caveat: the stale "Fold" banner
(defect 3) mislabels what remains in the view-model file.

### 5. Remaining mojibake

One occurrence. A folder-wide scan of every file for U+00E2, U+00C2, U+00C3 and U+FFFD
returned exactly one line: `usage-summary.view-model.ts:121` (defect 1). A second scan
listing every non-ASCII line in the folder confirms all other non-ASCII is intentional
and valid UTF-8: en dashes in `usage-formatting.ts:96,102,108,109` and the specs; em
dashes in `usage-summary.view-model.ts:28,34,52,59,104`, the components and the specs;
the `≥` sign in component output (`usage-kpi-strip.component.ts:103-108`,
`usage-cost-quality.component.ts:66-71`, `usage-cost-summary.component.ts:122-127,156-159`,
`usage-breakdown-table.component.ts:152-165`) with matching spec assertions
(`usage-dashboard.component.spec.ts:124,147,154`); the middle dot in
`usage-cost-summary.component.ts:178`; ellipses in `stacked-area-chart.component.ts:21,117,286`.

Note: the task's stated probe (U+00E2 followed by U+20AC, or U+00C2) cannot find the
remaining occurrence. Its corrupted bytes are U+00E2 U+2030 U+00A5. A broader scan is
required, and that is what found it.

## Defects

1. **Moderate — unrepaired mojibake in the `totalCostUnpricedFactCount` doc comment.**
   File: `usage-summary.view-model.ts:121`. The comment reads `("â‰¥")`. This is the
   UTF-8 encoding of `≥` (U+2265) read as Windows-1252. The parallel doc comment in the
   spec carries the correct character (`usage-summary.view-model.spec.ts:6`). The
   orchestrator's repair pass covered dashes only (U+2013/U+2014), so this character
   stayed broken. Impact: comment only. No test sees it, and no runtime behavior changes.
   But it corrupts the documented honesty rule of the whole dashboard, and it breaks the
   verbatim contract for the moved text. Fix: replace with `("≥")`.
2. **Minor — dead type exports in the fold module.**
   Files: `usage-summary-fold.ts:13` (`ProviderAcc`), `:32` (`ModelAccSeed`),
   `:37` (`DayModelAcc`). A search across all of `libs/frontend` finds these names only
   inside the defining file. The builder imports only the six values
   (`usage-summary.view-model.ts:6-9`), not the types. The lane report's rationale —
   "exported solely for the builder's direct import" (`batch-pr2-viewmodel-split.md:21`) —
   does not match the code. Impact: none at runtime. The export surface is wider than
   the split needs, and the report claim is wrong. Fix: remove the `export` keyword from
   the three interfaces. `SavingsAcc` at `:7` already shows the intended private pattern.
3. **Minor — move leftovers in the view-model file.**
   File: `usage-summary.view-model.ts:143-147`. The section banner at `:143-145` still
   says "Fold", but the fold now lives in `usage-summary-fold.ts`. Line `:147` is an
   orphaned doc comment, `/** Savings accumulator shared by every group: known sum plus
   unknown count. */`. It describes `SavingsAcc`, which moved to `usage-summary-fold.ts:7`.
   Two doc comments now stack before `buildUsageViewModel` (`:148-152`), and the first
   attaches to nothing. Impact: comment only, but it misleads a reader about the file's
   content. Fix: delete `:147` and retitle or delete the "Fold" banner.

Routed to code-style-reviewer, not scored here: the double blank line at
`usage-summary-fold.ts:65-66` (formatting only).

## Five logic questions

### 1. How does this fail silently?

The split's silent-failure risk was mojibake inside runtime string literals. That risk
fired at lane time (6 test failures) and was repaired before the suite passed. The only
corruption left is comment-only (`usage-summary.view-model.ts:121`). No user can observe
it. `enumerateDays` truncates windows longer than 400 days without a signal
(`usage-formatting.ts:5,89`). That limit is pre-existing, documented in the file, and
unreachable from the 7/30/90 ranges the store offers.

### 2. What user action produces unexpected behaviour?

None from the split. Switching range or workspace rebuilds the view model through the
same pure functions as before. All module-level state is stateless. The importers
changed import paths only; their symbols resolve to the same implementations.

### 3. What input data produces a wrong answer?

Invalid day strings make `enumerateDays` return an empty window and `daySpanLabel`
return an empty string or the raw days (`usage-formatting.ts:86,98-103`). The fold drops
out-of-window facts but counts them (`usage-summary-fold.ts:92-96`). A `costSource`
outside the three known buckets would drop out of the quality shares, but the shared
contract types it as a closed union and the RPC boundary validates it. All pre-existing,
and the invalid-day case is tested (`usage-summary.view-model.spec.ts:61-65`).

### 4. What happens when a dependency fails?

The three modules depend only on compile-time imports: `@ptah-extension/shared` and
`provider-accent`. A missing or renamed export fails the typecheck loudly. The modules
add no timer, subscription, fetch or disposal need. Nothing new can fail at runtime.

### 5. What is missing that the requirements never mentioned?

Nothing new. The review-cap rule (`HANDOFF.md`, "In progress") allowed exactly one
bounded, behavior-preserving split plus an independent check. This split is that
correction, and it keeps the same public builder API and the same passing tests. The
deferred file-size items that the split did not touch (chart component ~368 lines,
component spec ~790 lines) remain PR-body follow-ups, as `HANDOFF.md` records.

## Failure modes

None found. Scope examined to support that claim: the three split files read in full;
the spec read in full; every importer verified by import-line and symbol-use searches
across `libs/frontend`; the lane report, `context.md`, `implementation-plan.md`,
`HANDOFF.md` and the prior frontend r2 review read (`task-description.md` and
`batches.md` do not exist in this task folder). Residual uncertainty: byte-level
verbatimness is unprovable because the original is unrecoverable, and the importer
files were verified at the import and symbol level, not read in full. The per-provider
"at least $x" chart readout branch still lacks a DOM test; that gap is pre-existing and
tracked in `HANDOFF.md`, not introduced by the split.

## Data flow

1. Store summary enters `buildUsageViewModel` (`usage-summary.view-model.ts:153`). OK.
2. `enumerateDays` builds the UTC window (`usage-formatting.ts:80`). OK.
3. `foldUsageSummary` aggregates facts into totals, providers, models, days
   (`usage-summary-fold.ts:67`). OK.
4. Finalizers and `shareOf` convert accumulators to null-or-number
   (`usage-summary-fold.ts:43-64`). OK.
5. The builder composes provider rows, model rows, KPIs, quality, series and day rows
   (`usage-summary.view-model.ts:170-272`). OK.
6. Components render the view model; they import only types and formatting helpers. OK.

No step can lose, duplicate or read stale data: the chain is pure and synchronous, and
the only shared state is immutable module constants.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Verbatim move | PARTIAL | All executable content verified against anchors. Two comment-level divergences (defects 1, 3). |
| No import cycle | COMPLETE | None among the three files or the seven importers. |
| No shim, no dead exports | PARTIAL | No shim. Three dead type exports (defect 2). |
| One responsibility per file | COMPLETE | Stale "Fold" banner mislabels the view-model file (defect 3). |
| No remaining mojibake | PARTIAL | One comment occurrence left (defect 1). |

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Null summary | YES | `buildUsageViewModel(null)` returns null (`usage-summary.view-model.spec.ts:98-100`) | None |
| Empty window | YES | Empty rows without invented usage (`usage-summary.view-model.spec.ts:248-265`) | None |
| All facts unpriced | YES | Null totals, null shares (`usage-summary.view-model.spec.ts:240-246`) | None |
| Unknown provider id | YES | Title-cased slug (`usage-formatting.ts:136-145`) | None |
| Window over 400 days | YES | Silent truncation (`usage-formatting.ts:89`) | Pre-existing, documented, unreachable from the UI ranges |
| Same-cost tie in day top model | YES | First-inserted model wins (`usage-summary-fold.ts:254,256`) | Deterministic; acceptable |

## Verdict

- Recommendation: **APPROVE WITH FIXES** (role scale: APPROVED).
- Score: **8/10**.
- Confidence: HIGH for behavior preservation (anchored logic plus 51/51 scoped suite);
  MEDIUM for full byte-level verbatimness (the original is unrecoverable).
- Top risk: none behavioral. The one must-fix is the corrupted `≥` comment, which is a
  contract breach of the verbatim move, not a runtime defect.
- Fixes required: three one-line edits (defects 1-3). They need no new tests; the
  existing 51/51 suite already covers all executable behavior.
- Score separation: not 9-10, because the move left three artifacts (one corrupted
  comment, three dead exports, one dangling comment with a stale banner) and the lane
  report carries one inaccurate claim. Not 5-7, because every executable anchor matches,
  the graph is acyclic, no shim exists, all consumers resolve, and the full scoped
  suite passes. All findings sit in the comment and export surface.

## Decisions

- **Verify the move by anchors instead of blocking on the missing original.**
  Options: refuse a verdict, or verify as described. Evidence: the file is absent from
  HEAD and both stash entries; the lane inventory matches; the r2 review's line anchors
  match; the passing spec pins every runtime string literal. Reversible: yes.
- **Classify the three accumulator type exports as dead.**
  Options: public API surface, or dead exports. Evidence: no importer anywhere in
  `libs/frontend`; `SavingsAcc` stays private and the build still typechecks; the lane
  report's stated reason does not match the code. Reversible: yes.
- **Report the `â‰¥` sequence although it fails the task's stated byte probe.**
  Options: report only U+00E2 U+20AC and U+00C2 hits, or scan all CP1252 artifact leads.
  Evidence: the corrupted bytes are U+00E2 U+2030 U+00A5; a broader folder scan found
  exactly this one line. Reversible: yes.
- **Do not reopen the pre-split r2 findings (breakdown denominator, chart readout).**
  Options: re-review them, or stay inside the split scope. Evidence: fix round 2 already
  addressed them; the component spec passes; the split changed import paths only.
  Reversible: yes, a later review can reopen them.