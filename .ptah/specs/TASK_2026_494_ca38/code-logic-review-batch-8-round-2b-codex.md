# Code Logic Review — `TASK_2026_494_ca38`, Batch 8, Round 2b

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 0 |
| Failure modes found | 0 remaining in this bounded re-check |

**Verdict: APPROVED for the consumed-drafts marker fix.** The previous round's one remaining blocker is resolved. The B8 overall score is 8/10, carrying forward the earlier resolved findings without reopening their scope. The reproduced restore failure is now covered for both blur and Enter, while the existing duplicate-commit and stale-text tests pass. This supports the sound 7–8 band; this bounded review does not establish exhaustive lifecycle coverage warranting 9–10.

Scope: read the complete current `surface-text-input.component.ts`, its spec, and `batch-8-fix-2-report.md`; compared the affected logic with the previous review's source evidence. No other B8 implementation was re-reviewed.

Paths below use **C** = `libs/frontend/declarative-dashboard/src/lib/components/`.

## Requested rulings

| Check | Ruling | Evidence and effect |
| --- | --- | --- |
| (1) Type `a`, save, commit, host snapshot `new host`, restore, then blur/Enter commits `a` | RESOLVED | C/surface-text-input.component.ts:129 calls `releaseConsumed` when inputs are observed; :223 clears the marker upon seeing a different drafts object. The two cases at C/surface-text-input.component.spec.ts:281 assert `new host`, restored `a`, then exactly two total `a` commits (:291,294,298). Both passed. |
| (2) F1: repeated Enter/blur/timer on an unchanged drafts object does not duplicate a commit | PASS | Component :224 retains the marker for the same object; :219 blocks the consumed entry. A successful commit clears typed text and stores the marker before outputs (:203–206); :198 clears the timer. Spec :254 covers Enter followed immediately by blur; :269 covers debounce followed by blur and Enter. New restore cases repeat the commit event before change detection and advance timers (:295–298), still asserting exactly one additional commit. All passed. |
| (3) F2 stale-text dropping and first commit before parent round trip | PASS | `releaseConsumed` touches only the consumed marker (:223). `reconcileTyped` and `isStale` retain ID/path, host-value and drafts checks (:237–246), and `dropTyped` clears the timer (:248). Passing specs at :303,315,326,336,345,354 cover cleared/replaced text, swapped nodes, unrelated writes and restoration. Before a first parent round trip, `draftInput` stores local typed text (:168); same node/host/drafts is not stale (:243–246); `currentDraft` returns typed text before the consumed guard (:218–219), so the first commit still works. That last timing case is confirmed by source trace in this narrow run, not claimed as a new dedicated test. |

## Verification

- Executed `npx jest -c libs/frontend/declarative-dashboard/jest.config.ts libs/frontend/declarative-dashboard/src/lib/components/surface-text-input.component.spec.ts --runInBand`: **1 suite, 28 tests passed**, exit 0.
- Scoped `ptah_get_diagnostics` for these two files: **0 errors, 0 warnings**.
- No source or spec files changed. Only this review was written; prior reviews remain intact.
- No Git operation ran: the higher-priority reviewer role forbids all Git operations, including the requested read-only diff. Consequently, exact historical diff equivalence is not certified. The current source and complete spec were examined, and the prior source evidence is available in this conversation. No direct file-read or Write tool was listed; native reading and patch writing were used.

## Five logic questions

### 1. How does this fail silently?

The previously reproduced silent suppression is closed: a different observed drafts record expires the marker (component :224), allowing a later restoration to commit. Spec :298 now observes both expected commits.

### 2. What user action produces unexpected behaviour?

None established within this fix's scope. Blur and Enter after restoring the consumed draft now commit once; repeated events remain suppressed until acknowledgement (spec :281; component :219).

### 3. What input data produces a wrong answer?

No new wrong-answer case established. The old consumed record is accepted after an intervening record is observed (component :131,216,224); externally replaced typed values retain the F2 protection (:243–246).

### 4. What happens when a dependency fails?

This fix adds no external dependency. Invalid drafts still fail validation without a commit (component :202; spec :131), and timer cleanup remains in commit and destruction paths (:128,198). Host/RPC behavior is outside this bounded check.

### 5. What is missing that the requirements never mentioned?

Observation is the relevant boundary: if a parent changes away and back before the input observes either change, reference identity alone cannot distinguish that from an unchanged input (component :224). This review approves the requested sequence, which includes the intervening rendered host snapshot (spec :289–293); it does not claim correctness for unobserved intermediate parent states.

## Failure modes

No remaining failure mode established in the reviewed change. The component and complete text-input suite were examined; both added restore cases and all existing cases passed. Residual uncertainty is limited to unobserved intermediate states and the absence of a Git baseline comparison, as disclosed above.

## Blocking issues

None. Prior round-2 F1 is resolved at component :131,216,224, with regression evidence at spec :281.

## Serious issues

None established.

## Moderate and minor issues

None established in scope.

## Data flow

1. Keystroke → local typed text and draft output: OK (component :166).
2. Commit attempt → release an expired consumed marker → reconcile typed text: OK (:213–217).
3. Current typed text wins; otherwise an unacknowledged consumed entry is blocked: OK (:218–220).
4. Valid commit → clear typed text, record consumed object, emit commit and draft removal: OK (:197–206).
5. Parent's different drafts record → effect expires marker: OK (:129–132,224).
6. Restore previous object → blur/Enter commits once: OK (spec :281–298).

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Restore previously consumed value and commit it | COMPLETE | None in the reproduced sequence; spec :281. |
| Preserve F1 duplicate suppression | COMPLETE | None established; spec :254,269,295. |
| Preserve F2 and first commit before round trip | COMPLETE | Tests plus source trace as distinguished above; component :218,243. |

Implicit requirements not addressed: none additional within this bounded fix.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Restored consumed object, blur or Enter | YES | Marker expired; spec :281 | None found. |
| Same object, repeated commit events | YES | Marker retained; component :219,224 | None found. |
| Different object observed at commit before effect | YES | Synchronous release at :216 | Verified by trace. |
| Stale typed value after parent replacement | YES | Reconciliation at :237; spec :303,336 | None found. |
| First commit before parent round trip | YES | Typed path precedes consumed guard at :218 | Verified by trace. |

## Verdict

- Recommendation: APPROVE.
- Confidence: HIGH for the reported blocker and bounded regression checks.
- Top residual uncertainty: intermediate parent states that the input never observes are not covered by this reference-based acknowledgement protocol (component :224).
- What a robust implementation would add: no further change required for this item; retain the new restoration cases and existing F1/F2 assertions.

One-line summary: **APPROVED, B8 8/10 — consumed-marker expiry fixes restored-value commits for blur and Enter; all 28 text-input tests pass and F1/F2 behavior is preserved.**
