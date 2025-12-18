/**
 * SDK Message Transformer - Converts SDK messages to flat stream events
 *
 * Transforms messages from the official Claude Agent SDK into flat streaming events
 * that contain relationship IDs instead of nested children trees.
 *
 * CRITICAL CHANGE (TASK_2025_082): Emits FlatStreamEventUnion[] instead of ExecutionNode[].
 * The frontend builds ExecutionNode trees at render time from these flat events.
 */

import { injectable, inject } from 'tsyringe';
import {
  FlatStreamEventUnion,
  MessageStartEvent,
  TextDeltaEvent,
  ThinkingStartEvent,
  ThinkingDeltaEvent,
  ToolStartEvent,
  ToolDeltaEvent,
  ToolResultEvent,
  AgentStartEvent,
  MessageCompleteEvent,
  MessageDeltaEvent,
  SignatureDeltaEvent,
  SessionId,
  calculateMessageCost,
} from '@ptah-extension/shared';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import {
  SDKMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKSystemMessage,
  SDKResultMessage,
  SDKPartialAssistantMessage,
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
  isTextBlock,
  isToolUseBlock,
  isToolResultBlock,
  isResultMessage,
  isSystemInit,
  isStreamEvent,
  isUserMessage,
  isAssistantMessage,
} from './types/sdk-types/claude-sdk.types';

// Re-export isResultMessage for backward compatibility with stream-transformer.ts
export { isResultMessage as isSDKResultMessage };

/**
 * Generate unique event ID
 * Format: evt_{timestamp}_{random}
 */
