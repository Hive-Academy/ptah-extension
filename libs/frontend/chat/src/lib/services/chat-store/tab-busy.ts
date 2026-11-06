import type {
  SessionStatus,
  StreamingState,
} from '@ptah-extension/chat-types';

/**
 * The ONE definition of "this tab is still generating".
 *
 * Its readers must never disagree: `MessageDispatchService`, which decides
 * send-vs-queue, `FollowUpQueueService`, which decides when a held slash
 * command may start its turn, and the chat input's Stop button, which is the
 * only way out of the queue-only state this returns `true` for. Gate the affordance
 * on a different signal than the gate that creates the state and you get a tab
 * that can neither send nor stop (TASK_2026_382 review B5).
 *
 * Three sources, OR'd:
 *
 * 1. `status` — the root-turn phase written by the backend `turn_state` stream.
 * 2. `isStreamingTab` — the `_streamingTabIds` spinner set, which the SDK's
 *    pause/resume self-heal can leave set while `status` reverted to `loaded`.
 *    Routing a follow-up to `send()` there spins up a fresh AbortController and
 *    KILLS the in-flight stream.
 * 3. An UNSETTLED TREE — the condition the user can actually see, because the
 *    live bubble in the transcript is rendered from `streamingState`, not from
 *    the phase the other two read. A writer that clears the turn flags without
 *    settling the tree opens a window where the transcript shows a streaming
 *    bubble while the predicate says idle.
 *
 * ## The tree condition has a BOUNDED EXIT, and that is load-bearing
 *
 * `streamingState != null` alone is a latch, not a predicate.
 * `StreamingHandlerService` mints an empty `StreamingState` for events routed
 * to a tab that has none, only `message_start` ever sets `currentMessageId`,
 * and `MessageFinalizationService.finalizeCurrentMessage` early-returns on a
 * null `currentMessageId`. So one stray post-turn event — the late
 * `agent_progress` / `agent_completed` / `message_complete` that TASK_2026_360
 * documents as routine — used to pin a `loaded` tab into queue-only mode with
 * NO drain able to fire and no recovery short of a reload.
 *
 * A tree with no `currentMessageId` is a tree nothing can finalize, so it is
 * not a turn in flight — it is debris. Treat it as idle. A real streaming
 * window always has one: `message_start` sets it and it survives until
 * `applyFinalizedTurn` / `clearStreamingForLoaded` clears the turn.
 *
 * ## The `awaiting-background` / `sleeping` exclusion is also load-bearing
 *
 * `chat-types.ts` defines both as "agent itself is idle, USER INPUT REMAINS
 * ENABLED", with background tasks or session crons still running. A subagent's
 * next `message_start` builds a fresh `streamingState` there, so the field is
 * non-null while sending is correct by design — and queuing would hold a slash
 * command until that subagent tree settles. Do not widen this back to an
 * unconditional check.
 *
 * The rest of the `SessionStatus` union needs no exclusion: `streaming` /
 * `resuming` are already caught by source 1; `fresh` / `draft` / `loaded` claim
 * no live tree, so a tree present under them IS the accidental window this
 * exists for; `switching` is a momentary UI transition during which a live tree
 * still ends with a root `message_complete`.
 *
 * This is NOT the deleted TASK_2026_360 self-heal. That heuristic lived in the
 * streaming WRITE path and re-derived "the agent is busy" from event content,
 * re-lighting the spinner with nothing left to clear it. This reads tab state
 * that already exists and writes nothing.
 */
export function isTabBusyGenerating(input: {
  status: SessionStatus | null | undefined;
  streamingState: StreamingState | null | undefined;
  isStreamingTab: boolean;
}): boolean {
  const { status, streamingState, isStreamingTab } = input;
  const hasUnsettledTree =
    streamingState != null &&
    streamingState.currentMessageId != null &&
    status !== 'awaiting-background' &&
    status !== 'sleeping';
  return (
    status === 'streaming' ||
    status === 'resuming' ||
    hasUnsettledTree ||
    isStreamingTab
  );
}
