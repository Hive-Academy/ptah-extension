# Decisions - TASK_2026_872_f3b4

| # | Decision | Options | Evidence | Reversible |
|---|----------|---------|----------|------------|
| 1 | Type FEATURE, Partial depth | FEATURE Full / Partial | Known requirements from user; redesign of an existing surface | yes |
| 2 | Skip designer/prototype; require before/after Electron screenshots | designer + Gate 1.7 / skip | Target reuses two existing visual patterns (AGENTS table, PLAN LIMITS card) the user pointed at | yes |
| 3 | Architect = codex lane | codex / kimi code / subagent | codex is the only lane with confirmed room; Glm, grok, opencode AT LIMIT; memory conflicts on codex, user global rule says prefer non-Claude lanes | yes |
| 4 | Plan document review = orchestrator (in-process, opposite side to codex author) | subagent / orchestrator | Opposite-side rule; saves Claude usage per user rule | yes |
| 6 | Plan APPROVED by orchestrator (Gate 2, lane-review mode) | revise / approve | implementation-plan-review.md | yes |
| 7 | One codex lane implements both batches in sequence | two lanes / one lane | Batch 2 imports Batch 1 exports; same vendor; fewer spawns | yes |
| 8 | "Before" screenshot = the user's own sidebar screenshot; "after" Electron screenshot needs the app to run, which CLAUDE.md allows only on user request | run Electron / ask user | CLAUDE.md: never run build/serve/dev unless asked | yes |
| 5 | Moving per-run details out of LANES is user-approved | ask / treat request as approval | The user's own request proposes the move | yes |
