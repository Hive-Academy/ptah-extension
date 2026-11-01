# Code Logic Review — B3b Phase 1 (TASK_2026_ONBOARDING)

Scope: read in full `generation-step.store.ts`, `guidance-section-counts.ts`, the step-store spec, and the diffs of `generation-workflow.store.ts`, `generation-handoff.store.ts`, the summary card and `index.ts`. I did not read the other specs line by line (parser, workflow, handoff, card). Nothing was run, as instructed.

## Findings

1. **Serious — `guidanceSections()` is not reactive to the capture result.** `generation-step.store.ts:18,98,103-107`. Captured counts live in a plain `Map`. The capture finishes asynchronously after the run turns `completed`. At that point no signal changes, so a `computed` or template that already called `guidanceSections()` and got `null` is never re-evaluated. The four-row card would stay hidden until an unrelated signal moves (for example `result().generatedAt`). The spec calls `guidanceSections()` imperatively after `await`, so it cannot catch this. Fix: hold the map in a `signal` (immutable replace on capture) or bump a version signal that `guidanceSections` reads.

2. **Serious — `runMismatch` is wrongly raised after a legitimate new run when `?run` was bound.** `generation-workflow.store.ts:296-306`. When `expectedRunId` is set, `refresh()` always does a runless lookup and treats any other run id as a mismatch. After the user regenerates or restarts on the same tab, `accept()` sets run B. The next `refresh()` (event adapter, stop flow, polling) then returns B, `runMismatch` becomes true, `runValue` is cleared and the state is forced to `idle`. `expectedRunId` is never cleared or advanced in `accept()`, `applyRun()` or on terminal status. Fix: clear or advance `expectedRunId` when `accept()` adopts a run from this store, or apply the mismatch only to the first authoritative lookup after `bind`.

3. **Moderate — a null authoritative lookup with `expectedRunId` is not a mismatch.** `generation-workflow.store.ts:296-306,310-325`. If the settled run A was replaced by another tab's run, the runless lookup returns `blocked`/null. The store then falls into the `!run` branch and lands on `idle` with `runMismatch` false. The A3 plan expects the "no longer current" recovery for a run that is not the authoritative one. The page will see `idle` and may offer or auto-start a new run. Define null-with-expected as recovery, or have the page treat it that way, and test it.

4. **Moderate — rebind churn.** `generation-workflow.store.ts:74-83`. If the page binds with `expectedRunId` undefined, then rewrites `?run` (the handoff `replaceUrl` case) and re-binds with the run id, the guard no longer matches. The store does a full reset of the run, state and revision, which causes flicker and a duplicate lookup. Fix: when the stored run already equals the new expected id, skip the reset.

5. **Moderate — A4 rebind order and auto-start are not in Phase 1 code.** The `?run`, then handoff `started()`, then authoritative `getRunState` order, "no second `runWizard`", and "auto-start only when no run exists and the outcome is not `manual-recovery`" belong to the page. The building blocks are present and correct: `bind(binding, expectedRunId)`, a `started` signal with the full run binding, and a runless refresh. The handoff-started run has the right shape to pass as `expectedRunId`. The order itself is untestable at this phase and needs a Phase 2 check. `started()` is also not keyed by the page's tab. The page must compare `started().tabId === tab`.

6. **Minor — handoff catch path ignores supersession.** `generation-handoff.store.ts` (catch around the `startBoundGuidance` call, at about `:144`). The new revision guards cover the post-await success paths, but the `catch` still sets `outcome = 'manual-recovery'` when a newer handoff superseded this one. A late failure from the old handoff can overwrite the newer outcome. Add `if (revision !== this.revision) return;` in the catch.

7. **Minor — `captured` map is never evicted.** `generation-step.store.ts:98`. One entry per run and `generatedAt`, kept for the session. Small, but it is unbounded.

