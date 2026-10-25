# Context - TASK_2026_720_6f98

## Request

User (2026-10-25), during TASK_2026_701_9e4b: asked how skill trajectory and learning work after
the TASK_2026_662 purge, whether lanes are read and scored properly, and whether escalations,
lane reports, user messages and AskUserQuestion answers enter the trajectory scorer. Then: "make
sure you add these new enhancements for user records".

## Findings (orchestrator investigation, 2026-10-25, main at 17860fd8b)

What works today:
- Lane completion verdict (delivered / no-deliverable / failed / unverified) is persisted to sqlite
  `lane_outcome_records` (`lane-completion-outcome.ts:28-62`, migration `0054_lane_outcome_records.ts`).
- `ptah_outcome_report` stores review verdicts (`outcome-report.tool.ts:90-207`,
  `sqlite-lane-outcome.store.ts:160`).
- Lane ranking uses delivered rate and approved rate per family/model/taskKind after 5 verified runs
  in 90 days (`lane-routing/src/lib/matrix/local-derivation.ts:252-295`, `routing-constants.ts:152-155`).
- Skill scorecard reads harvested pass/fail grades from `skill_task_grades`; enhancement is a user
  action only (Preview -> Apply).

## Scope (proposed, to be refined by PM)

1. **User signals into the scorer (user request).** None of these is recorded for scoring today:
   - lane `ptah_agent_report` content (only a report count reaches the completion signal);
   - escalations (REVISE at the revise cap, removals sent to the user, same-side review fallbacks);
   - user corrections and overrides in chat (redo, stop, "you are wrong", overturned decisions);
   - AskUserQuestion answers (which option, whether the recommended option was chosen).
   Record them per run and let ranking and the skill scorecard use them (for example "escalated"
   and "user overruled" outcomes).
2. **CLI-lane grades reach the skill scorecard.** `findAttributions` only takes
   `executor_kind = 'subagent'` (`skill-synthesis/src/lib/skill-task-grade.store.ts:164`).
3. **Keep review scores and REVISE.** Only pass/fail is parsed; revise counts as fail
   (`skill-synthesis/src/lib/spec-extractor.ts:79,114`).
4. **Use revise rounds in ranking.** Stored but ignored (`local-derivation.ts:187-195`).
5. **Show lane/model scores in Electron.** Computed but no UI (`capability-matrix.store.ts:497`).
6. **Token and cost columns** are always null (`lane-completion-outcome.ts:54-56`).
7. **Frozen data and leftovers:** `skill_session_verdicts` has no writer but is still read
   (`skill-telemetry-seam.adapter.ts:106`); `enhance()` has no callers
   (`skill-enhancer.service.ts:541`); `linked` / `candidateId` are vestigial
   (`skill-registry-catalog.service.ts:68,76`); stale comment in
   `session-end-callback-registry.ts:8`. Removals need user approval.
8. **Tool availability.** `ptah_outcome_report` and `ptah_route_decide` are on main but were not
   listed in the published build used on 2026-10-25, so orchestration skipped outcome reports.
   Confirm they ship in the next release and that the orchestration skill calls them.

## Related

- TASK_2026_662_3eea (purge, merged #788), TASK_2026_701_9e4b (wizard/Library alignment, item 7
  grade expectations). Electron is the priority host.

## Next step

`/orchestrate TASK_2026_720_6f98` in its own worktree from `main`: PM -> architect -> team-leader.
