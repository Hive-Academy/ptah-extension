---
id: TASK_2026_557_9dbc
status: backlog
type: BUGFIX
title: Stop orphaned rival-CLI probes from holding the Electron app open on quit
depends_on: []
created: "2026-09-25T17:00:00.000Z"
updated: 2026-11-07T00:00:00.000Z
description: >-
  A rival-CLI version probe still running at quit can keep the app's pipes open, so
  Playwright's electronApp.close() waits up to about 28 s. Give the probes a quit-time stop.
estimate: S
labels:
  - e2e
  - electron
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

Electron starts `registerCodeExecutionMcpForSubagents` in `postWindow` without awaiting it
(`apps/ptah-electron/src/activation/wire-runtime.ts:552-562`). It reaches
`CliDetectionService.detectAll()`
(`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-detection.service.ts:180`), which probes each
installed CLI in turn through `probeCliVersion`
(`libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cli-adapter.utils.ts:369`). Nothing
stops an in-flight probe at quit. With slow CLI shims on PATH, `electronApp.close()` waited up to
about 28 s, and real users can be left with stray CLI processes.

Add a quit-scoped stop: a signal owned by the detector or the MCP service, triggered from
`will-quit` or the shutdown path (`apps/ptah-electron/src/activation/shutdown.ts`). One caller's
signal must not cancel shared detection work that another caller awaits (the `enqueueMcpOp` queue in
`libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-mcp-server.service.ts`). The VS
Code host constraint in `context.md` no longer applies (PR #892).

Acceptance: with slow CLI shims first on PATH, `electronApp.close()` returns within a few seconds; no
probe outlives the app; a unit test shows that a stop kills the in-flight probe.

## Current state (2026-11-07)

- Not fixed. `detectAll()` takes no signal, and `shutdown.ts` has no probe or detection step.
- Probes already spawn with `stdio: ['pipe', 'pipe', 'pipe']`, `detached` and a 5 s timeout
  (`cli-adapter.utils.ts:336-343,369-380`, `7a5dc08c5`). Re-measure the 28 s close delay first:
  the remaining wait may come from the probe sequence, not from stdio inheritance.

Full history in [./context.md](./context.md).
