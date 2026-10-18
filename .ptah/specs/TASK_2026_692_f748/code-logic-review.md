# Code Logic Review (re-review) - `TASK_2026_692_f748` Phase 1

Review family: Claude (reviewer); implementer family: codex (CLI lanes).

## First review summary

First review (`70478faf7^..daeefb6ec`, score 6/10, NEEDS_REVISION, 0 blocking, 3 serious, 6 moderate): the
reducer/service split was sound, but one exception in `scan`/`runEffects`/config read killed a session's
pipeline silently (F1), signals under a pre-rekey alias were ignored by the reducer (F2), and the `sending` and
`boundary` phases had no deadline so a lost feedback signal could wedge the claim and the fire key (F3, F4).
F5 to F9 were moderate items (claim release after rebind, stale notice, manual reservation cap, phase regression,
minor input range).

## Scope of this re-review

`git diff daeefb6ec..e931d243c` (batches 8F, 8G, 8H). Read in full: `idle-compaction.service.ts`,
`idle-compaction.helpers.ts`, `idle-session.reducer.ts`, `compaction-config-provider.ts` idle path.
Check run once: `npx jest -c libs/backend/agent-sdk/jest.config.ts .../compaction/idle --coverage=false
--maxWorkers=2 --detectOpenHandles` = 6 suites, 78 tests pass. No other runs.

## Summary

| Metric              | Value          |
| ------------------- | -------------- |
| Overall score       | 7/10           |
| Assessment          | NEEDS_REVISION |
| Blocking issues     | 0              |
| Serious issues      | 1 (new, N1)    |
| Moderate issues     | 2 (N2, N3)     |
| Failure modes found | 3              |

## Status of F1 to F4

| Finding | Status | Evidence |
| ------- | ------ | -------- |
| F1 containment | FIXED | `scan` wraps the reducer and settings read in try/catch and returns the previous state plus a `signal-failed` log effect (`idle-compaction.service.ts:145-163`). `runEffects` catches per effect (`:253-282`). `enqueue` catches per signal (`:~375-395`). One bad signal now drops one signal, not the group. |
| F1 config provider throw on read | FIXED | Defaults validated once in the constructor (`compaction-config-provider.ts`, diff hunk at `@@ -102`), fields `idleEnabledDefault` and `idleMinTokensDefault` are used on read. `getIdleCompactionConfig` has no throw path left; invalid persisted values warn once and fall back. |
| F2 alias normalisation | FIXED | `resolveIdleSignal` rewrites `signal.sessionId` to `currentIds.get(key)` before delivery (`idle-compaction.helpers.ts:~50-60`). For `rekey` it sets `currentIds` to `toId` first, so the reducer's `signal.sessionId === state.sessionId` guard passes and the `rekey` case (`idle-session.reducer.ts:405`) updates `state.sessionId`. Spec at `idle-compaction.service.spec.ts:405` covers old-alias activity, turns and notices. |
| F3 `sending` deadline | FIXED in the reducer, but see N1 | `attempt-due` sets `deadlineAt = now + IDLE_CLAIM_TIMEOUT_MS` (`reducer:~327`), `timerFor` emits a `deadline` spec for in-flight phases (`:34-44`), the service arms it on the injected scheduler (`service.ts:183-211`), and `deadline-elapsed` releases the claim and closes (`reducer:371-403`, `send-timeout`). The claim no longer wedges. The send pipeline itself still can. |
| F4 `boundary` deadline | FIXED | `compact-boundary` keeps `deadlineAt`/`dwellAt` from `precompact` (`reducer:~263`), `timerFor` uses `dwellAt` for `boundary` (`:40-42`), `turn-ended` shortens it for `boundary-ended` (`:150-160`), and `deadline-elapsed` handles both phases with `dwell-timeout` and `postcompact-timeout`. |

## Carried items from 8G

### 1. `group-failed` warn in `finalize` (`service.ts:235`)

Misleading, but low impact (Minor). `lastSignalFailed` is reset by every successful non-release signal
(`:151-152`) and never by `session-released`, so the sequence "signal fails, then normal release" logs
`group-failed` on a group that did not fail. The same signal already logged `signal-failed`, so no information
is lost and nothing is hidden, but an operator searching for `group-failed` gets a false positive that reads as a
dead pipeline. The case the flag is meant for (a throwing reducer on the release signal itself) is the only
legitimate one. Fix: set a separate flag only when the failing signal is `session-released`, or log
`group-failed` only from `catchError`. Not a reason to hold the batch.

### 2. Logger throwing twice (outer `catchError -> EMPTY`)

