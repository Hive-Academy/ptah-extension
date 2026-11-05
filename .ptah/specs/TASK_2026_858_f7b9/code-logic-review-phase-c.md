# Code Logic Review — TASK_2026_858_f7b9, Phase C (Batches 8–13)

Review family: claude (implementer: codex)

## Summary

| Metric | Value |
| --- | --- |
| Overall score | 6/10 |
| Assessment | NEEDS_REVISION (REVISE) |
| Blocking issues | 0 |
| Serious issues | 3 |
| Moderate issues | 4 |
| Failure modes found | 7 |

Scope read in full: `session-driver-lock/*` (kernel lock, control endpoint, control keys, local client, endpoint names, null lock), `session-driver-lock.interface.ts`, `spawn-driver-lock-holder.ts`, `session-driver-lock-coordinator.ts`, the lock call sites in `chat-session.service.ts`, the registry notification diff, the codex adapter open/close/dispose paths, both `registration.ts` bindings and the Electron driver gate. I did not run the test suites. The ts-node load failure in note 4 is analysed from the code only.

## Findings

### F1 (Serious) Stale `admissionFailures` refuses a later healthy start and can leak the old lock on rebind
- File: `libs/backend/rpc-handlers/src/lib/chat/session/session-driver-lock-coordinator.ts:28, 265-266, 253, 228, 274-278`
- Scenario: `failRecord` stores the refusal in `admissionFailures` keyed by `tabId`. Only `assertRecordAdmission` (called only from the `chat:start` path, `chat-session.service.ts:1241`) deletes it. `removed()` clears `failures` (`:253`) but not `admissionFailures`.
- Resume and rebind failures never reach that call. A bound-time lock loss on resume or on a session id rebind leaves the entry behind.
- Impact 1: the next `chat:start` on the same tab throws the old `SESSION_DRIVEN_ELSEWHERE` at `:276` before checking anything, even though the new session holds its lock.
- Impact 2: `rebound` returns early at `:228` whenever the tab has a stale entry. Even a successful rebind then skips `dropRecord(token, old)`. `heldByRecord` now points to the new id, so `removed()` never finds the old id. The old kernel lock stays held until process exit, and the operator release is refused because the live-record check sees a record.
- Fix: key by token, or delete the tab's entry in `removed()` and at the start of `launchSdkSession`. Decide the rebind skip from the `bound` result (return a boolean), not from tab-scoped shared state.

### F2 (Serious) `acquire` returns `ok` for an entry that is releasing or stranded, and the operator release races it
- File: `libs/backend/platform-core/src/session-driver-lock/kernel-session-driver-lock.ts:66-67`, `control-endpoint.ts:100-105`
- Scenario: the control `release` passes the live-record check, then enters `closeEntry`, which sets `state = 'releasing'` and awaits `server.close`. During that time the coordinator's `ensure` (`beginDrive`, `admitNative`) calls `lock.acquire`. `retryStranded` skips `releasing` entries, and `acquire` returns `{ ok: true, nonce: own.nonce }` for the dying entry. The server then closes.
- Impact: the coordinator believes it holds the session while the kernel name is free. A second process can bind it, and two processes drive one session (the exact thing this feature prevents).
- The same applies to a `stranded` entry that fails to close again: the caller gets `ok` for a name in an uncertain state.
- Fix: when `own.state !== 'held'`, await `own.closing` and re-bind, or return `{ ok: false, unavailable: 'release in progress' }`. In `respond`, re-check `hasLiveRecord` immediately before `release` (the nonce is captured before the `await`).

### F3 (Serious) Windows endpoint name depends on the `USERDOMAIN` environment variable
- File: `endpoint-names.ts:5-11`, `control-keys.ts:60-65`
- Scenario: the name is a 32-bit FNV hash of `${process.env.USERDOMAIN}\${username}`. The code comments call this "SID-derived", which it is not.
- Impact: two processes of the same user can compute different names. Examples are a service or scheduled-task worker versus an interactive Electron app, or an environment without `USERDOMAIN`. They would then bind different pipes and both succeed: exclusion silently lost, the worst failure for this feature.
- Fix: do not use env data in the name. Use `os.userInfo().username` lowercased, or the real SID (`whoami /user` or a `SECURITY_IDENTIFIER` lookup, cached). Fix the comment. Add a unit test with `USERDOMAIN` unset versus set that expects the same name.