function generateEventId(): string {
  return `evt_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * SdkMessageTransformer - Transforms SDK messages to flat stream events
 *
 * CRITICAL CHANGE (TASK_2025_082):
 * - Returns FlatStreamEventUnion[] instead of ExecutionNode[]
 * - NO tree building (no children field manipulation)
 * - Emits events with relationship IDs (messageId, toolCallId, parentToolUseId)
 * - Removed 87 lines of complex state tracking (messageStates, messageUuidStack)
 * - Simple currentMessageId variable tracking instead
 */
@injectable()
export class SdkMessageTransformer {
  /**
   * Simple message ID tracking - replaced complex Map-based state
   */
  private currentMessageId: string | null = null;

  /**
   * Maps blockIndex to real contentBlock.id from tool_use blocks.
   * Used to associate tool_delta events with correct toolCallId.
   * Cleared on message boundaries.
   */
  private toolCallIdByBlockIndex: Map<number, string> = new Map();

  constructor(@inject(TOKENS.LOGGER) private logger: Logger) {}

  /**
   * Transform SDK message to flat stream events
   *
   * A single SDK message may produce multiple flat events:
   * - SDKAssistantMessage → message_start + content events + message_complete
   * - SDKUserMessage → message_start + text_delta + message_complete
   * - stream_event → various streaming events
   *
   * @param sdkMessage - SDK message to transform (uses structural typing to match SDK types)
   * @param sessionId - Optional session ID for event correlation
   * @returns Array of FlatStreamEventUnion (flat events with relationship IDs)
   */
  transform(
    sdkMessage: SDKMessage,
    sessionId?: SessionId
  ): FlatStreamEventUnion[] {
    try {
      // Use type guards for discriminated union narrowing
      if (isAssistantMessage(sdkMessage)) {
        return this.transformAssistantToFlatEvents(sdkMessage, sessionId);
      }

      if (isUserMessage(sdkMessage)) {
        return this.transformUserToFlatEvents(sdkMessage, sessionId);
      }

      if (isSystemInit(sdkMessage)) {
        // Skip system messages (init, etc.) - they contain metadata
        // that shouldn't be displayed as chat messages in the UI.
        return [];
      }

      if (isResultMessage(sdkMessage)) {
        // Skip result messages - they contain session summary metadata
        // (cost, duration, tokens) that shouldn't appear as chat bubbles.
        // This data is handled via callback in StreamTransformer.
        return [];
      }

      if (isStreamEvent(sdkMessage)) {
        // Process partial streaming events for real-time UI updates
        return this.transformStreamEventToFlatEvents(sdkMessage, sessionId);
      }

      // Unknown message type
      this.logger.warn(
        '[SdkMessageTransformer] Unknown message type',
        sdkMessage
      );
      return [];
    } catch (error) {
      const errorObj =
        error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        '[SdkMessageTransformer] Transformation failed',
        errorObj
      );
      return [];
    }
  }

  /**
   * Transform SDK stream_event to flat events
   *
   * stream_event messages contain real-time streaming content from the API.
   * The event field contains RawMessageStreamEvent with various event types:
   * - message_start: Initialize streaming with message.id (UUID)
   * - content_block_start: New content block beginning
   * - content_block_delta: Partial text/json/thinking content
   * - content_block_stop: Content block finished
   * - message_delta: Top-level changes (stop_reason, cumulative token usage)
   * - message_stop: Final completion event
   * - ping: Keep-alive (ignored)
   * - error: Stream error
   */
  private transformStreamEventToFlatEvents(
    sdkMessage: SDKPartialAssistantMessage,
    sessionId?: SessionId
  ): FlatStreamEventUnion[] {
    const { event, parent_tool_use_id } = sdkMessage;

    // Skip non-content events
    if (!event || typeof event !== 'object') {
      return [];
    }

    const eventType = (event as { type?: string }).type;
    const blockIndex = (event as { index?: number }).index ?? 0;

    // Capture parent_tool_use_id for nested agent messages
    const parentToolUseId = parent_tool_use_id ?? undefined;

    switch (eventType) {
      // ========== MESSAGE LIFECYCLE ==========

      case 'message_start': {
        // Capture UUID from message.id - this is the canonical message ID
        const message = (event as { message?: { id?: string } }).message;
        const messageId = message?.id || `stream-msg-${Date.now()}`;

        // Track current message ID (simple variable tracking)
        this.currentMessageId = messageId;

        // Clear tool call ID tracking for new message
        this.toolCallIdByBlockIndex.clear();

        this.logger.debug(
          `[SdkMessageTransformer] Stream started: ${messageId}`
        );

        // Emit message_start event
        const messageStartEvent: MessageStartEvent = {
          id: generateEventId(),
          eventType: 'message_start',
          timestamp: Date.now(),
          sessionId: sessionId || '',
          messageId,
          role: 'assistant',
          parentToolUseId,
        };

        return [messageStartEvent];
      }

      case 'message_delta': {
        // Emit message_delta event with cumulative token usage
        const usage = (
          event as {
            usage?: { input_tokens?: number; output_tokens?: number };
          }
        ).usage;

        if (!usage || !this.currentMessageId) {
          return [];
        }

        const messageDeltaEvent: MessageDeltaEvent = {
          id: generateEventId(),
          eventType: 'message_delta',
          timestamp: Date.now(),
          sessionId: sessionId || '',
          messageId: this.currentMessageId,
          tokenUsage: {
            input: usage.input_tokens ?? 0,
            output: usage.output_tokens ?? 0,
          },
        };

        return [messageDeltaEvent];
      }

      case 'message_stop': {
        this.logger.debug(
          `[SdkMessageTransformer] Stream stopped: ${this.currentMessageId}`
        );

        // TASK_2025_086: Emit message_complete when stream ends
        // This is CRITICAL - without this, StreamTransformer never stores the message
        // because it waits for message_complete to finalize the accumulator
        const events: FlatStreamEventUnion[] = [];

        if (this.currentMessageId) {
          const messageCompleteEvent: MessageCompleteEvent = {
            id: generateEventId(),
            eventType: 'message_complete',
            timestamp: Date.now(),
            sessionId: sessionId || '',
            messageId: this.currentMessageId,
            // Note: token usage comes from message_delta events, not message_stop
            parentToolUseId,
          };
          events.push(messageCompleteEvent);
        }

        // Clear tracking after emitting complete event
        this.currentMessageId = null;
        this.toolCallIdByBlockIndex.clear();

        return events;
      }

      // ========== CONTENT BLOCK LIFECYCLE ==========

      case 'content_block_start': {
        const contentBlock = (
          event as {
            content_block?: {
              type?: string;
              text?: string;
              id?: string;
              name?: string;
            };
          }
        ).content_block;

        const blockType = contentBlock?.type || 'text';

        if (!this.currentMessageId) {
          this.logger.warn(
            '[SdkMessageTransformer] content_block_start but no active message'
          );
          return [];
        }

        // Emit thinking_start for thinking blocks
        if (blockType === 'thinking') {
          const thinkingStartEvent: ThinkingStartEvent = {
            id: generateEventId(),
            eventType: 'thinking_start',
            timestamp: Date.now(),
            sessionId: sessionId || '',
            messageId: this.currentMessageId,
            blockIndex,
            parentToolUseId,
          };

          return [thinkingStartEvent];
        }

        // Emit tool_start for tool_use blocks
        if (
          blockType === 'tool_use' &&
          contentBlock?.id &&
          contentBlock?.name
        ) {
          const isTaskTool = contentBlock.name === 'Task';

          // Track real toolCallId for subsequent deltas
          this.toolCallIdByBlockIndex.set(blockIndex, contentBlock.id);

          const toolStartEvent: ToolStartEvent = {
            id: generateEventId(),
            eventType: 'tool_start',
            timestamp: Date.now(),
            sessionId: sessionId || '',
            messageId: this.currentMessageId,
            toolCallId: contentBlock.id,
            toolName: contentBlock.name,
            isTaskTool,
            parentToolUseId,
          };

          return [toolStartEvent];
        }

        // Text blocks don't emit on start (wait for delta)
        return [];
      }

      case 'content_block_delta': {
        const delta = (
          event as {
            delta?: {
              type?: string;
              text?: string;
              partial_json?: string;
              thinking?: string;
              signature?: string;
            };
          }
        ).delta;

        if (!delta || !this.currentMessageId) {
          return [];
        }

        switch (delta.type) {
          case 'text_delta': {
            if (!delta.text) return [];

            const textDeltaEvent: TextDeltaEvent = {
              id: generateEventId(),
              eventType: 'text_delta',
              timestamp: Date.now(),
              sessionId: sessionId || '',
              messageId: this.currentMessageId,
              delta: delta.text,
              blockIndex,
              parentToolUseId,
            };

            return [textDeltaEvent];
          }

          case 'input_json_delta': {
            if (delta.partial_json === undefined) return [];

            // Get real toolCallId from map, fallback to placeholder if delta arrives before start
            const realToolCallId =
              this.toolCallIdByBlockIndex.get(blockIndex) ||
              `tool-block-${blockIndex}`;

            const toolDeltaEvent: ToolDeltaEvent = {
              id: generateEventId(),
              eventType: 'tool_delta',
              timestamp: Date.now(),
              sessionId: sessionId || '',
              messageId: this.currentMessageId,
              toolCallId: realToolCallId,
              delta: delta.partial_json,
              parentToolUseId,
            };

            return [toolDeltaEvent];
          }

          case 'thinking_delta': {
            if (!delta.thinking) return [];

            const thinkingDeltaEvent: ThinkingDeltaEvent = {
              id: generateEventId(),
              eventType: 'thinking_delta',
              timestamp: Date.now(),
              sessionId: sessionId || '',
              messageId: this.currentMessageId,
              delta: delta.thinking,
              blockIndex,
              signature: delta.signature,
              parentToolUseId,
            };

            return [thinkingDeltaEvent];
          }

          case 'signature_delta': {
            // Extended thinking signature validation
            // Emitted after thinking block to provide cryptographic verification
            if (!delta.signature) return [];

            const signatureDeltaEvent: SignatureDeltaEvent = {
              id: generateEventId(),
              eventType: 'signature_delta',
              timestamp: Date.now(),
              sessionId: sessionId || '',
              messageId: this.currentMessageId,
              blockIndex,
              signature: delta.signature,
              parentToolUseId,
            };

            return [signatureDeltaEvent];
          }

          default:
            this.logger.debug(
              `[SdkMessageTransformer] Unknown delta type: ${delta.type}`
            );
            return [];
        }
      }

      case 'content_block_stop': {
        // Content block finished - no event needed (frontend accumulates deltas)
        return [];
      }

      // ========== SPECIAL EVENTS ==========

      case 'ping':
        // Keep-alive event, ignore
        return [];

      case 'error': {
        const error = (event as { error?: { type?: string; message?: string } })
          .error;
        this.logger.error(
          `[SdkMessageTransformer] Stream error: ${error?.type} - ${error?.message}`
        );
        // Could emit error event if needed
        return [];
      }

      default:
        this.logger.debug(
          `[SdkMessageTransformer] Unknown event type: ${eventType}`
        );
        return [];
    }
  }

  /**
   * Transform complete assistant message to flat events
   *
   * Emits:
   * - message_start
   * - text_delta events for text blocks
   * - tool_start events for tool_use blocks
   * - tool_result events for tool_result blocks
   * - message_complete
   */
  private transformAssistantToFlatEvents(
    sdkMessage: SDKAssistantMessage,
    sessionId?: SessionId
  ): FlatStreamEventUnion[] {
    const { uuid, message, parent_tool_use_id } = sdkMessage;

    const events: FlatStreamEventUnion[] = [];

    // Extract content blocks from Anthropic SDK message
    const content = message.content || [];

    // TASK_2025_087 FIX: Use message.id (Anthropic API ID) for consistency with stream_event
    // Stream events use event.message.id, so we must match that for deduplication to work.
    // The SDK's internal `uuid` is different for stream_event vs assistant messages,
    // but `message.id` (Anthropic API ID like msg_xxx) is consistent across both.
    const messageId = message?.id || uuid;

    // 1. Emit message_start
    const messageStartEvent: MessageStartEvent = {
      id: generateEventId(),
      eventType: 'message_start',
      timestamp: Date.now(),
      sessionId: sessionId || '',
      messageId,
      role: 'assistant',
      parentToolUseId: parent_tool_use_id ?? undefined,
    };
    events.push(messageStartEvent);

    // 2. Emit content events (text, tools)
    let textBlockIndex = 0;

    for (const block of content) {
      if (isTextBlock(block)) {
        // Emit text_delta event
        const textDeltaEvent: TextDeltaEvent = {
          id: generateEventId(),
          eventType: 'text_delta',
          timestamp: Date.now(),
          sessionId: sessionId || '',
          messageId,
          delta: block.text,
          blockIndex: textBlockIndex,
          parentToolUseId: parent_tool_use_id ?? undefined,
        };
        events.push(textDeltaEvent);
        textBlockIndex++;
      } else if (isToolUseBlock(block)) {
        // Emit tool_start event
        const isTaskTool = block.name === 'Task';

        // Extract agent-specific fields for Task tools using safe property access
        // block.input is Record<string, unknown>, so we check properties exist
        let agentType: string | undefined;
        let agentDescription: string | undefined;
        let agentPrompt: string | undefined;

        if (isTaskTool && block.input) {
          // Use bracket notation for index signature properties (TS4111)
          agentType =
            'subagent_type' in block.input &&
            typeof block.input['subagent_type'] === 'string'
              ? block.input['subagent_type']
              : undefined;
          agentDescription =
            'description' in block.input &&
            typeof block.input['description'] === 'string'
              ? block.input['description']
              : undefined;
          agentPrompt =
            'prompt' in block.input && typeof block.input['prompt'] === 'string'
              ? block.input['prompt']
              : undefined;
        }

        const toolStartEvent: ToolStartEvent = {
          id: generateEventId(),
          eventType: 'tool_start',
          timestamp: Date.now(),
          sessionId: sessionId || '',
          messageId,
          toolCallId: block.id,
          toolName: block.name,
          toolInput: block.input,
          isTaskTool,
          agentType,
          agentDescription,
          agentPrompt,
          parentToolUseId: parent_tool_use_id ?? undefined,
        };

        // Emit agent_start event for Task tools
        if (isTaskTool) {
          const agentStartEvent: AgentStartEvent = {
            id: generateEventId(),
            eventType: 'agent_start',
            timestamp: Date.now(),
            sessionId: sessionId || '',
            messageId,
            toolCallId: block.id,
            agentType: agentType || 'unknown',
            agentDescription,
            agentPrompt,
            parentToolUseId: parent_tool_use_id ?? undefined,
          };
          events.push(agentStartEvent);
        }

        events.push(toolStartEvent);
      } else if (isToolResultBlock(block)) {
        // Emit tool_result event
        const toolResultEvent: ToolResultEvent = {
          id: generateEventId(),
          eventType: 'tool_result',
          timestamp: Date.now(),
          sessionId: sessionId || '',
          messageId,
          toolCallId: block.tool_use_id,
          output: block.content,
          isError: block.is_error ?? false,
          parentToolUseId: parent_tool_use_id ?? undefined,
        };
        events.push(toolResultEvent);
      }
    }

    // 3. Emit message_complete with metadata
    const tokenUsage =
      message.usage &&
      'input_tokens' in message.usage &&
      'output_tokens' in message.usage
        ? {
            input: message.usage.input_tokens,
            output: message.usage.output_tokens,
          }
        : undefined;

    const cost = tokenUsage
      ? calculateMessageCost(message.model || '', tokenUsage)
      : undefined;

    const messageCompleteEvent: MessageCompleteEvent = {
      id: generateEventId(),
      eventType: 'message_complete',
      timestamp: Date.now(),
      sessionId: sessionId || '',
      messageId,
      stopReason: message.stop_reason ?? undefined,
      tokenUsage,
      cost,
      model: message.model,
      parentToolUseId: parent_tool_use_id ?? undefined,
    };
    events.push(messageCompleteEvent);

    return events;
  }

  /**
   * Transform user message to flat events
   *
   * Emits:
   * - message_start
   * - text_delta (with full text)
   * - message_complete
   *
   * TASK_2025_086: Skips empty user messages (SDK sends these for tool result confirmations)
   */
  private transformUserToFlatEvents(
    sdkMessage: SDKUserMessage,
    sessionId?: SessionId
  ): FlatStreamEventUnion[] {
    const { uuid, message } = sdkMessage;

    const events: FlatStreamEventUnion[] = [];

    // Extract text content from user message
    let textContent = '';
    if (typeof message.content === 'string') {
      textContent = message.content;
    } else if (Array.isArray(message.content)) {
      // Concatenate text blocks
      // Filter for text blocks using inline check (UserMessageContent doesn't include ThinkingBlock)
      textContent = message.content
        .filter(
          (block): block is TextBlock =>
            typeof block === 'object' &&
            block !== null &&
            'type' in block &&
            block.type === 'text' &&
            'text' in block
        )
        .map((block) => block.text)
        .join('\n');
    }

    // TASK_2025_086: Skip empty user messages (SDK sends these for tool result confirmations)
    // This prevents empty "You" bubbles from appearing in the UI
    if (!textContent || !textContent.trim()) {
      this.logger.debug('[SdkMessageTransformer] Skipping empty user message', {
        uuid,
      });
      return [];
    }

    // 1. Emit message_start
    const messageStartEvent: MessageStartEvent = {
      id: generateEventId(),
      eventType: 'message_start',
      timestamp: Date.now(),
      sessionId: sessionId || '',
      messageId: uuid || `user-${Date.now()}`,
      role: 'user',
    };
    events.push(messageStartEvent);

    // 2. Emit text_delta with full text
    const textDeltaEvent: TextDeltaEvent = {
      id: generateEventId(),
      eventType: 'text_delta',
      timestamp: Date.now(),
      sessionId: sessionId || '',
      messageId: uuid || `user-${Date.now()}`,
      delta: textContent,
      blockIndex: 0,
    };
    events.push(textDeltaEvent);

    // 3. Emit message_complete
    const messageCompleteEvent: MessageCompleteEvent = {
      id: generateEventId(),
      eventType: 'message_complete',
      timestamp: Date.now(),
      sessionId: sessionId || '',
      messageId: uuid || `user-${Date.now()}`,
    };
    events.push(messageCompleteEvent);

    return events;
  }

  /**
   * Clear streaming state - called for reset scenarios
   */
  clearStreamingState(): void {
    this.currentMessageId = null;
    this.toolCallIdByBlockIndex.clear();
  }
}
