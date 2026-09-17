# Code Style Review — `TASK_2026_453_1eb4` (Batch 3)

## Summary

| Metric          | Value                                |
| --------------- | ------------------------------------- |
| Overall score   | 7/10                                  |
| Assessment      | NEEDS_REVISION                        |
| Blocking issues | 0                                     |
| Serious issues  | 1                                     |
| Minor issues    | 3                                     |
| Files reviewed  | 9 (7 diffed + 2 codex reports read for context) |

Scope reviewed: `libs/frontend/core/src/lib/services/app-state.service.ts` (+spec),
`libs/frontend/canvas/src/lib/orchestra-canvas.component.ts` (+spec),
`libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts` (+spec),
`libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.admission.spec.ts` (new),
`libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts`,
`libs/frontend/chat/CLAUDE.md`. No test/lint commands were run for this review (read-only per
scope); `ptah_get_diagnostics` timed out mid-typecheck and was not retried, so the compiler
signal below is drawn from the codex reports' own recorded runs (76/76 suites, exit 0), not
independently re-verified.

## Five style questions

### 1. What breaks in six months?

Nothing in the production code paths inspected breaks under a plausible near-term change. The
one thing that *will* mislead someone in six months already exists today:
`apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts:157-169` still
reads "a real, if narrow, PRODUCT bug ... not fixed in this batch" and recommends "queue
`canvasSessionRequest`s ... so a second click can't overwrite a first one still waiting" —
which is exactly the fix Task 3.1 just shipped in `app-state.service.ts:706-737`. A reader
six months out, hitting this comment while investigating an unrelated canvas issue, will
conclude the bug is still open and either re-fix it or waste time confirming it isn't.

### 2. What would a new team member misread?

The same comment (`tile-open-longtask-budget.perf.spec.ts:156-158`) names the wrong internal
symbol (`_canvasSessionRequest`, a single-slot signal) as if it were still current — the signal
was deleted at `app-state.service.ts:259-264` and renamed to `_canvasSessionRequests`. A reader
who greps for `_canvasSessionRequest` from this comment gets zero hits and no explanation.

Separately, in `session-history-replayer.service.ts:181-183`, `acquireReplayAdmission` returning
`Promise<void> | null` (not always a promise) is a slightly unusual shape; the inline comment at
`:180` ("callers must not await it") heads this off well, so it is a minor-not-serious flag —
noted under Minor issues.

### 3. What does this cost to maintain?

Low. Both lanes stayed inside the facade/collaborator pattern already in place: Lane A extended
an existing signal-bridge idiom already used for `newCanvasSessionRequest` in the same file
(`app-state.service.ts:259-336`, matching `requestNewCanvasSession`'s shape per the plan's own
"pattern to follow" note), and Lane B added one collaborator method group
(`acquireReplayAdmission` / `releaseReplayAdmission` / `handoffReplayAdmission` / `yieldToPaint` /
`canContinueReplay`) to an existing class rather than inventing a new file, keeping
`session-history-replayer.service.ts` at 437 lines (well under the 700-line ceiling, and the
plan's own estimate of "+100" undershoots slightly — actual growth was +106 lines net for a
non-trivial concurrency primitive plus its documentation).

### 4. Where is this inconsistent with the rest of the repository?

