# TASK_2026_505_1d73 — context

## Triage 2026-10-30

Backlog audit after the October refactors: partly delivered, still open.

- Still open: Only the gridstack version lift and its canvas verification remain. The two tribunal-panel fixes no longer apply because the library was removed by dea55817c (PR #845).
- Evidence on main: Both named tribunal fixes are moot: libs/frontend/tribunal-panel was removed from main by dea55817c (PR #845, 2026-10-29, "retire the Tribunal page"). The gridstack half still applies: main:package.json:175 still pins gridstack ^12.5.0.
