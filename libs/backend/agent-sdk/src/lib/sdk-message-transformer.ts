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
  EventSource,
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
 *
 * TASK_2025_096 FIX: Changed from single currentMessageId to per-context tracking.
 * Main agent and subagent streams interleave, so we must track messageId separately
 * for each context (parentToolUseId). Without this, subagent text_delta events
 * would be associated with wrong messageId when main agent continues streaming.
 */
@injectable()
export class SdkMessageTransformer {
  /**
   * TASK_2025_096 FIX: Per-context message ID tracking.
   * Key: parentToolUseId (or '' for root messages)
   * Value: current messageId for that context
   *
   * This prevents main agent and subagent streams from interfering.
   * When subagent sends message_start with parentToolUseId='tool-xyz',
   * its messageId is stored under 'tool-xyz' key, separate from root.
   */
  private currentMessageIdByContext: Map<string, string> = new Map();

  /**
   * Maps blockIndex to real contentBlock.id from tool_use blocks.
   * Used to associate tool_delta events with correct toolCallId.
   * Cleared on message boundaries.
   *
   * TASK_2025_096 FIX: Changed to per-context tracking.
   * Key: `${context}:${blockIndex}` where context = parentToolUseId || ''
   */
  private toolCallIdByContextAndBlock: Map<string, string> = new Map();

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
        // TASK_2025_094 FIX: Use Anthropic API's message.id for stable message correlation
        //
        // Log evidence proves message.id (like "gen-1766961093-H9nAcWY4jRlYPHnMLdIi")
        // IS CONSISTENT across stream_event AND assistant messages for the same response.
        //
        // The SDK's uuid is DIFFERENT for each SDK message, which breaks:
        // 1. Tool linking: tool_start and tool_result end up with different messageIds
        // 2. Deduplication: same content gets added twice with different messageIds
        // 3. Tree building: events for same message scattered across multiple messageIds
        //
        // Priority: Anthropic message.id > SDK uuid > generated fallback
        const message = (event as { message?: { id?: string } }).message;
        const messageId =
          message?.id || sdkMessage.uuid || `stream-msg-${Date.now()}`;

        // DIAGNOSTIC: Log ALL message_start events to understand SDK behavior for subagents
        this.logger.info(`[SdkMessageTransformer] message_start received`, {
          messageId,
          sdkUuid: sdkMessage.uuid,
          anthropicMsgId: message?.id,
          parentToolUseId: parentToolUseId || '(root)',
          isSubagent: !!parentToolUseId,
        });

        // TASK_2025_096 FIX: Track current message ID per context
        // Context = parentToolUseId (for nested agent messages) or '' (for root messages)
        // This prevents main agent and subagent streams from interfering with each other.
        const context = parentToolUseId || '';
        this.currentMessageIdByContext.set(context, messageId);

        // Clear tool call ID tracking for this context's new message
        // Only clear entries for this context, not all entries
        for (const key of this.toolCallIdByContextAndBlock.keys()) {
          if (key.startsWith(`${context}:`)) {
            this.toolCallIdByContextAndBlock.delete(key);
          }
        }

        this.logger.debug(
          `[SdkMessageTransformer] Stream started: ${messageId} (context: ${
            context || 'root'
          })`
        );

        // Emit message_start event
        const messageStartEvent: MessageStartEvent = {
          id: generateEventId(),
          eventType: 'message_start',
          timestamp: Date.now(),
          sessionId: sessionId || '',
          source: 'stream' as EventSource,
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

        // TASK_2025_096 FIX: Look up messageId by context
        const context = parentToolUseId || '';
        const currentMessageId = this.currentMessageIdByContext.get(context);

        if (!usage || !currentMessageId) {
          return [];
        }

        const messageDeltaEvent: MessageDeltaEvent = {
          id: generateEventId(),
          eventType: 'message_delta',
          timestamp: Date.now(),
          sessionId: sessionId || '',
          source: 'stream' as EventSource,
          messageId: currentMessageId,
          tokenUsage: {
            input: usage.input_tokens ?? 0,
            output: usage.output_tokens ?? 0,
          },
        };

        return [messageDeltaEvent];
      }