8. **Minor — test gaps in the step-store spec.**
   - "Service lock held" is an exact copy of "B completed before first read" (`generation-step.store.spec.ts`). Both mock `null`.
   - Only the happy path asserts that `getBoundRunState` is called runless. The plan also asks for this assertion in the B cases.
   - There is no test for single-flight (two concurrent `captureGuidanceSections` calls for the same key).
   - There is no test that a `stale` result stores no counts.
   - The "binding changed mid-capture" test only changes `tabId`. The workspace and run id guards at `:93-95` are untested.
   - The late-bind test only checks `getBoundRunState` was not called. It does not assert the outcome.

## Focus answers

1. **Capture sequence.** `generation-step.store.ts:74-101` follows C6 steps 1-7:
   - Runless identity check `L` compares tab, workspace, workflow, run id, `completed` and `committed` (`:77-81`).
   - Status is read before and after the content read, with `generatedAt` compared (`:85-90`).
   - `L` runs again at `:91`, then the local binding, run id and status are checked (`:92-95`).
   - The parser result is stored under the key `(workspace, run, g0)`.
   - A thrown RPC gives `unavailable`. Step 1 uses `stale` for a failed `L` and `unavailable` for a throw, as specified.
   - Two small deviations are harmless. An `error` on S2 also yields `stale`. The `committedState` fallback `run.result?.committedState` is used.
   - Staleness in `guidanceSections` checks the key, `result().generatedAt`, the local run id and `completed` (`:103-106`), matching the plan. It is correct except for finding 1.
   - The trigger effect fires only on an observed non-terminal to `completed` transition (`:36-39`). A late-bound `completed` run is not captured. Single-flight is keyed by workspace and run (`:65-72`).
2. **Parser.** `guidance-section-counts.ts` matches the C6 rules:
   - null, empty and whitespace input return null.
   - CRLF is normalised.
   - The first `## Project-Specific Guidance` line is the region start, with trailing whitespace ignored.
   - Canonical `### Name` headings are matched case-sensitively in order, each after the previous found heading.
   - A missing heading gives `{ wordCount: 0, generated: false }`.
   - A section runs to the next found canonical heading or to the end.
   - No canonical heading found gives null.
   - Words are counted with `split(/\s+/).filter(Boolean)`.
   - The result always has the four canonical entries in order.
   - The spec file was not audited against the 13 listed cases.
3. **Rebind.** Runless refresh when a run is expected, the revision guards and `runMismatch` follow the plan for the first lookup. Findings 2-4 are the gaps.
4. **Legacy behaviour.** The new bind arguments are optional and the `bindingRevision` guards only add stale-response protection. The summary card narrows its input to `Pick<…,'sections'>`, and its only caller (`prompt-enhancement.component.ts:127`) still compiles. The card hides the Quality Guidance row. Dropping the fallback and token badges is the D9 reduction.
5. **Silent failures and races.**
   - Finding 1 is a silent UI failure.
   - Finding 2 produces a wrong recovery state.
   - The remaining stale-async and identity guards in the workflow store, handoff store and capture are sound.

## C6 required cases

| Case | Status | Note |
| --- | --- | --- |
| B completes before first read | COVERED | `stale` asserted; the runless-only assertion exists on the happy path only |
| B active during capture (step 1 and step 5) | COVERED | before and during tests |
| Service lock held | WEAK | duplicate of the first case, no distinct scenario |
| New run in same tab | COVERED | `stale` asserted |
| `generatedAt` moves between reads | COVERED | `stale` asserted |
| Guidance disabled during capture | COVERED | `stale` asserted |
| Content null | COVERED | `unavailable` asserted |
| RPC throws | COVERED | `unavailable` asserted |
| Binding changes mid-capture | COVERED | only `tabId` varies |
| Completed run bound late | WEAK | asserts no RPC call, not an outcome |
| Result advances while local run stays A | COVERED | imperative read only, see finding 1 |
| Happy path (4 rows) | COVERED | `captured` and 4 sections; the card's 4 rows are tested in the card spec |
| Reload omits counts | COVERED | trivial |

## Score and verdict

Score: 6/10. The core capture algorithm, the parser and the legacy compatibility are faithful to the plan. Findings 1 and 2 are real behavioural defects on likely paths.

Verdict: **REVISE**. Fix findings 1 and 2 (add tests that would have caught them), and decide on finding 3. Findings 4-8 can be addressed in the same pass.

