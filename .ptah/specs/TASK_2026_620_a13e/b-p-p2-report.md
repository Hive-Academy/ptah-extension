# B-P sub-batch P2 — Skills backend pause gates (libs/backend/skill-synthesis)

TASK_2026_620 B-P, P2 per `pause-switches-plan.md` §4 ("P2 — Skills backend"), rows S1–S17
of §1b, semantics of §3.1/§3.4/§3.6 and the §5 skill-synthesis test row. Not committed (per
instructions). `skillSynthesis.enabled` is THE skills switch: pause stops all new skills
background work; the read side (promoted skills, S15) and invocation telemetry (S5) stay on;
resume needs no restart, including a host that BOOTED paused.

## Files changed (absolute paths)

Production (6):

- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\libs\backend\skill-synthesis\src\lib\skill-synthesis.service.ts` — `ensureStarted()` deferred start (+ concurrency-safe `performStart`/`startRun`), `skillSynthesis.enabled` config listener, `restartCurator()`, `curatorStartOptions()`, `ensureCuratorRunning()`, lazy start from `enqueueAnalyze`/`analyzeSession`.
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\libs\backend\skill-synthesis\src\lib\skill-curator.service.ts` — settings supplier (`options.readSettings`), live-read gated tick, master gate at `start()`, clear-before-arm, `isScheduled()`.
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\libs\backend\skill-synthesis\src\lib\triggers\skill-trigger.service.ts` — boot-scan owed/armed + `'stalled'` callback + `maybeRearmBootScan()` (event + lazy), config listener, `fireHarvest` gate.
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\libs\backend\skill-synthesis\src\lib\triggers\skill-trigger-config.ts` — `SKILL_TRIGGER_KEYS.enabled`/`SKILL_TRIGGER_DEFAULTS.enabled` (the master key, not a per-trigger toggle).
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\libs\backend\skill-synthesis\src\lib\queue\skill-drain.service.ts` — per-item gate-1 re-read, `'paused-mid-run'`, `readMasterEnabled()`, gate-order header updated.
- `D:\projects\ptah-extension\.claude-worktrees\task-620-memory-skills-bench\libs\backend\skill-synthesis\src\lib\queue\stage-handlers.service.ts` — `SkillStageWorkers.ensureStarted()`; prefilter → `unscored` + `retryInMs` when not started.

Specs/test-support (10):

- `D:\...\libs\backend\skill-synthesis\src\lib\skill-synthesis.pause-resume.spec.ts` — NEW (7 tests).
- `D:\...\libs\backend\skill-synthesis\src\lib\queue\skill-drain.gates.spec.ts` — `describe('gate 1 re-read, per item (B-P S6)')` (3 tests).
- `D:\...\libs\backend\skill-synthesis\src\lib\skill-curator.service.spec.ts` — `describe('live settings + pause (B-P S9)')` (5 tests).
- `D:\...\libs\backend\skill-synthesis\src\lib\triggers\skill-trigger.service.spec.ts` — `describe('SkillTriggerService — the skills master switch (B-P)')` (2 tests) + harness exposes `harvester`.
- `D:\...\libs\backend\skill-synthesis\src\lib\triggers\skill-trigger.boot-defer.spec.ts` — `describe('SkillTriggerService — boot scan under the master switch (B-P S3)')` (3 tests) + event-capable workspace mock + `makeTwoSessionsDir()`.
- `D:\...\libs\backend\skill-synthesis\src\lib\skill-synthesis.service.spec.ts` — workspace mock; "analyzeSession() before start" re-pinned to the deferred-start contract (2 tests).
- `D:\...\libs\backend\skill-synthesis\src\lib\skill-synthesis.service.enqueue.spec.ts` — workspace mock only.
- `D:\...\libs\backend\skill-synthesis\src\lib\skill-synthesis.stage-handlers.spec.ts` — workspace mock; the disabled-start test re-pinned to `unscored` (S7).
- `D:\...\libs\backend\skill-synthesis\src\lib\archaeology\regex-demotion.spec.ts` — workspace mock only.
- `D:\...\libs\backend\skill-synthesis\src\lib\queue\skill-drain.test-support.ts` — `makeWorkspace` gains a stand-in `onDidChangeConfiguration`.

## Per inventory row (§1b S1–S17): what gates it now, and where

All paths relative to `libs/backend/skill-synthesis/src/lib/`.

| Row                                                                                      | What gates it now                                                                                                                                                                                                                                                                                                                                | Where (file:line)                                                                                                                                                                                                                           | Pause/resume pin                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **S1** session-end → `enqueueAnalyze`, subscribed only if enabled at boot                | Deferred start: the subscription is created by `performStart()`, reached on resume by `ensureStarted()` from the config listener and lazily from `enqueueAnalyze`                                                                                                                                                                                | `skill-synthesis.service.ts:518` (`ensureStarted`), `:455` (subscription), `:595-614` (listener), `:695` (lazy call)                                                                                                                        | `skill-synthesis.pause-resume.spec.ts`: "booted paused does none of the boot work", "resume by EVENT … subscription …", "resume LAZILY (external edit, no event) …"                                                                                                                 |
| **S2** trigger hooks → `enqueueAnalyze`                                                  | The synthesis entry re-reads the master live and lazily completes the deferred start; `false` no-ops exactly as before                                                                                                                                                                                                                           | `skill-synthesis.service.ts:693-697` (enabled read + lazy start), config keys `triggers/skill-trigger-config.ts:21`                                                                                                                         | `skill-synthesis.pause-resume.spec.ts`: "pause stops nothing … the enqueue side no-ops while paused", "resume LAZILY …"                                                                                                                                                             |
| **S3** boot scan enqueues `source:'boot'`, watermark advanced past never-queued sessions | Arming needs the master (else `bootScanOwed`); the per-session callback returns `'stalled'` and sets owed while paused (`BootScanRunner` keeps the watermark below the stalled session); `maybeRearmBootScan()` from the config event and lazily from `onActivity`; the arm resets when a run completes so an external mid-scan stall can re-arm | `triggers/skill-trigger.service.ts:208-223` (owed + listener + re-arm), `:911-914` (`'stalled'` + owed), `:946-949` (arm reset), `:276` (lazy `onActivity` re-arm), `:988-1016` (`cancelBootScan`/`maybeRearmBootScan`/`readMasterEnabled`) | `triggers/skill-trigger.boot-defer.spec.ts` B-P describe: "boots paused arms nothing; the first resume event re-arms once", "external resume (no event) re-arms on the next activity", "a pause mid-scan stalls, keeps the watermark, and the resume re-queues the skipped session" |
| **S4** spec harvest on turn complete                                                     | `fireHarvest` returns early when the master is off                                                                                                                                                                                                                                                                                               | `triggers/skill-trigger.service.ts:467-472`                                                                                                                                                                                                 | `triggers/skill-trigger.service.spec.ts`: "does not harvest specs while paused, and does once enabled"                                                                                                                                                                              |
| **S5** invocation telemetry — **stays on** [L]                                           | No gate added (deliberate); gated only by its own `skillInvocationTelemetry.enabled` flag as before                                                                                                                                                                                                                                              | `triggers/skill-trigger.service.ts:625+` (`recordInvocation`, untouched)                                                                                                                                                                    | `triggers/skill-trigger.service.spec.ts`: "still records Skill-tool invocation telemetry while paused (S5)"                                                                                                                                                                         |
| **S6** drain ticks (a nightly/weekly tick kept running mid-run)                          | Gate 1 re-read before EVERY item; on false the tick breaks with `summary.reason='paused-mid-run'` (`skipped` stays false), unclaimed rows stay `queued`                                                                                                                                                                                          | `queue/skill-drain.service.ts:844-852` (per-item break), `:226` (`'paused-mid-run'`), `:1295-1303` (`readMasterEnabled`), header `:17-43`                                                                                                   | `queue/skill-drain.gates.spec.ts` B-P S6 describe: "breaks with paused-mid-run, not skipped", "the unclaimed rows drain on the next tick after a resume", negative control                                                                                                          |
| **S7** prefilter marked terminally `skipped` when the analyzer never started             | Prefilter calls `workers.ensureStarted()`; not started → `{outcome:'unscored', reason:'analyzer-not-started', retryInMs:15min}` — the row survives the pause and re-opens after a resume                                                                                                                                                         | `queue/stage-handlers.service.ts:300-306` (+ `:133` port, `:147-148` constants); `skill-synthesis.service.ts:518` supplies it                                                                                                               | `skill-synthesis.stage-handlers.spec.ts`: "registers handlers even when the master switch is off at start" (now asserts `markUnscored` with `analyzer-not-started`, never `markSkipped`)                                                                                            |
| **S8** SKILL.md migration, dirs, embedding-backfill enqueue in `start()`                 | Deferred start: none of it runs while booted-paused; `ensureStarted()` completes all of it once, on resume (event or lazy)                                                                                                                                                                                                                       | `skill-synthesis.service.ts:393-483` (`performStart`), `:483` (backfill row)                                                                                                                                                                | `skill-synthesis.pause-resume.spec.ts`: "booted paused does none of the boot work", "resume by EVENT … backfill row", "two resumes → one …"                                                                                                                                         |
| **S9** curator interval fires while paused with a stale snapshot                         | The tick re-reads LIVE settings through the `options.readSettings` supplier and no-ops while `enabled` or `curatorEnabled` is false; the interval stays armed so resume needs no restart; `start()` clears an existing interval before arming (no double schedule)                                                                               | `skill-curator.service.ts:119` (supplier), `:241-247` (clear-before-arm), `:249-256` (master gate at start), `:273-274` (live tick gate), `:284-292` (`liveSettings`/`isScheduled`)                                                         | `skill-curator.service.spec.ts` B-P S9 describe (5 tests) + `skill-synthesis.pause-resume.spec.ts` "pause stops nothing … the tick no-ops" and "restartCurator() …"                                                                                                                 |
| **S10** curator reconciliation — **preserved** [R], but never while paused               | Still runs once per `curator.start()`; unreachable while the master is off (early return) and on a booted-paused host (deferred start)                                                                                                                                                                                                           | `skill-curator.service.ts:249-256` (gate), reconcile unchanged at `:330` region                                                                                                                                                             | `skill-curator.service.spec.ts`: "start() with the master switch off reconciles nothing"; `skill-synthesis.pause-resume.spec.ts`: booted-paused test asserts the reconcile is not called                                                                                            |
| **S11** backlog cleanup `41 * * * *`                                                     | Already live-gated before B-P; untouched                                                                                                                                                                                                                                                                                                         | `cleanup/skill-backlog-cleanup.service.ts` (unchanged)                                                                                                                                                                                      | existing suites, green in the full run below                                                                                                                                                                                                                                        |
| **S12** manual RPCs run while paused                                                     | P3 owns the RPC refusals (`runCurator`/`analyzeNow`/`enhanceNow`/`previewEnhancement` throw `PAUSED`); P2 supplies the seam P3's `updateSettings` already calls                                                                                                                                                                                  | `skill-synthesis.service.ts:551` (`restartCurator()` — called by `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:663`, already landed by P3)                                                                   | P3's `skills-synthesis-rpc.handlers.spec.ts` (their batch); P2 side pinned by the restartCurator tests below                                                                                                                                                                        |
| **S13** curator restart dropped `onPassComplete`/`onEvent`                               | `restartCurator()` stops and re-starts with the ONE option set every start uses (`curatorStartOptions()`), so the callbacks survive a settings change and period changes apply live                                                                                                                                                              | `skill-synthesis.service.ts:551-556` (`restartCurator`), `:562-568` (`curatorStartOptions`), `:469` (performStart uses it)                                                                                                                  | `skill-synthesis.pause-resume.spec.ts`: "restartCurator() keeps the pass/event callbacks wired (S13)"                                                                                                                                                                               |
| **S14** Electron tray                                                                    | P5's batch (apps/ptah-electron); nothing in P2 touches it                                                                                                                                                                                                                                                                                        | —                                                                                                                                                                                                                                           | P5's specs                                                                                                                                                                                                                                                                          |
| **S15** promoted skills read side — **stays on** [U]                                     | Untouched by P2 (no gate anywhere on skill files / `mirrorUserLayer`)                                                                                                                                                                                                                                                                            | —                                                                                                                                                                                                                                           | —                                                                                                                                                                                                                                                                                   |
| **S16** dead key `skillSynthesis.triggers.sessionEnd`                                    | Deleted in PD (already committed); verified absent from `triggers/skill-trigger-config.ts`                                                                                                                                                                                                                                                       | `triggers/skill-trigger-config.ts` (key list, no `sessionEnd`)                                                                                                                                                                              | PD's done-check                                                                                                                                                                                                                                                                     |

Additional binding requirements and where they landed:

- **"Reconcile, retirement, backlog cleanup, embedding backfill stop while paused"** — reconcile: `skill-curator.service.ts:249` + the deferred start; retirement/umbrella/enhancement: the gated tick (`:273-274`); backlog cleanup: pre-existing live gate; embedding backfill: no enqueue while booted-paused (`performStart` deferred) and the drain's gates cover the stage.
- **"Curator interval start() must not double-schedule and must keep its callbacks"** — clear-before-arm `skill-curator.service.ts:241-247`; callbacks via `curatorStartOptions()`; pinned by "two resumes → one subscription, one curator start, one interval" and "restartCurator() keeps the pass/event callbacks wired".
- **"No prefilter row terminally skipped because of a pause"** — S7 mapping + pinned.
- **"No boot-scan watermark advance while paused"** — S3 `'stalled'` mapping + pinned (the scan-stats event asserts `stalled: 1`).
- **"Claimed rows released/reaped correctly"** — unchanged claim/reap paths; the per-item break happens between items, so no claim is left dangling by the pause itself (existing `staleClaimTtlMs` reaper still owns crash recovery). Pinned by the gates-spec resume test (no `markSkipped`/`markFailed` for the held-back row, it drains on the next tick).

## Exact check lines (run 2026-10-07, this worktree)

`npx nx run-many -t test,typecheck,lint -p skill-synthesis --parallel=1` →

```
√  nx run @ptah-extension/skill-synthesis:test
√  nx run @ptah-extension/skill-synthesis:typecheck
√  nx run @ptah-extension/skill-synthesis:lint
 NX   Successfully ran targets test, typecheck, lint for project @ptah-extension/skill-synthesis
