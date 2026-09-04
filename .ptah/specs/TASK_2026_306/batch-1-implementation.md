# Batch 1 — Implementation Report

**Task**: 1.1 — Make cold-start catchup fire-and-forget, matching the resume path
**Defect**: A (S1 — boot blocker)
**Branch**: `ak/boot-blocker-quota-gate`
**Status**: Implemented, verified, not committed (team-leader commits).

---

## What changed

### 1. `libs/backend/cron-scheduler/src/lib/cron-scheduler.ts` — the fix

The `await` inside the `try/catch` at the old `:97-103` is gone. The `try/catch`
was removed entirely rather than left wrapping a now-synchronous call; the
rejection handler moved onto the promise:

```ts
void this.catchup
  .replayMissed(options, () => DEFAULT_CATCHUP_POLICY)
  .catch((err: unknown) => {
    this.logger.error('[cron-scheduler] cold-start catchup failed', {
      err: err instanceof Error ? err.message : String(err),
    });
  });
```

This is the shape of the resume path at `catchup-coordinator.ts:61-67`. No new
policy was invented.

Two deliberate details:

- **Log message kept distinguishable.** `cold-start catchup failed` here vs
  `catchup on resume failed` in the coordinator. A reader of the log can tell
  which of the two catchup entry points failed.
- **Narrowing, not casting.** The sibling at `catchup-coordinator.ts:64` uses
  `(err as Error).message`, and so did the code being replaced. The new handler
  uses `err instanceof Error ? err.message : String(err)` instead, per the repo
  standard in `CLAUDE.md` ("narrow with `instanceof Error` before `.message`")
  which the batch brief restated explicitly. This is the one intentional
  divergence from a verbatim copy of the sibling, and it is strictly safer — a
  non-`Error` rejection now logs its value instead of `undefined`. There is a
  spec case pinning that branch. The resume path was **not** touched.

Everything after the call site is unchanged and in the same order —
`jobs.list({enabledOnly: true})`, `armTimer` per enabled job, `catchup.attach`,
`started = true`, the `[cron-scheduler] started` info log. All of it now runs
immediately instead of behind the drain.

`start()` remains `async` returning `Promise<void>`; the signature its caller
(`start-thoth-cron.ts:282`) awaits is unchanged. It now resolves immediately.
No `require-await` rule is configured (checked `eslint.config.mjs`), and lint
passes.

### 2. The ordering comment rewrite (`:78-101`)

The old comment claimed step 2 was "Run cold-start catchup BEFORE arming new
timers so missed slots from the previous boot don't race the next-fire
scheduling." That is exactly the guarantee the fix drops, so leaving it would
have left a comment the code contradicts.

The rewritten docblock does two things:

1. **States what the code now does and why** — step 2 starts catchup without
   awaiting, and names the concrete failure it prevents, including the full call
   chain (`main.ts` -> `wireRuntime` -> `bootHeavyServices` -> `startThothCron`
   -> `start`) so the next reader does not have to re-derive it from a log.
   Step 3 is annotated that timer arming now happens while catchup is in flight.

2. **Acknowledges the race it just accepted, and argues it is safe** rather than
   pretending it does not exist. Two grounds, both verified in-repo, not asserted:
   - The resume path has been fire-and-forget since it shipped
     (`CatchupCoordinator.attach`, `catchup-coordinator.ts:61`), so this race is
     already live in production on the wake path.
   - `job_runs` carries `UNIQUE(job_id, scheduled_for)` (schema authority:
     `persistence-sqlite/.../0004_cron.sql`, restated at `types.ts:9`), so
     whichever side reaches a slot first claims it and the other is a silent
     no-op. The `CatchupCoordinator` header at `:20-24` already documents this
     as the at-most-once mechanism. The database, not the call order, is the
     arbiter — which is why the old comment's ordering guarantee was never the
     thing actually providing correctness.

### 3. `libs/backend/cron-scheduler/src/lib/cron-scheduler.spec.ts` — new file

`start()` had no spec at all. 14 new cases across 4 describes.

`./croner-loader` is mocked so no real OS timers are created; the fake `Cron`
records its constructions, which is the "were timers armed?" signal. Fakes and
the `makeLogger()` shape follow `job.store.spec.ts`; `import 'reflect-metadata'`
per the existing convention.

**The four required proofs:**

