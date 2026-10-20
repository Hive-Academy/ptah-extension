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

## Session 2026-10-18 — user decisions and Gate 0.1

User approved the full epic ("approved i would like to complete the full epic for the skills"), scope
TASK_2026_639 (children 644, 435) + this task. TASK_2026_640 stays a separate later epic.

1. **Removals approved**: everything `remove-proposed` in `../TASK_2026_659_cec4/parity-inventory.md`.
2. **Promoted skills**: remove both `execute-phase-gated-task` and
   `extract-and-relocate-angular-component-feature`.
3. **Data drop approved**: export to an archive file first and verify it, then drop `skill_candidates`,
   `skill_suggestions`, `skill_synthesis_queue`, `skill_synthesis_budget`, `skill_invocations` and the
   skill jobs' `job_runs` rows; prune the bulk-seed snapshots (keep user-edit snapshots).
4. **Success % (new requirement, replaces the "use count" proposal)**: user answer verbatim —
   "why don't we utilize the task folder reviews extensive files that the agent generate to count success
   rate and also learn enhancements ?". So: derive the Skills/Commands/Agents success rate from the graded
   artifacts in `.ptah/specs/TASK_*` (batches.md verdicts, code-logic-review.md / code-style-review.md
   verdicts, judge-round-*.json, *-review.md), and feed their findings into the manual "Enhance now"
   draft. Starting point: the kept `SpecHarvesterService` (`libs/backend/skill-synthesis/src/lib/spec-harvester.service.ts`)
   already reconciles agent events against batch verdicts and feeds review findings to the enhancer, but it
   writes through `SkillCandidateStore` (to be deleted) and only covers agents. Ungraded = `null`, never 100%.

Gate 0.1: preference from memory = lanes-first (codex first), cross-family review. Mode `enabled`,
approval `lane-review`. Removals were approved by the user above.
Lanes (ptah_agent_list 2026-10-18): codex confirmed room (weekly 9%); grok, Glm (Ollama Cloud),
antigravity unknown; opencode near limit (monthly 93%) — avoid; copilot disabled; cursor, pi not installed.

## Orchestrator decisions (2026-10-18, Gate 2)

| # | Decision | Evidence | Reversible |
| - | -------- | -------- | ---------- |
| D1 | Revise round 2 uses one ordering rule: add new code beside old, switch consumers, cut each consumer's pipeline imports, delete pipeline dirs, remove shared contracts (DI tokens, RPC types, push message constants) last. A batch may exceed the 6-file cap when it only removes imports/usages of already-dead code across one project. | Round-1 re-review N1-N4: every piecemeal reorder broke another consumer. | Yes |
| D2 | mcp-bench suites that test only deleted pipeline code are deleted with it ("and their specs" in the approved removal). Suites with another purpose are repointed to archived fixtures. The two plan Clarifications (cursor/vec tables) stay retained until the user answers. | User approval of removals incl. specs (task.md description; 2026-10-18 decision 1); re-review N7. | Yes (git) |
| D3 | **User-approved 2026-10-18**: also drop `skill_synthesis_workspace_cursor` and `skill_candidates_vec` after the verified archive (user: "i think those 2 tables has no use, if thats the case lets delete them"). Verified: the only readers are `skill-queue.store.ts` and `skill-candidate.store.ts` (both deleted); `embedder.interface.ts:6` is a comment to update. | git grep on the worktree | No (data) — archive first |
| D4 | **User decision 2026-10-18 (Gate 2 escalation at revise cap)**: accept the plan's design; the team-leader decomposition must fold in round-2 findings R1-R6 (`implementation-plan-review-round-2.md`) as mandatory fixes. Every batch passes its scoped checks before commit; a batch that hits a missed consumer stops and is fixed in place. | User answer "Fold into decomposition (Recommended)" | Yes |
