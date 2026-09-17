# Code Logic Review (Delta 2) — `TASK_2026_453_1eb4` Batch 3, post-revise round 2

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 8/10 |
| Assessment | APPROVED |
| Blocking issues | 0 |
| Serious issues | 0 |
| Moderate issues | 1 |
| Failure modes found | 0 new |

Scope: `git diff` (working tree vs `HEAD`) for the nine tracked changed source/spec files plus
the untracked `session-history-replayer.admission.spec.ts`, read against `b3-code-logic-review.md`,
`b3-code-logic-review-delta.md` (round-1 delta, the document this review supersedes),
`b3-revise-codex-report.md` §"Revise round 2", `batches.md` Batch 3 (Tasks 3.1/3.2 ACs),
`implementation-plan.md` C2/C3 sections, and `libs/frontend/chat/CLAUDE.md` rule 7. Read-only; no
nx/jest run performed (per instructions); `ptah_get_diagnostics` was run but returned unscoped,
mostly pre-existing spec-file `as unknown` cast warnings unrelated to this batch (see Diagnostics
note below) — the round-2 report's own `nx run-many -t typecheck` (exit 0) is the authoritative
signal for this review.

## Five logic questions

### 1. How does this fail silently?

No silent-success case was found in the admission/queue changes. The one candidate — a hand-off
failure being swallowed into a `console.warn`/`console.error` while the caller is told "success" —
was the round-1 delta's Serious finding and is now closed: a failed hand-off surfaces as a genuine
rejection on the *waiter's own* promise (`session-history-replayer.service.ts:257-262`), not as a
detached log line and not as a false failure on an unrelated succeeded replay. The orphan-timeout
false-negative (round-1 Failure mode 1) remains closed: `app-state.service.ts:717-727` only settles
`false` when the timeout's filter actually removed the request from the array.

### 2. What user action produces unexpected behaviour?

A user who opens three canvas tiles from three long-running sessions in quick succession, where the
admission hand-off between the first and second tile's replay fails (e.g. a `MessageChannel` post
throws), sees: tile A opens correctly, tile B's tile-open promise resolves `false` (per the canvas
effect's `.catch` at `orchestra-canvas.component.ts:335-341`) and tile C still opens correctly once
the queue's baton passes on. This is the documented, deliberate trade-off (chat/CLAUDE.md:75) — B is
the one actually affected by the broken hand-off, not A. No user action was found that stalls the
queue or gets a false "loaded" for a tab whose resume actually failed.

### 3. What input data produces a wrong answer?