| #   | Requirement                                                     | Cases                                                                                                                                                                                                                                                                                                                                                          |
| --- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `start()` resolves without waiting on a slow `replayMissed`     | `resolves without waiting for a slow replayMissed` — the fake returns a deferred that is never settled; `start()` is raced against a real 50ms timer and must win. Also asserts the replay really was in flight, so the test cannot pass vacuously                                                                                                             |
| 2   | Timers armed regardless of catchup being in flight              | `arms timers for enabled jobs while catchup is still in flight` — two jobs, replay unsettled; asserts `setMaxConcurrent`, `jobs.list({enabledOnly:true})`, both `Cron` constructions with the right expr + timezone, `catchup.attach`, and the `started` log with `armed: 2`                                                                                   |
| 3   | A rejecting `replayMissed` is logged, no unhandled rejection    | `logs a rejecting replayMissed and does not raise an unhandled rejection` — installs a real `process.on('unhandledRejection')` listener and asserts it stays empty, plus the exact error log, plus that the scheduler still came up. Two siblings: a non-`Error` rejection is stringified; a rejection arriving _after_ `stop()` still logs and does not throw |
| 4   | `start()` idempotent, `stop()` safe against an in-flight replay | `is idempotent: a second start does not replay or re-arm`; `stops every armed timer and detaches while catchup is still running` (asserts every fake timer stopped, `detach` once, and that a replay resolving post-shutdown logs nothing); `is idempotent and is a no-op before start`; `allows a fresh start after stop, replaying catchup again`            |

Plus two supporting cases: the disabled-by-settings path starts no catchup and
no timers but still latches `started`, and the logged `catchupWindowMs` is
clamped to the 24h ceiling.

---

## Mutation check — the spec was verified to actually test the fix

The spec was run against the **pre-fix** code by temporarily restoring the
`await` + `try/catch`:

```
● CronScheduler.start — cold-start catchup is fire-and-forget › resolves without waiting for a slow replayMissed
● CronScheduler.start — cold-start catchup is fire-and-forget › arms timers for enabled jobs while catchup is still in flight
● CronScheduler.start — cold-start catchup is fire-and-forget › clamps the logged catchup window to the 24h ceiling
● CronScheduler.start — replay rejection handling › logs a rejecting replayMissed and does not raise an unhandled rejection
● CronScheduler.start — replay rejection handling › stringifies a non-Error rejection instead of reading .message off it
● CronScheduler.start — replay rejection handling › logs the rejection even after stop() has already run
● CronScheduler.start — idempotency and the disabled path › is idempotent: a second start does not replay or re-arm
● CronScheduler.stop — safe against an in-flight replay › stops every armed timer and detaches while catchup is still running
● CronScheduler.stop — safe against an in-flight replay › is idempotent and is a no-op before start
● CronScheduler.stop — safe against an in-flight replay › allows a fresh start after stop, replaying catchup again
Tests: 10 failed, 28 passed, 38 total
```

10 of the 14 new cases fail without the fix. The fix was then restored and the
file confirmed byte-correct. This is not a spec that would pass either way.

---

## Verification

| Command                                       | Result                                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------- |
| `npx nx test cron-scheduler --skip-nx-cache`  | **PASS** — Test Suites: 4 passed, 4 total; Tests: 38 passed, 38 total             |
| `npx nx build cron-scheduler --skip-nx-cache` | **PASS** — target `build` for `@ptah-extension/cron-scheduler` and 8 dependencies |
| `npx nx build ptah-electron`                  | **PASS** — target `build` for `ptah-electron` and 8 dependencies                  |
| `npx nx lint cron-scheduler --skip-nx-cache`  | **PASS** — All files pass linting                                                 |

Before this change the lib had 3 spec files / 24 tests. It now has 4 / 38. The
three pre-existing suites (`job.store`, `run.store`, `power-monitor.interface`)
are untouched and still pass.

---

## Scope discipline

- **`wire-runtime.ts:373` was NOT touched.** Whether the remaining local I/O in
  `bootHeavyServices` should also move behind the window is deferred as a
  separate judgement with its own risk, per the brief and `research-report.md`
  §A's own "Consider as a follow-up".
- **The resume path was NOT touched.** `catchup-coordinator.ts` has zero
  changes — `git diff --stat` shows one source file modified.
- Files changed: `cron-scheduler.ts` (+23/-9). Files added:
  `cron-scheduler.spec.ts`.

---

## For the reviewer

- The `catch` is attached to the promise (`:113`), not a leftover `try/catch`.
- `started = true` still set (`:125`); `stop()` still guards on `if (!this.started) return`
  and is covered by three spec cases including the in-flight-replay case.
- The one divergence from a verbatim copy of the sibling is the `instanceof Error`
  narrowing, argued above and pinned by a spec case.
- Acceptance criteria that need a real boot to confirm (`[Ptah Electron] Cron
scheduler started` / `Subsystems brought up` appearing, `[IpcBridge] Cannot send
to renderer` no longer firing at boot) are unit-unverifiable here; the unit
  proof is that `start()` resolves with `replayMissed` still pending, which is the
  precise link that was broken in the captured run.
