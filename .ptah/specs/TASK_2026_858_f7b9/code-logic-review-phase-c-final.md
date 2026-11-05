# Code Logic Review (final) — TASK_2026_858_f7b9 Phase C

Review family: claude (implementer: codex)
Diff: `446c5f38b..8cdb176b7`. Static review, no tests run (orchestrator verify results taken as stated).

| Metric | Value |
| --- | --- |
| Score | 7/10 |
| Verdict | REVISE (one Serious regression, small fix) |
| New defects | 1 Serious, 2 Minor |

## Per-finding judgement

| # | Finding | Status | Evidence |
| --- | --- | --- | --- |
| F1 | Stale `admissionFailures` / old lock leak on rebind | FIXED | Failures are stored only while `activeAdmissions` holds the tab (`session-driver-lock-coordinator.ts` `failRecord`, `beginRecordAdmission`/`endRecordAdmission`; `removed()` clears them when no admission is active). `chat:start` brackets with begin/end in `try/finally` (`chat-session.service.ts` ~1268). `rebound` drops the old id in `finally` regardless of the new bind result, so `heldByRecord` can no longer orphan it. |
| F2 | `acquire` returned ok for releasing/stranded entry | FIXED | `kernel-session-driver-lock.ts` `acquire`: `own.state !== 'held'` now returns `unavailable: 'release in progress'`. The control endpoint check was doubled (`control-endpoint.ts` release branch calls `hasLiveRecord` twice in a row); this adds nothing but is harmless. The remaining window needs an entry held with no coordinator owner, which only exists while stranded or releasing, and that is now refused. |
| F3 | Windows name used `USERDOMAIN` | FIXED | `endpoint-names.ts` and `control-keys.ts` now hash `username.normalize('NFKC').toLowerCase()`. Comment corrected. |
| F4 | Provisional ownership outlives attempt | PARTLY FIXED — introduces N1 | try/finally added around continue, resume activation and rewind (`chat-session.service.ts` ~1928, ~2159, ~2359). See N1. |
| F5 | Sync throw in `close()` leaked lease | FIXED | `codex-chat-session-controls.ts:109-125`: all sync steps are now inside the `safe('close')` promise, with the lease released in the innermost `finally`. |
| F6 | Fire-and-forget rejections | FIXED | `.catch`/`then(…, onError)` with `logger.error` on `removed`, `bound` and the handoff (`coordinator` constructor). `bound` also logs before `failRecord`. |
| F7 | macOS silent null lock | FIXED | `create-session-driver-lock.ts` logs once (`console.warn`) and is used by the Electron and CLI registrations. |
| Note 4 | Cross-process flakiness | FIXED (not run) | `spawn-driver-lock-holder.ts`: `TS_NODE_TRANSPILE_ONLY=1`, isolated temp `HOME` removed on exit, 30 s timeout, SIGKILL. Cross-process specs also use SIGKILL (`kernel…cross-process.spec.ts:38,83`). |

## New defects

### N1 (Serious) `abandonDrive` in `finally` releases the lock before the SDK record binds
- Files: `chat-session.service.ts` ~1928 (`chat:continue`), ~2159 (`chat:resume` with activate), ~2359 (auto-resume); coordinator `abandonDrive` / `releaseEmpty`.
- The Claude record's `realSessionId` is bound on the SDK `init` message (`session-registry.service.ts` `register`, `bindRealSessionId` via `sdk-agent-adapter.ts:1774`), after `resumeSession` has returned the stream. The `finally` runs when the RPC returns, which can be before `init`. At that point the only owner is `provisional`, so `releaseEmpty` frees the kernel name while the SDK process is live.
- Impact: a window in which another process can take the lock and drive the same session. Our later `bound` then fails and aborts the record, but only after the SDK was resumed and may have sent a message. The previous round kept the provisional until `bound` consumed it; this round removed that protection on the success path.
- Fix: abandon only on failure (keep it in `catch`, drop the unconditional `finally`), or in `finally` abandon only when `!lifecycle.find(tabId)` and no native lease exists. A cheap alternative is a short-lived provisional that `removed(tabId)` and `bound` clear, as before. Add a test that resumes with a pending `init`, completes the RPC, then asserts `lock.held()` still contains the session.
- Note the `catch` in `chat:continue` and the `finally` now both call `abandonDrive` (redundant).

### N2 (Minor) Required injection with a dummy default
- `chat-session.service.ts` constructor: `driverLock: ChatSessionDriverLock = undefined!` hides a missing registration behind a non-null assertion. A missing coordinator now fails at the first call with a `TypeError` instead of the coded `SESSION_DRIVER_LOCK_UNAVAILABLE`. Resolve the token strictly (drop the default) or keep the coded guard.

### N3 (Minor) Duplicate `hasLiveRecord` check
- `control-endpoint.ts` release branch calls it twice with no state change in between. Either remove one or place the second call after the awaited step it was meant to guard.

## Verdict
REVISE, 7/10. F1, F2, F3, F5, F6, F7 and note 4 are fixed. F4's fix regresses the success path (N1). Once N1 is fixed with a test, this is APPROVED.
