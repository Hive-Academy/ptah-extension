# Code Logic Review — `TASK_2026_453_1eb4` Batch 3 (Lane A / C3, Lane B / C2)

## Summary

| Metric              | Value                                |
| -------------------- | ------------------------------------ |
| Overall score        | 6/10                                  |
| Assessment            | NEEDS_REVISION                        |
| Blocking issues       | 0                                      |
| Serious issues        | 1                                      |
| Moderate issues       | 2                                      |
| Failure modes found   | 3                                      |

Scope reviewed: full diffs of `app-state.service.ts`, `app-state.service.spec.ts`,
`orchestra-canvas.component.ts`, `orchestra-canvas.component.spec.ts` (Lane A / Task 3.1);
`session-history-replayer.service.ts`, `session-history-replayer.admission.spec.ts`,
`session-history-replayer.service.spec.ts`, `session-loader.service.spec.ts`,
`libs/frontend/chat/CLAUDE.md` (Lane B / Task 3.2); both codex reports; batches.md Tasks
3.1/3.2 and implementation-plan.md C2/C3/User-Decision-3. No tests were run (read-only
review); all conclusions below are from static trace of the diffs and the existing spec
assertions.

## Five logic questions

### 1. How does this fail silently?

- `AppStateManager.requestCanvasSession`'s 5 s safety timeout (`app-state.service.ts:717-726`)
  fires unconditionally once 5 s elapse, **even after the request has already been taken off
  the queue and is genuinely in flight**. It resolves the caller's promise `false` while the
  tile may still open successfully moments later — a silent, misleading "failure" signal for
  an operation that is still running. See Failure mode 1 below; this is the sharpest instance
  of "success-looking result on failure," inverted (failure-looking result on eventual
  success).
- `SessionHistoryReplayer.releaseReplayAdmission` (`:234-247`) hands off to the next waiter via
  a detached `void this.handoffReplayAdmission().catch(...)` (`:240-244`). A rejection there is
  only `console.error`'d — the `replay()` call that triggered the release never sees it and
  has already returned/resolved. That is deliberate per the plan (AC4: "no wedge... without a
  sentinel catch") and the `finally` in `handoffReplayAdmission` (`:249-256`) does still admit
  the next waiter, so this is not a hang — but a genuinely failing handoff (e.g. a broken
  `yieldToMacrotask` in a future refactor) would only ever surface as a console line, never as
  an observable failure to any caller. Acceptable as designed, flagged for completeness.

### 2. What user action produces unexpected behaviour?

- Clicking three sidebar sessions from the sidebar (or a canvas "open" action) in quick
  succession, cold, on a session large enough that its own replay takes close to or over 5 s
  (plausible per Batch 2's M0 numbers — see Failure mode 1) causes the **third** tile's opening
  promise to resolve `false` although the tile does, in fact, open a few seconds later. Nothing
  in today's two production callers (`app-shell.component.ts:564`,
  `chat-view.component.ts:982`) currently acts on that `false` (E3, confirmed by grep — both are
  fire-and-forget), so this is not user-visible **today**, but the very doc comment this batch
  edited (`app-state.service.ts:693-701`) tells the next caller to `await` the promise "if it
  needs to know the outcome" — that caller will be wrong a meaningful fraction of the time under
  load, and no test in this batch pins the correct behaviour here (Batch 3's new specs only
  exercise both the queue and the admission slot in isolation, never together).
- A user re-clicking a session tile fast enough to trigger tab supersession
  (`SessionHistoryReplayer.claim` racing an in-flight `replay()` on the same tab) now waits for
  the superseded replay to notice it lost its claim (bounded by the current chunk, ≤250 events)
  **plus** the admission hand-off's macrotask + paint yield (≤~66 ms) before the newer resume's
  own chunks start — a small, deliberate latency increase, not a regression in the queue's
  guarantee itself.

### 3. What input data produces a wrong answer?

- Any session whose own uncontended replay-and-finalize legitimately takes ≥5 s (a large history
  under CPU pressure) will hit the same "resolved `false` while actually succeeding" defect from
  Finding 1, independent of whether other tiles are queued — C2's added latency simply makes the
  window far more likely to be hit for the 2nd/3rd tile in a burst, but a single very large
  session replaying alone can also exceed 5 s.
- `canContinueReplay` reads `claim.tabId` for the tab lookup, not the outer `tabId` destructured
  at `:172` (`session-history-replayer.service.ts:285-296`). Both currently name the same value
  (`claim.tabId === tabId` is an invariant of how `replay()` is always called), so this is not
  presently reachable as a bug, but it means the check is *not* actually re-verifying "is this
  still the same tab id the caller started with" independent of the claim object — it is
  definitionally true by construction. Not a defect, but worth a one-line note if this helper is
  ever reused with a claim whose `tabId` could diverge from the caller's.

### 4. What happens when a dependency fails?

- `handoffReplayAdmission`'s `yieldToMacrotask()` rejecting (a failed `MessageChannel.postMessage`,
  per the existing contract in `libs/frontend/chat/CLAUDE.md` rule 7 "Yield semantics") still runs
  the `finally` and admits the next waiter (`:249-256`) — pinned by
  `session-history-replayer.admission.spec.ts:360-388`. Correct, matches AC4.
