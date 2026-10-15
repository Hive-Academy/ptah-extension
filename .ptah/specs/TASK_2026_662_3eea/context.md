# Task Context - TASK_2026_662_3eea

## User Request

> go , i like retiring old and unused code that bloating everything around it

(2026-10-14, approving the purge plan: carve-out first, then delete, then archive and drop data.)

> so if we decided to leave what we have and fix it so we clear these old broken data for skills, and focus on 2
> things the one we agreed on which is for lanes evaluations and learnings, but also we leave enhancing our
> subagents and own skills, and delete the broken new skill suggestions ( or surgically fix it ) what you think ?

(2026-10-15, user direction: keep and fix in place, no carve-out. TASK_2026_646_136a decisions #22, #23.)

## Plan shape (revised 2026-10-15)

1. **Keep in place** — no new home. These stay in `libs/backend/skill-synthesis`,
   `libs/frontend/skill-synthesis-ui` and `libs/backend/harness-sync`:
   - the Library: manual edit, clone, history and revert of skills and agents;
   - harness sync of skills and agents to the CLIs;
   - per-agent invocation telemetry (`skill_invocation_events`), session verdicts (`skill_session_verdicts`), the
     spec harvester and skill-load counting. TASK_2026_646_136a reads them through a port and decouples them from
     `skillSynthesis.enabled`;
   - memory (untouched).
2. **Fix the kept parts:**
   - `succeeded: true` is hard-coded (`skill-trigger.service.ts:510,675`). Write `null` for a run with no grade,
     and reset the 6,295 ungraded rows of `skill_invocation_events` to `null`.
   - "Enhance now" becomes a manual draft with a diff. It never applies changes automatically. Its before/after
     check uses the Agents-tab outcome signals from TASK_2026_646_136a Requirement 9. Fix or retire
     `getAgentModels` (it times out; only the enhance model picker uses it).
   - **Proposal, needs user confirmation:** the Skills and Commands tabs' "Success %" is also 100% by
     construction (202 of 202 prompt expansions). Replace it with a use count now and lift later. This reopens
     the "Skills/Commands tabs stay" part of TASK_2026_646_136a decision #13.
   - Stop the bulk-seed snapshots (832 files under `~/.ptah/user/**/.history/`, same timestamps across agents).
3. **Delete in place** everything marked remove-proposed in `.ptah/specs/TASK_2026_659_cec4/parity-inventory.md`:
   prefilter, archaeology, synthesis, judge, judge panel, replay, trigger eval, skill curator, drain crons and
   queue, candidates and suggestions (new-skill suggestions are deleted, not fixed: every candidate is
   single-session), promotion and `SkillInvocationTracker`, the automatic agent rewrite, the Recommended /
   Sessions / Activity tabs, about 87 settings keys, and their specs. Remove the promoted skill
   `execute-phase-gated-task` (duplicates `orchestrate`); ask the user about
   `extract-and-relocate-angular-component-feature`.
4. **Data** — export to an archive file, then drop with a migration: `skill_candidates`, `skill_suggestions`,
   `skill_synthesis_queue`, `skill_synthesis_budget`, `skill_invocations`, and the skill jobs' `job_runs` history.
   Prune the bulk-seed snapshots; keep the snapshots of user edits (revert depends on them).
   **Show the exact table list to the user and get approval before the drop.**

Depends on TASK_2026_646_136a (its read seam must land first). Replaces TASK_2026_660_c1ac (cancelled).
