# Code Logic Re-Review (Phase C fix round) - TASK_2026_662

Score: 8/10. Verdict: APPROVED (no Blocking or Serious findings).
Review family: reviewer Claude; implementers codex lanes A, B, C plus orchestrator Claude (O36). O36 lines
(main.ts `trayRef`, thoth-shell spec fake, degradation-audit comment markers) carry weaker evidence (same family).

## Verified
1. S1 - closed. `retired-skill-jobs.ts` disables the four ids (`get` then `update({enabled:false})`, only when
   `job?.enabled`, so idempotent; rows and `job_runs` are never deleted; per-id try/catch). It is called before
   `refs.cronScheduler.start` in `start-thoth-cron.ts:~387-405` and before `cronScheduler.start` in
   `cli-engine/.../thoth-runtime.ts:~359-376`, both guarded by `isRegistered(CRON_JOB_STORE)` and wrapped in a
   non-fatal catch. `CronScheduler.start` arms only `jobs.list({ enabledOnly: true })` (`cron-scheduler.ts:119-120`),
   so disabled jobs are not armed. No code re-seeds the ids (grep: only archive, run.store and UI spec references).
2. M4 - closed. `removeAbsent` returns the summed `.changes`; the harvester logs info when `removed > 0`
   (`spec-harvester.service.ts:~200`).
3. U5 - ok. `refreshSpecs`, `harvestSpecs` and `clearStaleSpecs` (`skill-synthesis-state.service.ts:694-743`) each
   catch their own errors and reset `specsLoading` in `finally`, so the component's `void` calls cannot cause an
   unhandled rejection. Buttons are disabled while loading, and clear-stale is disabled at 0 stale.
4. Routing map - ok. `total = BACKGROUND_ROLE_IDS.length` (3: two consumers plus `decision`). Wording is "Default"
   for unset roles, the footer reads "N default", and the `slice(0, 2)` branch is gone.
5. U7 - ok. No `trayKeepalive`, keepalive or "Pause skills" reader is left in apps/ptah-electron/src.
   `handleWindowAllClosed({platform, quit})` quits on non-darwin. `trayRef.current` holds the Tray for the process
   lifetime, and tray creation failure is non-fatal (leaves `current` null, still quits).
6. E2E and showcase - ok. `git grep tray-keepalive` finds no importer. `skills-tour.json` has 6 lines against the
   scene's 5-6 caption beats. The selectors `clones-view`, `skills-pause-switch`, `skills-telemetry-switch`,
   `thoth-section-skills`, `clones-row` and `clones-empty` all exist in current templates.

## Findings
- Blocking: none. Serious: none.
- Moderate: `CronScheduler.toggle/update` (`cron-scheduler.ts:192,201`) still lets the Schedules UI or RPC
  re-enable a retired job. Nothing then stops it arming in that session, and its handler is gone, so each tick would
  fail. Boot re-disables it next start. Low likelihood, because the jobs remain listed; consider hiding or locking
  these ids in the Schedules list (batches 63/65).
- Minor: `disableRetiredSkillPipelineJobs` swallows per-id errors without reason (`catch {}`; the ids are reported
  as `failed`, which is acceptable). `backgroundRolesPreview` hard-codes the Decision role instead of deriving it
  from `BACKGROUND_ROLE_IDS`, so a fourth role would fall out of sync (`routing-map.component.ts:~27-33`).
- Minor: the skills-tour caption count depends on whether the Library is empty (5 vs 6 beats), so the voiceover can
  drift by one line in the empty case.

## Other
No new defects introduced by the fix round beyond the above.
