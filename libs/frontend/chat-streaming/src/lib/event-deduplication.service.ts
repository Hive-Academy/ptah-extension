/**
 * EventDeduplicationService - Handle event source priority and deduplication
 *
 * Extracted from StreamingHandlerService to handle:
 * - Source priority logic (history > hook > complete > stream)
 * - Duplicate checking for messages, tools, and agents
 * - Session cleanup for deduplication state
 *
 * Part of StreamingHandlerService refactoring for better maintainability.
 */

import { Injectable } from '@angular/core';
import {
  FlatStreamEventUnion,
  EventSource,
  MessageStartEvent,
} from '@ptah-extension/shared';
import type { StreamingState } from '@ptah-extension/chat-types';

@Injectable({ providedIn: 'root' })
export class EventDeduplicationService {
  /**
   * Tracks processed messageIds per session to prevent duplicate message_start events.
   * SDK sends both streaming events AND complete messages - we must deduplicate.
   * Map key = sessionId, value = Set of processed messageIds.
   */
  private processedMessageIds = new Map<string, Set<string>>();

  /**
   * Tracks processed toolCallIds per session to prevent duplicate tool_start events.
   * Prevents duplicate agent cards.
   * Map key = sessionId, value = Set of processed toolCallIds.
   */
  private processedToolCallIds = new Map<string, Set<string>>();

  /**
   * Source priority for event deduplication.
   * Higher priority sources should replace lower priority sources.
   * - 'history': Loaded from JSONL files (highest priority - definitive)
   * - 'hook': From SDK subagent hooks (medium-high priority - has agentId for summary lookup)
   * - 'complete': From complete assistant/user messages (high priority - definitive)
   * - 'stream': From streaming events (low priority - preview only)
   */
  getSourcePriority(source: EventSource | undefined): number {
    switch (source) {
      case 'history':
        return 4;
      case 'hook':
        return 3; // Hook events have agentId - preserve them
      case 'complete':
        return 2;
      case 'stream':
        return 1;
      default:
        return 0;
    }
  }

  /**
   * Check if new event should replace existing event based on source priority.
   * Returns true if new event has higher or equal priority.
   */
  shouldReplaceEvent(
    existingSource: EventSource | undefined,
    newSource: EventSource | undefined,
  ): boolean {
    return (
      this.getSourcePriority(newSource) >=
      this.getSourcePriority(existingSource)
    );
  }

  /**
   * Replace stream events with higher priority events for the same toolCallId.
   * When a 'complete' or 'history' source event arrives, it should replace any existing
   * 'stream' source events for the same tool call.
   *
   * Also supports agent_start events to prevent duplicate agents.
   *
   * @param state - The streaming state to update
   * @param toolCallId - The tool call ID to match
   * @param eventType - The event type to match ('tool_start', 'tool_result', or 'agent_start')
   * @param newSource - The source of the new event
   * @returns The existing event if it should NOT be replaced, undefined if new event should be stored
   */
  replaceStreamEventIfNeeded(
    state: StreamingState,
    toolCallId: string,
    eventType: 'tool_start' | 'tool_result' | 'agent_start',
    newSource: EventSource | undefined,
  ): FlatStreamEventUnion | undefined {
    // Find existing event with same toolCallId and eventType
    let existingEvent: FlatStreamEventUnion | undefined;

    for (const event of state.events.values()) {
      if (
        event.eventType === eventType &&
        'toolCallId' in event &&
        event.toolCallId === toolCallId
      ) {
        existingEvent = event;
        break;
      }
    }

    if (!existingEvent) {
      // No existing event, new event should be stored
      return undefined;
    }

    const existingSource = (
      existingEvent as FlatStreamEventUnion & { source?: EventSource }
    ).source;

    if (this.shouldReplaceEvent(existingSource, newSource)) {
      // New event has higher priority, remove old event
      state.events.delete(existingEvent.id);
      return undefined; // Allow new event to be stored
    }

    // Existing event has higher priority, skip new event
    return existingEvent;
  }

