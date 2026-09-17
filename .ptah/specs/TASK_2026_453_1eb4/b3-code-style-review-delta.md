# Code Style Review — Delta — `TASK_2026_453_1eb4` (Batch 3, revise round 1)

Base: `b3-code-style-review.md` (7/10, NEEDS_REVISION, 1 serious, 3 minor).
Cross-checked against `b3-code-logic-review.md` (6/10, NEEDS_REVISION, 2 serious) and
`b3-revise-codex-report.md`. HEAD `93c41c41d`, worktree uncommitted, read-only
(`git diff`/`Read` only, no test runs).

## 1. Prior findings — verified closed or still open

### Style Serious — stale perf-harness comment (batches.md AC4/AC6)

CLOSED for the file this review scoped as its evidence.
`apps/ptah-electron-e2e/src/specs/chat/tile-open-longtask-budget.perf.spec.ts:153-160`
now reads "Product bug this harness surfaced, fixed by TASK_2026_453 C3" and correctly
names `canvasSessionRequests` (plural) and `OrchestraCanvasComponent` as the drain
site — no more `_canvasSessionRequest`/"not fixed in this batch" language.
`grep -rn "canvasSessionRequest\b|clearCanvasSessionRequest" libs apps` returns zero
hits repo-wide (verified this session). AC4/AC6 as scoped to this file: met.

Not closed, and not claimed closed: `apps/ptah-electron-e2e/src/support/perf-page-capture.ts:174-176`
still reads "Clicks are separated by one `requestAnimationFrame` yield because the
product currently consumes tile-open requests through a single-slot signal." That
sentence is still false post-C3 — the product now consumes a FIFO queue, and the
one-rAF click cadence is a stress-cadence choice, not a single-slot workaround. The
revise report (`b3-revise-codex-report.md:32`) states this file "was not changed
because this revision's explicit file scope authorizes only the perf spec comment" —
an explicit, disclosed scope decision, not a missed fix. Recorded below as a residual
minor, not re-opened as the original serious (the original evidence file is fixed;
this is a second, previously-uncited file with the same defect class).

### Logic Serious (Finding 1) — orphan timeout settling an in-flight request

Verified fixed. `app-state.service.ts:706-737`: the timer callback now filters the
request out of `_canvasSessionRequests` by reference and only calls `settle(false)`
when `removedWhileWaiting` is true — i.e. only when the request was still queued.
A request already taken by the canvas effect is no longer timeout-eligible; it
settles solely through `switchSession`'s real outcome. `app-state.service.spec.ts:681`
(the `keeps three consumed requests in flight past the orphan timeout...` test) drains
three requests, advances fake timers 15s past every 5s window, asserts nothing settled,
then resolves all three and asserts `[true, true, true]` in FIFO order. This is the
exact "taken, then resolved after the timer would have fired" case the logic review
said was untested — now it is.

### Logic Serious (Finding 3, same defect as Style Serious above) — see above. Closed for the cited file.

### Logic Moderate (Finding 2) — AC9 scope deviation not escalated

Acknowledged, not silently absorbed this round: `b3-revise-codex-report.md:26`
records the deviation explicitly ("This report explicitly records the deviation")
and states the user prohibited editing `batches.md`/`implementation-plan.md` this
round. That is a process record, not a code fix — team-leader still owns closing
AC9's text. No further code action was available to this revision; not a style
defect in the diff.

### Style Minor 1 — non-Promise admission fast path documented only locally

CLOSED. `session-history-replayer.service.ts:16-21` (class doc, "Admission" bullet)
and `libs/frontend/chat/CLAUDE.md:75` both now state the fast path intentionally
returns no Promise. Matches the four sibling bullets' voice (Claims/Chunks/Fence/Yield).

### Style Minor 2 — macrotask-scheduler.ts rAF warning lacked forward pointer

CLOSED. `macrotask-scheduler.ts:9-11` adds: "The chat history replayer separately
races rAF with a 50 ms timer when it specifically needs a paint opportunity between
admitted replays." Resolves the cross-reference gap from Q4 of the base review.

### Style Minor 3 — canvas effect drain+execute in one block

Not actioned — correctly so. `b3-revise-codex-report.md:48` calls this a preference,
not a fix, and declines to extract a one-use helper. `orchestra-canvas.component.ts:319-350`
is unchanged in shape from the base review's read (still one cohesive effect). No
new finding here.

## 2. New findings from the revise-round code

