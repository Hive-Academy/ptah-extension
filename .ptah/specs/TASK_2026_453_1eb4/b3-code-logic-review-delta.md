# Code Logic Review (Delta) — `TASK_2026_453_1eb4` Batch 3, post-revise round 1

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 5/10 |
| Assessment | NEEDS_REVISION |
| Blocking issues | 0 |
| Serious issues | 2 (1 closed-finding regression check, 1 new) |
| Moderate issues | 2 |
| Failure modes found | 1 new |

Scope: `git diff HEAD` for all nine changed source files plus the new admission spec,
against `b3-code-logic-review.md`, `b3-code-style-review.md`, `b3-revise-codex-report.md`,
`implementation-plan.md` C2 (`:360-411`), and `libs/frontend/chat/CLAUDE.md` rule 7. Read-only;
no nx/jest/eslint run beyond what the revise report already recorded. All conclusions are a
static trace of the diff and the existing/added spec assertions.

## 1. Failure mode 1 (orphan timeout vs. in-flight canvas request) — CLOSED, verified

`app-state.service.ts:706-737`: the 5s timer now filters `_canvasSessionRequests` by reference
identity (`candidate !== request`) and only calls `settle(false)` when that filter actually
removed the request (`removedWhileWaiting`). A request already drained by
`takeCanvasSessionRequests()` is structurally absent from the array, so the timer's filter is a
no-op and `settle` is never invoked for it — the real `switchSession` outcome is the only thing
that can resolve that promise. `settle` also now `clearTimeout(timer)` (`:709`), closing the
"resolved true, timer still pending" leak.

Traced against the six requested paths:

- **Still queued at timeout** — pinned by `app-state.service.spec.ts` "removes a timed-out
  request and resolves false when no canvas consumes it" (new name, same case as before).
- **Taken and succeeding after 5s** — pinned by the new "keeps three consumed requests in flight
  past the orphan timeout and settles their real outcomes FIFO" test
  (`app-state.service.spec.ts:681-712`): three requests are drained via
  `takeCanvasSessionRequests()`, fake time advances 15s, `settlementOrder` stays empty, then each
  resolves `true` in order and `jest.getTimerCount()` is asserted `0`. This is the exact scenario
  Finding 1 named as untested, and it now is.
- **Taken and failing** — not directly re-pinned by a new canvas-level test, but
  `orchestra-canvas.component.spec.ts` "reports a queued session switch failure and resolves that
  request false" confirms the `.catch` path still resolves `false` (via `switchSession`
  rejecting), independent of the timer; combined with the app-state fix, a request that fails after
  5s settles `false` from its real outcome, not from the timer. Not literally re-verified past the
  5s mark, but the mechanism (identity removal from an already-empty array) makes the timer inert
  for any taken request regardless of eventual success/failure — low residual risk.
- **Tile cap rejects** — unaffected by this fix (synchronous, resolves before any timer
  question); re-pinned by "resolves only the second queued request false when the second tile hits
  the cap" (canvas spec).
- **Teardown while in-flight** — not exercised by a new test in this round, and was not one of
  the base review's failure modes either; behaviour is unchanged from pre-batch (the `.then`/
  `.catch` on `switchSession` still fires into a torn-down component with no guard). Pre-existing,
  out of this batch's stated scope — flagged as a residual gap, not a regression.
- **Two bursts** — the three-request test doubles as a two-burst proof once you read it as
  "burst of 3, all taken together"; a literal two-separate-bursts-before-one-flush scenario is not
  separately pinned, but the FIFO array logic gives no reason to expect burst boundaries to matter
  (the effect drains whatever is queued at flush time; two bursts before one flush degenerate into
  the same single-array case already tested).

No timer leak: `clearTimeout(timer)` in `settle` (`:709`) plus the fake-timer assertion
`jest.getTimerCount()).toBe(0)` in the new three-request test. **This finding is closed.**

## 2. C2×C3 interaction spec — NOT independently driven end-to-end, contrary to the implied claim