`session-history-replayer.service.ts:265-282` (`yieldToPaint`) reaches for
`requestAnimationFrame` directly, which `libs/frontend/core/src/lib/services/macrotask-scheduler.ts:6-8`
documents as unsafe in a hidden Electron window ("requestAnimationFrame never fires for a hidden
window at all") — the exact reason that file gives for using a `MessageChannel` macrotask
instead. The new code is not actually inconsistent with that rule: it races `rAF` against a 50 ms
`setTimeout` specifically to cover the hidden-window gap (implementation-plan.md:373-376, batches.md:531-535),
and the intent here — a *paint* opportunity, not a macrotask turn — is a different primitive than
what `yieldToMacrotask` provides, so reusing it would not fit. But `macrotask-scheduler.ts`'s own
header comment, which is core's canonical explanation for why `rAF`/`setTimeout` are avoided
elsewhere, does not mention this new sanctioned exception, so the next engineer who reads that
file and then greps for `requestAnimationFrame` in the replayer will see a call that looks like it
contradicts the file they just read, with no forward pointer resolving the apparent conflict.

### 5. What would you have done differently, and why is that better rather than merely other?

I would have made the perf-harness comment rewrite (batches.md Task 3.1 AC6, files list line 480)
part of the same commit as the production rename, not a follow-up. The two lanes ran the rename
and the fix together; leaving the one file that *describes* the bug as fixed-later, when the fix
landed in the same batch, is strictly worse than either doing the doc edit now or filing a
tracked follow-up task and removing the "not fixed in this batch" claim. A one-line pointer
comment in `macrotask-scheduler.ts` ("the replayer's admission paint-yield is a deliberate,
narrower exception — see `session-history-replayer.service.ts`'s Admission doc") would have cost
nothing and closed the cross-reference gap noted in Q4.

## Blocking issues

None.

## Serious issues

### Task 3.1's own acceptance criteria (batches.md AC4, AC6) are not met — stale/misleading perf-harness comment left in place

- File: `apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts:142-169,
  ~525-535, ~615-616` (unchanged; confirmed via `git diff` — this file is absent from the
  batch's diff entirely)
- Problem: `batches.md:480-483` lists this file (doc-comments only) as in-scope for Task 3.1,
  and AC6 (`batches.md:506-507`) requires "Perf-harness comments reworded: the single-slot bug
  is fixed by TASK_2026_453 C3." AC4 (`batches.md:500-501`) requires
  `grep -rn "canvasSessionRequest\b\|clearCanvasSessionRequest" W/libs W/apps` to return only the
  new plural names; it currently still matches `tile-open-longtask-budget.perf.spec.ts:157,168`
  (confirmed by running that exact grep in this review). Lane A's own report
  (`b3-lane-a-codex-report.md:51-52,105-109`) states the edit was skipped because "the lane prompt
  explicitly excludes the perf harness" — i.e., a routing instruction given to the lane
  contradicted the task's own written acceptance criteria, and the lane followed the routing
  instruction without flagging the conflict back to the team leader.
- Impact: the comment at lines 156-169 now asserts a bug exists and is unfixed, while describing
  and recommending the exact fix this batch shipped. It is not a stale reference in the abstract —
  it actively misinforms a future reader about the current state of a real product bug. It also
  leaves a documented acceptance criterion of the batch unmet, which is a gap the team leader
  should decide whether to accept before closing Task 3.1.
- Fix: either (a) reword `tile-open-longtask-budget.perf.spec.ts:156-169` to state the bug was
  fixed by TASK_2026_453 C3/Task 3.1 and cite `app-state.service.ts`'s FIFO queue, or (b) if the
  team leader deliberately deferred this to a separate follow-up task, record that explicitly in
  batches.md/future-enhancements.md rather than leaving Task 3.1's AC4/AC6 silently unmet.

## Minor issues

- `session-history-replayer.service.ts:181-197`: `acquireReplayAdmission` returns
  `Promise<void> | null` rather than always a promise, so the call site needs the
  `if (admission) await admission;` guard immediately below it. The private comment at
  `:180` explains why (preserving synchronous timing for the uncontended path), so this is a
  judgment call rather than a defect, but a one-line note in the class doc's Admission
  paragraph (`:16-19`) that the fast path is intentionally non-`Promise`-returning would save the
  next reader the trip to the method body.
- `libs/frontend/core/src/lib/services/macrotask-scheduler.ts` documents `rAF` as unusable in a
  hidden window with no forward pointer to the replayer's sanctioned exception (see Q4); a
  one-line cross-reference would close the gap cheaply.
- `orchestra-canvas.component.ts:319-341`: the effect now does two jobs — read the FIFO signal
  and, inside the same block, run the per-request side-effecting body (`addTileFromSession`,
  `switchSession().then/.catch`) for every queued entry. This mirrors the pre-existing
  single-request shape exactly (not a new pattern introduced by this batch) and stays well short
  of the file-size or responsibility thresholds that would call for extraction, so this is
  recorded as a preference, not a finding with a fix attached.

## File-by-file

### `libs/frontend/core/src/lib/services/app-state.service.ts`

Score 9/10 — 0 blocking, 0 serious, 0 minor. Clean, minimal rewrite of a documented signal
bridge into a FIFO queue; the doc comments at `:107-127` and `:693-705` were updated in step with
the code, `takeCanvasSessionRequests()` avoids a write when the queue is already empty
(`:731-736`), and the timeout path removes the exact request by reference identity
(`:715-722`) rather than assuming it is still first/last in the queue.

### `libs/frontend/canvas/src/lib/orchestra-canvas.component.ts`

Score 8/10 — 0 blocking, 0 serious, 1 minor (responsibility note above, not actioned). FIFO
drain via `untracked(() => takeCanvasSessionRequests())` (`:322-324`) is the correct read/write
split for a signal read inside its own effect, and the per-request resolution logic is carried
over unchanged from the single-slot version, so behavior for an individual request (tile cap,
switch failure) is provably identical to before.

### `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.ts`

Score 8/10 — 0 blocking, 0 serious, 2 minor (both noted above). The admission slot is a
well-isolated collaborator (five small private methods) added to an existing class rather than a
new file, consistent with the facade-over-collaborators guidance in the root CLAUDE.md; release
is unconditionally in `finally` for every exit path (replayed, superseded, throw), matching the
existing `claim`/`release`/fence discipline in the same file. Class doc (`:1-35`) gained the
Admission paragraph as required.

### `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.admission.spec.ts` (new)

Score 9/10 — 0 blocking, 0 serious, 0 minor. Placement and naming (`.admission.spec.ts` beside
the class it tests, not a nested folder) follow the sibling `.spec.ts` convention in this
directory (compare `session-loader.cli-restore.spec.ts` for the same "qualifier-suffixed spec
file next to the main one" pattern already in this lib). Two spec files for one service is
justified here, not a split done to dodge a line-count ceiling: the main spec pins the
claim/chunk/fence contract that predates this batch, the new one isolates a genuinely separate
concern (global ordering across tabs) with its own fake-timer/rAF-mock harness that would have
made the existing spec's setup noisier for every other test in it.

### `libs/frontend/chat/src/lib/services/chat-store/session-history-replayer.service.spec.ts`

Score 8/10 — 0 blocking, 0 serious, 0 minor. The diff removes two `await until(() => yields === 2)`
waits and rewrites one test's staging to reflect that a second tab's replay now waits on
admission rather than progressing concurrently. This is the minimum edit needed to keep the
pre-existing fence/exact-once assertions valid under FIFO serialization, and the assertions
themselves (`liveEntries()` contents, `deferLiveEvent` return values) are unchanged in substance.

### `libs/frontend/chat/src/lib/services/chat-store/session-loader.service.spec.ts`

Score 8/10 — 0 blocking, 0 serious, 0 minor. One test restructured so a "newer" targeted load is
started before the held stale replay releases, rather than after — required because C2 now
serializes the two replays and the original ordering could no longer produce the scenario the
test was pinning (a newer in-flight claim on the same tab while an older one is still replaying).

### `libs/frontend/chat/CLAUDE.md`

Score 8/10 — 0 blocking, 0 serious, 0 minor. The new Admission bullet matches the voice, length
and structure of its four siblings in the same numbered list (Claims/Chunks/Live-event
fence/Yield semantics), states FU-20a as a known limitation rather than silently dropping it (as
the plan required), and is placed correctly after the Yield-semantics bullet.

## Pattern compliance

| Repository rule or nearby convention                                                          | Status | Evidence |
| ------------------------------------------------------------------------------------------------ | ------ | -------- |
| Signals + `inject()`, `OnPush`, zoneless-safe effects (root CLAUDE.md; canvas/CLAUDE.md)          | PASS   | `orchestra-canvas.component.ts:319-341` uses `untracked()` correctly inside an `effect()`; no new component state bypasses signals |
| Frontend libs MUST NOT import backend libs                                                        | PASS   | No new imports outside `@ptah-extension/{core,chat,chat-state,chat-streaming,shared,ui}` in the diffed files |
| File size soft ceiling 700 lines                                                                  | PASS   | Largest touched file is `app-state.service.ts` at 815 lines total, but the diff itself is small; `session-history-replayer.service.ts` is 437 lines |
| Facade rule: extend an existing collaborator/class rather than a same-purpose new file             | PASS   | Admission logic added as private methods on `SessionHistoryReplayer`, not a new service |
| Old single-slot API fully deleted, not kept beside the new one (implementation-plan.md:422)        | PARTIAL | Product/spec code: PASS (`grep` in `libs/` and non-perf `apps/` finds only the plural names). Perf-harness prose: FAIL (`tile-open-longtask-budget.perf.spec.ts:157,168` still names `_canvasSessionRequest`/`canvasSessionRequest`) — see Serious issue above |
| `catch (error: unknown)` narrowing                                                                 | PASS   | `handoffReplayAdmission`'s `.catch((error: unknown) => ...)` at `session-history-replayer.service.ts:230-235` |
| Consistency between the two lanes (same change read as one)                                       | PASS   | Both lanes use the same doc voice ("Met at ...", file:line citations in their reports), the same signal-bridge idiom, and neither lane touched the other's files (confirmed disjoint in `git diff --stat`) |

## Maintenance debt

- Introduced: one new concurrency primitive (`replayAdmissionActive` / `replayAdmissionQueue` / a
  private paint-yield helper) inside `SessionHistoryReplayer`, and one new FIFO array signal
  replacing a nullable single-value signal in `AppStateManager`.
- Retired: the single-slot `_canvasSessionRequest` signal and `clearCanvasSessionRequest()` method
  (fully removed from production and test code); the two `await until(() => yields === 2)` waits in
  the pre-existing replayer spec that encoded a concurrency assumption C2 now invalidates.
- Net: slightly positive. The FIFO queue and the admission slot both replace an implicit,
  previously-undocumented ordering assumption ("only one request/replay matters at a time") with
  an explicit, tested one. The one debt this batch adds without paying it down is the now-stale
  perf-harness comment (Serious issue above), which was true before this batch and is false after
  it.

## Verdict

- Recommendation: REVISE
- Confidence: HIGH
- Key concern: `tile-open-longtask-budget.perf.spec.ts:156-169` describes, as a current unfixed
  product bug, exactly the defect this batch fixed — that is a real, verifiable acceptance-criteria
  miss (batches.md Task 3.1 AC4/AC6), not a stylistic nit, and it will actively mislead the next
  reader of that file.
- What a 10/10 version would do differently: include the perf-harness comment rewrite in the same
  batch (it was explicitly in scope), or, if deliberately deferred, say so in batches.md instead of
  leaving the acceptance criterion silently unmet; add the one-line cross-reference in
  `macrotask-scheduler.ts` pointing at the replayer's sanctioned `rAF` exception.
