# Batch 62: skill synthesis DI token purge

## Changes

- `libs/backend/skill-synthesis/src/lib/di/tokens.ts:67`: removed the 24 specified dead token keys and their documentation. Preserved all 16 retained keys and four top-level token constants.
- `libs/backend/skill-synthesis/src/lib/di/register.spec.ts:69`: kept four unregistered-token guards using their `Symbol.for(...)` values. The retained-token uniqueness check remains at line 83; removed the queue and budget description assertions.
- `apps/ptah-electron/src/activation/wire-runtime.spec.ts:245`: removed the unused synthesis-service fake registration. The skill trigger, invocation recorder, and other test wiring remain.
- `apps/ptah-electron/src/di/phase-2-libraries.ts:395`: corrected the registration comment.

## Acceptance search

`rg -nw` across `libs apps tools` for all 24 removed names, excluding `**/migrations/**`: **0 matches outside migrations**. Search covered all 24 names in one invocation using separate `-e` arguments; `rg` exit status was 1 (no matches).

## Decisions

- Left `register.ts` and `index.ts` untouched because neither references a removed token.
- Left the token-file header unchanged because it does not mention any removed token.
- Kept the Electron test meaningful by retaining its active skill trigger and telemetry wiring; only the obsolete fake was removed.

## Could not do

- Did not run Nx, Jest, TypeScript, lint, build, or other checks, as instructed. Text search and UTF-8/LF inspection were performed.
