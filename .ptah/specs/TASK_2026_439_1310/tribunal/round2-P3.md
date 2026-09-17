# Tribunal Thoth — Round 2, Panelist P3

## Strongest point

**Area A (memory lifecycle). Answer A is the most convincing.** A designed the full retention system, not only the salience defect: a registered decay sweep, a 7-day purge of processed observation rows, a 48-hour quarantine for stuck unprocessed rows, a demote-then-delete tier rule, and a preview screen with reclaimed bytes. A also caught the defect that neither B nor I caught: the stage order in the skills pipeline. The code drafts the candidate first and asks the archaeologist later (`stage-handlers.service.ts:272` runs `analyzeSession`, then lines 285-286 enqueue the archaeology and the judge gates). The synthesizer reads the verdict at authoring time, so the verdict is usually absent (`skill-synthesis.service.ts:785`), and the prompt tells the model to fabricate a skill even for a one-off session (`skill-synthesizer.service.ts:243`).

**Area B (skill quality). Answer B is the most convincing.** B found two defects that my Round 1 missed: the dead `CandidateNamerService`, and the promotion counter that no production code increments. B also gave the arithmetic reason why an additive salience base cannot work, and proposed the correct fix: `base * recency` instead of `base + 0.4 * recency`. B documented that `purgeOlderThan` has zero production callers and cited migration 0039 for it.

**Area C (Thoth UI). Answer B and my Round 1 answer tie.** B found the duplicated component pair in the Skills Activity view: `skill-synthesis-tab.component.ts:478-490` renders both `ptah-skill-pipeline-status` and `ptah-skill-diagnostics-accordion`, and both show the last analysis time, the histogram, the counts and the events. I verified the template: both tags are present. My Round 1 answer holds the clearest root cause for the broken log: the feed slices the oldest end of an oldest-first list (`event-feed.component.ts:58`).

## Flaws

**Answer A.**

- A cites the correct slug derivation line (`trajectory-extractor.ts:230-232`). My Round 1 cite was wrong: I cited lines 136-138, which are a docblock.
- A did not check `CandidateNamerService` at all. The namer exists, is registered in DI, but no production code calls it. So `display_name` is never filled. This defect explains the slug names that A attributed only to the prefilter.
- A proposed an immutable base plus a decay term. An immutable additive base still floors the score. With base 0.6, the score never falls below about 0.65: `0.6 + 0.4 * recency(≈0) + 0.1 * tierBias(0.5)` (`salience-scorer.ts:44-49`, `memory-writer.adapter.ts:83`). The `< 0.1` demotion threshold in `memory-decay.job.ts:91-98` stays unreachable. A's fix removes the ratchet but keeps the unreachable threshold.

**Answer B.**

- B did not report the stage-order inversion. B treated the archaeology stage as a working gate. The code enqueues it after the candidate body exists (`stage-handlers.service.ts:285`), and the synthesizer reads the verdict before that stage runs (`skill-synthesis.service.ts:782-786`). The gate cannot gate.
- B proposed a plain 30-day delete for the stuck unprocessed rows. That loses the error metadata that explains the curator stalls. A's quarantine shape is safer: keep session id, kind and error in a small ledger, delete the payload.
- B did not report the wrong-end slice in the skills event feed, only the duplicate keys. The wrong-end slice is the larger defect: the feed shows the oldest rows of the newest window, so live updates never reach the screen (`event-feed.component.ts:58`).

**My Round 1 answer (C).**

- My claim "Angular rejects duplicate keys and the view fails to render" is wrong. Angular 21 logs a dev-mode warning, code NG0955, and reuses the DOM node. I verified this in the framework source: `const duplicateKeys = ngDevMode ? new Map() : undefined;` at `_debug_node-chunk.mjs:13570`, and `console.warn(formatRuntimeError(-955, ...))` at 13690-13703. No throw occurs. In production builds the map is absent, so duplicates are silent. The user-visible defect is stale and duplicated rows from DOM node reuse, not a crashed view. Answer A stated this correctly.
- I missed the dead `CandidateNamerService` and the stage-order inversion. Both defects explain part of the prompt-slug names that I attributed to the prefilter alone.
- My salience fix was imprecise. I asked for "a decay term driven by the age of `last_used_at`". The formula already has one: `0.4 * recency` with `recency = exp(-ageDays / halflife)` (`salience-scorer.ts:44-49`). The real defects are the stored-salience feedback loop (`salience-scorer.ts:64`) and the additive base. My wording would not have fixed the threshold.
- I cited `trajectory-extractor.ts:136-138` for the slug. The correct lines are 230-232.