      case 'message_stop': {
        // TASK_2025_096 FIX: Look up messageId by context
        const context = parentToolUseId || '';
        const currentMessageId = this.currentMessageIdByContext.get(context);

        this.logger.debug(
          `[SdkMessageTransformer] Stream stopped: ${currentMessageId} (context: ${
            context || 'root'
          })`
        );

        // TASK_2025_086: Emit message_complete when stream ends
        // This is CRITICAL - without this, StreamTransformer never stores the message
        // because it waits for message_complete to finalize the accumulator
        const events: FlatStreamEventUnion[] = [];

        if (currentMessageId) {
          const messageCompleteEvent: MessageCompleteEvent = {
            id: generateEventId(),
            eventType: 'message_complete',
            timestamp: Date.now(),
            sessionId: sessionId || '',
            source: 'stream' as EventSource,
            messageId: currentMessageId,
            // Note: token usage comes from message_delta events, not message_stop
            parentToolUseId,
          };
          events.push(messageCompleteEvent);
        }

        // TASK_2025_096 FIX: Clear tracking for this context only
        this.currentMessageIdByContext.delete(context);
        for (const key of this.toolCallIdByContextAndBlock.keys()) {
          if (key.startsWith(`${context}:`)) {
            this.toolCallIdByContextAndBlock.delete(key);
          }
        }

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

        // TASK_2025_096 FIX: Look up messageId by context
        const context = parentToolUseId || '';
        const currentMessageId = this.currentMessageIdByContext.get(context);

        if (!currentMessageId) {
          this.logger.warn(
            `[SdkMessageTransformer] content_block_start but no active message for context: ${
              context || 'root'
            }`
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
            source: 'stream' as EventSource,
            messageId: currentMessageId,
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

          // TASK_2025_096 FIX: Track real toolCallId per context
          const blockKey = `${context}:${blockIndex}`;
          this.toolCallIdByContextAndBlock.set(blockKey, contentBlock.id);

          const toolStartEvent: ToolStartEvent = {
            id: generateEventId(),
            eventType: 'tool_start',
            timestamp: Date.now(),
            sessionId: sessionId || '',
            source: 'stream' as EventSource,
            messageId: currentMessageId,
            toolCallId: contentBlock.id,
            toolName: contentBlock.name,
            isTaskTool,
            parentToolUseId,
          };

          // TASK_2025_096 FIX: Only emit tool_start during streaming.
          // DO NOT emit agent_start here - we don't have the agentType yet.
          // agent_start will be emitted when the complete message arrives
          // (in transformCompleteAssistantMessage) with the correct agentType.
          // Emitting agent_start here with 'unknown' causes duplicate agents.
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

        // TASK_2025_096 FIX: Look up messageId by context
        const context = parentToolUseId || '';
        const currentMessageId = this.currentMessageIdByContext.get(context);

        // DIAGNOSTIC: Log ALL content_block_delta events to understand SDK behavior
        // This will help us see if SDK sends text_delta for subagents
        this.logger.info(
          `[SdkMessageTransformer] content_block_delta received`,
          {
            deltaType: delta?.type,
            hasText: !!delta?.text,
            textLength: delta?.text?.length || 0,
            hasPartialJson: !!delta?.partial_json,
            parentToolUseId: parentToolUseId || '(root)',
            context,
            currentMessageId: currentMessageId || '(none)',
            blockIndex,
            isSubagent: !!parentToolUseId,
          }
        );

        if (!delta || !currentMessageId) {
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
              source: 'stream' as EventSource,
              messageId: currentMessageId,
              delta: delta.text,
              blockIndex,
              parentToolUseId,
            };

            // DIAGNOSTIC: Log text_delta emission for subagent debugging
            if (parentToolUseId) {
              this.logger.info(
                `[SdkMessageTransformer] SUBAGENT text_delta emitted`,
                {
                  eventId: textDeltaEvent.id,
                  messageId: currentMessageId,
                  parentToolUseId,
                  textLength: delta.text.length,
                  textSnippet: delta.text.substring(0, 50),
                  blockIndex,
                }
              );
            }

            return [textDeltaEvent];
          }

          case 'input_json_delta': {
            if (delta.partial_json === undefined) return [];

            // TASK_2025_096 FIX: Get real toolCallId per context
            const blockKey = `${context}:${blockIndex}`;
            const realToolCallId =
              this.toolCallIdByContextAndBlock.get(blockKey) ||
              `tool-block-${blockIndex}`;

            const toolDeltaEvent: ToolDeltaEvent = {
              id: generateEventId(),
              eventType: 'tool_delta',
              timestamp: Date.now(),
              sessionId: sessionId || '',
              source: 'stream' as EventSource,
              messageId: currentMessageId,
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
              source: 'stream' as EventSource,
              messageId: currentMessageId,
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
              source: 'stream' as EventSource,
              messageId: currentMessageId,
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

    // TASK_2025_094 FIX: Use Anthropic API's message.id for stable message correlation
    //
    // Log evidence proves message.id IS CONSISTENT across stream_event AND assistant.
    // Using uuid causes tool_start and tool_result to have DIFFERENT messageIds,
    // breaking tree builder tool collection (collectTools filters by messageId).
    //
    // Priority: Anthropic message.id > SDK uuid
    const messageId = message?.id || uuid;

    // DIAGNOSTIC: Log complete assistant messages, especially for subagents
    // This helps understand if/when SDK sends complete text for subagents
    const contentTypes = content.map((block) => {
      if (isTextBlock(block)) return `text(${block.text.length} chars)`;
      if (isToolUseBlock(block)) return `tool(${block.name})`;
      if (isToolResultBlock(block)) return `tool_result(${block.tool_use_id})`;
      return 'unknown';
    });

    this.logger.info(
      `[SdkMessageTransformer] transformAssistantToFlatEvents called`,
      {
        messageId,
        uuid,
        parentToolUseId: parent_tool_use_id || '(root)',
        isSubagent: !!parent_tool_use_id,
        contentBlockCount: content.length,
        contentTypes,
      }
    );

    // 1. Emit message_start
    const messageStartEvent: MessageStartEvent = {
      id: generateEventId(),
      eventType: 'message_start',
      timestamp: Date.now(),
      sessionId: sessionId || '',
      source: 'complete' as EventSource,
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
          source: 'complete' as EventSource,
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
          source: 'complete' as EventSource,
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
        // TASK_2025_095: parentToolUseId must link to the Task tool's toolCallId (block.id)
        // This allows the frontend tree builder to find the agent via parentToolUseId
        if (isTaskTool) {
          const agentStartEvent: AgentStartEvent = {
            id: generateEventId(),
            eventType: 'agent_start',
            timestamp: Date.now(),
            sessionId: sessionId || '',
            source: 'complete' as EventSource,
            messageId,
            toolCallId: block.id,
            agentType: agentType || 'unknown',
            agentDescription,
            agentPrompt,
            parentToolUseId: block.id, // Link to parent Task tool
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
          source: 'complete' as EventSource,
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
      source: 'complete' as EventSource,
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
   * - tool_result events (for tool_result content blocks)
   * - message_complete
   *
   * TASK_2025_086: Skips empty user messages (SDK sends these for tool result confirmations)
   * TASK_2025_092: Now extracts tool_result blocks from user messages
   */
  private transformUserToFlatEvents(
    sdkMessage: SDKUserMessage,
    sessionId?: SessionId
  ): FlatStreamEventUnion[] {
    const { uuid, message, parent_tool_use_id } = sdkMessage;

    // DIAGNOSTIC: Log user message processing
    this.logger.info(
      '[SdkMessageTransformer] transformUserToFlatEvents called',
      {
        uuid,
        sessionId,
        contentType: typeof message.content,
        isArray: Array.isArray(message.content),
        contentLength: Array.isArray(message.content)
          ? message.content.length
          : 0,
      }
    );

    const events: FlatStreamEventUnion[] = [];
    const messageId = uuid || `user-${Date.now()}`;

    // TASK_2025_092: First, check for tool_result blocks in user messages
    // SDK sends tool execution results as user messages with tool_result content blocks
    // We MUST emit these as tool_result events, otherwise tools remain in streaming state
    //
    // Note: UserMessageContent type is different from ContentBlock - it includes image blocks
    // but excludes ThinkingBlock. We use inline type check instead of isToolResultBlock guard.
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        // Inline type check for tool_result (UserMessageContent != ContentBlock)
        if (
          typeof block === 'object' &&
          block !== null &&
          'type' in block &&
          block.type === 'tool_result' &&
          'tool_use_id' in block
        ) {
          const toolResultBlock = block as ToolResultBlock;
          const toolResultEvent: ToolResultEvent = {
            id: generateEventId(),
            eventType: 'tool_result',
            timestamp: Date.now(),
            sessionId: sessionId || '',
            source: 'complete' as EventSource,
            messageId,
            toolCallId: toolResultBlock.tool_use_id,
            output: toolResultBlock.content,
            isError: toolResultBlock.is_error ?? false,
            parentToolUseId: parent_tool_use_id ?? undefined,
          };
          events.push(toolResultEvent);
          this.logger.debug(
            '[SdkMessageTransformer] Extracted tool_result from user message',
            {
              uuid,
              toolCallId: toolResultBlock.tool_use_id,
              isError: toolResultBlock.is_error,
            }
          );
        }
      }

      // If we found tool_result blocks, return them without creating empty user message bubbles
      if (events.length > 0) {
        this.logger.info(
          '[SdkMessageTransformer] Extracted tool_result events from user message',
          {
            eventCount: events.length,
            toolCallIds: events
              .filter((e) => e.eventType === 'tool_result')
              .map((e) => (e as ToolResultEvent).toolCallId),
          }
        );
        return events;
      }
    }

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

    // TASK_2025_086: Skip empty user messages (no text content AND no tool_result blocks)
    // This prevents empty "You" bubbles from appearing in the UI
    if (!textContent || !textContent.trim()) {
      this.logger.debug('[SdkMessageTransformer] Skipping empty user message', {
        uuid,
      });
      return [];
    }

    // TASK_2025_096 FIX: Include parentToolUseId on user message events.
    // When SDK invokes an agent, it sends a user message with the agent's prompt.
    // This message has parent_tool_use_id set, linking it to the parent Task tool.
    // We MUST include parentToolUseId so frontend filters these as nested messages.
    // Without this, the agent's internal prompt appears as a separate user bubble.
    const parentToolUseId = parent_tool_use_id ?? undefined;

    // 1. Emit message_start
    const messageStartEvent: MessageStartEvent = {
      id: generateEventId(),
      eventType: 'message_start',
      timestamp: Date.now(),
      sessionId: sessionId || '',
      source: 'complete' as EventSource,
      messageId: uuid || `user-${Date.now()}`,
      role: 'user',
      parentToolUseId,
    };
    events.push(messageStartEvent);

    // 2. Emit text_delta with full text
    const textDeltaEvent: TextDeltaEvent = {
      id: generateEventId(),
      eventType: 'text_delta',
      timestamp: Date.now(),
      sessionId: sessionId || '',
      source: 'complete' as EventSource,
      messageId: uuid || `user-${Date.now()}`,
      delta: textContent,
      blockIndex: 0,
      parentToolUseId,
    };
    events.push(textDeltaEvent);

    // 3. Emit message_complete
    const messageCompleteEvent: MessageCompleteEvent = {
      id: generateEventId(),
      eventType: 'message_complete',
      timestamp: Date.now(),
      sessionId: sessionId || '',
      source: 'complete' as EventSource,
      messageId: uuid || `user-${Date.now()}`,
      parentToolUseId,
    };
    events.push(messageCompleteEvent);

    return events;
  }

  /**
   * Clear streaming state - called for reset scenarios
   * TASK_2025_096 FIX: Clears all per-context tracking
   */
  clearStreamingState(): void {
    this.currentMessageIdByContext.clear();
    this.toolCallIdByContextAndBlock.clear();
  }
}