## Re-review (revision 1)

Scope: read in full `generation-step.store.ts`, the revision-1 diffs of `generation-workflow.store.ts` and `generation-handoff.store.ts`, `safeLookup`, and the new regression tests named in the lane report. Parser and C6 capture code were re-read and are unchanged in behaviour. Nothing was run.

### Status of earlier findings

| # | Status | Evidence |
| --- | --- | --- |
| 1 reactivity | FIXED | `generation-step.store.ts:18` holds the entry in a `signal`; `:51` sets it; `:59` reads it, so a `computed` re-evaluates. The test `updates a computed from null when capture resolves without another signal change` fails against the old plain Map. |
| 2 false mismatch after own run | FIXED | `generation-workflow.store.ts:268-270` (accept clears expected and mismatch); `:305-306` (expected consumed on the first authoritative lookup). Test `adopts a started run B after binding run A...` (spec:92-112) fails on the old code, where refresh would have flagged B. |
| 3 null with expected | FIXED, with a caveat (see N1) | `generation-workflow.store.ts:307-312` latches `runMismatch` when the result is not the expected run, null included. Test spec:63-76. |
| 4 rebind churn | FIXED | `generation-workflow.store.ts:74-82`, second clause of the guard. Test spec:77-91 asserts the same run object and no extra lookup. |
| 5 | DEFERRED to Phase 2 | not in scope |
| 6 handoff catch supersession | FIXED | `generation-handoff.store.ts` catch now has `if (revision !== this.revision) return;`. Test `ignores a late failure from a superseded guidance handoff` (spec:11-41) fails without it, because outcome would flip to `manual-recovery`. |
| 7 unbounded map | FIXED | `generation-step.store.ts:18,51`: one entry, replaced. `guidanceSections` is key-guarded (`:60`), so an old entry cannot leak onto a newer run. |
| 8 test gaps | FIXED | The lane report maps each gap to a named test: distinct lock-owner mock, runless assertions, single-flight, no count on stale, workspace and run-id changes, late bind. I read the cited names but did not audit every assertion line. |

### Checks requested

- Late response from an earlier bind setting a mismatch: not possible. Every path that mutates state after the await checks `revision !== this.bindingRevision` (`:310`). `bind`, `unbind` and `accept` all bump the revision. Two concurrent refreshes under the same revision are safe, because the loser sees `this.expectedRunId !== expectedRunId` at `:312` and drops its result (it also drops a valid result, which is harmless).
- Legacy setup-wizard: it calls `bind(binding)` with no expected id, so `expectedRunId` is always undefined. The `if (expectedRunId)` block is skipped. `runMismatch` is only ever written `false` there. It can never see a mismatch. The lookup argument is unchanged for it (`this.runValue()?.binding.runId`).
- Interaction of the four rules:
  - "Same-run rebind skip" needs `runValue()` to equal the expected id. After a mismatch (run is null), a rebind with the same id resets and looks up again. That is the right recovery path.
  - "Clear on own accept" and "first lookup only" are consistent with each other.
  - The mismatch latch makes `refresh()` return at `:299`. This is intended, and `accept()` clears it.
- C6 capture sequence: unchanged order (runless identity check, status 1, content, status 2, identity check, local binding check, parse, set). It still fails closed. No regression found. The parser file is untouched.

### New findings

1. **Serious — a transient lookup failure with `expectedRunId` is reported as a permanent mismatch.** `generation-workflow.store.ts:301-312` with `safeLookup` at `:366-376`. `safeLookup` turns an RPC throw into `null`. With an expected id, a null result goes straight to `runMismatch.set(true)`, which consumes the expected id, clears the run and, via `:299`, blocks every later refresh until a new bind. On the legacy path, the same null goes into the `lookupFailures` and watchdog retry branch. So a single dropped call on a `?run=` page load now shows the "no longer current" recovery for a run that is still valid. The state is also sticky. Fix: distinguish "lookup failed" from "authoritative null" (for example `safeLookup` returns a sentinel). Treat a failure as a retry and do not consume the expected id. Add a test where `getBoundRunState` rejects once and then resolves the expected run.
2. **Minor — a duplicate refresh result is dropped silently.** `:312`. When two refreshes race on the first lookup, the one that loses discards a valid result. It converges on the next event, but a refresh that runs only once (stop flow) can leave the state one update behind. Low impact.
3. **Minor — `submit*` is still gated by `sameBinding` plus revision, but `startedValue` is cleared in `manualContinue` before the awaited open.** `generation-handoff.store.ts` (`manualContinue`). That is correct, but the page must not treat a cleared `started()` as "no run exists" while `outcome` is `idle` and the open is in flight. This is a Phase 2 note only.

