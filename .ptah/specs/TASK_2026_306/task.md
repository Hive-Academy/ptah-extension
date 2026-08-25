---
id: TASK_2026_306
status: in_review
type: BUGFIX
title: >-
  Electron dev boot never opens a window: cron cold-start catchup is awaited on
  the activation path and stalls behind an exhausted provider quota
description: >-
  A dev `nx serve ptah-electron` run reached full DI registration, opened and
  migrated SQLite, registered all 362 RPC methods, and then never created a
  `BrowserWindow`. The activation chain is fully synchronous through background
  work: `main.ts:127` awaits `wireRuntime`, which at `wire-runtime.ts:373` awaits
  `bootHeavyServices`, whose last step at `wire-runtime.ts:325` awaits
  `startThothCron`, which at `start-thoth-cron.ts:282` awaits
  `CronScheduler.start()`, which at `cron-scheduler.ts:98` awaits
  `CatchupCoordinator.replayMissed()`, which runs every overdue job serially to
  completion at `catchup-coordinator.ts:105`. `main.ts:145` calls
  `registerPostWindow` (and therefore `createMainWindow`) only after all of that
  returns. Neither `Cron scheduler started` nor `Subsystems brought up` ever
  printed, while `@ptah/skills-drain-frequent` alone took 94246 ms and the
  nightly and weekly drains had not yet run. The blocker is structural and fires
  for a healthy provider with a large backlog too, so it is not downstream of the
  quota problem. The quota problem is a second, independent defect: the developer
  was authenticated through the Codex OAuth translation proxy on an exhausted
  subscription, and although `translation-proxy-base.ts:545` correctly answers a
  429 with `rate_limit_error`, nothing consumes that signal. The Claude CLI
  subprocess absorbs the 429 and retries internally, so `LaneRunnerService` sees
  only its own wall clock expiring, `SkillLaneFailureKind` has no quota member,
  and an exhausted subscription is recorded as `kind: timeout`. Every queued row
  then pays a full `timeoutMs` to rediscover the same dead endpoint, the
  synthesizer falls back to a template and persists a candidate produced by a
  provider that never answered, and the user is told nothing. Scope covers the
  boot-ordering fix, a pre-dispatch provider quota gate reusing the existing
  `ILaneAuthResolver` stall seam, and seven further defects and warnings found in
  the same log — including a fully broken session importer and a workspace index
  that aborts on a single missing file.
---

# Electron dev boot never opens a window

Machine-owned metadata carrier. Prose lives in `./context.md`; the full defect
inventory with evidence lives in `./research-report.md`.
