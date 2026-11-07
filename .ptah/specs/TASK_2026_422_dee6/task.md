---
id: TASK_2026_422_dee6
status: backlog
type: BUGFIX
title: Native uuid stamping picks the oldest unstamped user bubble
updated: 2026-11-07T00:00:00.000Z
description: >-
  When a user echo has no `clientMessageId`, `reconcileUserMessageNativeUuid` stamps the
  transcript uuid onto the FIRST unstamped optimistic user bubble. After a failed send, the
  next uuid lands on the failed bubble, so fork and rewind anchor on the wrong message.
---

Follow-up from TASK_2026_420 (team-leader R1). See `context.md`.

## Description

Remaining work, in `libs/frontend/chat-state/src/lib/tab-manager.service.ts`:

- In the fallback `reconcileUserMessageNativeUuid` (:2372-2395), stop picking the first match
  (`findIndex`, :2382). Pick the most recent eligible bubble, and skip bubbles whose send
  failed (for example, bubbles followed by a "Message delivery failed" message).
- Add a spec: a failed direct send, then a successful send; the uuid must land on the second
  bubble.

## Current state (2026-11-07)

- Partly mitigated: an echo that carries `clientMessageId` now stamps the exact bubble through
  `acknowledgeUserPrompt` (`tab-manager.service.ts:2397`, called from
  `libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:165-173`).
- Not fixed: the fallback without `clientMessageId` (`streaming-handler.service.ts:175-181`)
  still uses `findIndex`. Queued tail prompts are excluded; failed sends are not.
- The line reference in `context.md` (~1541) is out of date; the function is at :2372.
