# Batch 35a report — Tasks 35.1, 35.2 (S4 Wave D, W1)

## Files

- CREATED `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-budget-guard.ts` — `LaneBudgetGuard` (plain class, no DI token), `LaneBudgetThresholds { steerAt, stopAt, repeatAt }`, `LaneBudgetAction` (`none` | `steer{message}` | `stop{stopReason}`), `LaneBudgetStopReason`, `laneBudgetSteerMessage(n)`.
- CREATED `libs/backend/cli-agent-runtime/src/lib/cli-agents/lane-budget-guard.spec.ts` — 10 tests.
- MODIFIED `libs/shared/src/lib/types/agent-process.types.ts` — `AgentProcessInfo.stopReason?: 'tool-call-budget' | 'repeat-call' | string` (documented; mutable like `exitCode`/`completedAt`, since the manager sets it at stop time).

## Behaviour (for Task 35.4)

- `guard.observe(segment)` per segment; non-`tool-call` segments return `none`.
- Per `tool-call`: counter +1, repeat-map[key] +1. Order of checks: repeat-at → `stop 'repeat-call'`; stop-at → `stop 'tool-call-budget'`; first time count ≥ steer-at → `steer` with "You have made N tool calls. Stop exploring, finish the deliverable now, and report." (exactly once).
- Key: tool name + key-sorted `JSON.stringify(toolInput)`; else name + trimmed `toolArgs`; else name alone.
- After a stop, every later segment returns `none`; the repeat map is cleared. Map size is bounded by stop-at. No timers. The guard only decides — the manager delivers the steer (`sendToAgent`) and performs the stop.
- Thresholds come from the constructor; the settings read is Task 35.3. No validation of threshold values in the guard (35.3 resolves invalid values to defaults).

## Spec coverage

Steer once at 40 / stop at 60 (80 distinct calls); exact steer text; repeat-call at 20; custom thresholds (3/5/4) for both budget and repeat paths; non-tool-call segments ignored; reordered `toolInput` keys count as one call; `toolArgs` and name-only keys; `none` after stop; 200 identical `glob` calls stop at 20 (`repeat-call`); 200 varied `glob` calls steer at 40 and stop at 60 (`tool-call-budget`).

## Checks

- `npx jest -c libs/backend/cli-agent-runtime/jest.config.ts lane-budget-guard` — 10/10 passed.
- `npx nx run-many -t test,lint,typecheck -p @ptah-extension/cli-agent-runtime @ptah-extension/shared --parallel=2 --skip-nx-cache` — "Successfully ran targets test, lint, typecheck for 2 projects".
- Affected typecheck (`nx show projects --affected --files=libs/shared/src/lib/types/agent-process.types.ts`, 80 projects, 75 with typecheck) — 62 passed, 13 failed: `api-identity`, `api-membership`, `api-notifications`, `api-community`, `api-marketing`, `api-licensing`, `api-admin`, `api-forum`, `api-learning`, `api-member-hub`, `api-billing`, `ptah-license-server`, `ptah-landing-page-e2e`. Not caused by this batch: the errors seen are Prisma types (`Property 'marketingCampaignTemplate' does not exist on type 'PrismaService'`, `'createdLicense' is of type 'unknown'`), `node_modules/.prisma/client` does not exist in this worktree (Prisma client not generated), and no error line mentions `agent-process.types.ts` or `lane-budget-guard` (grep count 0). Every ptah-extension app/lib that consumes `AgentProcessInfo` passed.
- `npx nx run di-lint:lint` — passed.
- `npx nx run degradation-audit:lint` — "Successfully ran target lint for project degradation-audit".
- `*.png` restore — no rewritten PNGs.

## Deviations

None. The guard is not exported from `cli-agents/index.ts` (the only consumer, the manager, is in the same lib); Task 35.4 imports it relatively.

## Out-of-scope observations

- The 13 affected-typecheck failures need `prisma generate` in this worktree before an app-wide typecheck can be green; the orchestrator may want to run it before the Batch 35 gate.
