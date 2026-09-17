# Code Logic Review — B5 (commit `d0d89cf08`), TASK_2026_411

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 1 |
| Minor issues | 2 |
| Failure modes found | 2 (both handled correctly) |

Scope reviewed in full: `session-analytics-state.service.ts` (613 lines, current
state, not just the diff), `analytics-card.component.ts/.html`, `format.utils.ts`,
`metrics-cards.component.ts`, `session-stats-card.component.ts`, and the two new
spec files (`session-analytics-state.service.spec.ts`,
`analytics-card.component.spec.ts`) plus their shared `session-analytics-state.testing.ts`
fixtures. Cross-checked against `b4-report.md`'s "RPC / types contract" and
`batches.md` B5 ownership/gate text.

## Five logic questions

### 1. How does this fail silently?

It does not, as far as this review can find. Every path that could produce a
wrong-looking success is guarded:

- A page RPC failure (`result.isSuccess() === false`) or a page whose echoed
  `scope`/`since`/`until` mismatches the load (`pageMatchesLoad`,
  `session-analytics-state.service.ts:588-597`) turns every requested id in that
  page into `unreadableStats(sessionId)` — `status: 'error'`, `totalCost: null`
  (`session-analytics-state.service.ts:492-511, 599-612`). It never silently
  contributes 0 to a total.
- An id the host answered for but the client never asked for is dropped
  (`requested.has(stat.sessionId)` guard, line 501) rather than written under
  the wrong key.
- `aggregates.totalCost` is `null`, not `0`, when `costContributorCount === 0`
  (`session-analytics-state.service.ts:304`), so an all-error or all-unpriced
  range reads "Unknown", not "$0.00".

### 2. What user action produces unexpected behaviour?

Clicking **Retry** (`analytics-card.component.ts:86-88` →
`loadDashboardData()`) re-runs the *entire* load — a fresh `session:list` plus
every stats page from scratch, including sessions that already succeeded —
rather than re-requesting only the failed ids. Functionally correct (the whole
card repaints from pending and settles to the same or better state) but wastes
a full 200-session page sequence to retry what might be one failed page of 20.
Not a correctness defect; flagged as Minor below.

### 3. What input data produces a wrong answer?

None found for B5's own logic. The one accepted, explicit incompleteness is
architectural, not a bug: the B4 contract says `session:list` is bounded only
by `since` (`b4-report.md` does not document an `until` param on `session:list`,
and the client only ever passes `since` — `session-analytics-state.service.ts:422-431`).
If the session-list index used a different notion of "recent" than the
stats-range `[since, until)` window, a session could appear in the list but have
zero in-range usage; the code handles that correctly today (`status: 'empty'`
or `totalCost: null` from the stats scope), so this is not a wrong-answer path,
just a note that `session:list`'s own `since` semantics are outside B5's
verification surface.

### 4. What happens when a dependency fails?

- `session:list` RPC failure or throw: caught in `runLoad`'s try/catch
  (`session-analytics-state.service.ts:446-451`), surfaces as `loadError`, no
  stats calls are issued. Verified by spec ("No workspace → error, no RPC" per
  `b5-report.md` and the failure-path assertions in
  `session-analytics-state.service.spec.ts`).
- `session:stats-batch` failure on any page: handled per Q1 — that page's ids
  become `'error'`, and the loop continues to the next page
  (`loadStatsPages`, `session-analytics-state.service.ts:462-483`, and the
  "marks a failed page as error and still reads the pages after it" spec at
  `session-analytics-state.service.spec.ts:319-336`, which the earlier B4
  runtime break — pages > 20 ids rejected outright — makes a real, not
  hypothetical, failure mode).
- Abort mid-page (workspace/range change, `cancelLoad`, destroy): the
  in-flight page's `AbortController` is aborted, `isCurrent()` fails the next
  check, and no result of the aborted call is ever written
  (`session-analytics-state.service.ts:519-527` and the "A -> B -> A" /
  "page that lands after a workspace change" specs at lines 225-275 of the
  spec file).

### 5. What is missing that the requirements never mentioned?

- No cap on how many times a load can be silently retried by rapid workspace
  bouncing — each bounce is a full `session:list` + N stats pages. Not a
  correctness issue (generation/abort guards make every bounce safe), only a
  possible request-volume concern under pathological UI use; batches.md does
  not ask for debouncing here and the 20 s per-page host budget bounds the
  damage.
