---
id: TASK_2026_425_b4f3
status: backlog
type: BUGFIX
title: No regression guard for rewind while a prompt boundary is live
updated: 2026-11-07T00:00:00.000Z
description: >-
  A mid-turn prompt is anchored through a user `message_start` boundary in the live streaming
  state. No spec covers a rewind or fork that removes or replaces that user message while the
  boundary is live. Trace the gate, add the specs, and fix only a real misplacement.
---

Follow-up from TASK_2026_420 (code-logic review M2). See `context.md`.

## Description

Remaining work:

1. Trace the rewind and fork entry points in `libs/frontend/chat-state` and confirm whether
   they can run while the streaming state holds a boundary. The boundary is recorded by
   `StreamingHandlerService.recordUserPromptBoundary`, called from `libs/frontend/chat/src/lib/services/message-sender.service.ts:945` and
   `chat-store/follow-up-queue.service.ts:508`.
2. Add specs: boundary live → user message removed or replaced → finalization in
   `libs/frontend/chat-streaming/src/lib/message-finalization.service.ts` (`placeFinalizedTrees`)
   gives a sane order (no lost assistant content, no ghost anchor). If the UI gate is the
   guarantee, pin the gate too.
3. Fix only if a spec exposes a real misplacement.

## Current state (2026-11-07)

- Not started. The specs that touch the boundary (message-sender, follow-up-queue,
  execution-tree-builder) do not cover rewind or fork.
- `StreamingHandlerService.recordUserPromptBoundary` (named in `context.md`) still exists; it now
  delegates to `accumulator-core.service.ts:672`
  (`libs/frontend/chat-streaming/src/lib/streaming-handler.service.ts:150`).