## Disputes 1–5

**1. Is `CandidateNamerService` dead code? Verdict: yes, it is dead code in production.**

`nameCandidate` is the only entry point (`candidate-namer.service.ts:117`). `store.setDisplayName` is its only write (`candidate-namer.service.ts:124`). Grep across `libs/` and `apps/` finds callers only in the namer's own spec file. DI registers the service, but no production code resolves and calls it. Therefore `display_name` stays null and the UI shows the slug. Answer B is correct.

**2. Does the skills feed `track` key cause an error? Verdict: no. It causes a dev-mode warning only.**

The track key is `ev.timestamp + '-' + ev.kind` (`event-feed.component.ts:26`). Two same-kind events in the same millisecond produce the same key. Angular 21 does not throw. It logs warning NG0955 in dev mode and reuses the DOM node (`_debug_node-chunk.mjs:13570, 13690-13703`). In a production build the duplicate map is not created, so duplicates pass in silence. The defect that the user sees is the stale and repeated rows that DOM reuse and the wrong-end slice produce (`event-feed.component.ts:58` slices the oldest end). Answer A is correct. My Round 1 crash claim is withdrawn.

**3. Salience: immutable base plus decay, `base * recency`, or an age rule? Verdict: `base * recency` for the score, and an age rule for the lifecycle.**

The feedback loop is agreed root cause: `scoreMemory` feeds the stored salience back in as `base` (`salience-scorer.ts:64`). Fix that first. But the additive form is a second defect. With an immutable additive base of 0.6, the score floor is about 0.65 forever, so the `< 0.1` demotion threshold in `memory-decay.job.ts:91-98` is unreachable in every additive-base variant. Answer B's multiplicative form fixes this: `0.6 * exp(-ageDays / halflife) + 0.1 * tierBias` decays to about 0.05, so the existing threshold becomes reachable. Answer B is correct on the arithmetic. Answer A is correct that the lifecycle should not depend on salience at all. My position: use the multiplicative score for ranking, and drive the lifecycle with a plain age rule: demote to archival when a memory is unused for N days, delete archival rows after M more days, keep `core` and pinned rows exempt.

**4. Skills: is manual promote blocked, and what pipeline shape? Verdict: promote is blocked. Ship the bypass now. Move to archaeology-first as the target design.**

The gate is closed at every level:

- `evaluate` has no manual override and returns `below-threshold` below the cut (`skill-promotion.service.ts:214-216`).
- `promote` and `promoteBulk` forward to `evaluate` with no bypass (`skill-synthesis.service.ts:1209-1213, 1247-1262`).
- `success_count` starts at 0 (`skill-candidate.store.ts:206`).
- Only `SkillInvocationTracker` increments it, and no production code calls the tracker (`skill-invocation-tracker.ts:48-96`).
- Real usage goes to a different table, `skill_invocation_events`, through `SkillTriggerService.recordInvocation`. That table never feeds the promotion counters.

So the manual Promote RPC always returns `below-threshold`. Zero skills were promoted. Answer B is correct.

On pipeline shape, Answer A is structurally correct and I adopt the finding: the stage order is inverted. The prefilter stage runs `analyzeSession` first and enqueues the archaeology and judge gates after (`stage-handlers.service.ts:272, 285-286`). The synthesizer reads the verdict at authoring time, when it does not exist yet (`skill-synthesis.service.ts:782-786`), and the prompt mandates fabrication for one-off sessions (`skill-synthesizer.service.ts:243`). The fallback names the candidate after the slug (`skill-synthesizer.service.ts:311-320`). A candidate drafted before its evidence exists cannot be verified. But archaeology-first plus cross-session clustering is a large rebuild. The bypass plus a tighter prefilter gives the user value now and stops the worst inflow. Do the bypass first, then move the archaeology stage before authoring, then add clustering.

