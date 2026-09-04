---
status: backlog
type: feature
title: Render the SDK fallback content block as a per-message model-switch chip
description: >-
  The Claude Code CLI can fall back to another model mid-turn and reports it
  as an assistant content block of type `fallback` with `from.model` and
  `to.model`. Ptah does not model the block, so it takes the warn-and-drop
  branch and the user is never told they paid for a different model than they
  picked. Render it inline in the message, not as a per-conversation marker.
---

# Render the SDK fallback content block

A user picks one model and silently gets another. That is the class of fact a
chat surface must not hide.

Emit a `model_fallback` flat stream event from the transformer, store it in
the accumulator, build a small child node under that message, and render a
chip modeled on `CompactionMarkerComponent`.
