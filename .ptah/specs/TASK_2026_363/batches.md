# Batches — TASK_2026_363

Executors are CLI agents (`ptah_agent_spawn`). Batches are file-disjoint and run in parallel.

## Batch A — watchdog holds for idle turns and subagent lifetime (Claude CLI, opus)

Files:

- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts` (+ `.spec.ts`)
- `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-query-executor.service.ts` (+ `.spec.ts`)
- `libs/backend/agent-sdk/src/lib/helpers/subagent-hook-handler.ts` (+ `.spec.ts`)
- `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts` (+ `.spec.ts`)
- `libs/backend/agent-sdk/CLAUDE.md`

Report: `batch-a-report.md`

## Batch B — bounded `sendToSubagent` (Codex)

Files:

- `libs/backend/agent-sdk/src/lib/helpers/subagent-message-dispatcher.ts` (+ `.spec.ts`)

Report: `batch-b-report.md`

## Verification (orchestrator)

- `npx nx run-many -t test -p @ptah-extension/agent-sdk`
- `npx nx run @ptah-extension/agent-sdk:typecheck`
- `npx nx run @ptah-extension/agent-sdk:lint`
- Live repro: resumed session idle > 3 min stays alive; a subagent asked for one 30 KB `Write` completes.