  /**
   * Deduplicate agent_start events by agentId (stable key).
   *
   * The hook and SDK complete message send agent_start events with DIFFERENT toolCallId formats:
   * - Hook: UUID format (e.g., "b4139c0d-...")
   * - Complete: Anthropic format (e.g., "toolu_012W...")
   *
   * Using toolCallId for deduplication fails because they don't match.
   * This method uses agentId (stable across both sources) for deduplication.
   *
   * @param state - The streaming state to check
   * @param agentId - The stable agent identifier (e.g., "adcecb2")
   * @param newSource - The source of the new event
   * @returns The existing event if it should NOT be replaced, undefined if new event should be stored
   */
  replaceAgentStartByAgentId(
    state: StreamingState,
    agentId: string | undefined,
    newSource: EventSource | undefined,
  ): FlatStreamEventUnion | undefined {
    // If no agentId, can't deduplicate by agentId - fall through to caller
    if (!agentId) {
      return undefined;
    }

    // Find existing agent_start event with same agentId
    let existingEvent: FlatStreamEventUnion | undefined;

    for (const event of state.events.values()) {
      if (event.eventType === 'agent_start') {
        // Type narrowing for agentId access
        const agentEvent = event as FlatStreamEventUnion & {
          agentId?: string;
        };
        if (agentEvent.agentId === agentId) {
          existingEvent = event;
          break;
        }
      }
    }

    if (!existingEvent) {
      // No existing event with this agentId
      return undefined;
    }

    const existingSource = (
      existingEvent as FlatStreamEventUnion & { source?: EventSource }
    ).source;

    // Dev-guard diagnostic log to reduce GC pressure in production
    if (typeof ngDevMode !== 'undefined' && ngDevMode) {
      console.log(
        '[EventDeduplication] Agent_start deduplication by agentId:',
        {
          agentId,
          existingSource,
          newSource,
          existingEventId: existingEvent.id,
          willReplace: this.shouldReplaceEvent(existingSource, newSource),
        },
      );
    }

    if (this.shouldReplaceEvent(existingSource, newSource)) {
      // New event has higher priority, remove old event
      state.events.delete(existingEvent.id);
      return undefined; // Allow new event to be stored
    }

    // Existing event has higher priority, skip new event
    return existingEvent;
  }

  /**
   * Find existing message_start event for a given messageId.
   * Used to check for duplicates before storing a new message_start event.
   *
   * @param state - The streaming state to search
   * @param messageId - The messageId to search for
   * @returns The existing message_start event if found, undefined otherwise
   */
  findMessageStartEvent(
    state: StreamingState,
    messageId: string,
  ): FlatStreamEventUnion | undefined {
    // Search in eventsByMessage for efficiency
    const messageEvents = state.eventsByMessage.get(messageId);
    if (!messageEvents) return undefined;

    return messageEvents.find((e) => e.eventType === 'message_start');
  }

  /**
   * Get or create the set of processed message IDs for a session.
   */
  getProcessedMessageIds(sessionId: string): Set<string> {
    let set = this.processedMessageIds.get(sessionId);
    if (!set) {
      set = new Set<string>();
      this.processedMessageIds.set(sessionId, set);
    }
    return set;
  }

  /**
   * Get or create the set of processed tool call IDs for a session.
   */
  getProcessedToolCallIds(sessionId: string): Set<string> {
    let set = this.processedToolCallIds.get(sessionId);
    if (!set) {
      set = new Set<string>();
      this.processedToolCallIds.set(sessionId, set);
    }
    return set;
  }

  /**
   * Check if a message was already processed and finalized.
   * Skip deltas for already-finalized messages.
   */
  isMessageAlreadyFinalized(
    sessionId: string,
    messageId: string,
    state: StreamingState,
  ): boolean {
    const sessionMsgIds = this.processedMessageIds.get(sessionId);
    return (
      !!sessionMsgIds?.has(messageId) &&
      !state.messageEventIds.includes(messageId)
    );
  }

  /**
   * Check if a tool was already processed and finalized.
   * Skip deltas for already-finalized tools.
   */
  isToolAlreadyFinalized(
    sessionId: string,
    toolCallId: string,
    state: StreamingState,
  ): boolean {
    const sessionToolIds = this.processedToolCallIds.get(sessionId);
    return (
      !!sessionToolIds?.has(toolCallId) && !state.toolCallMap.has(toolCallId)
    );
  }

  /**
   * Handle duplicate message_start event with source priority.
   * Returns true if the event should be skipped (existing has higher priority).
   */
  handleDuplicateMessageStart(
    state: StreamingState,
    event: MessageStartEvent,
  ): { skip: boolean; existingEvent?: FlatStreamEventUnion } {
    const existingMsgStart = this.findMessageStartEvent(state, event.messageId);

    if (!existingMsgStart) {
      return { skip: false };
    }

    // We have an existing message_start for this messageId
    const existingSource = (
      existingMsgStart as FlatStreamEventUnion & { source?: EventSource }
    ).source;

    if (this.shouldReplaceEvent(existingSource, event.source)) {
      // New event has higher priority - remove old, store new
      state.events.delete(existingMsgStart.id);
      // Remove from eventsByMessage
      const msgEvents = state.eventsByMessage.get(event.messageId) || [];
      const filtered = msgEvents.filter((e) => e.id !== existingMsgStart.id);
      state.eventsByMessage.set(event.messageId, filtered);
      // Return existingEvent so caller knows this is a REPLACEMENT,
      // not a first occurrence. Without this, caller pushes messageId to messageEventIds
      // again, causing the same message to appear 2-3 times in the UI.
      return { skip: false, existingEvent: existingMsgStart };
    }

    // Existing has higher priority - skip this event
    return { skip: true, existingEvent: existingMsgStart };
  }

  /**
   * Clean up deduplication state for a session.
   * MUST be called when closing/deleting a session to prevent memory leaks.
   *
   * @param sessionId - Session ID to clean up
   */
  cleanupSession(sessionId: string): void {
    this.processedMessageIds.delete(sessionId);
    this.processedToolCallIds.delete(sessionId);
  }
}
