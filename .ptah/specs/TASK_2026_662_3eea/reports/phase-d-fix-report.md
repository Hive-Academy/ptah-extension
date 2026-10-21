# B1 manual preview judge fix

- `libs/backend/skill-synthesis/src/lib/skill-judge.service.ts:47`: Add the two-field `JudgeGateSettings` type and manual preview defaults; use the type in `judge()` at line 173.
- `libs/backend/skill-synthesis/src/lib/skill-enhancer.service.ts:50`: Use `JudgeGateSettings` in `isEligible`, `generateProposal`, and `enhance`.
- `libs/backend/skill-synthesis/src/index.ts:126`: Export the gate settings type and manual preview defaults.
- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.ts:339`: Pass the shared settings directly to manual preview and remove the partial settings cast.
- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.spec.ts:1653`: Pin both preview settings fields in the RPC assertion.
- `libs/backend/skill-synthesis/src/lib/skill-judge.service.spec.ts:149`: Add a regression case requiring one lane-runner call and a numeric scored decision.

## Decisions

- Keep the retired settings defaults in the skill-synthesis library so the RPC preview and judge share one typed value.
- Checks were not run, as instructed; the orchestrator runs them.