### Minor — dead defensive branch in `handoffReplayAdmission`

- File: `session-history-replayer.service.ts:249-256` (`releaseReplayAdmission` at
  ~223-231, `handoffReplayAdmission` at ~236-256)
- Problem: `releaseReplayAdmission` only calls `handoffReplayAdmission()` when
  `this.replayAdmissionQueue.length === 0` is false, i.e. only when the queue is
  non-empty at the call site. Nothing removes entries from `replayAdmissionQueue`
  except `Array.prototype.shift` inside `handoffReplayAdmission`'s own `finally`
  block, and nothing runs between the length check and that `shift()` except two
  `await`s that can only `push` (via `acquireReplayAdmission`), never pop. So
  `const next = this.replayAdmissionQueue.shift()` is guaranteed non-undefined on
  every call this codebase can produce, and the `if (!next) { this.replayAdmissionActive = false; }`
  branch (`:250-251`) is unreachable. It is also untested: I checked
  `session-history-replayer.admission.spec.ts` for a case that empties the queue
  between the length check and the shift (none exists; the closest tests, "admits
  the next waiter..." at `:357-378` and the fence-supersession tests, all keep at
  least one waiter present through the shift).
- Impact: low — this is defensive code guarding an invariant that already holds by
  construction, not a functional bug. But it is exactly the kind of untested branch
  that erodes confidence in coverage claims ("76/76 suites" does not cover this
  line), and the next person extending `acquireReplayAdmission`/`releaseReplayAdmission`
  (e.g. adding a second queue-draining path) could easily break the invariant
  silently, since nothing pins that `next` is always defined here.
- Fix: either delete the dead branch and assert the invariant (`const next = queue.shift(); if (!next) throw new Error('unreachable: releaseReplayAdmission only calls handoff when the queue is non-empty');` or a comment plus non-null usage), or add one admission spec case that proves the invariant under a race the current tests don't hit (e.g. two waiters admitted back-to-back with a synchronous drain). Either is a small, mechanical change; not blocking.

### Minor — `perf-page-capture.ts:174-176` still describes the pre-C3 single-slot signal (see 1, above)

- File: `apps/ptah-electron-e2e/src/support/perf-page-capture.ts:174-176`
- Problem: same defect class as the closed Style Serious finding — asserts the
  product "currently consumes tile-open requests through a single-slot signal,"
  which is false after this batch's FIFO queue (`app-state.service.ts:259-264`).
- Impact: lower than the original finding (this is a support-file doc comment, not
  the perf spec's own incident write-up, and the revise report discloses the scope
  cut rather than hiding it), but it is the same misleading-to-a-future-reader
  pattern, in a file that references the very spec whose header now says the bug
  is fixed. A reader hitting this comment via `perf-page-capture.ts` without first
  reading the spec header gets the stale story.
- Fix: one-sentence edit — "Clicks are separated by one `requestAnimationFrame`
  yield to match the harness's stress cadence (see the spec header); this is a
  deliberate test pacing choice, not a workaround for a single-slot signal (fixed
  by TASK_2026_453 C3)." Small enough to fold into the next touch of this file;
  not worth a dedicated follow-up batch on its own.

### No other new findings

- `app-state.service.ts` timeout/settle logic: variable names (`removedWhileWaiting`,
  `settled`, `settle`) are precise and match what they guard; no leftover dead
  fields — the old `clearCanvasSessionRequest()` and its call sites are fully gone
  (confirmed by the repo-wide grep above), and `takeCanvasSessionRequests()` avoids
  a signal write when the queue is already empty (`:739-744`).
- Canvas effect drain block (`orchestra-canvas.component.ts:319-350`): the added
  `catch ((error: unknown) => { console.error(...); req.resolve?.(false); })` is a
  correct, minimal fix to the previously-swallowed rejection reason, matches this
  repo's `catch (error: unknown)` convention, and is pinned by
  `orchestra-canvas.component.spec.ts`'s new "reports a queued session switch
  failure" test (console.error spy + exact message assertion).
- `session-history-replayer.admission.spec.ts` (new file, 444 lines) and the
  legacy-spec edits in `session-history-replayer.service.spec.ts` /
  `session-loader.service.spec.ts`: naming and placement are unchanged from the
  base review's read and remain correct — `.admission.spec.ts` beside the class
  under the sibling-suffix convention already used in this directory
  (`session-loader.cli-restore.spec.ts`). The legacy-spec edits in this round
  (dropping stale `await until(() => yields === 2)` waits, adding the "release the
  awaited handoff" step at `session-history-replayer.service.spec.ts:536-544`, the
  rename to "delivers once after tab A fails and the surviving tab finishes") are
  the minimum rewrite needed to keep the same fence/exactly-once assertions valid
  now that `release()` awaits its handoff; no assertion was weakened, only the
  scheduling needed to reach it changed.
