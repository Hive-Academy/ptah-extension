---
id: TASK_2026_424_b6bf
status: backlog
type: BUGFIX
title: Cursor adapter waits for the SDK stream to end before completing
updated: 2026-11-07T00:00:00.000Z
description: >-
  `CursorCliAdapter` returns from its stream loop only when `run.stream()` ends, the shape that
  once left Codex agents running until the timeout. Measure whether the stream ends after a
  terminal `status` message; if not, return on that message.
---

Follow-up from TASK_2026_421. See `context.md`.

## Description

File: `libs/backend/cli-agent-runtime/src/lib/cli-agents/cli-adapters/cursor-cli.adapter.ts`.
Remaining work:

1. Measure a real Cursor run in Electron: does `ptah_agent_status` reach `completed` promptly
   after the final `status` message?
2. If not: in the `for await (const message of run.stream())` loop (:454), return on a terminal
   `status` (`FINISHED` → 0; `ERROR`, `CANCELLED`, `EXPIRED` → 1). Today the `status` case
   (:666-674) only emits output and breaks out of the `switch`.
3. Pin it with a never-ending-stream spec.

## Current state (2026-11-07)

- Not changed. The loop still returns only when the iterator ends (:454-467).
- The `status` union is declared at :102-104.
- The line reference in `context.md` (~347) is out of date; the loop is at :454.