- No client-side warning when `session:list`'s cap (200) and the analytics
  card's own `SESSION_ANALYTICS_SESSION_CAP` (`session-analytics-state.service.ts:147`)
  drift apart — they are the same literal today but nothing pins them together
  beyond the one shared constant, so a future edit to one without the other
  would silently under- or over-page. Moderate, noted below.

## Failure modes

### Stats page RPC failure (non-2xx / `isSuccess() === false`)

- Trigger: `session:stats-batch` returns `RpcResult(false, ...)` for one page.
- Symptom: the sessions in that page show "Stats unavailable" with a Retry
  affordance; later pages still load and paint.
- Evidence: `session-analytics-state.service.ts:492-511` (`mergePage`,
  `answered` map stays empty on failure), confirmed by
  `session-analytics-state.service.spec.ts:319-336`.
- Current handling: correct — matches the B4 note that dashboard traffic
  became a real 400-class failure mode once the 20-id cap was enforced.
- Recommendation: none; this is the fix B5 exists to deliver.

### Stale response after workspace/range switch or cancel

- Trigger: a `session:list` or `session:stats-batch` response resolves after
  a newer load has started (workspace switch, range switch, `cancelLoad()`,
  or component destroy).
- Symptom: none visible — the response is discarded.
- Evidence: `isCurrent()` (`session-analytics-state.service.ts:519-527`)
  checked immediately after every `await`, before any signal write; covered
  by three dedicated specs (lines 225-275).
- Current handling: correct.
- Recommendation: none.

## Blocking issues

None found.

## Serious issues

None found.

## Moderate and minor issues

### M1 — `SESSION_ANALYTICS_SESSION_CAP` and the stats-page loop share no assertion that caps stay aligned

- File: `session-analytics-state.service.ts:147` (`SESSION_ANALYTICS_SESSION_CAP = 200`) vs. `422-431` (`session:list` `limit`).
- Concern: `SESSION_ANALYTICS_SESSION_CAP` is hand-set to 200 and only used as the
  `session:list` `limit`; nothing ties it to whatever cap the host actually
  enforces for that RPC (unlike `SESSION_STATS_BATCH_MAX_IDS`, which B5 imports
  from `@ptah-extension/shared` — the correct pattern, used at line 16 and
  465). If the host's session-list cap ever changes independent of this
  constant, `hasMoreSessions` and the "Showing the 200 most recent sessions"
  copy (`analytics-card.component.html:89-93`) would silently mismatch the
  server's real behaviour. Moderate because today the numbers agree and
  nothing breaks; the risk is drift, not a present bug.
- Fix: source the cap from the shared contract the way `SESSION_STATS_BATCH_MAX_IDS`
  is sourced, if/when `session:list`'s cap becomes a documented shared constant.

### m1 — Retry reloads the whole range, not just failed sessions

- File: `analytics-card.component.ts:86-88`, `session-analytics-state.service.ts:355-403`.
- `loadDashboardData()` has no "resume only the failed ids" path; Retry always
  re-issues `session:list` plus every stats page. Wastes host work for a
  large range where only one 20-id page failed. No data-correctness impact.

### m2 — Jest "worker process has failed to exit gracefully" when both new spec files share a worker

- File: `session-analytics-state.testing.ts:119-122` (`flush()` uses a real
  `setTimeout(resolve, 0)`, called ~30 times across the two spec files).
- I ran both new spec files together to confirm the warning is reproducible
  and traced the design: `FakeRpc.call` (`session-analytics-state.testing.ts:36-47`)
  returns a `Deferred` promise that several tests deliberately leave
  unresolved (to assert `'pending'` state) and `flush()` is a real macrotask
  timer, not `jest.useFakeTimers()`. Neither leaves a genuine open handle in
  *production* code: `session-analytics-state.service.ts` has no
  `setTimeout`/`setInterval`, and its only async primitive is
  `AbortController`, which is always constructed and aborted within a single
  load's lifecycle (`cancelLoad()`, `DestroyRef.onDestroy`). The warning is
  most plausibly Jest's real-timer test scaffolding (`flush()`) racing Angular
  zone/TestBed teardown across two suites in the same worker, not a
  production leak. Classified Minor / test-infra, matching the executor's own
  honest disclosure in `b5-report.md` rather than a silently-fixed claim.

## Data flow

