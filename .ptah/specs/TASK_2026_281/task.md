---
id: TASK_2026_281
status: backlog
type: bugfix
title: >-
  Close the four harness entry points the reconciler still cannot see, and split
  the RPC facade that outgrew its ceiling
description: >-
  TASK_2026_278 put a bounded preflight in front of every session and a
  reconcile behind every trigger, but four paths slip past it, each recorded in
  that task's own report rather than found later. `SdkAgentAdapter.resumeSession`
  short-circuits at its already-active branch and never reaches the executor, so
  a resumed session gets no preflight. `AgentProcessManager.spawnFromSdkHandle`
  bypasses `doSpawn` and therefore the spawn-time preflight. Cron's cwd falls
  back to `process.cwd()`, which in Electron is the app install directory, so a
  job without a `workspaceRoot` reconciles against a directory that is not a
  workspace. And `plugins:add-marketplace` / `remove-marketplace` do not
  propagate — arguably correct, since neither changes an enabled plugin, but
  unverified either way. Separately `harness-rpc.handlers.ts` is 909 lines
  against a 700-line ceiling; the logic already lives in a collaborator, so what
  is left to split is registration.
---

# Harness trigger gaps

Machine-owned metadata carrier. Prose lives in `./context.md`.