The revise report frames the new `app-state.service.spec.ts` test as "pinning the C2-latency ×
C3-timeout interaction" (report line 52). It does not. That test simulates "C2's serialized
downstream work" by hand: it calls `takeCanvasSessionRequests()` then manually invokes
`request.resolve?.(true)` after advancing fake timers — there is no `OrchestraCanvasComponent`,
no `ChatStore.switchSession`, and no real `SessionHistoryReplayer` in that spec file at all
(`app-state.service.spec.ts` has no import of either). It proves C3's own timer/queue logic is
correct under an abstract "resolved late" stand-in for C2; it does not prove the two real
mechanisms interact correctly.

Symmetrically, the new `orchestra-canvas.component.spec.ts` tests still mock `chatStore` entirely
(`switchSessionMock = jest.fn().mockResolvedValue(undefined)`, `orchestra-canvas.component.spec.ts:220`)
— no real `SessionHistoryReplayer` admission delay is exercised there either.

So: two correct unit specs, each verified in isolation, per this review's own base finding's
language — restated rather than closed. **Would the pre-fix code have failed either of these two
specs?** Yes for the app-state one (that is a faithful regression test for Finding 1's own root
cause, and it does fail without the fix — verified by re-reading the pre-fix timer logic, which
unconditionally called `settle(false)` with no removal check). But neither spec would fail
differently if `SessionHistoryReplayer`'s admission slot were deleted entirely, because neither
spec exercises it. The literal ask — "a spec that really drives both mechanisms together" — is
still unmet; what exists is a correct proxy for one side plus an untouched mock for the other.
**Severity: Moderate** (the underlying defect is fixed and specifically regression-tested; the
gap is in end-to-end proof of the two-mechanism interaction, not in the fix itself).

## 3. Admission handoff failure visibility — now visible, but misattributed to the wrong replay (NEW defect)

Confirmed present per `libs/frontend/chat/CLAUDE.md` rule 7's own updated text: "a failed hand-off
rejects **the releasing replay** after still admitting the next waiter." This is a deliberate
design choice, documented and pinned by
`session-history-replayer.admission.spec.ts:356-379` ("admits the next waiter and rejects the
releasing replay when the handoff macrotask rejects" — `replayA` is asserted to reject with
`'handoff post failed'`).

Trace the consequence for `replayA` in that exact test: `claimA`'s `replay()` call is a 251-event
chunked replay. Its own chunk loop completes, `finalizeSessionHistory` and `closeFence` both run
inside the `try` block (`session-history-replayer.service.ts:214-216`), and the function reaches
`return 'replayed'`. Only *after* that does the `finally` call `releaseReplayAdmission()`, which
starts admitting waiter B (`handoffReplayAdmission()`); when that hand-off's `yieldToMacrotask()`
rejects, the `finally` block's own abrupt completion (the awaited rejection) overrides the try
block's `return 'replayed'` per ordinary `try/finally` semantics — `replayA` rejects with
`'handoff post failed'` even though A's own replay already fully succeeded and was already
finalized.

Follow that rejection to `replay()`'s one production caller,
`session-loader.service.ts:780-801`. Its `catch` block is written for "a throwing chunk must not
leave a half-replayed tab that looks complete" (`:791-800`): it calls
`this.streamingHandler.clearPendingUpdates(resolvedTabId)`, `this.tabManager.applyResumeFailure(resolvedTabId)`
(which sets `streamingState: null` and `status: 'loaded'` per
`libs/frontend/chat-state/src/lib/tab-manager.service.ts:2133-2139`), and re-throws. None of that
branch's premise holds for this failure mode: `finalizeSessionHistory` and `closeFence` for tab A
already ran to completion before the rejection was even created. The result is that a replay
that **genuinely succeeded** is driven through the "half-replayed, drop everything" recovery path
because an unrelated waiter (tab B in the test, "the next click's tile" in production) failed to
be handed the slot — the `resumableSubagents` restore at `session-loader.service.ts:803-805`
is silently skipped for A even though its events were fully processed, and the tab is marked
`applyResumeFailure` (a UI-visible failure state) for a resume that actually finished.

