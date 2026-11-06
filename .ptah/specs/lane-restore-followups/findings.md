# Lane restore follow-ups

## Follow-up 1

The 24-hour cap is anchored to the interrupted lane's persisted spawn time `startedAt` (`agent-process-manager.service.ts:702,1730`), passed as `hostRestartLaneStartedAt` (`lane-resume-gate.ts:72-73`). Restore stamps `completedAt` at restore time (`agent-process-manager.service.ts:1733`), so that value would underestimate a long outage and reset after another restore. The gate chooses fresh when the lane started more than 24 hours ago, with a distinct reason (`lane-resume-gate.ts:303-309`). Missing or non-finite timestamps choose fresh; future timestamps clamp to age zero (`:118-123`). The context-size check remains first and ordinary lanes retain the 600-second idle rule (`:293-320`). A lane spawned more than 24 hours before the crash also goes fresh, even when a recent `continue` turn ran (`continue` bumps only `turnSeq`, not `startedAt`); this conservative choice is acceptable because the manager creates a handoff task (`agent-process-manager.service.ts:729-749`). Gate and manager specs cover the boundary, invalid inputs, and real restore of old and recent running refs.

## Follow-up 2

Electron initializes `@sentry/node` through `SentryService.initialize` (`apps/ptah-electron/src/activation/bootstrap.ts:455-470`) during `await bootstrapElectron` (`apps/ptah-electron/src/main.ts:242`). The post-boot guard is installed later at the renderer-loaded `onGoal` (`main.ts:180-185`), so Sentry's listener is registered first when a DSN exists. Its default integrations include uncaught exceptions and unhandled rejections (`node_modules/@sentry/node-core/build/cjs/light/sdk.js:24-38`). The uncaught integration captures only the first exception per process (`integrations/onuncaughtexception.js:26,48-52`); therefore the guard captures every post-boot uncaught exception through `SentryService` (`main-process-error-guard.ts:55-61`). Sentry core drops the first duplicate for the same Error instance using `checkOrSetAlreadyCaught` (`node_modules/@sentry/core/build/cjs/client.js:139-143`, `utils/misc.js:103-115`). The guard preserves that instance (`main-process-error-guard.ts:47`). Sentry's rejection integration captures every rejection (`integrations/onunhandledrejection.js:60`), so the guard only logs rejections. The guard handles missing Sentry registration by logging only (`main-process-error-guard.ts:26-32`), and handles capture failures through `reportBootFailure` without throwing (`:56-60`). With no DSN, Sentry initialization is skipped (`bootstrap.ts:455-457`) while the guard still logs. The guard's listener prevents the native modal and fatal exit after boot; Sentry's `exitEvenIfOtherHandlersAreRegistered` defaults to false (`integrations/onuncaughtexception.js:11,39-47`). Boot-trace behavior during boot is unchanged.

## Follow-up 3

`restoreAgents` logs once per accepted running reference marked `host-restart`, after insertion (`agent-process-manager.service.ts:1757-1764`). The structured fields are `agentId`, `cli`, `startedAt`, and `cliSessionIdPresent`; the session ID value is excluded. A restore spec checks two running refs and one terminal ref.

## Follow-up 4

Design only. `agent-events.ts:473-483` skips bulk output persistence while running. Persisting snapshots would shorten the crash window but amplify writes with each output event, grow disk use, and retain potentially sensitive stdout longer. Recommend a time-throttled tail snapshot, at most once per 30 seconds per lane, with a fixed 64 KiB cap, explicit retention/cleanup and a privacy review before implementation. A crash could still lose up to one interval of text. Current resume keeps CLI-native session context, reducing the need for this change.

## Decisions

