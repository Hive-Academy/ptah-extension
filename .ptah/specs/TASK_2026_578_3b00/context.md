# Task Context - TASK_2026_578_3b00

## Background

Live state on 2026-09-30: `skill_candidates` has 578 `candidate` and 1,876 `rejected` rows, 0 promoted.
`skill_suggestions` has 13 pending, 2 accepted, 2 dismissed. `skill_invocation_events` has 4,176 rows. The
Skills page shows Promoted 0, Active skills 0, Invocations 0.

The parts exist but do not form a loop. Paths are relative to `libs/backend/skill-synthesis/src/lib/`.

| Gap | Evidence |
| --- | --- |
| Nothing merges suggestions or promoted skills into a broader skill. The suggestion pass clusters the newest 200 candidates (single linkage, 0.78, at least 2 members) and synthesizes one skill per cluster. The members stay `candidate`. | `skill-curator.service.ts:390-536`, `skill-clustering.service.ts:41-73` |
| The 24h curator never deletes. Its overlap/stale review only writes a report to `~/.ptah/curator-reports`. It is skipped when there are 0 promoted skills. | `skill-curator.service.ts:4-6, 245-356, 853` |
| No retirement from real use. The only demotion is the cap (`maxActiveSkills` 200) inside promotion, and its decay score reads `skill_invocations`, not `skill_invocation_events`. | `skill-promotion.service.ts:276-302`, `skill-candidate.store.ts:421-441` |
| Automatic promotion has no production caller. `SkillInvocationTracker.recordInvocation` is called only by a CLI e2e spec. Runtime invocations go to `skill_invocation_events` by slug. | `skill-invocation-tracker.ts:74-84`, `triggers/skill-trigger.service.ts:625` |
| `acceptSuggestion` writes SKILL.md to `~/.ptah/skills` and a `skill_registry` row, but creates no promoted candidate. The Promoted and Active counters count `skill_candidates` with `status='promoted'`, so accepted skills never show. | `skill-curator.service.ts:547-606`, `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:513-516, 705-708` |
| The judge panel only records scores. `replay` has a handler but no producer. | `queue/stage-handlers.service.ts:541-563` |

## Goal

Fewer, broader, used skills. Every skill is either used, merged into another skill, or retired.

## Scope

1. **Umbrella merge.** A curator pass clusters candidates, pending suggestions and promoted skills. Each
   cluster produces one broad skill (SKILL.md plus `references/` for variants, per `skill-creator`).
   Members are marked `merged-into:<id>` and leave the Recommended list.
2. **Judge gate that decides.** This task does not wait for TASK_2026_473 Track B. Until Track B lands, the
   gate uses the current `SkillJudgeService` rubric: novelty, actionability, scope, generalization and
   triggerClarity, each 1-10, averaged (`skill-judge.service.ts:97-132, 344-350`). The threshold is the
   existing `minJudgeScore` 6.0 (`skill-synthesis.service.ts:145`). When Track B lands, its rubric and its
   re-derived threshold replace both. Below the threshold: reject automatically. Above: show in
   Recommended. The judge panel result must change state, not only record.
3. **Accept means promote.** Accepting a suggestion creates or promotes a `skill_candidates` row, so the
   counters, the cap and retirement see it. The row's `name` is the materialized slug `md.slug`, not
   `suggestion.name` (`skill-curator.service.ts:562-568`). The two can differ: `writeAtRoot` sanitizes the
   slug and adds a `-2` to `-5` suffix on collision (`skill-md-generator.ts:209-236, 278-285`). Set the
   `skill_registry` row's `candidateId` to that row; today it is `null` (`skill-curator.service.ts:589`).
   The automatic path has the same gap: `promoteToActive` gets `candidate.name`, but `promoteAtomically`
   never stores `materialized.slug` (`skill-promotion.service.ts:308-321`). Store it there too. Fix the
   existing 2 accepted suggestions with a migration or a one-time backfill that takes the slug from their
   `skill_registry` row (`cloneStatus = 'synth'`).
4. **Usage-based retirement.** Join key: `skill_invocation_events.skill_slug` (`0021_skill_invocation_events.ts:4`,
   index `idx_skill_inv_events_slug`) equals the promoted skill's materialized slug, stored in
   `skill_candidates.name` per item 3. Runtime writes that slug from the Skill tool command or the prompt
   expansion (`triggers/skill-trigger.service.ts:611-622, 673-683, 693-706`). Today
   `listActiveOrderedByDecayScore` reads `skill_invocations` by candidate id through `listInvocations`
   (`skill-candidate.store.ts:421-441, 1479-1487`), and the activity score does the same (`:570-571`).
   Both move to `skill_invocation_events` by slug. No use for N days: set dormant. M more days: remove
   SKILL.md and mark retired. Pinned and user-authored skills are exempt. N and M are settings.