This is the mirror image of the exact class of bug this batch was fixing (Finding 1's "false
negative on genuine success"), reintroduced one layer down: the fix for "handoff failures were
invisible" (base review Finding, five-logic-question #1 / #4) makes them visible on the **wrong**
promise. The plan's own failure-behaviour note
(`implementation-plan.md:396-398`: "a failed paint yield cannot reject (timer path)... No
sentinel catch") describes the paint-yield half of the hand-off (which indeed cannot reject) but
does not discuss `yieldToMacrotask()` rejecting inside the hand-off and does not say the
*releasing* replay's own promise should carry that failure — the plan is silent on which promise
should observe a hand-off failure, and the implementation picked the one call site
(`session-loader.service.ts`) whose failure branch actively discards already-committed state.

- Trigger: tab A's replay chunks/finalize/fence-close all succeed; the subsequent hand-off
  (macrotask yield) that admits the next queued waiter (tab B, or another queued canvas tile)
  rejects — e.g., a failed `MessageChannel.postMessage`, per the existing "a failed post rejects"
  contract for `yieldToMacrotask` (chat/CLAUDE.md rule 7).
- Symptom: tab A's `chat:resume` promise rejects with `'handoff post failed'` (or whatever the
  underlying post failure is) even though A's transcript was fully replayed and finalized; A's
  tab flips through `applyResumeFailure` (clears `streamingState`, sets `status: 'loaded'`),
  `resumableSubagents` restoration for A is skipped, and the caller's error path re-throws —
  while B (the unrelated waiter whose admission triggered the failure) proceeds and replays
  correctly.
- Evidence: `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts:181-216`
  (try/finally structure — `return 'replayed'` at `:216` is inside the `try`, the awaited handoff
  is in `finally` at `:238-241`); `session-history-replayer.admission.spec.ts:356-379` (proves the
  releasing replay, not the waiter, rejects); `session-loader.service.ts:780-801` (the one
  production caller's catch branch, written for a genuine mid-replay throw, now also runs for this
  case); `tab-manager.service.ts:2133-2139` (`applyResumeFailure`'s effect).
- Current handling: none — this is the shipped round-1 behaviour, not a leftover from before the
  revision (the pre-revision code detached the hand-off with `void ... .catch(console.error)`,
  which the base review flagged as invisible but which did NOT misattribute failure to A).
- Recommendation: do not let a hand-off failure reject the *already-completed* replay's promise.
  Either (a) let `releaseReplayAdmission()`'s hand-off run detached-but-observable through a
  side channel the loader does not `await` (e.g. re-log with enough context to be actionable, or a
  dedicated signal/metric), or (b) if the intent is truly "the releasing caller should know its
  hand-off failed," keep it out of the `try/finally` return-value path — e.g. capture the hand-off
  rejection and attach it to the *next* waiter's own admission entry instead of the finishing
  replay, since the next waiter is who is actually affected by a broken hand-off. As shipped, the
  caller that gets punished is the one call that had nothing to do with the failure.
- Severity: **Serious** (a replay that fully succeeded is reported as failed to its one production
  caller, which then discards state and skips subagent restoration for it — a wrong-answer defect
  triggered by an unrelated concurrent operation, directly in a path this batch modified).

## 4. Task 3.2 AC 9 (legacy specs unchanged) — deviation confirmed, assertions not weakened, AC is broken as written

Verified by reading the full diffs of both files, not just the report's claim:

- `session-history-replayer.service.spec.ts:456-599`: two tests changed. "the first tab finishes;
  the sibling is still held between chunks" → the sibling now genuinely waits on admission (comment
  updated accordingly, `:481`); assertion shape (`toBe('replayed')`) unchanged. The renamed test
  ("delivers once after tab A fails and the surviving tab finishes",
  formerly "...if tab B already finished") is a real behavioural rewrite, not a relaxation: the old
  version asserted **two** live events delivered (`['live:1', 'live:2']`) because B could finish
  concurrently with A under the old per-session-only serialization; the new version asserts **one**
  (`['live:1']`) because global admission now forces B to wait for A before it can finish, changing
  which events are still "live" vs. already fenced by the time B closes. Both versions still assert
  "delivered exactly once, and a later live event past release is dropped" — the exact-once fence
  contract itself is intact; only the count of events that qualify as "live at release time" changed
  because the real concurrency model changed. This is a correct, necessary update, not a weakened
  assertion.
- `session-loader.service.spec.ts:2296-2308`: the "newer resume before older releases" ordering is
  restaged per the report's description — consistent with the file's diff.

Conclusion: **AC 9 as literally written ("Existing ... green unchanged") is broken, not
deviated-with-reason in a hidden way** — the revise report does say so explicitly
("Finding is correct as a planning contradiction... This report explicitly records the deviation"),
so the deviation is now visible in the artifact trail. But nothing in `batches.md` itself was
touched (report says the user prohibited editing `batches.md`/`implementation-plan.md`), so the
carrier's AC 9 text still reads as met when it structurally cannot be. This is a documentation/
process gap, not a code defect: **the AC is broken by the correct C2 implementation, and the
break is now recorded in `b3-revise-codex-report.md` but not reflected in `batches.md` itself.**
Team-leader should reconcile `batches.md` AC 9 before closing Task 3.2. No test weakening found.

## 5. Perf-spec comment — fixed for the scoped file, one sibling comment still stale (residual, not new)

`tile-open-longtask-budget.perf.spec.ts:153-160` now correctly states C3 fixed the bug and the
grep check (`canvasSessionRequest\b|clearCanvasSessionRequest`) returns zero hits anywhere under
`apps/`/`libs/` (re-run, confirmed clean). AC4/AC6 for Task 3.1 are now met for this file.

However, `apps/ptah-electron-e2e/src/support/perf-page-capture.ts:174-179` (the file the base
review's Finding 3 also named) still reads: "Clicks are separated by one `requestAnimationFrame`
yield because the product currently consumes tile-open requests through a single-slot signal."
That sentence is false today — the product consumes a FIFO array, not a single-slot signal — and
it is not caught by the grep check (it names no symbol, only prose). The revise report explicitly
acknowledges this and declines to fix it as out of the round's authorized file scope. This is a
narrower, less actionable version of the same stale-doc problem the base review flagged (it does
not name a deleted symbol, so a grep-based verification would not catch it), but it still misleads
a future reader in the same file family. **Severity: Moderate**, unchanged from the base review's
assessment, now scoped to one file instead of two.

## Other new-defect scan

- No new resource leak found in the admission/timer changes: `yieldToPaint()` always clears both
  its `frameId` and `timerId` via the shared `finish()` (`session-history-replayer.service.ts:265-283`),
  including when called from a rejected-handoff path.
- `handoffReplayAdmission`'s `finally` still unconditionally shifts the queue and resolves/clears
  the warning timer regardless of the awaited yields throwing, so no starvation of subsequent
  waiters was introduced by this round — consistent with the admission spec's own assertion that B
  still resolves `'replayed'` in the handoff-rejection test.
- `canContinueReplay(tabId, claim, sessionId)` now takes the caller's `tabId` as an explicit
  parameter, closing the base review's Finding under "input data" (§3) about `claim.tabId` vs.
  the destructured `tabId` being definitionally identical; confirmed at
  `session-history-replayer.service.ts:184-204, 283-301`.

## Blocking issues

None.

## Serious issues

### 1. Admission hand-off failure rejects the wrong replay's promise (new, see §3)

- File: `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts:181-243`;
  caller `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.ts:780-801`.
- Scenario: tab A's replay fully succeeds; the hand-off that admits queued tab B fails.
- Impact: A's already-completed, already-finalized resume is reported to its caller as failed,
  which clears `streamingState`, skips subagent restoration, and marks the tab through the
  genuine-failure recovery path.
- Fix: see §3 recommendation — do not let a hand-off failure ride the finishing replay's own
  settle path.

### 2. `batches.md` Task 3.2 AC 9 still reads "unchanged" while two named specs were structurally rewritten (carried over from base review, not newly closed)

- File: `.ptah/specs/TASK_2026_453_1eb4/batches.md` (AC 9 text, unedited); evidence of the actual
  edits in `session-history-replayer.service.spec.ts:456-599`, `session-loader.service.spec.ts:2296-2308`.
- Scenario: anyone reading `batches.md` alone (not the revise report) to confirm Task 3.2's AC
  will see AC 9 marked as satisfiable when it is not.
- Impact: traceability gap, not a functional defect — see §4.
- Fix: team-leader edits `batches.md` AC 9 to record the deviation (the revise report already has
  the correct language to lift).

## Moderate and minor issues

- C2×C3 interaction is proven only per-mechanism, not end-to-end — see §2.
- `perf-page-capture.ts:174-179` still names the retired single-slot model in prose — see §5.
- (Minor, unchanged from base review) `orchestra-canvas.component.ts`'s per-request effect body
  still does two jobs in one block; not actioned, acceptable per style review.

## Data flow (delta from base review)

1. `requestCanvasSession` timer now checks removal-by-identity before settling — OK, closes
   Finding 1.
2. `OrchestraCanvasComponent` effect unchanged in shape, adds error logging on `switchSession`
   rejection — OK.
3. `SessionHistoryReplayer.replay()`: admission acquired, chunks run, `finalizeSessionHistory` +
   `closeFence` inside `try`, **then** the `finally` awaits a hand-off whose failure can now
   override the try's `return 'replayed'` — **gap**, see §3.
4. `SessionLoaderService.switchSession`'s catch branch treats any `replay()` rejection as "must
   discard state," which was written for genuine mid-chunk throws and is now also reached by an
   unrelated hand-off failure — **gap**, same as step 3.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Failure mode 1 (orphan timeout vs. in-flight request) | COMPLETE | Teardown-while-in-flight remains untested but is pre-existing/out of scope |
| C2×C3 combined interaction spec | PARTIAL | Two isolated, correct unit specs; no single spec drives both real mechanisms together |
| Admission handoff failure visible, no wedge, no sentinel-catch audit site | PARTIAL | Visible and non-wedging, but misattributed to the wrong (already-succeeded) replay — new Serious issue |
| Task 3.2 AC 9 (legacy specs unchanged) | BROKEN-AS-WRITTEN | Deviation is real and necessary, recorded in the revise report, but `batches.md` itself was not reconciled |
| Perf-spec comment / grep check | COMPLETE for scoped file | `perf-page-capture.ts` still stale (prose only, not grep-catchable) |

Implicit requirements not addressed: a spec (or at least an explicit design note) for what should
happen to the *releasing* replay's own promise when only the *hand-off* to someone else fails —
the plan discusses paint-yield failure but not macrotask-yield-during-handoff failure's blast
radius on the finishing caller.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Canvas request taken, resolves true after 5s | YES | New app-state fake-timer test | — |
| Canvas request taken, resolves false after 5s (switch failure) | PARTIAL | Timer fix is outcome-agnostic; not separately re-timed past 5s | Low risk, mechanism covers it |
| Real C2 delay driving a real C3 timeout end-to-end | NO | Both sides tested with mocks/manual resolves, not the real collaborator | See §2 |
| Hand-off macrotask rejects while releasing replay already succeeded | YES (behaviourally), but wrong attribution | `admission.spec.ts:356-379` proves the mechanism; nothing proves the *caller* handles it sanely | See §3, Serious issue 1 |
| Legacy same-session concurrent-tab specs under global admission | YES | Rewritten correctly, deviation recorded in report only | batches.md AC 9 still unreconciled |

## Verdict

- Recommendation: **NEEDS_REVISION**
- Confidence: HIGH
- Top risk: the round-1 fix for "handoff failures were invisible" makes them visible on the wrong
  promise — a tab whose resume genuinely succeeded can be driven through the loader's
  half-replayed-tab recovery path (state cleared, subagents not restored) because of an unrelated
  waiter's admission failure. This is a new, real defect at
  `session-history-replayer.service.ts:181-243` / `session-loader.service.ts:780-801`, more severe
  in character than the invisibility it replaced, because it now actively misleads a caller about
  its own success.
- What a robust round 2 would add: (1) decouple the hand-off's own failure from the finishing
  replay's return value — attribute it to the waiter it was trying to admit, or surface it through
  a channel the loader does not treat as "this replay failed"; (2) one spec that composes the real
  `OrchestraCanvasComponent` effect with a real (or realistically faked) `SessionHistoryReplayer`
  admission delay so the 5s-timeout-vs-serialization interaction is proven end-to-end, not per side;
  (3) reconcile `batches.md` Task 3.2 AC 9 text to match the recorded, necessary deviation; (4)
  update `perf-page-capture.ts:174-179`'s remaining single-slot-signal sentence.