- **24-hour restart cap from persisted lane start.** Options: restore `completedAt`, persisted `startedAt`, ordinary 600-second idle. Chose `startedAt` because it survives downtime and TTL cleanup; restore time is reset on each restore (`agent-process-manager.service.ts:702,1730-1733`, `lane-resume-gate.ts:50-54,303-309`). A turn that ran more than 24 hours before the crash goes fresh and receives a handoff task (`agent-process-manager.service.ts:729-749`). Reversible: yes.
- **Capture uncaught exceptions in the guard; leave rejections to Sentry.** Options: guard captures both, neither, or uncaught only. Chose uncaught only because Sentry's uncaught integration captures only the first error (`node_modules/@sentry/node-core/build/cjs/integrations/onuncaughtexception.js:26,48-52`), core deduplicates that first shared Error (`node_modules/@sentry/core/build/cjs/client.js:141`), and Sentry captures every rejection (`node_modules/@sentry/node-core/build/cjs/integrations/onunhandledrejection.js:60`). `apps/ptah-electron/src/main.ts:180-185,242` and `activation/bootstrap.ts:455-470` establish listener order. Reversible: yes.
- **One structured restart log per marked lane.** Options: aggregate, per-lane. Chose per-lane for incident evidence without leaking session IDs; `agent-process-manager.service.ts:1699,1757-1764`. Reversible: yes.
- **Defer output persistence.** Options: persist every event, bounded snapshots, existing terminal-only persistence. Chose terminal-only for now because bounded snapshots need retention and privacy decisions; `agent-events.ts:473-483`. Reversible: yes.

## Changes

Edited `lane-resume-gate.ts` and its spec, `agent-process-manager.service.ts` and its service/restore specs, and `main-process-error-guard.ts` and its spec. No change to `agent-events.ts`. Skill catalogue/loading was unavailable in this lane.

Follow-up 2 correction edited only `main-process-error-guard.ts`, its spec, and this findings file. The guard now captures uncaught exceptions, leaves rejections to Sentry's integration, and installs without a registered Sentry service.

Review correction edited `lane-resume-gate.ts` and its spec, `agent-process-manager.service.ts` and its service spec, plus this findings file. The Electron guard and restart log line were not changed. Prettier formatted these files.

## Review response

1. **Fixed:** cap now uses persisted turn `startedAt`, surviving long outages and repeated restores (`agent-process-manager.service.ts:702`).
2. **Verified:** exact boundary, context precedence, future clamp, ordinary idle rule, and distinct reason remain; the boundary now refers to lane start (`startedAt`) (`lane-resume-gate.ts:118-123,293-320`).
3. **Fixed:** added missing, NaN, future, and unmarked timestamp cases (`lane-resume-gate.spec.ts:159-204`).
4. **Fixed:** replaced the synthetic stopped-ref fixture with old and recent persisted running refs, exercising real `restoreAgents` and a real `LaneResumeGate` (`agent-process-manager.service.spec.ts:1359-1452`).
5. **Verified:** restart logging remains one redacted info entry per marked lane; no change to that line (`agent-process-manager.service.ts:1775-1783`).
6. **Verified:** Electron guard behavior and Sentry integration evidence remain as described under Follow-up 2; the guard was not changed in this correction.
7. **Accepted as nit:** non-Error thrown values can produce a first-event duplicate because the guard wraps them in a new Error. Rare and confined to non-Error throws; outside this correction's scope.
8. **Accepted as nit:** the guard's later uncaught events use error level while Sentry's first event is fatal. Current alerting must not assume every post-boot event is fatal; outside this correction's scope.
9. **Accepted as nit:** Sentry core deduplication is an installed dependency behavior, not a guard unit property; existing guard specs cover the guard's decisions.
10. **Fixed:** added the cap's anchor doc comment and formatted all files changed in this correction with repository Prettier.

## Verify results