- A closed/rebound tab discovered only after a waiter is admitted is handled by
  `canContinueReplay` (`:285-296`), which calls `clearPendingUpdates` and `setStatus('loaded')` —
  unchanged from the pre-existing per-chunk check, now shared correctly between the pre-loop
  (contended) and in-loop re-checks. Pinned by
  `session-history-replayer.admission.spec.ts:276-322` (`'closed'` case).
- If `requestAnimationFrame` is undefined (hidden window), `yieldToPaint` falls back to the 50 ms
  timer alone (`:265-283`) — pinned by `session-history-replayer.admission.spec.ts:421-450`.
  Correct.
- The canvas effect's `switchSession(...).catch(() => req.resolve?.(false))`
  (`orchestra-canvas.component.ts:333-336`) still swallows the rejection reason entirely (matches
  the pre-existing behaviour this batch was not asked to change — not a new regression, but also
  not improved: a `switchSession` failure for tile 2 of 3 is indistinguishable from a tile-cap
  failure to any awaiting caller).

### 5. What is missing that the requirements never mentioned?

- Task 3.1's own AC 6 ("Perf-harness comments reworded: the single-slot bug is fixed by
  TASK_2026_453 C3") was not done — see Finding 3. Nobody specified what happens if the comment
  update is skipped, but the AC is explicit and unmet.
- No requirement anywhere in Batch 3 addresses the C2×C3 interaction directly (the team-leader's
  edge-case list has "Timed-out canvas request later consumed by a mounting canvas" but that is a
  different scenario — a request removed from the queue and never reconsidered — not "a request
  taken from the queue whose own downstream async work outlives the orphan timer"). This is
  exactly the gap in Finding 1.

## Failure modes

### 1. Canvas-session-request orphan timeout can fire after genuine consumption, resolving `false` for a request that will still succeed

- Trigger: `requestCanvasSession` is called, the canvas effect drains it from the queue and
  starts `addTileFromSession` + `switchSession(...)` (`orchestra-canvas.component.ts:323-337`),
  and that `switchSession` — which now serializes through C2's replay-and-finalize slot
  (`session-history-replayer.service.ts:181-209`) behind one or two other queued tile opens —
  takes ≥5 s to settle.
- Symptom: the 5 s timer created in `requestCanvasSession` (`app-state.service.ts:717-726`) fires
  regardless of whether the request object is still in the queue. Its filter is a no-op (the
  request was already removed when taken), but it unconditionally calls `settle(false)`
  (`:721-725`). Because `settle` is idempotent (`:706-711`), this "wins" if it fires before the
  real `switchSession` resolution calls `req.resolve(true)` — the caller's promise is now
  permanently `false` even though the tile opens moments later.
- Evidence: `app-state.service.ts:703-729` (the timer and `settle` guard);
  `orchestra-canvas.component.ts:317-338` (consumption path, no interaction with the timer once a
  request is taken); implementation-plan.md's own per-tile latency estimate
  ("+0.5 to +1.5 s per tile ahead") plus Batch 2's M0 cold-run totals (4.0-6.9 s blocked time
  across 3 tiles) show the 5 s window is not a generous margin for a 2nd/3rd queued tile under
  load.
