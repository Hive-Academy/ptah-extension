# Code logic review — TASK_2026_620 B-P backend (PD, P1, P2)

Reviewed commits 7872fc689 (PD), a6a6a6854 (P1), c2618c287 (P2) against `pause-switches-plan.md` (rows M1-M20, S1-S17, 3.4, section 5). Read-only. Paths below are relative to the worktree.

Verdict: **REVISE** — 0 blocking, 2 serious, 4 moderate, 3 minor.

## Findings

1. **SERIOUS (P1)** — memory boot scan cannot resume lazily after an external-edit pause. `libs/backend/memory-curator/src/lib/triggers/memory-trigger.service.ts:944-948` (the `run` callback) sets `bootScanOwed = true` and returns `'stalled'` when paused, but `bootScanArmed` is only reset in `cancelBootScan` (`:1086`), which only the config event reaches. An external edit of `~/.ptah/settings.json` fires no event (plan 0.3). The scan stalls, owed=true, armed stays true, and `maybeRearmBootScan` (`:1090-1103`) returns on `this.bootScanArmed` forever. The lazy re-arm from `onActivity`/`onSessionStart` (`:288`, `:630`) never fires, so the memory boot scan is not re-armed until restart. The skills twin fixes this with a `finally { bootScanArmed = false }` (`skill-trigger.service.ts` runBootScan, end), and memory's `runBootScan` (`:929-1035`) has no equivalent. Fix: reset `bootScanArmed = false` in a `finally` in `runBootScan`, as skills does. Add a spec for scan armed, flag flipped with no event, scan stalls, flag flipped back, one `onActivity`, one re-arm.

2. **SERIOUS (P2)** — unhandled rejection from `start()`. `skill-synthesis.service.ts:381-383`: `this.startRun = run.finally(...)` creates a derived promise nobody awaits. When `performStart()` rejects (for example `openAndMigrate` fails at `:~392`), `await run` hands the error to the caller, but the derived `startRun` promise also rejects with no handler. The CLI has no `unhandledRejection` handler (grep over `apps/ptah-cli` and `cli-engine`: none), so Node 15+ terminates the process. Electron's `boot-trace.ts:105` only logs. Previously the failure was swallowed by the "start skipped (non-fatal)" catch (`cli-engine/.../thoth-runtime.ts:288`). Fix: `this.startRun = run.then(clear, clear)` or `run.finally(...).catch(() => undefined)`, and add a spec where `openAndMigrate` rejects.

3. **MODERATE (P2)** — pause racing the claim turns a prefilter row into terminal `skipped`. The per-item gate (`queue/skill-drain.service.ts:~838`) runs before `runItem`. If the switch flips between the gate and `analyzeSession`, `analyzeSession` returns `null` at `skill-synthesis.service.ts:~860` (`!settings.enabled`). `runPrefilterStage` (`queue/stage-handlers.service.ts:~311`) maps `null` to `{outcome:'skipped', reason:'no candidate from this session'}`, which loses the row. `ensureStarted()` returns `true` whenever `started`, even when the switch is off, so the `unscored` guard (`:301`) is bypassed. Window is small but the loss is permanent. Fix: have `ensureStarted` or the stage check `readSettings().enabled` and return `unscored`, or have `analyzeSession` distinguish paused from ineligible.

4. **MODERATE (P2)** — failed deferred or boot start leaves a dangling config listener and never starts the trigger service. `registerConfigListener` runs above the early returns (`skill-synthesis.service.ts:~366`). In `boot-thoth-runtime.ts:447-460`, a rejected `start()` sets `refs.skillSynthesis = null`, so shutdown never calls `stop()` and the listener is never disposed. `startSkillTrigger()` also never runs, so a later resume has no skill trigger service, and the boot scan, hooks and harvest stay dead until restart. Pre-existing boot behaviour, but B-P's "resume without issues" depends on it.

5. **MODERATE (P1)** — pause by event clears idle timers without re-arming on resume. `memory-trigger.service.ts:222-230` drops `idleTimer`/`idleDueAt`. Episodes are kept (`episodes` map), but a session that went quiet before resume is only curated at its next activity or at session end. A paused-then-resumed idle episode can sit uncurated indefinitely. Plan 3.4 accepts "dropped"; flagging the data-latency gap. Also, with the external edit the timer fires instead, and `fireIdle` returns at `:675` without a re-arm, so the idle curate is dropped there too.

6. **MODERATE (P1 tests)** — the pause spec `memory-trigger.service.spec.ts:866-900` is probably vacuous. It sends only an assistant `activity`, which builds no episode content, so `tryEpisodeCurate` hits `snap.isEmpty` and never calls `curator.curate` even without the gate or the timer clear. A spec that would pass without the fix. It needs a captured observation (PostToolUse) before the pause. The plan section 5 also asks for: two events produce one arm, no-event resume, listener disposed on `stop()`, paused scan leaves the watermark. Only the boot-paused lazy re-arm is covered (`:902-946`).

7. **MINOR (P1)** — `memory-curator.service.ts:253-259` reads `memory.enabled` with a bare `=== false` and a hard-coded section and key, not `MEMORY_TRIGGER_*` as the other three sites do. Works, but drift risk.

