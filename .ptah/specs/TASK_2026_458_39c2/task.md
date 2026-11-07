---
id: TASK_2026_458_39c2
status: backlog
type: BUGFIX
title: >-
  Let the cli-engine worker host degrade instead of crash when memory registration fails early
description: >-
  The cli-engine boot (run by the worker-host bundle) stubs the memory-contracts tokens but not
  MEMORY_SEARCH or MEMORY_STORE. If memory-curator registration throws first, resolving the
  lib-owned MemRpcHandlers fails outside any try/catch and the boot crashes.
depends_on: []
created: 2026-09-16T01:35:00.000Z
updated: 2026-11-07T00:00:00.000Z
parent: TASK_2026_635_5ea5
labels:
  - P1
---

## Description

The cli-engine host always enables the memory capability, so `registerRpcSurface` always resolves
`MemRpcHandlers`. That handler is lib-owned, so its resolution is outside the try/catch.
`ensureMemoryContractFallbacks` stubs the memory-contracts tokens, but `MEMORY_SEARCH` and
`MEMORY_STORE` come only from Track 1 (memory-curator registration). If Track 1 throws before it
registers them, the boot crashes. This predates TASK_2026_443, so it is not a regression. Found by the
TASK_2026_443_40ec Batch 11 review.

The standalone CLI app is gone (PR #892). The same boot still runs: `libs/backend/worker-host`
imports `@ptah-extension/cli-engine` (`libs/backend/worker-host/src/lib/commands/serve.ts:4`), and
Electron builds it as `worker-host.mjs` (`apps/ptah-electron/project.json:231-234`).

Sites:

- `libs/backend/rpc-handlers/src/lib/handlers/mem-rpc.handlers.ts:49` (`MEMORY_SEARCH`).
- `libs/backend/rpc-handlers/src/lib/handlers/memory-rpc.handlers.ts:182,185` (`MEMORY_STORE`,
  `MEMORY_SEARCH`).
- `libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts:126-132` (the non-fatal catch,
  then the fallback call) and `:203` (`ensureMemoryContractFallbacks`).
- `libs/backend/rpc-handlers/src/lib/host-profile/register-rpc-surface.ts:185-189` (lib-owned
  resolution outside the guard).
- `libs/backend/memory-curator/src/lib/di/register.ts:97-102` (the only registrar of `MEMORY_SEARCH`).

Decide the shape: either the fallback installers also stub the search and store tokens, or the `mem`
and `memory` manifest entries stop claiming the capability when Track 1 failed. Prove it with a spec
where `registerMemoryCuratorServices` throws on entry, nothing is hand-registered, and
`registerRpcSurface` still completes. Do not weaken the existing Batch 11 spec, which covers the four
contract tokens. Source: `TASK_2026_443_40ec/code-logic-review-batch-11.md` finding 1.

## Current state (2026-11-07)

- Not fixed. `ensureMemoryContractFallbacks` still stubs only the memory-contracts tokens, not
  `MEMORY_SEARCH` or `MEMORY_STORE`.
- The lib-owned branch in `register-rpc-surface.ts:186-189` still has no try/catch.
- The host is now the worker-host process that Electron ships, not the removed CLI app.
