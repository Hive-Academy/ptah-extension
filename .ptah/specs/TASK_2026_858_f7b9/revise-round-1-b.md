# Revise round 1 — part B (findings 3 and 4)

Scope: `libs/backend/worker-runtime/src/lib/session-driver.ts` (+ spec),
`libs/backend/worker-host/src/lib/commands/remote-sessions.ts` (+ new spec).

## Finding 3 (High): shutdown released the lock of a turn whose abort was refused

- `session-driver.ts:163` new `running(sessionId)`: true for a registered turn
  or any admission (admitting, or orphan whose abort was refused) carrying that
  session ID. A refused `chat:abort` already left the turn in `turns` / the
  orphan in `admissions`, so this reflects "the engine turn may still run".
- `session-driver.ts:~195-206` `terminal()`: a terminal engine event for an
  orphan with a known session (its abort was refused) now frees its slot and
  calls `onAbandoned` (which releases its lock). Before, the event was ignored
  and the orphan held its slot forever. This is the "engine confirms
  termination" path for orphans; registered turns already ended via `end()`.
- `remote-sessions.ts:~528-545` `releaseLocks()`: skips every held lock whose
  session `driver.running(...)`, and logs
  `kept the driver lock of N turn(s) that may still run`. The decision is made
  at release time, not from a drain snapshot, so a turn that ended between
  drain and release (terminal event) does get its lock released.
- A kept lock is never handed to another driver while this process lives. The
  platform lock is `kernel-session-driver-lock.ts`, so it goes away with the
  process. At that point the in-process engine turn is gone too.

## Finding 4 (Moderate): held tab-only permissions lost after a start timeout

- `session-driver.ts:150` new `awaitingSession(tabId)`: true while any
  admission on the tab has no session ID. That includes a timed-out start kept
  as an orphan for a late `session:id-resolved`.
- `remote-sessions.ts:389` `session.start` `finally`: deletes the held requests
  only when `!driver.awaitingSession(tabId)`. A timed-out start keeps them.
- `remote-sessions.ts:464` tap: holds tab-only `permission:request` while
  `awaitingSession(tabId)`, which now includes the orphan. A request that
  arrives after the timeout is held too.
- The existing `session:id-resolved` branch (tap) binds the held requests to
  the late session ID and deletes them, so `permission.respond` works.

## Specs

- `session-driver.spec.ts:344` drain with refused abort returns
  `failedAborts: ['s1']`; `running('s1')` stays true until `terminal('s1')`.
- `session-driver.spec.ts:356` timed-out start: `awaitingSession` true; late
  resolve with a refused abort keeps the orphan `running`; drain reports it; a
  terminal event frees it and calls `onAbandoned`.
- New `libs/backend/worker-host/src/lib/commands/remote-sessions.spec.ts`
  (unit, fakes for engine RPC, logs, lock):
  - refused abort at shutdown: `releaseLocks()` keeps the lock (no
    `lock.release` / `requestRelease`) and logs it. After
    `session:turnEnded` it releases `('s1','nonce-s1')`.
  - start times out (`resolveTimeoutMs: 20`) with a held tab-only request; a
    late `session:id-resolved` binds it; `permission.respond` returns
    `{applied: true}` and calls `handleResponse`.

## Verification

- `npx ts-node --transpile-only tools/degradation-audit/check-degradation.ts` → exit 0.
- `npm run verify -- -p @ptah-extension/worker-runtime,@ptah-extension/worker-host -t test -- --testPathPatterns='session-driver|remote-sessions|serve-sessions'`
  → see result below.

## Remaining limits

- A start that never reports a session (`unresolvedTabs`) cannot be aborted.
  Its lock is keyed by a session this worker never learned, so `releaseLocks()`
  still releases it. The existing serve-sessions spec "shuts down promptly with
  a start still waiting for its session and releases its lock" asserts that
  release.
- Held requests of an orphan that never resolves stay in memory until the
  process exits. They are bounded at 100 per tab, and the active-turn limit
  bounds the number of orphans.
- A late-resolved orphan is aborted on resolution (existing behaviour), so the
  bound permission matters only until `permission:session-cleanup` clears it.
