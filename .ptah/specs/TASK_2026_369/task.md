---
status: backlog
type: feature
title: Render the SDK fallback content block as a per-message model-switch chip
updated: 2026-11-07T00:00:00.000Z
description: >-
  The Claude Code CLI reports a mid-turn model fallback as an assistant content block of type
  `fallback` with `from.model` and `to.model`. Ptah drops it with a warning. Model the block and
  render it inline in the message as a model-switch chip.
---

# Render the SDK fallback content block

A user picks one model and silently gets another. That is the class of fact a
chat surface must not hide.

Emit a `model_fallback` flat stream event from the transformer, store it in
the accumulator, build a small child node under that message, and render a
chip modeled on `CompactionMarkerComponent`.

## Description

Remaining work (all of it):

- Add the `fallback` block (`{ type: 'fallback'; from: { model: string }; to: { model: string } }`)
  to `ContentBlock` in `libs/backend/agent-sdk/src/lib/types/sdk-types/claude-sdk.types.ts`.
- Handle it in `libs/backend/agent-sdk/src/lib/message-transform/assistant-message.transformer.ts`
  instead of the "Unhandled content block type" warning (:341-342). Emit a `model_fallback`
  flat stream event (add the type to `libs/shared`).
- Store it in the chat-streaming accumulator and build a child node under the message.
- Render a chip in `libs/frontend/chat-ui`, modeled on
  `libs/frontend/chat-ui/src/lib/molecules/notifications/compaction-marker.component.ts`. Render
  it inline per message, not once per conversation like the compaction marker
  (`libs/frontend/chat/src/lib/components/templates/chat-view.component.html:58-60`).

## Current state (2026-11-07)

- Not started: no `fallback` or `model_fallback` type in `libs/shared`, `agent-sdk` or `chat-ui`.
- The warn-and-drop branch is still `assistant-message.transformer.ts:341-342`.
- The compaction marker line number in `context.md` (`chat-view.component.html:54`) is now :58-60.