### F4 (Moderate) Provisional ownership can outlive its drive attempt
- File: `session-driver-lock-coordinator.ts:131-136, 247-254`, `chat-session.service.ts:1699, 2051, 2332`
- `provisional` is cleared only by `abandonDrive` on a handled error branch, by `bound`/`admitNative`, or by `removed(tabId)`. A `beginDrive` followed by a path that returns without a record and without an error (for example a stream that is never created, or an early `return` added later) leaves the lock held. `hasLiveRecord` counts `provisional`, so the operator cannot release it either.
- Fix: wrap each `beginDrive` in a try/finally helper, or give `provisional` an expiry (for example 30 s) that the live-record check ignores.

### F5 (Moderate) A synchronous throw in `close()` leaks the native lease
- File: `codex-chat-session-controls.ts:105-123`
- The lease is released only inside `session.closing`. If `sink.endTurn`, `abort()` or `sink.dispose()` throws before `session.closing` is assigned, the session is already out of `sessions` (`:104`) and the lease is never released. The coordinator then keeps `natives` forever.
- Fix: put the pre-`closing` section in try/catch, or release the lease in an outer finally. Lease release is idempotent in the coordinator, so a double release is safe.

### F6 (Moderate) Fire-and-forget coordinator handlers can reject unobserved
- File: `session-driver-lock-coordinator.ts:44, 47-48, 256-271`
- `void this.removed(...)` and `void this.bound(...)` have no `.catch`. `failRecord` runs inside `bound`'s catch, so an error from `endSessionIfTokenMatches` becomes an unhandled rejection, which is fatal under strict Node settings. `removed` has the same exposure through `lock.release`.
- Fix: add `.catch(log)` to each, and fall back to aborting the record.

### F7 (Moderate) macOS uses `NullSessionDriverLock` with no signal
- File: `platform-electron/src/registration.ts`, `null-session-driver-lock.ts`
- This matches the plan (workers are unsupported on macOS), but Electron-on-macOS now has an `ISessionDriverLock` that always says `ok`. Nothing is logged or shown. Log once at startup (`driver lock: macOS, no cross-process exclusion`) so a future remote-worker feature does not assume exclusion there.

### Minor
- Mass formatting churn in `codex-chat-adapter.ts`, `chat-session.service.ts` and the codex specs hides the logic change (about 5,700 added lines). Route to code-style review.
- `spawnDriverLockHolder().stop()` is a no-op, and the child releases before exit. The helper is a contender, not a holder, so its name misleads.
- `kernel-session-driver-lock.cross-process.spec.ts` and `control-endpoint.cross-process.spec.ts` do not isolate `HOME`, so they write key files into the real `~/.ptah/session-drivers`. A SIGTERM'd child never runs its `exit` handler, so it leaves a stale `<pid>.key`. The client removes stale keys lazily, so this is only pollution.
- Local multi-user: the Linux abstract names are not access-controlled. Another user who knows the uid and session id can squat a session name (DoS, fail-closed). The control key never leaves the owner's `0600` file, so release stays authenticated.

## Answers to the orchestrator's notes

1. **`useValue` binding.** Accepted. The constructor only stores the check and registers `process.on('exit')` (`kernel-session-driver-lock.ts:32-38`). No socket, file or key is created until the first `acquire` (`bind`, `:87-93`). Cost in every process is one listener. Leak risk: one `exit` listener per instance that is never disposed; this matters only in tests that build many (MaxListeners warning above 10). If the control endpoint cannot start (read-only home, no abstract namespace), every acquire returns `unavailable`. That is deliberate fail-closed behaviour and is surfaced as `SESSION_DRIVER_LOCK_UNAVAILABLE`.
2. **Windows name from domain and username, no SID.** Not acceptable as written (F3). The hash itself is fine, but the `USERDOMAIN` input can differ between processes of the same user. Use the username only, or a real SID.
3. **Live-record check.** Correct and race-free for the case you named. Before the coordinator exists, the default `true` refuses release, but nothing can hold a lock before the coordinator exists, because only the coordinator acquires. Fail-closed is the right direction. Two caveats: the check counts `provisional` (F4), and there is a check-then-release gap in `respond` (F2).
4. **Cross-process spec flakiness.** Cause: each child runs `-r ts-node/register`, which type-checks the whole import graph per spawn, against a hard 5 s timer (`spawn-driver-lock-holder.ts`, both cross-process specs). Concrete fix, in order:
   - spawn with `TS_NODE_TRANSPILE_ONLY=1` (or `-r ts-node/register/transpile-only`) so a child starts in about 300 ms, and give the helper a shared 30 s timeout constant;
   - raise the Jest per-test timeout from 15 s to 60 s;
   - set `HOME` to a temp dir for the child in every cross-process spec;
   - kill children with `SIGKILL` after `SIGCONT` and await `exit` in a `finally`.
   The READY handshake already used in the kernel spec is the right pattern; copy it into the other helpers.