**5. Observation retention: 7 or 14 days, and the 5,106 stuck rows? Verdict: 7 days. Quarantine the stuck rows, then delete their payload.**

Nothing reads a processed row again. The drain reads unprocessed rows only: `PEEK_SQL` at `observation-queue.store.ts:146`, with the partial index `idx_obs_queue_drain ... WHERE processed_at IS NULL` (migration 0016:33). After `MARK_PROCESSED_SQL` marks a row, no production path reads it. So a short retention window is safe. I change my number from 14 days to 7 days, which matches the `VOICE_RETENTION_MS` precedent that migration 0039 cites.

For the 5,106 stuck unprocessed rows: migration 0039 does not clear them. It reaps only orphaned unprocessed rows, older than 30 days, with no matching session (`0039_reap_orphaned_queue_rows.ts:40-79`). The stuck rows are curator-stall deferrals with live sessions, so they are not orphans and survive 0039. Force-processing them after seven weeks is not worth the model spend. Answer A's quarantine is the right shape: after a grace window, for example 14 days stuck, keep session id, kind and error in a small ledger, then delete the payload. Answer B's plain 30-day delete loses that metadata without need.

## Revise?

My position changes in four places:

1. I withdraw the Angular duplicate-key crash claim. NG0955 is a dev-mode warning. The fix is still correct: sort newest-first, slice the newest end, and add an index to the key.
2. I adopt B's multiplicative salience form for the score. An additive base keeps the demotion threshold unreachable, even with the feedback loop removed.
3. I adopt A's stage-order finding. The candidate body is drafted before the archaeology verdict exists. This is a second cause of the prompt-slug names, beside the loose prefilter.
4. I adopt B's dead-namer finding and lower my retention number from 14 to 7 days.

### Final prioritized fix plan

1. **Unblock promotion.** Add a manual override flag to `evaluate` and let the Promote RPC pass it (`skill-promotion.service.ts:214-216`, `skill-synthesis.service.ts:1209-1213`). This is a small change and gives the user the one control that works today: a human decision.
2. **Fix the salience arithmetic.** Remove the stored-salience feedback at `salience-scorer.ts:64`. Change the score to `base * recency` plus the pinned and tier terms. Keep the base immutable after creation.
3. **Rewrite the decay rule as an age rule.** Demote to archival when unused for N days, delete archival after M more days, exempt `core` and pinned rows. Drop the `< 0.1` condition at `memory-decay.job.ts:91-98`. Register the `memory:decay` cron handler in `start-thoth-cron.ts`.
4. **Purge and quarantine the observation queue.** Call `purgeOlderThan` for processed rows older than 7 days. Add a quarantine rule for unprocessed rows stuck longer than 14 days: record session id, kind and error in a ledger, then delete the payload. Ship this as a one-time migration with a user-visible report.
5. **Fix the activity feed.** Sort newest-first, slice the newest end, and key rows by `timestamp-kind-index`, as the memory feed does. Remove the duplicated diagnostics accordion from the Activity view, or make the two components show disjoint data (`skill-synthesis-tab.component.ts:478-490`).
6. **Wire the namer.** Call `nameCandidate` after the judge panel runs, or delete the service. Do not leave a registered service that nothing calls.
7. **Tighten the prefilter.** Require edit, test or tool evidence. Delete the depth-only branch.
8. **Move the archaeology stage before authoring.** Draft the candidate body only when the verdict exists. This is the target design; items 1 and 7 protect the user until it lands.
9. **Reclaim disk.** Run a full `VACUUM` monthly after the purge. Set the backup `reset` retention to a bounded count, for example 3 (`backup.service.ts:106-110`).
10. **Refresh the status tiles.** Refresh on tab switch and on a slow timer. Scope the skills count to the active workspace.