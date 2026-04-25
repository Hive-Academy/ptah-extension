import {
  createEmptyStreamingState,
  setStreamingEventCapped,
  type StreamingState,
} from '@ptah-extension/chat-types';
import type { FlatStreamEventUnion } from '@ptah-extension/shared';
import type { WritableSignal } from '@angular/core';

/**
 * WizardStreamAccumulator — accumulates FlatStreamEventUnion events into
 * per-phase {@link StreamingState} maps so ExecutionNode tree rendering
 * can operate off a stable structure.
 *
 * Mirrors the accumulation logic in ChatStore's streaming handler but is
 * kept here so the wizard can evolve its own accumulation rules without
 * being coupled to chat. TASK_2025_229.
 */
export class WizardStreamAccumulator {
  public constructor(
    private readonly phaseStreamingStates: WritableSignal<
      Map<string, StreamingState>
    >,
  ) {}

  /**
   * Accumulate a single {@link FlatStreamEventUnion} into the phase whose
   * key is `event.messageId`. Always writes through an immutable clone of
   * the target {@link StreamingState} so signal consumers detect changes.
   */
  public accumulate(event: FlatStreamEventUnion): void {
    const phaseKey = event.messageId;

    this.phaseStreamingStates.update((statesMap) => {
      const newMap = new Map(statesMap);
      const prev = newMap.get(phaseKey);

      // Clone or create StreamingState — never mutate the previous reference.
      // This ensures Angular signal consumers detect changes correctly.
      const state: StreamingState = prev
        ? {
            events: new Map(prev.events),
            messageEventIds: [...prev.messageEventIds],
            toolCallMap: new Map(prev.toolCallMap),
            textAccumulators: new Map(prev.textAccumulators),
            toolInputAccumulators: new Map(prev.toolInputAccumulators),
            agentSummaryAccumulators: new Map(prev.agentSummaryAccumulators),
            agentContentBlocksMap: new Map(prev.agentContentBlocksMap),
            currentMessageId: prev.currentMessageId,
            currentTokenUsage: prev.currentTokenUsage,
            eventsByMessage: new Map(prev.eventsByMessage),
            pendingStats: prev.pendingStats,
          }
        : createEmptyStreamingState();

      // Store event by ID (FIFO-capped to prevent unbounded growth)
      setStreamingEventCapped(state, event);

      // Index by messageId
      const messageEvents = [
        ...(state.eventsByMessage.get(event.messageId) ?? []),
        event,
      ];
      state.eventsByMessage.set(event.messageId, messageEvents);

      // Handle event-type-specific accumulation
      switch (event.eventType) {
        case 'message_start':
          if (!state.messageEventIds.includes(event.messageId)) {
            state.messageEventIds.push(event.messageId);
          }
          state.currentMessageId = event.messageId;
          break;

        case 'text_delta': {
          if (!state.messageEventIds.includes(event.messageId)) {
            state.messageEventIds.push(event.messageId);
          }
          const textKey = `${event.messageId}-block-${event.blockIndex}`;
          const existing = state.textAccumulators.get(textKey) ?? '';
          state.textAccumulators.set(textKey, existing + event.delta);
          break;
        }

        case 'thinking_start':
          // Store the event — tree builder needs it to create thinking nodes
          break;

        case 'thinking_delta': {
          const thinkKey = `${event.messageId}-thinking-${event.blockIndex}`;
          const existingThink = state.textAccumulators.get(thinkKey) ?? '';
          state.textAccumulators.set(thinkKey, existingThink + event.delta);
          break;
        }

        case 'tool_start': {
          const toolChildren = [
            ...(state.toolCallMap.get(event.toolCallId) ?? []),
            event.id,
          ];
          state.toolCallMap.set(event.toolCallId, toolChildren);
          break;
        }

        case 'tool_delta': {
          const inputKey = `${event.toolCallId}-input`;
          const existingInput = state.toolInputAccumulators.get(inputKey) ?? '';
          state.toolInputAccumulators.set(
            inputKey,
            existingInput + event.delta,
          );
          const deltaToolChildren = [
            ...(state.toolCallMap.get(event.toolCallId) ?? []),
            event.id,
          ];
          state.toolCallMap.set(event.toolCallId, deltaToolChildren);
          break;
        }

        case 'tool_result': {
          const resultToolChildren = [
            ...(state.toolCallMap.get(event.toolCallId) ?? []),
            event.id,
          ];
          state.toolCallMap.set(event.toolCallId, resultToolChildren);
          break;
        }

        case 'message_complete':
          state.currentMessageId = null;
          break;

        // Events the wizard doesn't need to accumulate
        case 'message_delta':
        case 'signature_delta':
        case 'agent_start':
        case 'compaction_start':
        case 'compaction_complete':
        case 'background_agent_started':
        case 'background_agent_progress':
        case 'background_agent_completed':
        case 'background_agent_stopped':
          break;
      }

      newMap.set(phaseKey, state);
      return newMap;
    });
  }

  /** Reset all accumulated per-phase streaming states (used on generation start). */
  public reset(): void {
    this.phaseStreamingStates.set(new Map());
  }
}
