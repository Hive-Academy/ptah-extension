# Batch B fix round

## What was wrong

`dock-overflow-duration.spec.ts` retained pre-change expectations that a zero-capacity dock renders one to five chips, and that six agents at zero capacity leave one chip visible. The approved agent-dock design allows zero chips when the dock cannot fit a chip and overflow trigger. Every agent, including the selected agent, must then be reachable through overflow.

## What changed

- Updated the zero-capacity cases for 1, 5, and 6 agents to expect all agents in overflow and explicitly check the selected agent remains there.
- Changed the six-agent case to use five available slots and verify the five-chip cap, one hidden agent, and a late selected running agent kept inline.
- Left `dock-overflow.ts` unchanged because its zero-capacity behavior matches the design.

## Verification

`npm run verify -- -t test -p @ptah-extension/canvas -- --testPathPatterns=dock-overflow|canvas-lane-tabs|agent-dock-menu` completed in the foreground with exit code 0; Nx reported 1 task succeeded. Scoped `ptah_get_diagnostics` reported no errors in the changed spec. It reported 11 errors in sibling files outside this fix, including `canvas-lane-tabs.component.spec.ts` and `canvas-rail-board.component.spec.ts`.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Update the legacy assertions and keep the planner. | Keep zero chips with all agents in overflow; or render a chip despite zero capacity. | `design-spec.md` Agent dock requires room for the overflow trigger and puts the selected agent in overflow when a pill and trigger cannot fit; `task-description.md` part B requires the selected agent to remain reachable. Existing planner and batch B report follow that contract. | Yes |

## Limitation

The host exposed no skill-loading tool, so the assigned `angular-frontend-patterns` skill could not be loaded. This fix changes only Jest assertions.
