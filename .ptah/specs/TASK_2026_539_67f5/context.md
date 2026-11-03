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

## Triage 2026-10-30

Backlog audit after the October refactors. Still open (a cancel was proposed and rejected).

Mount SURFACE_UPDATED dashboard surfaces in chat tabs, claim and release routing IDs on SurfaceUpdateInbox, and implement the surface:release host RPC with schema, handler, cleanup and tests.

## Triage 2026-10-30 (premise audit)

Verdict: PARTIAL (lane codex, verified by Claude).

- Delivered: ptah-ui blocks and turn recap in the Electron coding chat (#649, TASK_2026_610); the display panel renders surfaces through `ptah-surface-renderer` (`main:libs/frontend/chat-ui/src/lib/organisms/display-panel/display-panel.component.ts:142`).
- Missing: SurfaceUpdateInbox claims exist only for Apps (`main:libs/frontend/mcp-apps-page/src/lib/services/apps-conversation-claims.ts:41`); `main:libs/backend/rpc-handlers/src/lib/handlers/surface-rpc.handlers.ts` has no release method.
- Parallel branch risk: feat/artifact-display-window (TASK_2026_853_3401) is changing the display panel and adds a detachable display window; re-check this scope after it merges.