Not fully acceptable as described, because the real blast radius is wider than one session (Moderate, N2).
`runEffects`' catch calls `this.warn`, which calls the logger (`service.ts:279-281, 295`). If the logger throws
again, the error leaves the `tap`, reaches `catchError`, whose handler calls `this.warn` again
(`:229-232`) and throws, so the error propagates through `mergeMap` to the outer subscribe error handler, which
calls `this.warn('pipeline-failed')` (`:99`) and throws a third time. A throw inside a subscriber error callback is
rethrown by rxjs on a timer as an uncaught exception, and the outer stream is already terminated, so every
session loses idle compaction until restart. A logger that throws persistently is a contract violation and the
code path is then broken anyway, so I would not block on it, but the fix is one line: make `warn` and the
`runEffects` log call swallow logger errors (`try { ... } catch { /* logger must not break the pipeline */ }`).
The spec should cover a logger that throws once in `runEffects` and once in `catchError`.

## Jest "worker failed to exit gracefully"

Not from idle code. The idle run finished cleanly: 6 suites, 78 tests, no open-handle report from
`--detectOpenHandles`, no worker warning in the tail. Idle timers go through the injected scheduler in specs and
`createUnrefScheduler` in production. The only warning seen was Node's cosmetic ESM message about loading
`jest.config.ts`, unrelated. Caveat: `--detectOpenHandles` runs in band, so a worker-exit warning could not appear
in this mode; the evidence is the absence of open handles, not a worker run. The warning most likely comes from a
suite outside `compaction/idle` in the wider compaction run, which I was told not to run.

## New findings

### N1 (Serious) - A hung sender still wedges the fire pipeline after the deadline

- File: `idle-compaction.service.ts:219-226` (`exhaustMap`), `:~340-345` (`defer(() => from(sender.sendIdleCompact(...)))`
  with no timeout or cancellation).
- Scenario: `sendIdleCompact` never settles. At 120 s the reducer fires `send-timeout`, releases the claim and
  closes the attempt (F3 fixed at state level). The `exhaustMap` inner observable is still subscribed. On the next
  turn, a new `attempt-due` produces a `fire` effect that `exhaustMap` silently drops, the attempt sits in
  `sending` until its own 120 s deadline, logs `send-timeout` again, and repeats. Idle compaction for that
  session is dead until the group is released.
- Second effect: if the hung send later resolves after having passed `beforeEnqueue`, the claim was already
  released by the deadline, so the compaction can be enqueued without a claim and the manual `/compact` path can
  run concurrently. `fire-sent` is ignored because the attempt id no longer matches.
- Fix: make the inner cancellable by the deadline, for example `takeUntil` a per-attempt subject that `runEffects`
  or the deadline path completes, or use `switchMap` for fires keyed to the attempt, and have the late-resolve path
  re-check `isLive()` and the attempt id. Add a spec: sender never resolves, advance 120 s, start a second turn,
  assert the second fire reaches the sender.
- Dependency note: the real sender is a Phase 2 item, so this is latent today but is exactly the failure F3
  described.

### N2 (Moderate) - Logger failure ends the whole service (see carried item 2)

`service.ts:99, 229-232, 279-281, 295`.

### N3 (Moderate) - `rekey` collision still returns null with no log

`idle-compaction.helpers.ts:~55` (`existing !== key` returns null). Carried from the first review, not
addressed. The rekey is dropped silently and later signals under `toId` never reach this group. Log a
`rekey-collision` warn.

## Five logic questions

1. Silent failure: collision rekey (N3); a hung sender after the deadline (N1). The per-signal containment
   now logs `signal-failed` instead of dying.
2. Unexpected user action: manual `/compact` while the claim is held is still coalesced; the claim is now
   bounded by the deadlines, except in N1's late-resolve case.
3. Wrong answer from input: unchanged, `minTokens` above the table maximum is accepted (Minor, previous review).
4. Dependency failure: config reads cannot throw; coordinator lookups map to `lookup-failed`; a hanging sender is
   N1; a throwing logger is N2.
5. Missing: a cancellation path for an in-flight send; a spec for a throwing logger.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Reducer throws on one signal | YES | `scan` catch returns previous state | `group-failed` false positive at release (carried item 1) |
| Effect throws | YES | per-effect catch | logger throw escapes (N2) |
| Signal under old id after rekey | YES | `resolveIdleSignal` normalises | none |
| Lost `fire-sent` feedback | YES | `sending` and `enqueued` deadlines | N1 for a never-settling sender |
| Compact boundary never followed by post-compact | YES | `dwellAt` deadline | none |
| Settings default missing | YES | constructor validation | fails at DI construction, as intended |

## Verdict

- Recommendation: REVISE (small)
- Confidence: MEDIUM-HIGH. N1 and the logger chain are derived from rxjs semantics and the code, not from a
  failing test.
- Top risk: the send pipeline is not cancelled by the `send-timeout` deadline, so one hung send permanently stops
  idle compaction for that session.
- Robust implementation would add: cancellation tied to the attempt deadline, a logger-safe `warn`, a
  `rekey-collision` log, and specs for each.

Decisions: none needed. F1 to F4 are confirmed fixed at the state-machine level; N1 is reported rather than
treated as a regression of F3 because the claim and attempt do release.

