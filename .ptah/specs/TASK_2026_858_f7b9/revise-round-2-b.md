# Revise round 2, part B: tab-only orphan lock and slot

This fixes Codex round 1, defect 2. A start whose `chat:start` succeeded but whose
`session:id-resolved` never arrived became an orphan with no session ID. At shutdown
its lock was released, and no terminal event could free it.

## Changes

### `libs/backend/worker-runtime/src/lib/session-driver.ts`

- `:43-48`: new option `onUnresolvedEnded()`. The driver calls it after the engine
  ends a started turn whose session ID it never learned. The driver cannot name that
  lock, so the caller decides which lock to release.
- `:161-170`: new `unresolvedStarts()` counts admissions with no session ID. These are
  starts that are still admitting plus tab-only orphans. While the count is above zero,
  an engine turn may be running under a lock keyed by a session this worker does not
  know.
- `:216-230` `terminal()`: an orphan now matches in three ways:
  - by its known session;
  - by its tab, when the event carries no session ID;
  - by its tab alone, when the orphan has no session ID.

  The orphan is deleted first, so it is freed exactly once. Then the driver calls
  `onAbandoned(orphan.sessionId ?? event.sessionId)` when a session ID is known, and
  `onUnresolvedEnded()` otherwise. A second terminal event (for example `turnEnded`
  followed by `chat:sessionEnded`) finds nothing and does nothing.
- `:338-352` `start()` catch: if a terminal event for the tab arrived while the start
  waited for its session (`admission.ended`), the turn has already ended. The admission
  is deleted and `onUnresolvedEnded()` is called. It does not become an orphan that
  holds its slot forever.
- `:517-520` `retire()`: after `chat:abort` returns, `onAbandoned` is skipped if a
  terminal event freed the orphan during the abort. Before this fix, a late resolve
  racing a terminal event could release the lock twice.
- `:526-529` `sessionOf()`: rejects at once while closing. Without this, a
  `chat:start` that returned after `drain()` began made drain wait the full
  `resolveTimeoutMs` (30 s). The start becomes a tab-only orphan, so its lock is kept.

### `libs/backend/worker-host/src/lib/commands/remote-sessions.ts`

- `:197-198`: wires `onUnresolvedEnded` to `releaseUnattributed()`.
- `:200-207` `attributable(sessionId)`: true when `tabsBySession` has the session, that
  is, when this worker started it (open callback) or continued it.
- `:208-224` `releaseUnattributed()`: runs only when `unresolvedStarts() === 0`. It
  releases held locks that are not `refresh` purpose, not attributable and not
  `running`, through the existing `releaseLock` (gated request, then a direct
  release).
- `:555-582` `releaseLocks()`: while `unresolvedStarts() > 0`, it keeps every held lock
  that is neither running nor attributable, and logs
  `kept N driver lock(s) that may belong to M start(s) that never reported a session`.
  The existing logic for locks of turns that may still run is unchanged. Known idle
  sessions are still released.

## Decision: how the orphan's lock is identified

- **Evidence.** `session-driver-lock-coordinator.ts` `bound()` acquires a new
  session's lock when the lifecycle record binds its real session ID. That is the
  event that also produces `session:id-resolved`. So a tab-only orphan's lock is held
  under a session ID the worker never received.
- **Chosen: option (a), conservative.** While any start is unresolved, keep every held
  lock this worker cannot attribute to a session it started or continued. A lock this
  worker knows to be idle is still released. Keeping too many costs little: the locks
  are kernel locks (`kernel-session-driver-lock.ts`) and die with the process, as does
  the in-process engine turn. Releasing one wrongly would let another driver take a
  session whose turn still runs.
- **Mid-run release on a tab-only terminal event.**
  - If the event carries a session ID, the driver uses it: `onAbandoned(id)`, the
    precise release.
  - If it carries only the tab, `releaseUnattributed()` frees the unattributable drive
    locks, but only once no other start is unresolved. At that point no running turn
    can own them. `refresh` locks (short transcript reads) are never touched mid-run.
  - If another start is still unresolved, the lock stays until a later terminal event
    or shutdown. This trades a precise release for never releasing a lock whose turn
    may still run.
