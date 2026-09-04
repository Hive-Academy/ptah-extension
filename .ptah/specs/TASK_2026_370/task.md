---
status: backlog
type: bugfix
title: SdkMessageTransformer singleton shares per-stream state across concurrent chat sessions
description: >-
  `SdkMessageTransformer` is registered `Lifecycle.Singleton` and keeps its
  streaming bookkeeping in instance maps keyed by `parent_tool_use_id || ''`
  with no session dimension. `StreamTransformer` injects that singleton for
  every interactive chat session, so two sessions streaming at once overwrite
  each other's root message slot. Symptom in the log with three live sessions:
  six `content_block_start but no active message for context: root` warnings,
  each a dropped content block. A compact boundary in one session also calls
  `clearStreamingState()`, which wipes every other session's state.
---

# Shared transformer state across sessions

Not the cause of the empty-bubble defect in TASK_2026_366 — that was the
signature-only thinking block. This is a separate, latent, cross-session
defect that the same log exposed.

The isolation mechanism already exists: `createIsolated()`. Two callers use
it. The interactive chat path does not.