- `node_modules/.bin/nx`: present before verification.
- `ptah_get_diagnostics` scoped to three changed sources: unavailable after its 45-second timeout; no result count.
- `npm run verify -- -p @ptah-extension/cli-agent-runtime,ptah-electron`: exit 1 after 518 seconds (including 72 seconds waiting on memory lock). Lint/typecheck: **4 passed, 0 failed**. Test projects: **0 passed, 2 failed**. CLI runtime: **138 suites passed, 1 failed; 2,971 tests passed, 6 failed, 1 skipped**. Electron: **96 suites passed, 2 failed, 1 skipped; 1,673 tests passed, 2 failed, 3 skipped**. The changed specs passed. Failures were in unrelated `mcp-install.service.spec.ts` (6 tests), `phase-2-libraries.config-home.spec.ts` (1), and `worker-host-packaging.spec.ts` (1). Logs: `C:\Users\abdal\.nx\d60e02896ae18ad9\cache\terminalOutputs\13426579778834705277` and `1740797483395118939`.
- Follow-up 2 correction: `npm run verify -- -t test -p ptah-electron -- --testPathPatterns=main-process-error-guard`: exit 0, **8 tasks passed, 0 failed**.
- Scoped `ptah_get_diagnostics` after correction: unavailable after 45-second TypeScript timeout (2 files unchecked).
- Follow-up 2 correction: `npm run verify -- -p ptah-electron`: exit 1. Lint/typecheck: **2 passed, 0 failed**. Test target: **1 failed**; Jest: **96 suites passed, 2 failed, 1 skipped; 1,677 tests passed, 2 failed, 3 skipped**. The changed `main-process-error-guard.spec.ts` passed. The two failures are the previously known unrelated `phase-2-libraries.config-home.spec.ts` (1 test) and `worker-host-packaging.spec.ts` (1 test). Log: `C:\Users\abdal\.nx\d60e02896ae18ad9\cache\terminalOutputs\3466280556542926196`.
- Review correction: `npm run verify -- -t test -p @ptah-extension/cli-agent-runtime -- --testPathPatterns=lane-resume-gate --testPathPatterns=agent-process-manager`: exit 0, **1 task passed, 0 failed**.
- Review correction: `npm run verify -- -p @ptah-extension/cli-agent-runtime`: exit 1. Lint/typecheck: **2 passed, 0 failed**. Test target: **1 failed**; Jest: **138 suites passed, 1 failed; 2,976 tests passed, 6 failed, 1 skipped**. All changed specs passed. The six failures are the previously known unrelated `mcp-install.service.spec.ts` cases. Log: `C:\Users\abdal\.nx\d60e02896ae18ad9\cache\terminalOutputs\16838283260627768285`.
- Review correction: scoped `ptah_get_diagnostics` on four changed TypeScript files was unavailable after its 45-second timeout (4 unchecked). The project typecheck above passed.

## Open questions

- The first-exception-only behavior is addressed by guard capture of every post-boot uncaught exception. No open question remains for follow-up 2.

## Re-review (round 1) response

Reviewer (Claude subagent; OpenCode and Antigravity lanes were at their usage limits) re-review: **APPROVED 7/10**.

- **R1 (should-fix, non-blocking): `startedAt` is the lane spawn time, not the turn start.** Fixed in wording by the coordinator: the gate field is now `hostRestartLaneStartedAt`, and the doc comments (`lane-resume-gate.ts:50-53,72-73`), the fresh reason string and the spec names say "lane started". Behavior is unchanged and conservative: a lane spawned more than 24 h before the crash goes fresh with a handoff task even if its last `continue` turn was recent. A per-turn start time in the persisted ref would remove this, but it changes the shared persisted type; left as an open question.
- **R2 (nit): a non-Error uncaught value is wrapped in a new `Error` (`main-process-error-guard.ts:48`), so Sentry core cannot dedupe it against its own first-error capture.** Accepted: a thrown non-Error is rare, and the only cost is one extra Sentry event for the first such throw in a process.

## Open questions (added after re-review)

- Persist a per-turn start time (for example `turnStartedAt`) in the lane reference, so the 24 h cap measures from the interrupted turn and not from the lane spawn?