### Score and verdict

Score: 8/10. All seven in-scope findings are fixed with regression tests that would fail on the old code, and the expected-run rules interact safely, including for the legacy caller. One Serious defect (new finding 1) is a likely path on a flaky host call and would show the recovery UI wrongly; it needs a small fix and a test.

Verdict: REVISE (fix new finding 1; the rest may go to Phase 2).

## Re-review (revision 2)

Scope: read the revision-2 diff of `generation-workflow.store.ts` (`refresh`, `safeLookup`, `accept`, `bind`) and the two new specs. Nothing was run.

### Status of revision-1 new findings

| # | Status | Evidence |
| --- | --- | --- |
| N1 transient failure reported as mismatch | FIXED | `safeLookup` returns the private `LOOKUP_FAILED` symbol on a throw (`generation-workflow.store.ts:379-389`). In `refresh`, the failed branch with an expected id (`:309-317`) sets no mismatch, does not clear `expectedRunId`, and schedules a backoff retry. An authoritative null reaches `:318-327`, consumes the expected id and latches `runMismatch`. |
| N2 duplicate refresh dropped | ACCEPTED as Minor | Left unchanged, as the lane stated. Low impact. |
| N3 | Phase 2 note | Not in scope. |

### Checks requested

1. Failed lookup versus authoritative null: correct. Spec `recovers the expected run after one failed lookup` asserts no mismatch, one pending timer, then the run adopted after 1000 ms. The old code (failure turned into null) would set the mismatch, so the test fails without the fix. `flags recovery when the expected run has no authoritative owner` keeps null as mismatch.
2. Legacy caller (no expected id): `expectedRunId` is undefined, so the failed branch is skipped. `run = lookup === LOOKUP_FAILED ? null : lookup` (`:318`) restores the old null path, with the same `lookupFailures` and watchdog code. The lookup argument is unchanged. `accept` also treats a failure as "not the accepted run" (`:288-290`), as it did for null.
3. Retry loop bound: capped at 3 failures (`lookupFailures < 3`), with delays of 1, 2 and 4 s. The revision check (`:307`) and the `expectedRunId` check (`:310`) stop a stale retry. `unbind`, `bind` and `accept` clear the watchdog and bump the revision. Success resets `lookupFailures` and clears the watchdog. The mismatch latch still clears on bind, unbind and accept.
4. Tests: the new failure tests fail on the old code. The second test (`schedules a retry...`) only proves the first retry is scheduled. It does not cover exhaustion or a retry that finds a null.

### New findings

1. **Moderate - retry exhaustion is silent.** `generation-workflow.store.ts:309-317`. After three failures with an expected id, nothing is scheduled and no signal is set. The state stays `idle`, `runMismatch` is false, and `expectedRunId` is kept. The page cannot tell "still loading" from "gave up". A later event-driven `refresh()` still retries, so it is recoverable. Phase 2 should show an error or retry affordance, or the store should expose a `lookupExhausted` signal. No test covers the fourth failure.
2. **Minor - `lookupFailures` is shared** between the expected-run retries and the legacy watchdog. This is harmless because `bind` resets it, but a spec for the exhaustion path would pin the behaviour.

### Score and verdict

Score: 9/10. The Serious defect is fixed with a sentinel, the authoritative-null and legacy paths are unchanged, the retry is bounded and revision-guarded, and the new tests are real regressions. What is left are Phase 2 UX notes, not logic faults.

Verdict: APPROVED
