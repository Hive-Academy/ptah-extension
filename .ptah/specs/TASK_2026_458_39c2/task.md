---
id: TASK_2026_458_39c2
status: backlog
type: BUGFIX
title: >-
  Let the CLI degrade instead of crash when memory registration fails early
description: >-
  Found by the TASK_2026_443_40ec Batch 11 review. The CLI host always enables
  the memory capability, so registerRpcSurface always resolves MemRpcHandlers,
  and that resolution is outside the try/catch because the handler is
  lib-owned. ensureMemoryContractFallbacks stubs the memory-contracts tokens,
  but MEMORY_SEARCH and MEMORY_STORE come only from Track 1. If Track 1 throws
  before it registers them, the CLI crashes at boot. The MEMORY_SEARCH
  injection predates TASK_2026_443, so this is pre-existing, not a regression.
depends_on: []
created: 2026-09-16T01:35:00.000Z
updated: 2026-09-16T01:35:00.000Z
---

## Description

Sites: `libs/backend/rpc-handlers/src/lib/handlers/mem-rpc.handlers.ts:49-50` (`MEMORY_SEARCH`),
`memory-rpc.handlers.ts` (`MEMORY_STORE`), `libs/backend/cli-engine/src/lib/thoth/register-thoth-libraries.ts:187-219`
(`ensureMemoryContractFallbacks`), `libs/backend/rpc-handlers/src/lib/host-profile/register-rpc-surface.ts:182-185`
(lib-owned resolution outside the guard) and `libs/backend/memory-curator/src/lib/di/register.ts:96-100`
(the only registrar of `MEMORY_SEARCH`).

Decide the shape: either the fallback installers also stub the search and store tokens, or the `mem`
and `memory` manifest entries stop claiming the capability when Track 1 failed. Prove it with a spec
where `registerMemoryCuratorServices` throws on entry, nothing is hand-registered, and
`registerRpcSurface` still completes. Do not weaken the existing Batch 11 spec, which covers the four
contract tokens. Source: `TASK_2026_443_40ec/code-logic-review-batch-11.md` finding 1.