## Batch 8I re-review

Review family: Claude (Sonnet 5.5) reviewing codex implementation. Scope: uncommitted diff of
`libs/backend/agent-sdk/src/lib/helpers/compaction/idle/` read against the full service file and
`idle-session.reducer.ts:408-414`. No tests, typecheck or lint run by me; the codex report's tails are not
independently verified.

| Finding | Verdict | Evidence |
| ------- | ------- | -------- |
| N1 hung send wedges `exhaustMap` | FIXED | `idle-compaction.service.ts:219-237`: each `fire()` inner is piped through `takeUntil(steps$.pipe(filter(state is not in-flight/sending for this attemptId)))`. `steps$` is `share()`d (`:181`) and always has subscribers, so the notifier is a plain Subject subscription; a subscriber added during the emitting step does not receive that step, so the inner is not cancelled by its own triggering step. When `deadline-elapsed` (or release, which sets `attempt: null` at reducer `:410`, or `fire-sent`/`fire-skipped`) moves the attempt out of `sending`, the notifier fires, the inner is unsubscribed, and `exhaustMap` accepts the next fire. |
| N1 late resolve enqueues or claims | FIXED | `beforeEnqueue` (`:~330-358`) throws `IdleSendVetoedError` unless `isLive()`, the alias exists, and `state().attempt` is `in-flight`/`sending` with the same `attemptId`, before `claimIdle`. After the deadline the attempt is closed or a different id, so it vetoes. The late rejection is harmless: the inner was unsubscribed, and rxjs ignores `error` on a stopped subscriber, so no unhandled rejection and no stray `fire-skipped` is enqueued (it would be attempt-id guarded anyway). |
| N2 throwing logger | FIXED for all logger calls in the idle folder | `safeWarn` (`idle-compaction.helpers.ts:9-20`) wraps `logger.warn` in try/catch. Every former `this.warn` call site now uses it (`service.ts:101, 241, 247, 293, 430, 433`). The one direct logger call, `this.logger[effect.level]` in `runEffects` (`:272`), is inside the per-effect try whose catch uses `safeWarn`. No logger call remains that can throw into `scan`, `catchError`, `finalize` or the outer subscriber. |
| N3 silent rekey collision | FIXED | `enqueue` (`:424-431`) warns `rekey-collision` with source and destination ids only when `resolveIdleSignal` returned null for a `rekey` whose both ids are registered under different keys. No false positive for unknown sessions (`aliases.has(sessionId)` guard). |
| 8G item 1 false `group-failed` | FIXED | `releaseSignalFailed` is assigned only in the reducer catch and is true only when the failing signal is `session-released` (`:148`); `finalize` warns on that flag only (`:246-247`). `catchError` still warns for real pipeline errors. |

### Specs

- N1: `idle-compaction.service.spec.ts:379-407` holds the first send forever, passes its deadline, starts a later
  turn and asserts the sender is called a second time and a claim is held. This fails without `takeUntil`
  (the second fire would be dropped by `exhaustMap`), so it exercises the fix. `:480-499` resumes a send after the
  deadline and asserts no enqueue, no claim, no notice. It exercises the veto only, which is the intended scope.
- N2: coalesce spec `:444-463` makes `warn` always throw, fails one session's signal, then asserts another session
  still fires. Exercises the `runEffects` and `enqueue` catch paths. It does not drive the `catchError` or
  outer-subscriber paths, but they now share the same `safeWarn`.
- N3: coalesce spec `:467-479` asserts the exact payload.
- Coalesce spec edit to existing tests: the diff changes only the expected `reason` in the failed-signal test
  from `group-failed` to `signal-failed` and adds a `not.toHaveBeenCalledWith(... group-failed)`. Nothing else in
  existing tests changed. Correct and consistent with 8G item 1.

### New defects introduced

None Blocking or Serious. Minor and residual:

- Minor: no spec covers the remaining legitimate `group-failed` case (reducer throwing on `session-released`).
  Note in that case the reducer's catch returns the previous state, so an in-flight `sending` attempt would
  keep the `takeUntil` unsatisfied; `groupBy` still closes the group but a hung send would keep `finalize` from
  running (leaked claim and aliases). Only reachable if the reducer throws on release; low likelihood.
- Minor: a send that called `beforeEnqueue` successfully (claim taken) and then hangs inside the sender past the
  deadline can still enqueue its message after the reducer released the claim. This is a Phase 2 sender contract
  matter (the sender must re-check or hold the claim); not introduced by 8I.
- Minor (style, route to style reviewer): removal of the blank line before `private fire` at `service.ts:~296`.

### Verdict

- Recommendation: APPROVE
- Assessment: APPROVED (0 Blocking, 0 Serious, 0 new Moderate; 2 Minor residuals above)
- Confidence: MEDIUM-HIGH. Derived from reading the code and rxjs semantics; test execution is the team-leader's.
