# Code Logic Review - lane-restore-followups

Review family: claude subagent (reviewer) vs codex (implementer)

Verdict: REVISE
Score: 6/10

Scope: full read of `lane-resume-gate.ts` (evaluate/decide), the touched parts of `agent-process-manager.service.ts` (`gateResume` 660-700, `restoreAgents` 1690-1775), the whole of `main-process-error-guard.ts`, the four specs' diffs, and the installed Sentry sources. Ran `npm run verify -- -t test -p @ptah-extension/cli-agent-runtime -- --testPathPatterns=lane-resume-gate --testPathPatterns=agent-process-manager`: 1 task succeeded. I did not re-run the Electron guard spec; the implementer reports it passing.

## Findings

1. **should-fix (near-blocking): the 24 h cap is anchored to restore time, not interruption time, so it does not stop the stale-resume case it was added for.**
   - `restoreAgents` stamps an interrupted ref with `completedAt: new Date().toISOString()` (`agent-process-manager.service.ts:1713-1714`).
   - `gateResume` then feeds that value to the gate as `hostRestartInterruptedAt` (`:692`).
   - A lane that crashed, with the host down for 3 days, is restored "now". Its age is about 0, so it resumes. The cap only fires if the same in-memory record survives more than 24 h in a long-lived Electron process.
   - After TTL cleanup removes the record, the next restore stamps `now` again, which resets the clock (`restoreAgents` skips ids already in `this.agents`, line 1696).
   - The persisted ref carries no interruption time, only `startedAt`. A real bound needs an anchor that survives the restart. Options: the persisted last-activity or last-output time, or `startedAt`, as a fallback.
   - If restore time is deliberately accepted, the findings and the constant doc must say the cap is "time since restore", not "time since crash".
   - The existing 24 h behaviour is otherwise implemented correctly (items 2 and 3).

2. **OK, verified: gate semantics.**
   - Boundary: the check is `> 24h` (`lane-resume-gate.ts:271`), so exactly 24 h resumes and 24 h + 1 ms goes fresh. The updated resume specs sit exactly on the boundary (`lane-resume-gate.spec.ts:111,125`) and would fail on a `>=` regression.
   - Missing or non-finite timestamp: age is `Infinity`, so the gate chooses fresh (`:113-117`). A future timestamp is clamped to 0 and resumes. The clamp is acceptable, but a clock-skewed future stamp bypasses the cap.
   - The context-size rule is still checked first (`:262-269`). The 600 s idle rule is unchanged for unmarked lanes (`:278`). Lanes without the marker get `interruptionAgeMs === null` and are unaffected. The reason string is distinct.

3. **should-fix: the missing/invalid-timestamp and future-timestamp branches have no test.**
   - The new gate spec covers only the `cap + 1` fresh case (`lane-resume-gate.spec.ts:139-147`).
   - The `undefined`/`NaN` to fresh branch could be deleted with no failure.
   - Add the following cases: `interruptedByHostRestart: true` with no timestamp, a `NaN` timestamp, a future timestamp, and `hostRestartInterruptedAt` supplied without the marker (must be ignored).

4. **should-fix: the manager spec uses a fixture the real restore path never produces.**
   - The new test (`agent-process-manager.service.spec.ts` ~1327-1346) restores a ref that is already `stopped` with `stopReason: 'host-restart'` and an old `completedAt`.
   - In production, restore turns a `running` ref into that state with `completedAt = now`. The test therefore hides finding 1.
   - It also mocks `resumeGate.evaluate` and only asserts argument threading. Add a case that restores a `running` ref and asserts the threaded timestamp is about now, which documents or pins the chosen anchor.

5. **OK, verified: restart log.**
   - `restoreAgents` logs exactly one `info` line per ref marked `host-restart`, after the record is inserted and before `scheduleCleanup` (`:1757-1764`).
   - Fields are `agentId`, `cli`, `startedAt`, `cliSessionIdPresent` (boolean only). It goes through the injected logger.
   - The restore spec uses two running refs (one without a session id) and one completed ref, and asserts exact payloads (`restore.spec.ts` ~193-205). It would fail if the log were removed or leaked the id.
   - The `continue` for known ids (`:1696`) skips the log, which is the correct dedupe.

6. **OK, verified: guard rationale against installed Sentry.**
   - `@sentry/node/build/cjs/sdk/index.js:41-42` includes both uncaught and unhandled-rejection integrations by default.
   - The uncaught handler captures only while `!caughtFirstError` (`onuncaughtexception.js:48-52`) and exits only if no other listener is present. `exitEvenIfOtherHandlersAreRegistered` defaults to false. The guard's own listener counts as a user listener, so Sentry will not exit after boot.
   - The rejection handler captures every rejection (`onunhandledrejection.js` `sendUnhandledPromise`) and does not exit in the default mode. The guard capturing only uncaught exceptions is therefore right.
   - `client.js:139-143` drops a repeat capture of the same Error instance. The guard preserves the instance, so the first-error duplicate is dropped.
   - `SentryService.initialize` runs in `bootstrap.ts:455-470`, inside `await bootstrapElectron` (`main.ts:242`). The guard is installed later, in `onGoal` (`main.ts:180-185`), so Sentry's listener is registered first. Without a DSN, `SentryService.captureException` is a no-op (`sentry.service.ts:82`) and logging still happens.
   - The guard installs without `SENTRY_SERVICE` (`main-process-error-guard.ts:20-33`, null sentry).
   - A throwing `captureException` is caught and sent to `reportBootFailure` (`:55-61`). A throwing logger is also caught. There is no exit and no modal after boot.

