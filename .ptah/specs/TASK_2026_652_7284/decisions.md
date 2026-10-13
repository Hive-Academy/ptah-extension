# Decisions - TASK_2026_652_7284

| # | Decision | Options | Evidence | Reversible | By |
| - | -------- | ------- | -------- | ---------- | -- |
| D1 | Skip the PM phase; Partial depth | PM → architect; architect only | Requirements, user decisions and verified defects already in `TASK_2026_647_1b0f/context.md`; three research reports in `research/` | yes | orchestrator |
| D2 | Type FEATURE (higher row than BUGFIX/REFACTORING) | FEATURE, BUGFIX, REFACTORING | New RPC, new manifest version, freshness check are additions; orchestration classification table | yes | orchestrator |
| D3 | Lanes enabled, approval lane-review | enabled / disabled | Most recent memory `orchestration-executor-preference` (lanes-first); user ran `/agent-lanes` this session | yes | orchestrator |
| D4 | One architect lane writes both `parity-inventory.md` and `implementation-plan.md` | separate inventory-only call; one call | The slice changes an RPC contract and a persisted format, not a UI surface; one call saves a lane round | yes | orchestrator |
| D5 | Codex author revise lanes started fresh with a handoff brief (runtime refused resume: context > 60k) | resume; fresh lane | Spawn results for agents 60951081 and a76f3d2b | yes | runtime / orchestrator |
| D6 | Gate 2 escalated to the user at the revise cap; F18-F21 handed to team-leader as binding notes | another design round; binding notes | implementation-plan-review.md F18-F21 are batch-ownership and check-scope items, no design change; user APPROVED | yes | user |
