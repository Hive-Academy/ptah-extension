# Batches — TASK_2026_334

Two batches, file-disjoint, run in parallel. Batch A is the orchestrator's;
Batch B is delegated to the Codex CLI (`ptah_agent_spawn`).

The two LOW findings in `cli-agent-runtime` (items 2 and 3 of `context.md`) are
DEFERRED, not dropped. A concurrent session committed `a2c28d3a1` in
`agent-process-manager.service.ts` while this task was being planned, so those
files have another writer. They become Batch C once that session is done.

## Batch A — the Electron quit reaps before it flushes (orchestrator)

Defect 1 plus LOW finding 1. Both are in one file and one ordering rule.

Files:

- `apps/ptah-electron/src/activation/shutdown.ts`
- `apps/ptah-electron/src/main.metadata-flush.spec.ts`
- `apps/ptah-electron/CLAUDE.md`

The flush must run AFTER the agents are reaped, because a reference staged by an
agent exit goes through `retryWithBackoff` with a 1000 ms first delay. The
existing spec asserts the losing order and must be inverted, not worked around.

## Batch B — bound the stream batch buffer (Codex CLI)

Defect 2. Cap `inFlight` and back-pressure the producer without reinstating a
per-send await, which would undo the coalescing win of `b401e65eb`.

Files:

- `libs/backend/rpc-handlers/src/lib/chat/streaming/stream-batch-buffer.ts`
- `libs/backend/rpc-handlers/src/lib/chat/streaming/stream-batch-buffer.spec.ts`
- `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.ts`
- `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-broadcaster.service.spec.ts`

Report: `batch-b.report.md`

## Batch C — the three remaining LOW findings (two CLI agents, in parallel)

Run once the concurrent session had stopped writing to `cli-agent-runtime`.

### C1 — Codex CLI

- LOW 2 — `getMaxConcurrentAgents` clamps to 1..20, non-finite falls back to 5.
  The bounds are exported from `cli-agent-runtime` and `agent-rpc.handlers.ts`
  imports them, so the number now has one definition.
- LOW 3 — `trimBufferToLowWater`'s no-newline fallback advances past a low
  surrogate. The newline branch is left alone: `\n` is never part of a pair.

Report: `batch-c1.report.md`

### C2 — Antigravity CLI

- LOW 4 — `_deleteInternal` flushes the staged session list BEFORE it deletes
  the per-agent output keys, so a failed flush destroys nothing.

Report: `batch-c2.report.md`

## Review finding on Batch A, fixed alongside Batch C

`agentProcessManager` is resolved eagerly pre-window, so after Batch A
essentially every quit is deferred and every quit awaits the final flush — which
was unbounded. The flush never rejects, but a storage that is going away can
leave it pending forever, ahead of the `finally` that re-issues `app.quit()`.
Now bounded by `METADATA_FLUSH_BUDGET_MS` through the same `withBudget` helper.
Pinned by `gives up on a flush that HANGS, so the app stays closable`.

## Verification (orchestrator)

```
npx nx run-many -t test -p @ptah-extension/rpc-handlers ptah-electron
npx nx run-many -t typecheck -p @ptah-extension/rpc-handlers ptah-electron
npx nx run-many -t lint -p @ptah-extension/rpc-handlers ptah-electron
```
