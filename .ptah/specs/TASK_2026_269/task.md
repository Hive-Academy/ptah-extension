---
id: TASK_2026_269
status: backlog
type: FEATURE
title: >-
  Regenerate registry.md from the task-index watcher, not only from an RPC
updated: 2026-11-07T00:00:00.000Z
description: >-
  `registry.md` is written only when `tasks:generateRegistry` is called. Make the
  `TaskIndexService` watcher flush regenerate it, so carriers written by hand or by
  machine both keep it current. The watcher already ignores its own `registry.md` writes.
---

# Keep registry.md derived by construction

Machine-owned metadata carrier. Prose lives in `./context.md`.

## Description

`registry.md` calls itself a derived view, but only the `tasks:generateRegistry` RPC writes it
(`libs/backend/rpc-handlers/src/lib/handlers/tasks-rpc.handlers.ts:279`). Agents often create
carriers by writing `task.md` directly, so a create-path hook alone is not enough. Remaining work:

- Call `RegistryGeneratorService` (`libs/backend/task-specs/src/lib/registry-generator.service.ts:34`)
  after each debounced reindex in `libs/backend/task-specs/src/lib/task-index.service.ts`.
- Keep the self-write suppression: the watcher already ignores `registry.md`
  (`task-index.service.ts:101`, `:580-591`), so a regenerate does not re-trigger the watcher.
- Resolve the open design questions in `context.md` (multi-checkout writes, git noise).

## Current state (2026-11-07)

- The main harm is mitigated. `ac84da4a9` stopped `registry.md` from being read as an ID
  allocator, and `28cd80567` allocates task IDs across every checkout.
- `TaskIndexService` still never regenerates `registry.md`. `RegistryGeneratorService` is reached
  only through the RPC.
- The watcher filter for `registry.md` exists and has a spec
  (`task-index.service.spec.ts:554`, "ignores registry.md and .archive/ watcher events").
- The drift figures in `context.md` (42 rows, 113 folders) are from 2026-08-17 and are history.
