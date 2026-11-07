---
id: TASK_2026_281
status: backlog
type: bugfix
title: >-
  Close the remaining harness preflight gaps and split harness-rpc.handlers.ts
updated: 2026-11-07T00:00:00.000Z
description: >-
  Resumed sessions and rootless cron jobs still skip a correct harness preflight, and the
  marketplace add/remove propagation choice has no spec. `harness-rpc.handlers.ts` is 1066
  lines against a 700-line ceiling.
---

# Harness trigger gaps

Machine-owned metadata carrier. Prose lives in `./context.md`.

## Description

Follow-up to TASK_2026_278. Remaining items:

1. Resume: `SdkAgentAdapter.resumeSession`
   (`libs/backend/agent-sdk/src/lib/sdk-agent-adapter.ts:1340`) returns the existing stream on
   its already-active branch and never reaches the preflight. Run the preflight there, or
   document why it is not needed.
2. Cron cwd: `libs/backend/cron-scheduler/src/lib/job-runner.ts:269` uses
   `job.workspaceRoot ?? process.cwd()`. In Electron that is the app install directory. A
   rootless job must not reconcile against it.
3. Marketplace add/remove: `plugins:add-marketplace` / `plugins:remove-marketplace`
   (`libs/backend/rpc-handlers/src/lib/handlers/plugin-rpc.handlers.ts:661`) do not propagate.
   Confirm that this is correct and pin it with a spec.
4. Split `libs/backend/rpc-handlers/src/lib/handlers/harness-rpc.handlers.ts` (1066 lines) under
   the 700-line ceiling. Keep the class name, DI token and method signatures.

Acceptance: items 1 and 2 each closed by a spec or a written "unsupported" note in the owning
lib; item 3 pinned by a spec; item 4 with RPC surface specs still green.

## Current state (2026-11-07)

- The old `spawnFromSdkHandle` item is covered for the Ptah CLI path: the registry runs the
  harness sync or preflight before it builds the handle
  (`libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts:837`, `:1038-1053`), and
  `prepareSdkHandleSpawn` (`agent-process-manager.service.ts:764-794`) adds the model and resume
  gates (TASK_2026_614).
- Items 1 to 3 are unchanged in code.
- `harness-rpc.handlers.ts` grew from 909 to 1066 lines.
