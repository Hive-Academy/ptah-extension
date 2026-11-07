---
id: TASK_2026_668_dd07
status: backlog
type: BUGFIX
title: "Remove prompt excerpt from chat:continue stop log"
depends_on: []
created: "2026-10-14T17:08:12.431Z"
updated: "2026-11-07T00:00:00.000Z"
description: >-
  chat-session.service.ts logs the first 80 characters of a user prompt in the chat:continue
  stop-intent path. Prompt text must not go to logs.
estimate: XS
labels:
  - follow-up
  - privacy
relates_to:
  - TASK_2026_655_handoff
---

<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. Do NOT write prose here — prose belongs in ./context.md. -->

## Description

In the `chat:continue` stop-intent path (autopilot on, permission level `yolo` or `auto-edit`),
`libs/backend/rpc-handlers/src/lib/chat/session/chat-session.service.ts:1907-1910` logs
`prompt: prompt.substring(0, 80)`. Remove the prompt excerpt from the log; keep `sessionId` and
`permissionLevel` (a prompt length is acceptable). Add or update a spec that asserts the log
carries no prompt text. Verify with `npm run verify -- -p @ptah-extension/rpc-handlers`.

## Current state (2026-11-07)

- Not started. The excerpt is still logged at `chat-session.service.ts:1909`.
- The start condition is met: PRs #724 and #725 are merged. The line moved from about 922 to 1909.

Full context, plan and discussion live in [./context.md](./context.md).
