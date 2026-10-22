# Decisions

| Decision | Source | Evidence | Reversible |
| --- | --- | --- | --- |
| REFACTORING / Partial | model, known user scope | Improve existing description and template contracts, no new product surface | Yes |
| Work in refactor/skill-routing from main | user-requested / project-rule | User requests separate worktree; CLAUDE.md requires it | Yes, retain until user asks removal |
| Limit source edits to shipped skills, templates and directly related tests | user-requested | Conversation explicitly excludes local copies and runtime discovery changes | Yes, user approval needed to expand |
| Use lanes-first, lane-review document gates | project-rule / remembered preference | orchestration Gate 0.1 and live available lanes | Yes |
| Use grok for initial architecture | model | codex disabled, opencode AT LIMIT, grok installed with confirmed room | Yes |
| Do not commit or push | project-rule | No explicit user authorization | Yes, user may authorize |
| Gate 2 passed after revision 1 | project-rule / peer validated | implementation-plan-review.md APPROVED, Grok CLI author and independent in-process architect reviewer; all five original blockers resolved | Yes |
| Reuse TOOLING_PRECEDENCE shared partial, preserve wizard slots | peer validated | Plan audit and review verify every role already expands this partial, avoiding a new resolver identifier | Yes |
| Audit all 28 shipped skills; revise 8 and retain 20 with task-specific evidence | peer validated | Approved implementation-plan.md and implementation-plan-review.md; no uniform negative-boundary requirement | Yes |
| Treat catalog entries as candidates, not assignments; preserve access policy and mandatory prerequisite stops | user-requested / peer validated | Approved shared-rule contract, review P1 dispositions | Yes |
| Manual task reservation in worktree | model / project-rule | Task MCP has no worktree target; prevent writes to main. Scanned local worktrees (max 712) after fetch; created exclusive TASK_2026_713_e067 carrier | Yes |
