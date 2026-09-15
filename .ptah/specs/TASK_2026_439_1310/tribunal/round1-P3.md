# Tribunal Thoth — Round 1, Panelist P3

### A — Memory lifecycle / unbounded growth

## Position

Ptah writes memories and observations, but no working path removes them. Salience can only rise, the decay job never runs, and no code deletes old rows.

## Root causes

1. Salience ratchets up and never falls. `score()` adds a positive sum to `base` (`salience-scorer.ts:37-52`). `scoreMemory()` feeds the stored salience back in as `base` (`salience-scorer.ts:63-71`). Each write sets a floor near the creation hint (`memory-curator.service.ts:675-686`). A merge takes the maximum of the two scores (`memory-curator.service.ts:662-670`). This explains complaint 1. It also explains the measured bulk salience of 1.1 to 1.4 with a floor near 0.6.
2. The archival threshold is unreachable. The decay job demotes recall to archival only when `newSalience < 0.1` and the memory is old (`memory-decay.job.ts:91-98`). Because of cause 1, salience never falls that far. The brief confirms 0 archival rows.
3. The decay job never runs. No code registers a `memory:decay` cron handler. No code calls `decay.run()`. `start-thoth-cron.ts:46-112,155-245,307-383` registers only the backup, the skill drains, and the integrity check. The DI file constructs the job and nothing more (`memory-curator/src/lib/di/register.ts:130-131`). The `memory-curator` CLAUDE.md claims the job is cron-registered. The code says it is not. This explains complaint 1.
4. Decay deletes nothing. The sweep deletes only rows with `expiresAt` set (`memory-decay.job.ts:72-76`). The brief measured `expires_at` on 0 rows. So even a running job would keep all 33,415 rows. This explains complaint 1.
5. Nothing purges the observation queue. `purgeOlderThan` exists (`observation-queue.store.ts:648`, SQL at line 155). Grep finds no production caller. 200,725 processed rows and 756 MB of tool text stay forever. This explains the 1.28 GB file and complaint 1.
6. Stuck rows cannot be purged. The purge SQL deletes only processed rows (`observation-queue.store.ts:155`). The curator defers rows on a stall and leaves them unprocessed. 5,106 rows have waited since 2026-07-28. This explains complaint 1.
7. The vacuum cannot reclaim the space. The daily job runs `incremental_vacuum(100)` (`start-thoth-cron.ts:344-355`). That reclaims at most 100 pages per day. The backup rotation also keeps three pre-migration copies of about 1 GB each. This explains complaint 1.

## Systematic fix

1. Change the scorer. Pass a fixed creation hint as `base`. Add a decay term driven by the age of `last_used_at`. Delete the stored-salience feedback in `scoreMemory` (`salience-scorer.ts:63-71`).
2. Rewrite the decay rule. Demote a memory to archival when it is unused for N days. Delete archival rows after M more days. Drop the `< 0.1` condition (`memory-decay.job.ts:91-98`).
3. Register the job. Add a `memory:decay` handler and a nightly `jobStore.upsert` in `start-thoth-cron.ts`, next to the backup block.
4. Purge on the same schedule. Call `purgeOlderThan` for processed rows older than 14 days. Add a rule that drops or force-processes unprocessed rows older than N days.
5. Reclaim disk. Run a full `VACUUM` monthly after the purge. Cut the pre-migration rotation from 3 copies to 1.
6. Ship a one-time migration that purges the existing backlog on upgrade.

Delete: the `< 0.1` threshold branch, the salience feedback loop, the unbounded snapshot rotation.

## Verification

- The user sees the DB file shrink after the upgrade migration.
- The Memory tab Maintenance view shows a decay sweep timestamp that moves nightly.
- The Schedules tab shows the new job with run history.
- The tier filter shows a non-zero archival count before deletions begin.
- A unit test pins the rule: an unused memory is demoted after N days and deleted after M days. A pinned `core` memory is never deleted.

## Tradeoffs