7. **nit: the first-error duplicate is not deduped for non-Error throws.**
   - `report` wraps a non-Error value in a fresh `new Error(String(value))` (`main-process-error-guard.ts:48`).
   - For a thrown string or object, Sentry's listener captured the original value, and the guard then captures a different object, so one event is sent twice.
   - This is rare and low impact. Mention it or skip the guard capture when the value is not an `Error`.

8. **nit: the Sentry events from the guard are `error` level while the first one is `fatal`.** This is harmless but inconsistent. Do not rely on `fatal` in alerting for post-boot errors.

9. **nit: guard spec coverage.**
   - It pins both the capture of uncaught exceptions and the no-capture of rejections (`main-process-error-guard.spec.ts` new tests), the no-Sentry install, the no-Logger install, and the capture-throw path.
   - It does not pin that dedupe works. That is not a unit-testable property here, so this is fine.

10. **nit: rules compliance.**
    - No `any`, `@ts-ignore`, `as unknown as`, or `console.*` was found in the diff.
    - The intentional swallowing catches carry `// degradation-audit: reported - ...` (`main-process-error-guard.ts:36, 59`).
    - `RESUME_GATE_MAX_HOST_RESTART_AGE_MS` (`lane-resume-gate.ts:50`) has no doc comment, unlike its neighbours.
    - Several new lines exceed the Prettier width, and the new specs are densely formatted. Run Prettier on the touched files.

## Summary of risk

The only substantive problem is finding 1: the cap measures a value that is reset on every restore, so it guards the long-running-process case but not the long-downtime case. That makes the feature largely cosmetic for its stated purpose. The error-guard and logging changes are sound against the installed Sentry sources, and the gate arithmetic is correct. Fix finding 1, or document the restore-time semantics explicitly, and add the tests in findings 3 and 4. After that this is APPROVED.

## Re-review (round 1)

Verdict: APPROVED
Score: 7/10 (was 6/10)

Method: Prettier-normalized the HEAD versions of `agent-process-manager.service.ts` and `lane-resume-gate.ts` and diffed them against the working files. The remaining differences are the intended changes only: the gate field and its doc comment, `decide`'s age parameter, the `hostRestartTurnStartedAt` threading at `agent-process-manager.service.ts:699-704`, and the restart log at `:1778-1788`. The reformat of unrelated lines (regex constants, event emits, `.catch` chains) changed no logic. Ran `npm run verify -- -t test -p @ptah-extension/cli-agent-runtime -- --testPathPatterns=lane-resume-gate --testPathPatterns=agent-process-manager`: 1 task succeeded (one cache hit), exit code 0.

Previous findings:

- Finding 1 (cap anchored to restore time): partly resolved. The anchor is now the persisted `startedAt` (`:702`), which survives restarts and is not reset on re-restore. A host that was down for days now goes fresh. See R1 below for what `startedAt` actually is.
- Finding 3 (missing tests): resolved. `lane-resume-gate.spec.ts` now covers a missing timestamp, NaN, a future timestamp (clamped, resumes), the exact 24 h boundary (resume), 24 h + 1 ms (fresh), and a timestamp supplied without the marker (ignored).
- Finding 4 (spec fixture): resolved. `agent-process-manager.service.spec.ts` restores a `running` ref with an old `startedAt` (fresh) and a recent one (resume), both through the real `LaneResumeGate` and the real restore path.
- Finding 10 (formatting and doc comment): resolved. Prettier was applied and the constant has a doc comment.

Remaining findings:

R1. **should-fix, non-blocking: the anchor is the lane's spawn time, not the interrupted turn's start.**
- `continue` reuses the same record and only bumps `turnSeq`: `tracked.info = { ...tracked.info, turnSeq: ..., status: 'running', ... }` (`agent-process-manager.service.ts:~2523-2534`). `startedAt` is assigned only at spawn (`:898, :1160`).
- The persisted `CliSessionReference` carries only `startedAt`/`completedAt` (`libs/shared/src/lib/types/agent-process.types.ts:711-713`), and a running ref has no `completedAt`.
- So a lane first spawned more than 24 h ago, continued recently, and killed mid-turn goes fresh with a handoff. Its CLI session context is lost although it was active minutes before the crash.
- The doc comment (`lane-resume-gate.ts:50-51`) and the field comment (`:72-73`) say "interrupted turn started", and the spec names say "turn". Both are inaccurate.
- Either (a) reword the comments, spec names and findings to "lane started more than 24 h ago", and record the multi-day-lane trade-off as a known limitation, or (b) persist a per-turn start time on the reference (shared-types change) and anchor on it. Option (a) is acceptable for this PR.

R2. **nit, carried from round 0:** a non-Error uncaught value is wrapped in a fresh `Error` (`main-process-error-guard.ts:48`), so the first-error Sentry dedupe does not apply to it. The Sentry-side behaviour is unchanged by this round.

Interplay with the idle rule: no conflict. For a marked lane the idle rule is bypassed and only the context-size rule and the 24 h cap apply (`lane-resume-gate.ts` `decide`). An unmarked lane keeps `lastActivityAt` and the 600 s rule. The only effect of the `startedAt` anchor is R1.
