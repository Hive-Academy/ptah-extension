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

## Deferred to Batch C

- LOW 2 — `getMaxConcurrentAgents` has no clamp to the documented maximum of 20.
- LOW 3 — `trimBufferToLowWater` can split a surrogate pair.
- LOW 4 — `session-metadata-store.ts` `_deleteInternal` drops the per-agent
  output keys before the staged session list is flushed. Its lib (`agent-sdk`)
  is disjoint from both batches above, so it can move as soon as someone takes
  it.

## Verification (orchestrator)

```
npx nx run-many -t test -p @ptah-extension/rpc-handlers ptah-electron
npx nx run-many -t typecheck -p @ptah-extension/rpc-handlers ptah-electron
npx nx run-many -t lint -p @ptah-extension/rpc-handlers ptah-electron
```