- Current handling: none — the timeout logic is unchanged from the pre-C3 single-slot version
  and was not revisited for C2's added serialization latency. Task 3.1's own AC 2 only requires
  removing the request from the queue "if still present" and clearing the timer "when the
  request resolves" — both are satisfied literally, but the combination with C2's latency
  produces the wrong answer for the caller, not a crash.
- Recommendation: clear (or at least neutralize) the orphan timer at the point the request is
  taken from the queue, not only when it resolves — e.g. have
  `takeCanvasSessionRequests`/the canvas effect signal "no longer orphan-timeout-eligible" per
  request, or size the timeout to the realistic C2-serialized worst case (or make it
  per-position-in-queue). At minimum, this needs a spec that starts a request, drains it via
  `takeCanvasSessionRequests`, advances fake timers past 5 s, and only then resolves it `true` —
  today's specs at `app-state.service.spec.ts:670-693` cover "timeout while still queued" and
  "resolved before the timer fires," but not "resolved after the timer would have fired, while
  already taken."
- Severity: **Serious** (a real, if currently unobserved, wrong-answer defect directly in the
  path Batch 3 was built to fix; not blocking because no shipped caller acts on the value today,
  and the doc comment already invites a future caller to).

### 2. Batch 3's own file list and AC for Task 3.2 could not be honoured, and the resulting scope expansion was not escalated

- Trigger: implementing C2's true global (cross-session) FIFO admission, as specified in
  implementation-plan.md ("Two tabs replaying one session queue separately" — i.e. even same-
  session sibling tabs are now mutually exclusive at the admission layer, not just at the
  fence).
