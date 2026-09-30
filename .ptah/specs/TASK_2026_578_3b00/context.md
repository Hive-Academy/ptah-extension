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
2. **Judge gate that decides.** Use the rubric from TASK_2026_473 Track B when it lands. Below the threshold:
   reject automatically. Above: show in Recommended. The judge panel result must change state, not only
   record.
3. **Accept means promote.** Accepting a suggestion creates or promotes a `skill_candidates` row, so the
   counters, the cap and retirement see it. Fix the existing 2 accepted suggestions with a migration or a
   one-time backfill.
4. **Usage-based retirement.** Read `skill_invocation_events`. No use for N days: set dormant. M more days:
   remove SKILL.md and mark retired. Pinned and user-authored skills are exempt. N and M are settings.
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
4. Invocations shown in the UI match `skill_invocation_events` for promoted skills.
5. Reachability proof for each new pass: a boot or integration spec fails if the production path does not
   call it.