5. **Fail-closed and serialization.**
   - Unavailable lock means no SDK call: yes. `beginDrive` runs before `resumeSession` (`chat-session.service.ts:1699, 2051, 2332`), and `assertDriveHeld` runs at `:2608`. A new Claude session binds its lock after the SDK starts, which is acceptable because the id is new. A `ensure` failure aborts the record via `failRecord`.
   - Native Codex: resume admits before `openContext`; start admits after the thread id is known and before the sink, and the first turn runs only after admission. Rejection rethrows the typed `RpcUserError` untouched (`codex-chat-adapter.ts:440`), which the start and continue catches map to a coded result.
   - Rebind acquires the new lock before dropping the old one (`rebound`, `:225-229`), except for the F1 skip.
   - Exactly-once lease release: the coordinator's `released` flag makes it idempotent. The adapter releases on an open failure (`:451-453`) and in `close()`, which is the only deletion path, but not on a synchronous throw (F5).
   - Release on every removal path: registry notifications cover `remove`, `removeIfTokenMatches` and the replace-on-register case. The leak routes are F1 and F4.
   - Per-session serialization: the `serial()` chain is correct and has no nested use of the same chain (checked `assertRecordAdmission`, `failRecord`, `removed`). The exception is the kernel lock's own `releasing` state (F2).

## Failure modes
- Stale tab failure poisons a later start and skips old-lock cleanup (F1).
- Acquire returns `ok` on a closing entry, silently losing exclusion (F2).
- Environment-dependent Windows name, silently non-exclusive (F3).
- Provisional ownership never cleared, unreleasable by the operator (F4).
- Native lease leaked on a synchronous close error (F5).
- Unobserved rejection from coordinator handlers (F6).
- No cross-process exclusion on macOS, unannounced (F7).

## Data flow
1. RPC (`chat:continue`, `chat:resume`, auto-resume): `beginDrive` then `ensure` then `lock.acquire`. OK, fail-closed, coded error.
2. SDK start or resume: `assertDriveHeld` pre-check. OK (resume); new sessions lock after the fact, acceptable.
3. Registry `bound` and `rebound` notifications create records and handoff. Gap: F1.
4. Native Codex: `admitNative` returns a lease; the adapter publishes it with the session. Gap: F5.
5. Removal: `removed`, `dropRecord`, `releaseEmpty`, `lock.release`. Gap: F4, F6.
6. Operator release: key-authenticated control, live-record check, `closeEntry`. Gap: F2.

## Requirements fulfilment

| Requirement | Status | Gap |
| --- | --- | --- |
| Kernel lock, one per session, refuse and show the holder | COMPLETE | F2 on the releasing state |
| Windows and Linux endpoints | PARTIAL | F3 |
| Registry lifecycle notifications | COMPLETE | |
| Coordinator and per-session serialization | PARTIAL | F1, F4, F6 |
| Native Codex gated (AD-25) | PARTIAL | F5 |
| macOS null lock | COMPLETE | F7 (visibility) |
| Cross-process tests | PARTIAL | Flaky under load (note 4) |

## Edge cases

| Case | Handled | How | Concern |
| --- | --- | --- | --- |
| Holder paused (SIGSTOP) | YES | 500 ms query timeout gives an unknown holder | none |
| Holder killed | YES | kernel frees the name | stale key file, cleaned lazily |
| Release while releasing | PARTIAL | `closing` promise | F2 |
| Lock service throws | YES | caught and refused | none |
| Windows env differences | NO | | F3 |

## Verdict
- Recommendation: REVISE
- Confidence: MEDIUM-HIGH (static analysis; tests not run)
- Top risk: silent loss of exclusion through F3 and F2, which is the one outcome the feature exists to prevent.
- A robust implementation would add: env-independent Windows naming, a state check in `acquire`, token-keyed admission failures, try/finally around every `beginDrive`, and `.catch` on every fire-and-forget handler. It would also use transpile-only children with isolated `HOME` in the cross-process specs.