- **Rejected: option (b), learn the session from any event that carries both tab and
  session.** Before resolution, engine events can carry a placeholder or tab-scoped
  session ID. Calling `tabResolved` from them could abort the wrong session or bind
  held permissions to it. Only a terminal event's session ID is used, and only to
  release, which cannot hurt: releasing a placeholder session that has no lock does
  nothing.
- **Reversible:** yes. All of this lives in two files and needs no contract change.

## Tests

- `session-driver.spec.ts`:
  - `:382`: start times out, so the orphan keeps its slot (`WORKER_BUSY` at max 1).
    Two tab-only terminal events lead to `onUnresolvedEnded` exactly once, no
    `chat:abort`, and a new start is admitted.
  - `:417`: a terminal event carrying both tab and session calls `onAbandoned('s1')`
    once.
  - `:436`: a terminal event during the wait frees the start at once.
  - `:454`: a late `session:id-resolved` still aborts the orphan. A terminal event that
    races the abort gives a single `onAbandoned`.
  - `:479`: drain does not wait out the resolve timeout when `chat:start` returns after
    drain began.
  - The round 1 tests (timed-out `awaitingSession`, refused abort) are unchanged and
    pass.
- `remote-sessions.spec.ts`:
  - `setup` now takes `overrides`.
  - `:189` (case 1): start times out, then `drain` and `releaseLocks`. The lock is kept
    (no `release`, no `requestRelease`) and logged.
  - `:215` (case 2, at `maxActiveTurns: 1`): the second start gets `WORKER_BUSY`.
    `session:turnEnded` and then `chat:sessionEnded` with tab only give one
    `requestRelease` and one `release('s-new','nonce-new')`. The next start is
    admitted.
  - Case 3 (late resolve) is covered by the existing round 1 test `:146` (held
    permission bound on a late resolve), which still passes.
- `serve-sessions.spec.ts:760`: the expectation **changed**. The renamed case is
  "shuts down promptly with a start still waiting for its session and keeps the lock
  its engine turn may still hold". In it, `chat:start` has returned, so the engine turn
  started and the fake engine bound `sess-new-1`. Drain rejects the waiter, which leaves
  a tab-only orphan whose turn may still run. The test now asserts that `release` is
  not called for `sess-new-1`, that the lock stays in `held()`, and that shutdown still
  takes under 10 s.
  - A start cancelled before its engine turn started cannot reach a waiter. The waiter
    is created only after `chat:start` returns, so there is no waiter-cancel case in
    which the old "releases" expectation would be correct.

## Verification

- `npm run verify -- -p @ptah-extension/worker-runtime,@ptah-extension/worker-host`
  exit 0: lint, test and typecheck, 6/6 tasks succeeded. The first run executed. I
  re-ran it once because my output filter had hidden the summary, and that run was a
  cache hit. A cached replay of the test target with `--output-style=static` shows:
  - worker-runtime: 26 suites, 141 tests passed;
  - worker-host: 7 suites, 48 tests passed, including serve-sessions and serve.
- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts`: exit 0
  (218 unsuppressed, at or below baseline).
- Prettier on all five changed files: no changes.

## Remaining limits

- Attribution uses `tabsBySession`, which is never pruned. A session this worker drove
  long ago still counts as attributable. Its lock is released at shutdown even if
  another start is unresolved. This is correct, because the unresolved start's lock is
  a fresh session this worker never learned.
- An orphan whose start registered its turn but whose `chat:abort` was refused, and
  which had already received a terminal event (`admission.ended`), is still kept as an
  orphan until the next terminal event (`register` catch). This path is unchanged.
- Held tab-only permission requests of an orphan freed by a tab-only terminal event
  stay in `heldPermissions` until the process exits. They are bounded at 100 per tab.
- If the engine never emits a terminal event for a tab-only orphan, its slot is held
  until restart. This is by design: the turn may still run.
