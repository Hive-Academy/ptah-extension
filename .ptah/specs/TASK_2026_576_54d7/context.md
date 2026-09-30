# Task Context - TASK_2026_576_54d7

## User Request
At TASK_2026_575_fee7 Gate 2, asked what to do if the landing app never reaches Angular stability because of GSAP/Lenis animation loops (assumption A4): "lets file a new task for it and inlcude it in the same pr"

## Task Type
BUGFIX

## Complexity
Medium (contingent)

## Strategy
BUGFIX, plan-free: [research] → team-leader → QA. Contingent on TASK_2026_575's E2E English control run failing on stability. Runs on branch `claude/sleepy-turing-pdzxlm`, same PR as TASK_2026_575.

## CLI Lanes
Same as TASK_2026_575_fee7: no `ptah_agent_*` tools in this cloud session; lanes disabled.

## Conversation Summary
- Parent: TASK_2026_575_fee7 (implementation-plan.md A4, Risks row 1, Component 6 app-stable marker, Component 15 E2E).
- Candidate sources: `apps/ptah-landing-page/src/app/app.config.ts` (`provideGsap`), `libs/web/landing/.../builders-section.component.ts`, `comparison-tug-meter.component.ts`, `pillars-spine.component.ts`, `libs/web/legal/.../falling-cubes-background.component.ts`.
