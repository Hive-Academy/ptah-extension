# Code Style Review — Delta 2 — `TASK_2026_453_1eb4` (Batch 3, revise round 2)

Base chain: `b3-code-style-review.md` (7/10, NEEDS_REVISION, 1 serious, 3 minor) then
`b3-code-style-review-delta.md` (APPROVED, 2 residual minors). This pass checks
`b3-revise-codex-report.md` "Revise round 2" against the current uncommitted diff.
Read-only: `git diff` + file reads, no test/lint run, no `nx reset`, no edits.

## Summary

| Metric          | Value                                        |
| --------------- | --------------------------------------------- |
| Overall score   | 9/10                                          |
| Assessment      | APPROVED                                      |
| Blocking issues | 0                                              |
| Serious issues  | 0                                              |
| Minor issues    | 0 new (both prior residual minors now closed) |
| Files reviewed  | 12 (11 diffed + new admission spec)           |

## Residual minors from delta 1 — verified closed

1. **`perf-page-capture.ts:174-179` stale single-slot prose.** Now reads: "Clicks are
   separated by one `requestAnimationFrame` yield to preserve the harness's disclosed
   stress cadence. This is a deliberate pacing choice, not a workaround for the
   single-slot bug fixed by TASK_2026_453 C3." Matches the perf spec header
   (`tile-open-longtask-budget.perf.spec.ts:153-160`, also reworded this round) word
   for word in claim. CLOSED.
2. **Unreachable `if (!next)` branch in `handoffReplayAdmission`.** Gone.
   `session-history-replayer.service.ts:238-246` now checks
   `this.replayAdmissionQueue.length === 0` before indexing `[0]`, splices that exact
   entry, and hands it to a per-waiter `resolve`/`reject` pair — there is no longer a
   shared "next" object whose non-existence needed a defensive guard. CLOSED.

## Round-2 structural change: readable, and the reject is finally attributed correctly

The round-1 defect (a failed hand-off rejecting the *releasing* replay's own promise,
per `b3-code-logic-review-delta.md` and the round-2 report §1) is fixed by giving each
`ReplayAdmissionWaiter` its own `resolve`/`reject`
(`session-history-replayer.service.ts:83-87`) and by `releaseReplayAdmission` firing
`handoffReplayAdmission` detached (`void this.handoffReplayAdmission(next)` at
`:216`) rather than awaiting it in the releasing replay's `finally`. Traced the full
path:

- `replay()`'s own `finally` (`:210-212`) calls `releaseReplayAdmission()`
  synchronously and does not await the hand-off — so a completed replay's returned
  promise is never re-opened by a later hand-off failure. Confirmed by
  `session-history-replayer.admission.spec.ts:411-452` ("keeps the finished replay
  successful and reports a failed handoff on its waiter"): A resolves `'replayed'`
  and finalizes; B's promise (not A's) rejects with `Replay admission handoff failed
  for tab ${TAB_B}`; C is still admitted afterward and finalizes.
- The production caller path is pinned too:
  `session-loader.service.spec.ts:2288-2323` drives the real `SessionLoaderService`
  and asserts A resolves `{ staleSnapshot: false }`, finalizes once, and never enters
  `applyResumeFailure`, while B alone enters recovery (`applyResumeFailure`,
  `clearPendingUpdates`) — closing exactly the state-clearing regression the logic
  delta review flagged.

This is a readable structure: one `interface ReplayAdmissionWaiter` carries its own
callbacks (`session-history-replayer.service.ts:82-87`), `acquireReplayAdmission`
returns the fast-path `null` or a promise wired to that waiter's own
`resolve`/`reject` (`:196-211`), and `handoffReplayAdmission` is the single place that
decides which waiter's promise settles which way (`:238-256`) — no shared mutable
"current handoff" object for two different callers to race over.

## Doc/comment accuracy — verified against the code, not just each other

- Class doc "Admission" paragraph (`session-history-replayer.service.ts:13-19`):
  every claim (one global FIFO slot, fast path returns no Promise, contended replay
  re-checks claim/tab binding on admission, release on every exit, one macrotask +
  one paint opportunity before the next waiter) matches the implementation read
  above. It does not restate the per-waiter-reject detail, which is fine — that is a
  finer point the CLAUDE.md bullet carries instead, not a place the two documents
  disagree.