- Symptom: two pre-existing specs that assumed two same-session tab replays make chunk-by-chunk
  progress **concurrently** — `session-history-replayer.service.spec.ts` ("holds the session
  buffer until the last of two tabs replaying that session finishes",
  `:456-495`; "delivers once ... if tab B already finished" / renamed "delivers once after tab A
  fails and the surviving tab finishes", `:571-599`) and
  `session-loader.service.spec.ts` ("cancels a stale replay when a newer resume claims the same
  tab", `:2282-2312`) — would otherwise deadlock or assert on an ordering that C2 makes
  impossible (a synchronous, unawaited `newer` replay call can no longer run to completion while
  an older replay on the same tab is paused mid-chunk, holding the global slot).
- Evidence: `batches.md` Task 3.2's file list (lines 514-518) names only
  `session-history-replayer.service.ts`, the new admission spec, and `chat/CLAUDE.md`; AC 9
  (`batches.md:546-547`) reads "Existing `session-history-replayer.service.spec.ts`,
  `session-loader.service.spec.ts`, `session-loader.cli-restore.spec.ts` green unchanged." Lane B
  modified the first two of those three files (confirmed by `git diff`), which is both outside
  the assigned file list and contrary to the literal AC text.
- Current handling: the edits themselves are technically sound — I traced both rewritten tests
  end to end (fence ref-counting, admission ordering, exactly-once live-event delivery) and found
  no weakened assertion; both still pin "delivered exactly once, only after the last open claim
  releases" and "only the superseding replay's events are counted as processed." But the AC as
  written was falsified by a *correct* C2 implementation, and Lane B silently absorbed that
  rather than flagging it back to the team-leader/architect, which is what "green unchanged"
  existed to gate.
- Recommendation: team-leader/architect should explicitly re-open AC 9 for Task 3.2 (it is
  provably unsatisfiable as written once C2 is global rather than per-session) and record the two
  edited files as an accepted, reviewed deviation rather than a silent one. No code change
  required — this is a process/traceability gap, not a functional defect.
- Severity: **Moderate** (no incorrect behaviour found in the edited tests; the concern is
  unreviewed scope expansion against an explicit AC).

### 3. Task 3.1 AC 6 (perf-harness comment rewording) is unmet, and the stale comments now describe a fixed bug as unfixed with wrong line numbers

- Trigger: reading the FU-22a doc block after Batch 3 lands.
- Symptom: `apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts:153-170`
  still says "A real product bug this harness surfaced (not fixed here)... writes to a
  single-slot signal (`_canvasSessionRequest`)... consumed by exactly one `effect()` in
  `OrchestraCanvasComponent` (`orchestra-canvas.component.ts:293-308`)... not fixed in this
  batch... Recommended follow-up: queue `canvasSessionRequest`s." Every one of those facts is now
  false: the signal is plural, the effect is at a different location, and the "recommended
  follow-up" is the very code this batch shipped. `perf-page-capture.ts:174-179` repeats "the
  product currently consumes tile-open requests through a single-slot signal." A future reader of
  either file will be misled into thinking FU-22a is still open.
- Evidence: `tile-open-longtask-budget.perf.spec.ts:142-170`; `perf-page-capture.ts:165-183`;
  batches.md Task 3.1 AC 6 ("the single-slot bug is fixed by TASK_2026_453 C3... Comment-only
  change there").
- Current handling: Lane A's own report (`b3-lane-a-codex-report.md:51-52`) states this was
  skipped because "the direct lane prompt explicitly excludes the perf harness" — i.e. a lane
  prompt overrode batches.md's own file list and AC for this task without the deviation being
  flagged as an unmet AC in the report's acceptance-criteria table (item 6 is presented as met by
  scope exclusion, not as a gap).
- Recommendation: update the two comment blocks now that C3 is real: they document a bug that no
  longer exists at the cited location and cite a signal name that was deleted this same batch.
- Severity: **Moderate** (documentation-only; no functional impact, but it actively misinforms
  and is a named, explicit acceptance criterion of this exact task).

## Blocking issues

None found.

## Serious issues

### Canvas-session-request orphan timeout races C2's added replay latency

- File: `libs/frontend/core/src/lib/services/app-state.service.ts:703-729`
- Scenario: request taken from the queue and in flight (`switchSession` pending, serialized
  behind another tile's replay via C2) when the 5 s timer fires.
- Impact: the awaiting caller (today none; the doc comment invites one) sees `false` for an
  operation that later succeeds — a wrong answer indistinguishable from a real failure.
- Fix: see Failure mode 1's recommendation.

## Moderate and minor issues

- `session-history-replayer.service.spec.ts:456-599` and
  `session-loader.service.spec.ts:2282-2312` modified outside Task 3.2's assigned file list,
  against the literal text of AC 9 — see Failure mode 2. Edits are correct; the deviation was not
  escalated.
- FU-22a doc comments in `tile-open-longtask-budget.perf.spec.ts:153-170` and
  `perf-page-capture.ts:174-179` are stale (wrong signal name, wrong line numbers, describe the
  bug as unfixed) — Task 3.1 AC 6 unmet. See Failure mode 3.
- Minor: `orchestra-canvas.component.ts:333-336`'s `.catch(() => req.resolve?.(false))` discards
  the rejection reason (pre-existing pattern, not introduced by this batch, but now shared by two
  more callers per burst — worth a debug log if this is ever revisited).

## Data flow

1. `AppStateManager.requestCanvasSession(sessionId, name)` appends a `CanvasSessionRequest` to
   `_canvasSessionRequests` and arms a 5 s orphan timer — OK, but the timer is not deactivated by
   dequeue, only by settlement (Finding 1).
2. `OrchestraCanvasComponent`'s effect reads `canvasSessionRequests()`, and when non-empty drains
   the whole array via `untracked(() => takeCanvasSessionRequests())` — OK, atomic, FIFO
   preserved.
3. Each drained request runs `addTileFromSession` synchronously (cap/dedupe applied per request in
   order — OK) then `switchSession(sessionId)` asynchronously, without awaiting between requests —
   OK, matches AC3.
4. `switchSession` eventually calls into `SessionLoaderService`, which claims the tab via
   `SessionHistoryReplayer.claim` and calls `replay()` — OK, unchanged plumbing.
5. `replay()` acquires the global admission slot (`acquireReplayAdmission`) — synchronous fast
   path when uncontended (no added await — OK, verified by
   `session-history-replayer.admission.spec.ts:251-274`), or queues as a waiter (FIFO via
   `Array.push`/`Array.shift` — OK) when contended.
6. On every exit (`replayed`, `superseded`, throw) the `finally` releases the slot
   (`releaseReplayAdmission`) — OK, verified for all three outcomes plus a rejected handoff
   macrotask (`admission.spec.ts:276-388`).
7. `switchSession`'s promise eventually resolves/rejects, calling `req.resolve(true/false)` from
   step 3 — **gap**: if this happens after the 5 s orphan timer already fired `settle(false)`, the
   caller already has the wrong answer (Finding 1); this step's result is silently discarded.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Task 3.1 AC 1-5 (FIFO queue, atomic take, timeout removal, effect drain, specs) | COMPLETE | — |
| Task 3.1 AC 6 (perf-harness comment rewording) | MISSING | Comments still describe the bug as unfixed with a stale signal name and stale line numbers; see Failure mode 3 |
| Task 3.2 AC 1-8, 10 (admission scope, FIFO, release-in-finally, paint yield, warning, file size, CLAUDE.md bullet) | COMPLETE | — |
| Task 3.2 AC 9 (existing replayer/loader specs green **unchanged**) | PARTIAL | Two of the three named specs were edited (necessarily, given a global rather than per-session slot); deviation not escalated — see Failure mode 2 |
| User Decision 3 (`session:load`/`chat:resume` stay concurrent; only replay-and-finalize serializes) | COMPLETE | `acquireReplayAdmission` is called only inside `replay()`, never around the resume RPC round trip |
| Batch 3 verification: no `canvasSessionRequest(` / `clearCanvasSessionRequest` left | COMPLETE | Confirmed by grep; only prose references remain (Finding 3) |

Implicit requirements not addressed: a spec proving the orphan-timeout does not fire a false
negative for a request that was already taken and is still legitimately in flight (Finding 1).

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Two canvas requests queued before one effect flush | YES | Drained together, FIFO, both `addTileFromSession`/`switchSession` in order | — |
| Tile cap hit on 2nd of 2 queued requests | YES | `addTileFromSession` returns falsy → `resolve(false)` synchronously | — |
| Canvas-session request times out before being taken | YES | Removed from queue by identity filter, `settle(false)` | — |
| Canvas-session request taken, then its own async work outlives the 5 s timer | NO | Timer still fires and calls `settle(false)` unconditionally | See Failure mode 1 |
| Three chunked replays across three tabs, strict FIFO | YES | `session-history-replayer.admission.spec.ts:190-249` | — |
| Uncontended ≤250-event replay stays synchronous | YES | `admission.spec.ts:251-274`; no `await` taken in the fast path | — |
| Superseded / closed-tab waiter releases slot immediately | YES | `admission.spec.ts:276-322` | — |
| Active replay throws | YES | `admission.spec.ts:324-358`; slot released, fence stays open | — |
| Handoff macrotask rejects | YES | `admission.spec.ts:360-388`; next waiter still admitted | — |
| Wait > 10 s | YES | One `console.warn`, cleared on admission (`admission.spec.ts:390-419`) | — |
| Hidden window (no rAF) | YES | 50 ms timer fallback (`admission.spec.ts:421-450`) | — |
| C3 + C2 interaction: queued tile open times out while waiting on the admission slot | NO | Not tested anywhere in Batch 3 | See Failure mode 1 |

## Verdict

- Recommendation: **REVISE**
- Confidence: HIGH
- Top risk: the canvas-session-request 5 s orphan timeout can resolve `false` for a request that
  is genuinely still in flight behind C2's serialization, and nothing in Batch 3 tests for or
  guards against it — the exact interaction the review was asked to probe.
- What a robust implementation would add: (1) neutralize or resize the orphan timer at the point
  a request is taken from the queue, with a spec proving "taken, then resolved after 5 s" still
  yields the real outcome; (2) reword the FU-22a doc comments in the perf harness to reflect that
  C3 fixed the bug; (3) have the team-leader explicitly re-open and re-record Task 3.2 AC 9
  against the two edited legacy specs rather than leave the "unchanged" text standing uncorrected.
