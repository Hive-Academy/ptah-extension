---
id: TASK_2026_274
status: backlog
type: refactoring
title: >-
  Merge the two subprocess probes into one spawnAndCapture utility in platform-core
updated: 2026-11-07T00:00:00.000Z
description: >-
  `toolchain-probe.ts` in workspace-intelligence and `spawnCli` / `probeCliVersion` in
  cli-agent-runtime duplicate the same cross-spawn capture logic. Add one concrete
  `spawnAndCapture(binary, args, { timeoutMs })` export in `platform-core` and use it in both.
---

# One spawnAndCapture, not two probes and not a port

Machine-owned metadata carrier. Prose lives in `./context.md`.

## Description

Two call sites spawn a binary, capture stdio, apply a timeout and never throw, both with
`cross-spawn`:

- `libs/backend/workspace-intelligence/src/project-analysis/toolchain-probe.ts` (196 lines).
- `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts`:
  `spawnCli` (:305) and `probeCliVersion` (:369).

`workspace-intelligence` cannot import `cli-agent-runtime` without a backwards dependency edge.
Remaining work:

- Add a plain concrete `spawnAndCapture(binary, args, { timeoutMs })` export to
  `libs/backend/platform-core`. Do not add a port: the code runs only under Node (Electron main
  process and the provider CLI lanes), so there is no per-platform variance to hide.
- Move both call sites to it. Keep the `.cmd` wrapper handling that `spawnCli` documents.

## Current state (2026-11-07)

- Not started: no `spawnAndCapture` exists in `libs/`.
- Both duplicates are still present (`toolchain-probe.ts:21`, `cli-adapter.utils.ts:8` import
  `cross-spawn`).
- The line numbers in the old description (`cli-adapter.utils.ts:202-230`) are out of date; use
  :305 and :369.
