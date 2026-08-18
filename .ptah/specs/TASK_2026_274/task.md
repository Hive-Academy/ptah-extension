---
id: TASK_2026_274
status: backlog
type: refactoring
title: >-
  Two near-identical subprocess-probe implementations should be one
  spawnAndCapture utility in platform-core
description: >-
  `workspace-intelligence/src/project-analysis/toolchain-probe.ts` (added by
  TASK_2026_270) and `cli-agent-runtime`'s `probeCliVersion` / `spawnCli`
  (`cli-adapter.utils.ts:202-230`) do the same job with the same tool
  (`cross-spawn`) — spawn, capture stdio, apply a timeout, never throw — across
  about 150 near-identical lines. `workspace-intelligence` cannot import
  `cli-agent-runtime` without an architecturally backwards edge (a widely-consumed
  service layer depending on a heavy vertical feature lib), which is why the
  duplication exists at all. The code-style review of TASK_2026_270 argued
  specifically AGAINST a `platform-core` port for this: all three hosts are plain
  Node, so there is zero per-platform implementation variance to hide behind an
  interface. The recommendation is a plain concrete export —
  `spawnAndCapture(binary, args, { timeoutMs })` — in `platform-core`, consumed by
  both call sites.
---

# One spawnAndCapture, not two probes and not a port

Machine-owned metadata carrier. Prose lives in `./context.md`.