```

Standalone `npx nx test skill-synthesis` (same suite, uncached summary lines) →

```
Test Suites: 1 skipped, 87 passed, 87 of 88 total
Tests:       1 skipped, 1856 passed, 1857 total
 NX   Successfully ran target test for project @ptah-extension/skill-synthesis
```

(The 1 skipped suite is a pre-existing environment-conditional skip — a native-binding probe in the queue-db test-support — present before this change too.)

`npx nx run degradation-audit:lint` →

```
libs/backend/skill-synthesis: 5 ok (baseline 5)
 NX   Successfully ran target lint for project degradation-audit
```

At baseline. The one new fail-soft catch (`ensureStarted`'s wrap of a failed deferred start,
`skill-synthesis.service.ts:524-532`) carries `// degradation-audit: reported - a failed
deferred start is warned; the row stays queued (the caller no-ops) and the next trigger
retries.` and logs a warn. `ensureCuratorRunning`'s catch logs and returns nothing (not a
catch-return-sentinel, so a marker there would be an orphaned suppression).

`npx prettier --check <the 16 changed files above>` →

```
Checking formatting...
All matched files use Prettier code style!
```

## Deviations from the plan (P2 rows and §3.4)

1. **Settings supplier carried on `options.readSettings`, not as `start()`'s first parameter.**
   The plan's §3.4 says "the curator tick reads settings through a supplier"; P2 passes it as
   an optional `SkillCuratorStartOptions.readSettings` (`skill-curator.service.ts:119`)
   instead of changing `start(settings, …)` to `start(supplier, …)`. Reason: the in-flight
   mcp-bench harness (another agent's file, `tools/mcp-bench/src/memory-skills/suites/skills/funnel-host-port.ts:608,639`)
   and the existing specs call `curator.start(settingsObject)`; a signature change would break
   their in-flight work. Behaviour is identical: the tick prefers the supplier and falls back
   to the snapshot.
2. **`ensureCuratorRunning()` added.** The plan's lazy sites call `ensureStarted()` "when
   `enabled && !started`"; that leaves one corner dead: a `restartCurator()` DURING a pause
   (curator keys changed while `skillSynthesis.enabled=false`) stops the interval, and an
   EXTERNAL resume (no event, service already started) would never re-arm it. P2's
   `ensureStarted()` also re-arms a stopped-but-should-run curator on the already-started
   path (a field read on the healthy host; settings are only read when the interval is
   actually down), which is what makes "resume needs no restart" hold for every host. Pinned
   by "restartCurator() while paused leaves the curator stopped, and the lazy resume re-arms it".
3. **`restartCurator()` skips the restart while paused (or before the deferred start).**
   The plan says it "passes the same `onPassComplete`/`onEvent` options as `start()`" — it does,
   whenever it starts anything — but starting while paused would run the startup reconcile,
   which the binding list says pause must stop. Paused ⇒ stop-only; the resume paths re-arm.
4. **`runBootScan` resets `bootScanArmed` when the run completes** (`skill-trigger.service.ts:949`).
   Not in the plan's text, required by its §5 test row: an external mid-scan pause fires no
   event, so `cancelBootScan` never resets the flag — without this the "resume (event AND
   LAZY) re-arms once" requirement cannot hold on the lazy path.
5. **Skills idle/turn-complete timers are NOT cleared on the pause event** (memory's P1 clears
   its idle timers; the plan's P2 row for the skills trigger service lists only boot-scan
   arming/`'stalled'`/re-arm + `fireHarvest` + "telemetry untouched"). A skills timer that
   fires while paused pushes a diagnostics event and reaches `enqueueAnalyze`, which re-reads
   the switch live and no-ops (S2 was already rated OK). Implemented exactly as planned;
   noted because the two pipelines differ by design.
6. **`'paused-mid-run'` joins `DrainSkipReason` with `summary.skipped` staying false** — the
   plan specifies "break with `summary.reason = 'paused-mid-run'`"; P2 keeps `skipped:false`
   because claims may already have been attempted (the `skip()` helper sets `skipped:true` and
   is deliberately not used). Documented on the union member itself.
7. **`ensureStarted()` is invoked from `enqueueAnalyze`/`analyzeSession` whenever `enabled`**
   (not literally "when `enabled && !started`"): the heavy deferred-start path only runs when
   `!started`; when already started the call reduces to the cheap curator re-arm check
   (deviation 2). Same externally visible behaviour as the plan's condition.

## Dependencies on other batches

- **P3** (libs/shared + rpc-handlers) — `skills-synthesis-rpc.handlers.ts:663` already calls
  `this.synthesis.restartCurator()`; P2 provides that method. Nothing else in P2 needs P3's
  shared types.
- **PD** (dead keys, committed) — verified: no `sessionEnd` key in `skill-trigger-config.ts`.
- **P5 / tray (S14)** and the mcp-bench harness — untouched by P2; see deviation 1.

## Review fixes (round 1) — orchestrator verification

The opencode lane implemented the four P2 findings of `code-logic-review-b-p-backend.md` (2, 3, 4,
9) but exited with "Unknown error" at its final prettier step, before it updated this report. The
orchestrator verified the working tree itself:

- Finding 2: `startRun` is now a `.catch`-observed join that logs, resets `startRun` and rethrows to
  awaiting callers (`skill-synthesis.service.ts`).
- Finding 3: a prefilter null while the switch is off becomes `unscored` with reason
  `analyzer-paused` and a 15-minute retry, never `skipped` (`queue/stage-handlers.service.ts`).
- Finding 4: the config listener deliberately outlives a failed start and is the retry path through
  `onMasterSwitchChanged` → `ensureStarted()`.
- Finding 9: boot-scan arm ownership by `bootScanGeneration` (`triggers/skill-trigger.service.ts`).
- Checks (orchestrator run): `npx nx run-many -t test,typecheck,lint -p skill-synthesis rpc-handlers
  --parallel=1` → Successfully ran targets test, typecheck, lint for 2 projects;
  degradation-audit `libs/backend/skill-synthesis: 5 ok (baseline 5)`; prettier clean.
