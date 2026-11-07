---
id: TASK_2026_667_af48
status: backlog
type: BUGFIX
title: "Return an acknowledgement when a child session fails to start"
depends_on: []
created: "2026-10-14T17:08:12.287Z"
updated: "2026-11-07T00:00:00.000Z"
description: >-
  A failed child-session start resets the announced tab with a fire-and-forget chat:error, so the
  host cannot confirm the renderer cleared the tab. Re-check the premise first.
estimate: S
labels:
  - follow-up
relates_to:
  - TASK_2026_655_handoff
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

When a child or handoff session fails to start after its tab was announced, the host calls
`reportStartFailure`
(`libs/backend/rpc-handlers/src/lib/chat/session/child-chat-session-host.adapter.ts:245-261`). It
only broadcasts `CHAT_ERROR` to the renderer. Nothing confirms that the renderer received it and
reset the announced tab, so a missed broadcast can leave a stale tab.

First decide whether this gap still matters:

- The calling agent already learns of the failure. The adapter returns
  `{ started: false, error }` (`child-chat-session-host.adapter.ts:128,188`), and the spawner turns
  it into a failed start (`libs/backend/cli-agent-runtime/src/lib/session-children/session-spawner.service.ts:412-413`).
- If a renderer acknowledgement is still wanted, add one (or have the renderer drop an announced tab
  that never starts) and cover it with specs.

Optional review moderates from `pr724-review-r2.md` (not re-checked): parked-tab test coverage,
and the `/clear` RPC reply that could overtake the clear broadcast.

## Current state (2026-11-07)

- Done in PR #724 (`d9933c000`): tab close, `/clear` and workspace removal drop a held
  `/session-handoff` command and its pending banner promise.
- Left: only the renderer acknowledgement for the failed-start `chat:error`. If the agent-side
  failure result is enough, this task can close.
- The `pr724-*.md` files in this folder are history of PR #724.

Full context, plan and discussion live in [./context.md](./context.md).
