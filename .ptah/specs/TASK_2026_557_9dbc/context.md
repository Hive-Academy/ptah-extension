# TASK_2026_557 — Orphaned rival-CLI probes hold the app open on quit

## Origin

Found while fixing TASK_2026_556 (PR #597). That task moved
`registerCodeExecutionMcpForSubagents` (`libs/backend/vscode-core/src/services/subsystem-bringup.ts`)
out of the pre-window phase in `apps/ptah-electron/src/activation/wire-runtime.ts`. It now runs
in `postWindow` under `settleOnAbort(…, coordinator.abortSignal)`.

## Problem

`settleOnAbort` stops the boot from waiting for the registration, but it does not stop the child
processes. `ensureRegisteredForSubagents` probes codex, copilot, cursor, agy, opencode and pi one
after another. Each probe is a child process that inherits the app's stdio. If a probe is still
running when the app quits, it keeps the stdout/stderr pipe open. Playwright's
`electronApp.close()` waits for that pipe to close, so it can wait up to about 28 s when slow CLIs
are on PATH (seen with forced-slow shims during the 556 investigation). Real users could also be
left with stray CLI processes after quitting.

## Direction (not decided)

- Give the probes a cancellation path, such as an `AbortSignal` passed down to the spawn calls,
  and trigger it from `will-quit` or the coordinator's abort.
- Or spawn probes with `stdio: ['ignore', 'pipe', 'pipe']` and kill the process tree on quit, so
  no probe inherits the parent's pipes.
- The VS Code host shares `bringUpSubsystems`, so any signature change must keep its behavior.

## PR #597 review (CodeRabbit) — suggested path and a caveat

CodeRabbit suggested threading `coordinator.abortSignal` through this path, keeping the signal
optional so VS Code keeps its current behavior:

`registerCodeExecutionMcpForSubagents` (vscode-core) → `ensureRegisteredForSubagents`
(`http-mcp-server.service.ts`, vscode-lm-tools) → `CliDetectionService.detectAll()`
(cli-agent-runtime) → each adapter's `detect()` → `probeCliVersion`
(`cli-adapter.utils.ts`). On abort, kill the active child and close its streams.

Caveat: `ensureRegisteredForSubagents` runs through `enqueueMcpOp`, a serialized queue that
the chat-session starters and the workspace-change re-points also use, and detection results
are shared. One caller's signal must not cancel work another caller is awaiting. That points to
two options:
- A quit-scoped signal owned by the detector or MCP service itself, triggered from `will-quit`.
- A per-caller signal that only drops that caller's wait, while the service kills children only
  on shutdown.

This was deferred out of PR #597. The orphaned-probe behavior was already there before the PR:
the probes used to run before the window with the same exposure.

## Acceptance

- With slow CLI shims first on PATH, `electronApp.close()` returns within a few seconds.
- No probe process outlives the app, checked with a process list after quit.
- Unit test: an aborted registration kills or stops its in-flight probe.
