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

## Acceptance

- With slow CLI shims first on PATH, `electronApp.close()` returns within a few seconds.
- No probe process outlives the app, checked with a process list after quit.
- Unit test: an aborted registration kills or stops its in-flight probe.