5. **Backlog purge.** One-time pass that rejects candidates older than 30 days that are in no cluster.
6. Show merged, retired and dormant counts in the Skills diagnostics.

## Out of scope

- Rewriting the generator prompt (TASK_2026_473 Track B owns it).
- The evidence-first archaeology pipeline (TASK_2026_439 phase 5).

## Acceptance criteria

1. On a copy of the live database, the umbrella pass reduces 13 pending suggestions and 578 candidates to a
   measured, smaller set. A blind reviewer scores at least half of the merged skills 6.0 or above.
2. Accepting a suggestion increases Promoted and Active skills in the UI.
3. A spec proves: an unused skill goes dormant after N days, retired after N+M, and a pinned skill does not.
4. Invocations shown in the UI match the `skill_invocation_events` rows whose `skill_slug` equals each
   promoted skill's `skill_candidates.name`. A spec covers a skill materialized with a collision suffix.
5. Reachability proof for each new pass: a boot or integration spec fails if the production path does not
   call it.

## User Decisions (2026-10-01)

- CLI lanes (Gate 0.1): antigravity + Glm for cross-side reviews. Codex not used (usage limit). Max 2 lanes in flight.
- CLI lanes revised (2026-10-01, resume session): use opencode with `opencode-go/kimi-k2.7-code`, Glm
  (ptah-cli `pc-355b645d-35af-4974-84cf-9cf961ea0164`) and antigravity, along with in-process sub-agents. Max 2
  lanes in flight is kept. Reviews stay cross-side.
- 2026-10-01 18:38: opencode Go returned "Go usage limit exceeded" (Batch 7 security lane failed twice). Kimi lanes
  are unavailable until the quota resets; antigravity and Glm carry the review lanes.
- 2026-10-01 19:42: Glm (Ollama Cloud) returned 429 "session usage limit". Only antigravity remains for CLI review
  lanes (it had stream interrupts, one Gemini safety-filter block and one 503 earlier in this session).
- Flow: FEATURE at Partial depth. context.md is the requirements source (no PM, no task-description.md).

## Cross-session coordination (TASK_2026_580 / 584, coordinator session)

- Migration `0051_skill_lifecycle` is agreed; 580 keeps `0050_session_organization`.
- Twelve migration specs pin the latest version, not three: 0028, 0030, 0038, 0039, 0040, 0041, 0042, 0043, 0044, 0045, 0046, 0047 (`libs/backend/persistence-sqlite/src/lib/migrations/*.spec.ts`; 10 use `toBe(49)`, 0044 and 0046 list versions in an array). 580 bumps them to 50 with the comment `// 50 since TASK_2026_580 appended 0050_session_organization.`. 578 bumps the same 12 to 51 and adds its own comment line beside it.
- Merge order: either order works at runtime (the runner reads applied versions as a set). Whoever merges second rebases the `index.ts` order and the 12 asserts to the higher number. Tell the coordinator before the migration commit.
- TASK_2026_586 (this session) removes `skill-diagnostics-accordion.component.ts` and moves its rows into `skill-pipeline-status.component.ts`. 578 UI counters must target the surviving component, and 578 rebases on 586.
- Correction (on disk, batches.md R-a): 0044 and 0046 are multi-line `toBe(49)` asserts, not arrays. All 12 became `toBe(51)`; no 50 appears on this branch.
- G-580 RESOLVED (2026-10-01). Coordinator reply (TASK_2026_584/580 orchestrator, session `ptah-ptah-extension-continue-task-584-an-416de600005og2pv0fas808`), verbatim:
  "ok: commit 578 migration 0051 and the 12 asserts as described. This is from the TASK_2026_584/580 orchestrator.
  - I checked the user_version point on the 580 branch. migration-runner.ts decides what to apply from the schema_migrations set and only writes PRAGMA user_version (the vec catch-up at :367-369 rewrites it to max(applied)). Nothing reads it to choose migrations, so applying 0050 after 0051 is safe.
  - The merge plan is unchanged. Whoever merges second rebases the index.ts order and the 12 asserts. 580 is still several batches away from its PR, so 578 likely merges first and 580 rebases. I will handle that rebase on the 580 side.
  - 586 / PR #620: noted. 580 and 584 do not touch the Thoth feed files. TASK_2026_439 stays in_progress until 586, 587 and 588 merge."
- Consequences: Batches 1-3 commit in order; 578 likely merges before 580 (580 owns the G-580-merge rebase); 578 still rebases on 586 (PR #620) before Batches 10-14 (G-586).

## Gate 2 (2026-10-01)

- implementation-plan.md Revision 1 (with the F7 edit: twelve max-version specs bumped to 51): APPROVED by the user.
