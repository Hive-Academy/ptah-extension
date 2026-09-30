# Task Context - TASK_2026_539_67f5

## Origin

TASK_2026_494_ca38 named this follow-up (`TASK_2026_494_ca38/context.md:105`) but the folder was never filed. The
user asked to file it as backlog on 2026-10-01 while closing 494. The id is the one 494 already references, so every
existing reference resolves.

## Task Type

FEATURE (webview chat + host surface RPC).

## Goal

Render declarative dashboard surfaces inside coding-chat tabs, the way the Apps page renders them today. This is
Revision 4 sequence C ("charts in the coding chat"), out of scope for 494 (`TASK_2026_494_ca38/task-description.md:37`).

## What already exists (from 494 and 538)

- Generic, zod-free routing-id dispatcher `SurfaceUpdateInbox` in `@ptah-extension/chat-routing`. 494 placed it there
  so this task can claim chat-tab routing ids without importing the Apps lib (`TASK_2026_494_ca38/implementation-plan.md`
  R1 and lines 195-205). `@ptah-extension/chat` cannot import `mcp-apps-page` (cycle).
- Renderer: `libs/frontend/declarative-dashboard` (catalog renderer + trust boundary).
- Host surface store and RPCs from TASK_2026_538_3ccf (`SURFACE_STORE_LIMITS`: 32 routing ids, 8 surfaces each,
  24 MiB, LRU).

## Scope to decide at planning

- Chat-tab surface mounting and claim/release on the inbox.
- `surface:release` RPC. 494 deferred it and recommended it for this task, because chat-tab close is the frequent
  trigger (`TASK_2026_494_ca38/implementation-plan.md:245-256`): shared params, registry and compile-time twin,
  `.strict()` schema, handler branch, a `SurfaceStateService` operation that interacts with the operation ledger and
  pending submits, and host tests on three hosts.
- Lazy loading: the renderer must not enter the initial chunk set (same gate as 494 Req 9.1).

## Coordination

- TASK_2026_524_1125 batches 3-4 and TASK_2026_584_5e7a both touch chat tab code. Plan this after they land.

## Depends on

- TASK_2026_494_ca38 (done).
