# Batch B1 report — TASK_2026_655

## Files changed

- `libs/backend/rpc-handlers/src/lib/chat/streaming/stream-delta-coalescer.ts` (new): order-safe stream-delta merging and running byte estimates.
- `libs/backend/rpc-handlers/src/lib/chat/streaming/stream-delta-coalescer.spec.ts` (new): merge keys, barriers, source, metadata, and signature coverage.
- `libs/backend/rpc-handlers/src/lib/chat/streaming/live-message-projection.ts` (new): per-context live suffixes, lifecycle, seed, deferred anchors, byte cap, and `persistedBlocks` counts.
- `libs/backend/rpc-handlers/src/lib/chat/streaming/live-message-projection.spec.ts` (new): lifecycle, background, subagent, compaction, cap, and 300-context count coverage.
- `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-delivery-coordinator.service.ts`: global sequence, coalesced hidden retention, ordered reveal, requested resync, seed fields, deferred anchor routing, and metrics.
- `libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-delivery-coordinator.service.spec.ts`: sequence, overflow seed, requested resync, reveal ordering, deferred anchors, and surface-mode coverage.

## Plan mapping

| Rule | Implementation |
| --- | --- |
| Component 2: stream-only text/thinking/tool keys; same-message non-key and global barriers | `stream-delta-coalescer.ts:9`, `:61`, `:88` |
| Component 2: latest id/timestamp/signature, concatenated delta, O(1) byte increment | `stream-delta-coalescer.ts:67`, `:77`, `:33` |
| Component 3: root/subagent Open and suffix, complete block count domains, persisted boundary | `live-message-projection.ts:72`, `:88`, `:98` |
| Component 3: Close and turn-state rules; background root waits for complete boundary | `live-message-projection.ts:54`, `:59`, `:164` |
| Component 3: Task result and compaction clear contexts | `live-message-projection.ts:49`, `:68` |
| Component 3: ordered seed, content-only anchors, deferred anchors, `blockCounts` for all contexts | `live-message-projection.ts:124` |
| Component 3: 1 MiB cap, truncation, preserved `persistedBlocks`, single warning/metric per truncation | `live-message-projection.ts:5`, `:109`, `:164`; `chat-stream-delivery-coordinator.service.ts:139` |
| Component 4: negotiated-only projection feed, coalesced tail, running caps, global sequence | `chat-stream-delivery-coordinator.service.ts:125`, `:136`, `:270`, `:74` |
| Component 4: retained live state after terminal, ordered reveal, generation check, synchronous visible switch | `chat-stream-delivery-coordinator.service.ts:220`, `:285`, `:321` |
| Component 4: resync seed and `liveSeedBlocks`; deferred anchor injection and cleanup | `chat-stream-delivery-coordinator.service.ts:149`, `:297`, `:309`, `:318` |
| Component 4: `resyncTabIds` for visible, hidden, or stateless tabs; aggregate metrics | `chat-stream-delivery-coordinator.service.ts:188`, `:196`, `:55` |

The legacy path returns before projection work (`chat-stream-delivery-coordinator.service.ts:125`). `surfaceMode` events are excluded from projection and deferred injection (`:138`, `:149`). The coordinator keeps its existing tsyringe registration and `Logger` integration. The repo uses Node 24, TypeScript 6, Nx, Jest 30, and `tsyringe`, as documented in `package.json` and the existing coordinator.

## Verification

- **PASS** — `npx jest -c libs/backend/rpc-handlers/jest.config.ts <the three B1 spec files> libs/backend/rpc-handlers/src/lib/chat/streaming/chat-stream-delivery-coordinator.ws-switch-resync.spec.ts --coverage=false --maxWorkers=2`. Tail: `Test Suites: 4 passed, 4 total`; `Tests: 23 passed, 23 total`; `JEST_EXIT=0`. The workspace-switch reproduction spec passed with its assertions unchanged; it was not edited.
- **PASS** — `npx nx typecheck @ptah-extension/rpc-handlers --parallel=1`. Tail: `Successfully ran target typecheck for project @ptah-extension/rpc-handlers`; `TYPECHECK_EXIT=0`. Nx Cloud also printed a disabled-organization notice; the local target succeeded.
- **FAIL outside B1 scope** — `npx nx lint @ptah-extension/rpc-handlers --parallel=1`. Tail: `51 problems (1 error, 50 warnings)`; `LINT_EXIT=1`. The sole error is `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.spec.ts:121:11`, `no-unexpected-multiline`. That file is owned by Batch B2 and was not edited here. No lint finding named a B1 file.

All three commands used the task folder's shared `.check-lock`, released after each command. The ptah diagnostic service timed out; the successful project typecheck is the compiler result.

## Decisions

- Used plain classes in the existing streaming folder and retained the coordinator's DI contract. No new token, timer, or host dependency was added.
- Measured delta bytes directly from strings, with a conservative fixed metadata allowance for the first delta. Non-delta events use JSON serialization. This avoids serializing visible stream deltas.
- Kept truncated contexts until the complete batch or turn teardown so their block count and deferred anchor survive a stream `message_complete`.

## Open

- Batch B2 owns the lint error at `chat-rpc.schema.spec.ts:121` and the viewport schema/handler wiring for `resyncTabIds`; it must resolve that file before project lint can pass.
- The plan's A-1 JSONL persistence timing and A-2 frontend nesting assumptions require an integration run beyond the allowed B1 checks; they were not asserted by these host unit specs.