8. **MINOR (P1)** — retention writes a `memory-paused` skip row to the cron history every hour while paused (`memory-retention.service.ts:~195`). Visible and intended per the manual-smoke plan, so no change needed; noted.

9. **MINOR (P2)** — `skillSynthesis.ts` boot-scan `finally { bootScanArmed = false }` also fires for an aborted older scan after a pause→resume. If scan A is aborted but still awaiting an item, resume arms scan B, and A's `finally` clears B's armed flag. Double-arm needs owed to be set again while B is armed, which requires a pause that cancels B anyway. No harm found.

## PD (7872fc689)

Grep over `apps` and `libs` (ts, md, html, mdx) for `memory.curatorEnabled`, `triggers.preCompact` and `skillSynthesis.triggers.sessionEnd`: zero hits. No remaining reader or writer of the three keys. The plan keeps the PreCompact hook symbols and `memory.triggers.sessionEnd.enabled`, which remain. Persisted values are ignored safely: the keys are not in the routed key list, so they land in the unrouted path (plan assumption, spec added in `file-settings-keys.spec.ts` per commit stat). No findings.

## Inventory table

| Row | Gated live? | Resume ok? | Evidence |
|---|---|---|---|
| M1-M5 capture, cue, stop, tool failure, session end | yes | yes (live re-read) | `memory-trigger.service.ts:288`, `:2454-2500` spec |
| M6 idle timer | yes (arm and `fireIdle` `:675`) | partial: timer dropped, finding 5 | `:222-230`, `:675` |
| M7 boot scan | yes (arm, per-session `:944`) | event path yes; external-edit path NO (finding 1) | `:944-948`, `:1090-1103` |
| M8 in-flight curate | finishes by design | n/a | plan 3.4 |
| M9 PreCompact curation | yes | yes | `memory-curator.service.ts:253-259` |
| M11 retention | yes | yes, next tick | `memory-retention.service.ts:195-202` |
| M12 lifecycle | inherits M11 | yes | same |
| M13 indexing run | yes (except `force`) | yes | `indexing-control.service.ts:311-318` |
| M14, M15 | out of scope (P3, P5) | | |
| S1/S2 session-end and trigger hooks | yes (`enqueueAnalyze` re-read) | yes (event and lazy `ensureStarted`) | `skill-synthesis.service.ts:~663-675`, `:370-385` |
| S3 skill boot scan | yes | yes, event and lazy; watermark kept (`'stalled'`) | `skill-trigger.service.ts:911-914`, `finally` reset |
| S4 harvest | yes | yes | `skill-trigger.service.ts:472` |
| S5 telemetry | stays on by design | n/a | |
| S6 drain | yes, per item | yes, rows stay queued (`paused-mid-run`) | `skill-drain.service.ts:~838` |
| S7 stages | inherits S6; prefilter `unscored` if not started | yes, but finding 3 race | `stage-handlers.service.ts:301` |
| S8 deferred start | live, idempotent via `startRun` | yes, but finding 2 | `skill-synthesis.service.ts:353-384` |
| S9 curator | yes (supplier plus `enabled` plus `curatorEnabled`) | yes: no double interval (clear-before-arm, `isScheduled`) | `skill-curator.service.ts:238-282` |
| S10 reconcile | not started while paused (stricter than plan, fine) | yes on re-arm | `skill-curator.service.ts:253-258` |
| S11 backlog cleanup | yes | yes | pre-existing |
| S13 restart drops callbacks | fixed (`curatorStartOptions`) | yes | `skill-synthesis.service.ts:~549-563` |
| S12, S14 | out of scope (P3, P5) | | |

Listeners: memory `configurationDisposer` disposed in `stop()` (`:246`, `:256`), registered once per `start()`. Skills service and skill trigger likewise (`registerConfigListener` is guarded by `_configDisposer`). Pause→resume cycles register no extra listeners or timers (the intervals and schedulers are guarded by `isScheduled`, `bootScanArmed`, `startRun`).

## Tests seen

- `npx nx test memory-curator` (patterns memory-trigger.service, memory-curator.service, indexing-control, memory-retention.service): `Tests: 232 passed, 232 total` (4 suites).
- `npx nx test skill-synthesis` (patterns skill-drain.gates, pause-resume, skill-curator.service, boot-defer, skill-trigger.service, stage-handlers, skill-synthesis.service, regex-demotion): `Tests: 305 passed, 305 total` (10 suites).

Test coverage gaps: findings 1, 2, 6. Skills pause/resume coverage (`skill-synthesis.pause-resume.spec.ts`, `skill-drain.gates.spec.ts`, boot-defer) is substantive for event and lazy resume; not independently mutation-tested.

## Five questions, short form

1. Silent failure: finding 1 (memory scan stuck owed), finding 3 (row skipped), finding 2 (crash on start failure).
2. User action: pause by hand-edit of settings, then resume — memory boot scan stays dead (finding 1).
3. Input data: none beyond the above.
4. Dependency failure: DB open failure on deferred start (findings 2, 4).
5. Missing: none beyond findings.