None found that survives round 2. The round-1 wrong-answer case (A's fully-succeeded, fully-finalized
replay reported as failed to its own caller because of B's unrelated hand-off failure) is closed —
traced below in Data flow.

### 4. What happens when a dependency fails?

- `yieldToMacrotask()` throwing inside a hand-off (`MessageChannel` post failure): rejects only the
  waiter being handed the slot (`session-history-replayer.service.ts:250-265`); the finishing
  replay's own `return`/reject value is untouched because `replay()`'s `finally` no longer awaits the
  hand-off (`:211-213`, `void`-fired via `releaseReplayAdmission` → `handoffReplayAdmission`).
- `requestAnimationFrame` absent/never firing (hidden window): `yieldToPaint()` falls back to the
  50 ms timer (`:268-286`), pinned by `session-history-replayer.admission.spec.ts:485-514`.
- `switchSession` rejecting for a queued canvas request: caught, logged, resolves that one request
  `false` (`orchestra-canvas.component.ts:335-341`), pinned by
  `orchestra-canvas.component.spec.ts:423-444`.

### 5. What is missing that the requirements never mentioned?

- `batches.md` Task 3.2 AC 9 ("Existing … green unchanged") is still literally false against the
  tree — this is a known, already-recorded deviation (round-1 report and round-1 delta both flag
  it), not a new gap. It remains the team-leader's job to reconcile the carrier text, not a code
  defect.
- Teardown-mid-replay (component destroyed while `switchSession`'s promise is still pending) has no
  new test in this batch; pre-existing behaviour, out of the stated Batch 3 scope, flagged as
  residual in the round-1 delta and not revisited here since nothing in round 2 touched it.

## Failure modes

No new failure modes found past what the two prior reviews already catalogued and round 2 closed.
Scope reviewed for new modes: the restructured `releaseReplayAdmission`/`handoffReplayAdmission`
split, the per-waiter `reject`, the loader's catch branch, and the two rewritten legacy spec files.
None introduces an unhandled rejection, a double-settle, a wedge, or a timer leak — see Data flow and
the trace below.

## Blocking issues

None.

## Serious issues

None. The round-1 delta's Serious issue ("Admission hand-off failure rejects the wrong replay's
promise", `b3-code-logic-review-delta.md` §3) is closed. Trace:

- `session-history-replayer.service.ts:83-88`: each queued waiter now carries its own `reject`
  function (`ReplayAdmissionWaiter.reject`), not just `resolve`.
- `:185-213`: `replay()`'s `try` awaits `admission` (the waiter's own promise) and returns/throws
  based on its own chunk work; the `finally` calls `this.releaseReplayAdmission()` **without
  `await`** — a failing hand-off downstream can no longer override this call's own settled outcome.
- `:238-265`: `releaseReplayAdmission` dequeues the next waiter and fires `handoffReplayAdmission`
  detached (`void`); that method's own `try/catch` converts a hand-off failure into
  `next.reject(new Error('Replay admission handoff failed for tab <waiter tab id>'))` — i.e. it
  rejects *that waiter's own* `admission` promise, which is exactly what *that waiter's own*
  `replay()` call is awaiting inside its own `try`. The failure therefore propagates through the
  waiter's own promise, not the previous (already-finished) replay's promise.
- Caller-side proof: `session-loader.service.spec.ts:2288-2323` — tab A (`makeChunkedService`)
  resolves `{ staleSnapshot: false }`, `finalizeSessionHistory` is called once for A, and
  `applyResumeFailure` is asserted **not** called with `TAB` (A) and **is** called with `tabB` (B).
  This is a faithful regression test for exactly the defect the round-1 delta named — verified by
  reading the harness setup and mocks, not just the assertion names.
- Replayer-level proof: `session-history-replayer.admission.spec.ts:411-452` — A resolves
  `'replayed'` and is finalized; B rejects with the tab-B-specific message and is neither finalized
  nor mutated; C is subsequently admitted and resolves `'replayed'` (no wedge past the failed
  hand-off).

No wedge: B's own `finally` (inside its `replay()` call) still runs `releaseReplayAdmission()` even
though B never held the slot productively, which is precisely what advances the baton to C. This
was traced by hand against `:238-247` and independently confirmed by the C-admission assertion in
both specs above.

No new unhandled-rejection or double-settle risk: the waiter's `admission` promise is created and
immediately awaited in the same synchronous frame (`acquireReplayAdmission` return value handed
straight to `if (admission) await admission;`), so there is no window in which it could reject
unobserved; `next.resolve()`/`next.reject()` are called at most once inside a single try/catch, and
`clearTimeout(next.warningTimer)` runs unconditionally in `handoffReplayAdmission`'s `finally`
regardless of which branch fired.

## Moderate and minor issues

### 1. `batches.md` Task 3.2 AC 9 still unreconciled (carried over, not new)

- File: `.ptah/specs/TASK_2026_453_1eb4/batches.md` (AC 9 text, unedited by design — the operator
  prohibited editing it in this round).
- Scenario: a reader of `batches.md` alone, without the revise report, still sees AC 9 phrased as
  "Existing … specs … green unchanged," which is not achievable once C2 forces global
  admission — `session-history-replayer.service.spec.ts:456-495,541-595,699-728` and
  `session-loader.service.spec.ts:2326-2356` were necessarily restructured (verified below).
- Impact: traceability gap only; the deviation is fully and correctly recorded in
  `b3-revise-codex-report.md` (round 1 and round 2), and no assertion was weakened by the
  restructuring (see Data flow §5-6).
- Fix: team-leader edits `batches.md` AC 9 to record the deviation when closing Task 3.2; no code
  change required.

Everything else the round-1 delta raised as Moderate is now closed with real, load-bearing evidence,
not merely restated:

- C2×C3 combined interaction (round-1 delta §2, Moderate): closed by
  `session-history-replayer.admission.spec.ts:250-300`, which drives the **real**
  `AppStateManager.requestCanvasSession`/`takeCanvasSessionRequests` and the **real**
  `SessionHistoryReplayer.replay()` together — three 251-event chunked replays, `jest.advanceTimersByTime(5000)`
  proving none of the three canvas promises settles false at the 5 s mark while C2 still owns the
  slot, then FIFO real-outcome settlement `[true, true, true]` with `settlementOrder` asserted
  `[A, B, C]` and `jest.getTimerCount()` `0`. This would fail against the pre-fix C3 code (its
  unconditional timeout would settle every drained request `false`) and would behave differently if
  the real admission queue were removed (the ordering/timing assertions depend on it), so it is a
  genuine end-to-end proof, not two isolated mocks re-labelled.
- Stale `perf-page-capture.ts:174-179` prose (round-1 delta §5, Moderate): closed — the sentence now
  reads "a deliberate pacing choice, not a workaround for the single-slot bug fixed by TASK_2026_453
  C3," matching the current FIFO-queue implementation. Confirmed via `git diff`.

## Data flow

1. `AppStateManager.requestCanvasSession` (`app-state.service.ts:703-730`) appends to
   `_canvasSessionRequests`; its 5 s timer removes-by-identity and only calls `settle(false)` when
   removal actually happened — OK, closes round-1 Failure mode 1.
2. `OrchestraCanvasComponent`'s effect (`orchestra-canvas.component.ts:319-347`) drains the queue with
   `untracked(() => takeCanvasSessionRequests())` and iterates synchronously with no `await` between
   requests — OK, preserves FIFO ordering and AC3.
3. `SessionHistoryReplayer.replay()` (`session-history-replayer.service.ts:174-214`): acquires
   admission (`null` fast path or a per-waiter `Promise`), runs chunks, finalizes and closes the fence
   inside `try`, and its `finally` releases the slot **without awaiting the hand-off** — OK, this is
   the round-2 fix; the finishing replay's own return value can no longer be overridden by a
   downstream hand-off failure.
4. `releaseReplayAdmission`/`handoffReplayAdmission` (`:238-266`): dequeues the next waiter, awaits
   `yieldToMacrotask()` then `yieldToPaint()`, and on failure rejects **that waiter's own** admission
   promise with a message naming that waiter's tab id — OK, attribution now matches the failing
   party.
5. `SessionLoaderService.switchSession`'s catch branch (`session-loader.service.ts:780-801`) now only
   ever sees a `replay()` rejection that belongs to the tab actually calling it (a genuine chunk throw,
   or — for a queued waiter — its own failed hand-off), so `applyResumeFailure`/`clearPendingUpdates`
   are only ever applied to the tab that actually failed — OK, closes round-1 Serious issue.
6. Legacy specs `session-history-replayer.service.spec.ts` and `session-loader.service.spec.ts`
   restructure scheduling (removing races that only worked under the old per-session-only
   serialization) but keep every outcome/count/order assertion intact — verified by reading both
   diffs in full, not just the report's claim (see below) — OK, no weakening.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Round-1 delta Serious (handoff failure misattributed to completed replay) | COMPLETE | None found; closed at both replayer and loader layers with direct regression specs |
| Uncontended ≤250-event replay stays synchronous | COMPLETE | `session-history-replayer.admission.spec.ts:302-325` asserts `promiseSettled === false` and `macrotasks === []` immediately after the call |
| C3 orphan timeout settles only requests still queued | COMPLETE | Identity-filter removal check unchanged from round-1 close, re-verified in current tree |
| C2×C3 combined interaction spec | COMPLETE | Real collaborators now driven together (`admission.spec.ts:250-300`) |
| Perf-spec / perf-page-capture stale comments | COMPLETE | Both files updated and consistent with the FIFO/admission model |
| Task 3.2 AC 9 (legacy specs "unchanged") | BROKEN-AS-WRITTEN, deviation recorded | `batches.md` text itself not reconciled (team-leader action, not a code defect) |

Implicit requirements not addressed: none newly identified. The round-1 delta's residual
"teardown-while-in-flight" and "burst boundaries" notes remain untouched, out of this round's scope,
and were already flagged as pre-existing/low-risk rather than regressions.

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Handoff fails after the releasing replay already fully succeeded | YES | Waiter-scoped `reject`; loader test isolates A from B | None |
| Three real canvas requests drain into real replay admission past the 5 s orphan timeout | YES | `admission.spec.ts:250-300` | None |
| rAF never fires (hidden window) during a hand-off | YES | 50 ms timer race, `finish()` clears both handles | None |
| Superseded/closed waiter while queued | YES | Immediate release, next waiter admitted (`admission.spec.ts:327-373`) | None |
| Active replay throws mid-chunk with a waiter queued | YES | Slot releases in `finally`; waiter still admitted (`admission.spec.ts:375-409`) | None |
| `batches.md` AC 9 read in isolation from the revise reports | NO | Text unedited by instruction | Team-leader must reconcile before closing Task 3.2 |

## Diagnostics note

`ptah_get_diagnostics` scoped to the four production files under review returned a workspace-wide
TypeScript pass (339 errors) rather than a narrowed one; the errors touching this batch's files are
all pre-existing `as unknown as X` / branded-type test-cast patterns already present at untouched
line numbers in the same spec files (e.g. `session-loader.service.spec.ts:64,860,885,...`,
`session-history-replayer.service.spec.ts:136`) and are consistent with the round-2 report's own
`npx nx run-many -t typecheck -p @ptah-extension/core @ptah-extension/canvas @ptah-extension/chat`
(exit 0) being the correctly-scoped signal. No error in the dump points at a line this batch actually
changed in `session-history-replayer.service.ts`, `session-loader.service.ts`, `app-state.service.ts`,
or `orchestra-canvas.component.ts` themselves (only at pre-existing spec-file casts).

## Verdict

- Recommendation: **APPROVE**
- Confidence: HIGH
- Top risk: none blocking. The only open item is process/traceability — `batches.md` Task 3.2 AC 9
  still reads as satisfiable when the C2 admission redesign makes it structurally impossible as
  literally written; this is fully disclosed in `b3-revise-codex-report.md` and does not affect
  runtime correctness.
- What a robust implementation would add: (1) team-leader reconciles `batches.md` AC 9 text when
  closing Task 3.2; (2) optionally, a follow-up test for teardown-while-in-flight (component
  destroyed mid-`switchSession`) — pre-existing gap, not introduced by this batch; (3) optionally,
  surface the FU-20a note (global status may read `loaded` while a later replay waits) as a tracked
  follow-up item rather than only a CLAUDE.md comment, since it is a real, if narrow, UX edge case.