- Deletion can remove a fact the user wanted. Keep `core` rows exempt. Keep a short recycle window.
- Decay changes search ranking over time. That is the intended behavior.
- A full VACUUM locks a large database for a while. Run it at night, after the backup.

## Confidence

High. Biggest risk: deleting a memory the user still needs.

### B — Skill synthesis quality and verifiability

## Position

The pipeline drafts a candidate for almost any session, writes a synthetic success record for it, and then demands three real successes that no code path can produce. Nothing is ever promoted, and the statistics cannot be trusted.

## Root causes

1. The prefilter admits pure conversation. `passesPrefilter` accepts on any of four signals (`skill-synthesis.service.ts:1188-1196`). The `depthOk` branch needs only turn count and character count. A session with no code work becomes a candidate. This explains complaint 2 and the prompt-slug names in the brief.
2. Name and body come from the first prompt, not from the work. The slug is the first 140 characters of the first user message (`trajectory-extractor.ts:136-138`). The service adopts that slug as the candidate name (`skill-synthesis.service.ts:774`). Boot sessions get a template body with no LLM pass (`skill-synthesis.service.ts:776-780`). This explains complaint 2.
3. The service writes a synthetic success row per candidate. After creation it inserts one invocation with `succeeded: true` (`skill-synthesis.service.ts:916-924`). The store method is a plain insert and touches no counters (`skill-candidate.store.ts:929-961`). The brief confirms 2,432 rows, all `succeeded=1`, one per candidate. The user cannot tell real usage from this data. This explains complaint 2.
4. The promotion gate is unreachable. `evaluate` refuses any candidate below `successesToPromote`, which is 3 (`skill-promotion.service.ts:214`). Only `SkillInvocationTracker` raises `success_count` (`skill-invocation-tracker.ts:66-78`). Grep finds no production caller of the tracker. The junction layer serves promoted skills only, so a candidate is never invoked. The manual Promote button passes through the same gate. The brief confirms 0 promoted, ever. This explains complaint 2.
5. Supply exceeds drain capacity. Tier caps are 4, 40 and 400 items per tick. The queue holds a standing backlog: 423 prefilter rows queued, oldest from 2026-08-28. The user sees an endless run of analyze events with no result. This explains complaint 2 and the queue numbers in the brief.
6. Session verdicts are weak. The brief measures 56 null-outcome degraded verdicts and near-zero routine data. Sessions with no code work carry no evidence to verify. This follows from cause 1 and explains the verdict numbers in the brief.

## Systematic fix

1. Tighten the prefilter. Require `editOk` or `testOk` or `toolOk`. Delete the `depthOk`-only branch (`skill-synthesis.service.ts:1191-1196`).
2. Delete the synthetic invocation write (`skill-synthesis.service.ts:916-924`). Draft status belongs in a column or an event, not in `skill_invocations`.
3. Open a path to real successes. Serve candidate skills to the agent in a trial mode, and route the recorder usage events into `SkillInvocationTracker`. Smaller first step: let the manual Promote RPC bypass the threshold, because the user makes that decision.
4. Add candidate expiry. Reject candidates that stay unused for N days. Clean the 2,426-row backlog once, with a user-visible report.
5. Keep the drain caps. With a tighter prefilter the inflow drops and the backlog drains.

## Verification

- New candidates carry edit, test or tool evidence in their rows.
- `skill_invocations` rows match real usage events only.
- The user clicks Promote on a good candidate. A SKILL.md appears under `~/.ptah/skills/`.
- The Skills tile count falls over weeks. Today it only grows.
- A spec pins the rule: a conversation-only session produces no candidate.

## Tradeoffs

- Trial mode exposes unverified skills to the agent. Cap the trial count and log every use.
- Deleting the synthetic rows resets win-rate history. Accept the reset, because the old data is false.
- A tighter prefilter produces fewer candidates. That is the goal.

## Confidence

High on causes 1 to 4. Medium on 5 and 6. Biggest risk: trial mode changes agent behavior.

### C — Thoth UI usability, including the activity log

## Position

The Skills activity feed renders the oldest end of the event list, so it shows stale repeated rows and can crash on duplicate keys. The shell status tiles load once and then freeze, and every tab is dead in VS Code.

