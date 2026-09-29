# Code Logic Review — TASK_2026_575_74a4, Batch 4, revision round 1

Re-review of the executor's revision to the uncommitted `libs/frontend/dashboard/` changes
in worktree `the task worktree`
(10 modified files, 4 new spec files). Round-0 review: `code-logic-review-b4.md`
(REVISE, 6/10).

Verification run in this review: `npx jest -c libs/frontend/dashboard/jest.config.ts` —
13 suites, 109 tests, all passed, no worker warnings in this run. The executor's
`nx run-many -t typecheck,test,lint -p @ptah-extension/dashboard` claim (13 suites,
109 tests) is consistent with the suite count and the five added tests.

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 8/10           |
| Assessment          | APPROVE        |
| Blocking issues     | 0              |
| Serious issues      | 0              |
| Minor issues        | 2 (both cosmetic, non-blocking) |
| Earlier findings    | 4 fixed, 1 observation unchanged |

## Status of round-0 findings

### 1. SERIOUS — false "≥" on Avg / Session — FIXED

- New `avgIsLowerBound` computed: `avgCostPerSession !== null && partiallyPricedSessionCount > 0`
  (`metrics-cards.component.ts:146-152`), with its own `avgTitle` tooltip
  (`:158-162`) and the marker condition switched to `avgIsLowerBound()` in the avg tile
  (`:123`); the title binding at `:112` now uses `avgTitle()`.
- Correctness checked over combinations:
  - all priced: both flags false, no markers (`metrics-cards.component.spec.ts:49-54`);
  - partial contributor present: both tiles marked — valid, since every contributor whose
    figure understates pushes the true average above the shown one
    (`metrics-cards.component.spec.ts:97-113`);
  - only unpriced sessions left out: total marked, avg exact and unmarked — the
    denominator `costContributorCount` (`session-analytics-state.service.ts:368`) already
    excludes them, so "≥" would have been false; pinned
    (`metrics-cards.component.spec.ts:75-95`, including the exact tooltip text);
  - total unknown: `avgCostPerSession` null → no avg marker (`:115-129`).
- Edge consistency: `partiallyPricedSessionCount > 0` implies at least one contributor with
  a lower-bound figure (service `:353-359`), so `avgIsLowerBound` can never be true while
  `avgCostPerSession` is null, and `avgTitle`'s `partlyPriced(a)` always has a non-zero
  count to name. No tautology: the new tests assert rendered text and exact tooltips.

### 2. MINOR — "lower bound" copy with no total — FIXED

- `analytics-card.component.html:114-122`: when `totalCost !== null` the line says
  "the total leaves it/them out, so it is a lower bound" (singular/plural handled);
  when `totalCost` is null it says "no session in range has a price, so the total is unknown".
- Pinned both ways: `analytics-card.component.spec.ts:170-183` (all unpriced →
  "the total is unknown", asserts no "lower bound" text) and `:185-195` (priced session
  beside unpriced → "the total leaves it out, so it is a lower bound").

### 3. MINOR — CLI-only sessions invisible in the aggregate explanation — FIXED (by design)

- New aggregate `cliAgentSessionCount` (`session-analytics-state.service.ts:162-168` doc,
  counted at `:356`) drives the status line "CLI agent runs in N sessions record no cost
  and are not in the total" (`analytics-card.component.html:123-129`).
- Verified it touches nothing else: it is incremented after the cost/coverage branches and
  is not an addend, does not touch `unknownCostSessionCount`, and cannot set
  `totalCostIsLowerBound` (`session-analytics-state.service.ts:328-395`). Pinned:
  `session-analytics-state.service.spec.ts:514-547` asserts
  `cliAgentSessionCount: 1`, `unknownCostSessionCount: 0`, total 2, flag false;
  `analytics-card.component.spec.ts:211-228` asserts the line renders for an 'ok' session
  with CLI agents plus an 'empty' CLI-only one while the total stays $2.00.
- Counting matches its doc ("readable sessions"): pending and error sessions are skipped
  before the count, so an unreadable session with CLI agents is not counted.

### 4. MINOR — `sessionCostEstimate` wire-contract assumption — FIXED (documented)