- `libs/frontend/chat/CLAUDE.md:75` (rule 7 "Admission" bullet): matches the code
  exactly, including the detail the class doc omits — "A failed hand-off never
  changes the finished replay's outcome: it rejects the affected waiter's admission
  with that waiter's tab id, and the waiter's `finally` releases the slot onward."
  Verified against `handoffReplayAdmission`'s catch block (`:250-256`, constructs
  `Replay admission handoff failed for tab ${next.tabId}` and calls only
  `next.reject`) and against the waiter's own `try { if (admission) await admission
  ...} finally { this.releaseReplayAdmission(); }` (`:186-212`), which runs its own
  `finally` — including for a rejected `admission` — regardless of what happened to
  its predecessor.
- `macrotask-scheduler.ts:9-11` forward-pointer to the replayer's rAF/50ms race is
  unchanged from delta 1 and still accurate — no drift introduced this round.

## File-size and hygiene

- `session-history-replayer.service.ts`: 445 lines (well under 700).
- `session-history-replayer.admission.spec.ts`: 515 lines, single responsibility
  (admission ordering, hand-off failure, timeout warning, hidden-window fallback,
  the real-caller FIFO-into-admission integration case) — no split needed.
- `app-state.service.ts`: 817 lines, unchanged since round 1 (pre-existing breach,
  not worsened by this batch; already accepted in delta 1).
- `orchestra-canvas.component.ts`: 457 lines.
- No `TODO`/`FIXME`/stub/placeholder introduced by this batch (repo-wide grep on the
  five touched product files: only a pre-existing, unrelated "Legacy `localStorage`
  key" comment at `app-state.service.ts:48` and "Legacy fire-and-forget callers" at
  `:696`, both predating this batch and describing real backward-compat behavior, not
  new dead code).
- No `V2`/`Legacy` copy of the replaced API: repo-wide grep for
  `canvasSessionRequest\b|clearCanvasSessionRequest` across `libs` and `apps` returns
  zero hits.
- No sentinel-return catch introduced: `orchestra-canvas.component.ts`'s new
  `.catch((error: unknown) => { console.error(...); req.resolve?.(false); })`
  resolves the request's own contract value (`false` is a real, documented outcome
  of `CanvasSessionRequest.resolve`, not a placeholder swallow), and
  `handoffReplayAdmission`'s catch converts the error into a typed rejection with
  `cause`, it does not swallow and return a literal.

## Spec file structure and naming

`session-history-replayer.admission.spec.ts` keeps the `.admission.spec.ts`
qualifier-suffix convention already used in this directory
(`session-loader.cli-restore.spec.ts`), with its own fake `MessageChannel`/rAF
harness isolated from the main spec's setup — unchanged assessment from delta 1,
still correct after round 2's additions (the two new cases at lines 250-300 and
411-452 reuse the same harness, no new mocking style introduced).

## Angular conventions (canvas)

`orchestra-canvas.component.ts`'s FIFO-drain effect (`:319-350`) is unchanged in
shape from delta 1's read: `effect()` + `untracked(() => takeCanvasSessionRequests())`
is the correct read-outside-write-inside-effect split, `inject()`-based DI and
`ChangeDetectionStrategy.OnPush` are both already in place at the component
decorator level and untouched by this batch.

## Import boundaries

`session-history-replayer.admission.spec.ts` imports `AppStateManager` from
`@ptah-extension/core` (`:9`) to drive a real cross-lib integration case (batches.md
Task 3.2's "one real combined spec", also demanded by
`b3-code-logic-review-delta.md` Moderate finding 2). `chat`'s own `CLAUDE.md`
"Dependencies" section already lists `@ptah-extension/core` as an internal
dependency, so this is not a new or improper boundary crossing — it is a test using
a dependency the lib already has, to prove the two lanes' halves genuinely compose,
which a mock could not do. No frontend/backend or product/platform boundary is
touched by this batch at all (core, canvas, chat all stay inside `libs/frontend`).

## Comment accuracy in perf spec / perf-page-capture.ts

Both re-verified this round, not just carried over: `tile-open-longtask-budget.perf.spec.ts:153-160`
and `perf-page-capture.ts:174-179` now tell the same, current story (FIFO queue
fixed the drop, the one-rAF gap is a disclosed stress cadence) — this closes the
last defect-class instance from the original Serious finding across both files
that assert it.

## Pattern compliance

| Repository rule or nearby convention | Status | Evidence |
| --- | --- | --- |
| `catch (error: unknown)` narrowing | PASS | `session-history-replayer.service.ts:250` (`catch (error: unknown)`); `orchestra-canvas.component.ts` new catch, unchanged since delta 1 |
| No V2/Legacy copy of replaced API | PASS | repo-wide grep, zero hits for old canvas-request names |
| No dead/unreachable branch | PASS | round-1's `if (!next)` branch removed; no new dead branch introduced |
| No sentinel-return catch / no swallowed error | PASS | canvas catch resolves the request's real `false` outcome; replayer catch produces a typed, attributed rejection |
| Class doc / CLAUDE.md bullet match code | PASS | traced both against `acquireReplayAdmission`/`releaseReplayAdmission`/`handoffReplayAdmission` |
| File-size soft ceiling (700 lines) | PASS (no new breach) | replayer 445, admission spec 515, canvas 457; `app-state.service.ts` pre-existing 817 unchanged |
| Perf-harness prose accurate post-C3 | PASS | both perf spec and perf-page-capture.ts now consistent |
| Spec naming/placement convention | PASS | `.admission.spec.ts` sibling-suffix pattern matches `session-loader.cli-restore.spec.ts` |
| Angular signals/`inject()`/OnPush in canvas | PASS | unchanged decorator, `untracked()` read inside `effect()` |
| Import boundaries (core/canvas/chat) | PASS | chat spec's `AppStateManager` import is an existing declared dependency, used for a deliberate cross-lib integration case |

## Maintenance debt

- Introduced: none new this round beyond what delta 1 already accepted. The
  per-waiter `resolve`/`reject` pair replaces round 1's single shared handoff
  promise, which is strictly less debt (no shared mutable object two unrelated
  callers could race on).
- Retired: the unreachable defensive branch; the stale single-slot prose in the
  second file that still had it.
- Net: positive. Both residual minors from delta 1 are closed with no new ones
  introduced, and the fix for the logic-review's serious hand-off attribution bug
  is structurally cleaner than the code it replaced, not just patched.

## Verdict

- Recommendation: **APPROVE**
- Confidence: HIGH — every claim above is backed by a direct read of the current
  `git diff` and the referenced spec assertions, not the codex report's
  self-description alone.
- Key concern: none. No blocking, serious, or open minor issues remain from this
  or prior style passes on Batch 3.
- What a 10/10 version would do differently: nothing material found in this pass;
  the only stylistic nice-to-have (not raised as a finding) is that the class doc's
  Admission paragraph could restate the per-waiter-reject detail CLAUDE.md carries,
  so a reader of the class doc alone gets the full picture without also opening
  CLAUDE.md — cosmetic, not a defect.