## Root causes

1. The Skills feed slices the wrong end. The backend returns the newest window in oldest-first order (`skill-synthesis.service.ts:1052-1055`). The feed takes `events.slice(0, limit)` (`skill-synthesis-ui/src/lib/components/diagnostics/event-feed.component.ts:58`). It shows the oldest rows of the window, not the newest. Live pushes append behind that list (`skill-diagnostics-state.service.ts:164`). The 30-second poll replaces the list with the same oldest-first data (`skill-diagnostics-state.service.ts:184`). The feed lags many events behind and often never updates. This explains the broken activity log in complaint 3.
2. The row keys collide. The feed tracks rows by `timestamp-kind` (`skill-synthesis-ui/src/lib/components/diagnostics/event-feed.component.ts:26`). Two same-kind events in the same millisecond produce duplicate keys. Angular rejects duplicate keys and the view fails to render. The Memory tab feed keys on `timestamp-kind-index` and is immune (`memory-curator-ui/src/lib/components/diagnostics/event-feed.component.ts:73`).
3. The feed shows repeated rows by design. A drain tick emits one `analyze-run` row per session. With 96 ticks a day the ring fills with near-identical lines. Nothing groups or counts them. Cause 1 keeps the same stale rows on screen. This explains "repeated components in a bad layout" in complaint 3.
4. The status tiles freeze. The shell calls `refreshIfNeeded()` once on init (`thoth-shell.component.ts:214-216`). That method runs only on the first call (`thoth-status.service.ts:263-266`). The tiles never refresh again in the session. The Skills tile also counts candidates without a scope filter (`thoth-status.service.ts:300-308`). It shows the whole-machine backlog of 2.4k. This explains complaint 3.
5. Every tab is Electron-only. All four tabs set `electronOnly: true` (`thoth-shell.component.ts:240-248`). Each tab shows a download placeholder in VS Code (`memory-curator-tab.component.ts:74-95`). A VS Code user sees four dead tabs and gets no value from them. This explains complaint 3.

## Systematic fix

1. Sort the feed newest-first before slicing. Apply this in the skills feed, or return newest-first from the backend. Add an index suffix to every row key.
2. Delete the skills feed copy and reuse one shared feed component. The two feeds are near duplicates. Put the shared component in `libs/frontend/ui`.
3. Group repeated rows. Count same-kind rows into one line with a badge, the way `back-office-activity.service.ts:188-211` coalesces.
4. Refresh the tiles on every tab switch and on a slow timer. Scope the skills count to the active workspace.
5. Fix the VS Code story. Either hide the four tabs in VS Code, or move the read-only views to RPCs that work there. Delete the dead placeholders if you hide the tabs.

## Verification

- The user opens Skills, Activity, while a drain runs. New events appear at the top within one poll.
- The feed shows distinct events with counts. No duplicate rows sit on screen.
- The Skills tile count drops after the user rejects a candidate.
- An e2e spec in `webview-e2e-harness/scenarios/thoth/` pins newest-first order and unique keys.

## Tradeoffs

- Faster polling costs RPC traffic. Refresh on tab switch plus a slow timer is enough.
- A shared feed component couples the two UI libs through `libs/frontend/ui`. That is the intended pattern.
- Hiding tabs in VS Code removes a discovery path for the desktop app.

## Confidence

High on causes 1, 2 and 4. Medium on 3 and 5. Biggest risk: the layout complaint may include styling that this analysis does not cover.

## Priority order

1. A, causes 1 to 4: fix salience decay, schedule the decay job, purge the queue, ship the one-time cleanup.
2. B, causes 1 and 3: tighten the prefilter, delete the synthetic invocation rows.
3. B, cause 4: unblock promotion. Ship the manual bypass first, the trial mode later.
4. C, causes 1 and 2: fix the feed order and the row keys.
5. C, cause 4: refresh and scope the status tiles.
6. A, causes 6 and 7: run a full VACUUM, cut the snapshot rotation to 1.
7. C, cause 5: decide the VS Code story.