- The doc comment above `sessionCostEstimate` (`session-analytics-state.service.ts:96-100`)
  now states the assumption: non-null `totalCost` implies full coverage; a missing coverage
  value is not treated as partial (older producers omit it on fully priced totals); an
  explicit `'partial'` beside a total is still marked. Matches the backend contract
  (`session-usage-aggregator.ts:292`) and the behaviour at `:107-111` (unchanged, as declared).

### 5. Observation — Jest worker force-exit warning

- Not addressed, correctly treated as out of scope: the round-1 run finished without the
  warning, confirming it is environmental/pre-existing, not a batch defect.

## Combination check (round-1 wording and flags)

| Range shape | Total tile | Avg tile | Status lines | Consistent |
| ----------- | ---------- | -------- | ------------ | ---------- |
| All fully priced | no marker | no marker | none of the three lines | YES (pinned) |
| Some partial contributors | "≥" + tooltip names partial | "≥" + avgTitle | partial line | YES (pinned) |
| Priced + unpriced, no partial | "≥" (totalTitle) | no marker (estimateLabel) | "leaves it/them out, so it is a lower bound" | YES (pinned) |
| All unpriced | "Unknown" muted | "Unknown" muted | "no session in range has a price, so the total is unknown" | YES (pinned) |
| CLI-only sessions | unchanged, never $0 | — | CLI line names them; per-card "Unknown" + note | YES (pinned, service + page) |
| Mixed: priced + unpriced + partial + CLI | "≥" naming both counts | "≥" (partial present) | all three lines | consistent by construction |

## New findings

### 1. MINOR — CLI line wording can read as claiming the whole session records no cost

- File: `analytics-card.component.html:123-129`; also
  `session-analytics-state.service.ts:356` (counts any readable session with `cliAgents.length > 0`).
- Failure scenario: a session with priced usage AND a CLI agent run is counted; the page line
  "CLI agent runs in N sessions record no cost and are not in the total" is true of the CLI
  runs, but a reader can take it as "those sessions are not in the total", which is false for
  the mixed session (its priced usage IS in the total). The per-card note is precise; the
  page-level line is slightly overbroad.
- Fix (optional, non-blocking): reword to "…record no cost; their spend is not in the total."
  or "CLI agent runs (N sessions) are not part of the total." No accounting impact; sums,
  flags and counts are all correct as implemented.

### 2. MINOR (cosmetic) — redundant phrasing in the all-unpriced sentence

- File: `analytics-card.component.html:114-122`.
- Failure scenario: "Cost unknown for 2 sessions (no current rate-card price); no session in
  range has a price, so the total is unknown." The two clauses repeat each other. No
  behavioural effect; purely copy polish.
- Fix: optional; e.g. drop "(no current rate-card price)" when the total is unknown.

No other regressions found: `format.utils.ts`, the session card, the detail modal and their
specs are unchanged from round 0 and were already verified there; the `AggregateTotals`
addition is additive, and every fixture in the touched specs was updated
(`metrics-cards.component.spec.ts:29`).

## Residual uncertainty

- The failing-on-base demonstration for the new tests (e.g. "marks the total but not the
  average" would have failed with `≥At least $2.00` before the fix, as the executor
  reports) is consistent with the round-0 code but was not independently re-run against
  base — this review does not check out base (no git write commands).
- The visual-reviewer "after" screenshots (dark + light) are still owed per batches.md
  Batch 4 verification; they are a separate reviewer's deliverable, not part of this logic
  review.

## Verdict

- Recommendation: **APPROVE**
- Confidence: HIGH
- Rationale: all four actionable round-0 findings are fixed with file:line-verifiable
  changes, each pinned by a DOM-level test that fails on the round-0 behaviour; the new
  `cliAgentSessionCount` provably touches no sum, flag or counter it should not; the
  combination matrix above shows correct wording and markers in every pricing combination.
  The two residual items are cosmetic copy issues that do not misstate any figure.
- Top remaining risk: none in logic; the open verification items (failing-on-base evidence,
  visual review) are process gates owned by the orchestrator.