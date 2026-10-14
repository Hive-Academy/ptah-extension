# Task Context - TASK_2026_662_3eea

## User Request

> go , i like retiring old and unused code that bloating everything around it

(2026-10-14, approving the purge plan: carve-out first, then delete, then archive and drop data.)

## Plan shape

1. **Carve-out** — done inside TASK_2026_646_136a: telemetry, verdicts and skill-load counting move to the new
   outcome-record home. This task moves the Library (manual edit, clone, history, revert) to the home that the
   TASK_2026_646_136a architecture designs.
2. **Delete** everything marked remove-proposed in `.ptah/specs/TASK_2026_659_cec4/parity-inventory.md`:
   prefilter, archaeology, synthesis, judge, judge panel, replay, trigger eval, skill curator, drain crons and
   queue, candidates and suggestions, promotion and `SkillInvocationTracker`, "Enhance now" and
   `getAgentModels`, the Recommended / Sessions / Activity tabs, about 87 settings keys, and their specs.
3. **Data** — export the skill tables to an archive file, then drop them with a migration. **Needs a separate
   user approval before the drop.**

Keep: `libs/backend/harness-sync`, memory, and everything TASK_2026_646_136a moved.
Replaces TASK_2026_660_c1ac (cancelled).