1. Component mount / workspace change → effect → `loadDashboardData()`
   (`analytics-card.component.ts:78-82`) — OK, guarded against duplicate
   concurrent loads for the same workspace/range (`session-analytics-state.service.ts:358-366`).
2. `cancelLoad()` + `clearLoadedData()` for any workspace/range change, new
   `generation`, new `AbortController`, one `until`/`since` captured
   (`:368-390`) — OK, single capture point, reused by every page.
3. `session:list` → `isCurrent()` gate → `_metadata`/`_hasMoreSessions` write
   (`:419-440`) — OK.
4. `loadStatsPages`: sequential 20-id pages, `isCurrent()` re-checked before
   the call and again before the write (`:455-483`) — OK, no duplicate or
   skipped id since pages are non-overlapping slices of one id array.
5. `mergePage`: unmatched/failed page → every requested id in that page
   becomes `'error'`; matched entries keyed by `load.keyPrefix + sessionId`
   into a copy-on-write map (`:492-517`) — OK, earlier pages' entries are
   preserved (`new Map(this._statsByKey())`), never wholesale-replaced.
6. `displayedSessions` / `aggregates` computed signals read only the active
   load's key prefix (`:244-323`) — OK, an orphaned write under an old prefix
   (which cannot happen per step 4/5, but even if it did) would never be read.
7. Display formatting (`format.utils.ts`, `metrics-cards.component.ts`,
   `session-stats-card.component.ts`) — OK: null cost never renders as `$0.00`,
   pending vs error vs empty vs partial are visually distinct, "Est." /
   current-rate-card language is present on every cost surface.

## Requirements fulfilment

| Requirement (batches.md B5) | Status | Gap |
| --- | --- | --- |
| Capture one `until`, issue 20-id pages, merge into signals | COMPLETE | none |
| Workspace/range/load generation + `AbortController`, stale responses cannot write | COMPLETE | none |
| Cache keyed by workspace/range/until/session | COMPLETE | scope is always `'range'` here so no current-context collision risk exists at this layer (by construction, not by an explicit guard) |
| OnPush, standalone, zoneless-safe preserved | COMPLETE | none — all four touched components declare `standalone: true` + `ChangeDetectionStrategy.OnPush`; state driven entirely by signals/`inject()`, no Zone dependency |
| Show partial coverage and 200-session cap; label local cost as estimate | COMPLETE | none |
| Range/workspace race and progressive-paint tests pass | COMPLETE | verified by reading assertions, not just running the suite; assertions check actual `status`/call counts, not "no throw" |
| No global RPC timeout increase | COMPLETE | `claude-rpc.service.ts` unchanged per `b5-report.md`; independently confirmed no timeout override is passed from the analytics service (`{ signal }` only, lines 430, 478) |

Implicit requirements not addressed: none identified beyond M1/m1/m2 above.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Empty session list | YES | `loadStatsPages` skips the page loop, sets progress 0/0 | none |
| No workspace open | YES | `loadError` set, no RPC issued (`:371-376`) | none |
| >200 sessions in range | YES | `hasMoreSessions` flag + cap banner | tied to M1 |
| Page answers wrong ids / extra ids | YES | filtered by `requested.has(...)` (`:501`) | none |
| Page echoes a different window | YES | `pageMatchesLoad` rejects, ids become error | none |
| Rapid workspace A→B→A | YES | generation-only guard, verified by dedicated spec | none |
| Concurrent identical loads (same ws/range) | YES | joins in-flight promise, no duplicate `session:list` call | none |
| Card destroyed mid-load | YES | `DestroyRef.onDestroy` → `cancelLoad()` | none |
| All sessions unpriced | YES | `totalCost: null`, not `0`; "Unknown" shown | none |
| Mixed null/priced costs | YES | sum only priced sessions, count them, show partial-pricing note | none |

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH
- Top risk: none blocking; the durable watch item is M1 (the 200-session cap
  living as a locally-defined constant rather than a shared contract value),
  which is a drift risk, not a present defect.
- What a robust implementation would add: (1) source `SESSION_ANALYTICS_SESSION_CAP`
  from a shared constant once `session:list` publishes one, mirroring the
  `SESSION_STATS_BATCH_MAX_IDS` pattern already used correctly here; (2) a
  narrower retry that re-pages only the sessions currently in `'error'`
  instead of reloading the full range.