- The e2e perf spec (`tile-open-longtask-budget.perf.spec.ts`, 592 lines) is the
  one artifact in this batch that intentionally spans core (`canvasSessionRequests`),
  canvas (`OrchestraCanvasComponent`), and chat (session replay) — it lives in
  `ptah-electron-e2e`, which is the correct owner: an e2e app is the one place in
  this monorepo permitted to assert cross-lib, cross-process timing behavior none
  of the three libs can observe alone (none of `core`/`canvas`/`chat` may depend on
  each other beyond what they already do, and a lib spec cannot drive a full
  Electron renderer). No change needed; this is the pre-existing correct placement,
  not new to this round.
- File sizes: `app-state.service.ts` is 817 lines (was 801 before this batch — this
  batch added 16 net lines, not a new breach). It was already over the 700-line
  soft ceiling before Batch 3 and stays there; this round did not make it worse and
  the ceiling is warn-level, not a gate — flagged for awareness, not a finding
  against this batch. `session-history-replayer.service.ts` (440), `orchestra-canvas.component.ts`
  (457), `macrotask-scheduler.ts` (79), `session-history-replayer.admission.spec.ts`
  (444) are all comfortably under 700.
- Comment accuracy elsewhere: `session-history-replayer.service.ts:13-19` (Admission
  doc bullet) and `chat/CLAUDE.md:75` describe the same mechanism in matching detail
  (global FIFO slot, fast path returns no Promise, release-in-`finally`, one
  macrotask + one paint yield, failed hand-off rejects the releasing replay while
  still admitting the next waiter) — I traced both against the actual code
  (`acquireReplayAdmission`/`releaseReplayAdmission`/`handoffReplayAdmission`/
  `yieldToPaint`) and found no divergence.
- Consistency across the three libs: naming (`_canvasSessionRequests` /
  `canvasSessionRequests` / `takeCanvasSessionRequests` in core,
  `replayAdmissionActive`/`replayAdmissionQueue`/`acquireReplayAdmission`/
  `releaseReplayAdmission`/`handoffReplayAdmission` in chat) each read as a FIFO
  admission primitive in the vocabulary already used in their own file, and neither
  lane touched the other's files this round (confirmed disjoint via `git diff --stat`
  across the two areas).

## Pattern compliance (delta only)

| Rule / convention | Status | Evidence |
| --- | --- | --- |
| `catch (error: unknown)` narrowing | PASS | `orchestra-canvas.component.ts` new catch block; `session-history-replayer.service.ts` handoff catch unchanged |
| Old single-slot API fully deleted (product/spec code) | PASS | repo-wide grep, this session, zero hits |
| Perf-harness prose accurate post-C3 (batches.md AC6) | PARTIAL | Fixed in the perf spec header; `perf-page-capture.ts:174-176` still stale (new minor above) |
| No dead/unreachable branches introduced | PARTIAL | `handoffReplayAdmission`'s `if (!next)` branch is unreachable given the current sole caller (new minor above) |
| File-size soft ceiling (700 lines) | PASS (no new breach) | `app-state.service.ts` 817 lines, pre-existing (801 before this batch) |
| CLAUDE.md sibling-bullet voice/placement | PASS | `chat/CLAUDE.md:75` matches Claims/Chunks/Fence/Yield bullets |

## Verdict

- Recommendation: **APPROVED**, with two residual minors carried forward (not
  blocking, not serious): the still-stale `perf-page-capture.ts:174-176` comment,
  and the unreachable `if (!next)` branch in `handoffReplayAdmission`. Both prior
  serious findings (the misleading perf-harness comment in the scoped evidence
  file, and the orphan-timeout false-negative) are verified closed with passing,
  targeted new tests (`app-state.service.spec.ts:681`,
  `session-history-replayer.admission.spec.ts:357-378`). All three prior style
  minors are closed.
- Confidence: HIGH — every claim above is backed by a direct `git diff` read of
  the current worktree state, not the codex report's self-description alone.
- Key concern: none blocking; the two residual minors are cheap to fold into a
  future touch of either file and do not affect runtime behavior.
