# TASK_2026_425 — Context

## Origin

Code-logic review M2 on TASK_2026_420 (`TASK_2026_420_84d9/code-logic-review.md`),
carried as a follow-up in `batches.md`.

## Gap

- `StreamingHandlerService.recordUserPromptBoundary` stores a user
  `message_start` whose id is the optimistic bubble id.
- At turn end, `MessageFinalizationService.placeFinalizedTrees` anchors on an
  existing USER message with that `id`; with no match it falls back to the
  plain append.
- Rewind / fork mutators in `chat-state` can remove or replace user messages.
  Rewind appears UI-gated while a turn streams, but the gate was not traced
  end-to-end, and no spec covers a boundary whose bubble disappeared.

## To do

1. Trace the rewind / fork entry points and confirm whether they can run while
   `streamingState` holds a boundary.
2. Add specs: boundary live → user message removed → finalization gives a
   sane order (no lost assistant content, no ghost anchor); and the
   UI gate, if that is the guarantee.
3. Fix only if a spec exposes a real misplacement.
