# Interrupted marker report

## State source

- `libs/backend/agent-sdk/src/lib/helpers/stream-transformer.ts:612,1149,1174` emits `settleInterruptedTurn` for interrupted Claude turns.
- `libs/backend/agent-sdk/src/lib/sdk-message-transformer.ts:210-220` turns that into a terminal `turn_state` with `terminalReason: 'aborted_streaming'` and the consumed prompt ID.
- `libs/frontend/chat-streaming/src/lib/turn-state-applier.service.ts:127-145` accepts terminal state and now distinguishes `aborted_streaming`/`aborted_tools` from other failed reasons. It passes the interruption to message finalization.

## Change

- Added optional `isInterrupted` to `ExecutionChatMessage` and its Zod schema. The field records the existing terminal reason on the finalized assistant message; it is not a second turn lifecycle state.
- Finalization marks partial assistant text or creates a minimal assistant placeholder before queued user follow-ups when the turn produced no renderable message. Existing interrupted placeholders are not duplicated.
- The assistant bubble renders a muted `Interrupted` label with `data-testid="chat-turn-interrupted"`; the empty placeholder suppresses action buttons.
- Added focused finalization and bubble specs for interrupted text, an empty interruption, and normal completion.

## Decisions

- Used the existing terminal reason `aborted_streaming`/`aborted_tools` rather than tree node status because an empty turn has no tree. Reversible.
- Placed the placeholder before recorded queued follow-ups via `QueuedPromptRecord.queuedAtTail`; this preserves transcript order. Reversible.

## Limits and verification

- A live session's finalized message carries the marker through tab message persistence. Claude transcript history replay rebuilds messages from `message_start` and tree events; no persisted `turn_state` is available in that replay path, so a fresh transcript-only resume cannot reconstruct this marker. No marker is inferred from missing assistant text.
- Nx/verify and rendering were not run per lane instructions. Scoped `ptah_get_diagnostics` was called twice but returned unavailable after its 45-second TypeScript timeout; compile status remains unverified.
- The assigned `angular-frontend-patterns` skill could not be loaded because this lane has no skill-loading tool.
- Updated turn-state applier expectations to assert that only aborted reasons pass the interruption flag; other terminal outcomes retain the prior finalization call shape.
