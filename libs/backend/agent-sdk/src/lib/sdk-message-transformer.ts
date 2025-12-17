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
  SessionId,
  calculateMessageCost,
} from '@ptah-extension/shared';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';

/**
 * SDK Types - Manually defined to avoid ESM/CommonJS import issues
 *
 * The SDK package is ESM-only ("type": "module"), but this library is CommonJS.
 * We manually define the types we need from the SDK to avoid TS1479 errors.
 * These types are extracted from @anthropic-ai/claude-agent-sdk/sdk.d.ts
 *
 * Note: These types use structural typing to match SDK types without imports.
 * We use `any` strategically in nested types to maintain compatibility while
 * preserving type safety at the API boundary.
 */

/**
 * Generic SDK message type - accepts any SDK message
 * We perform runtime type checking via switch/case on the 'type' field
 */
type SDKMessage = {
  type: string;
  [key: string]: any;
};

/**
 * Assistant message type (for internal type hints)
 */
type SDKAssistantMessage = SDKMessage & {
  type: 'assistant';
};

/**
 * User message type (for internal type hints)
 */
type SDKUserMessage = SDKMessage & {
  type: 'user';
};

/**
 * System message type (for internal type hints)
 */
type SDKSystemMessage = SDKMessage & {
  type: 'system';
  subtype: string;
};

/**
 * Result message type (for internal type hints)
 * Strict type with all required stats fields
 */
type SDKResultMessage = SDKMessage & {
  type: 'result';
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
  duration_ms: number;
};

/**
 * Content block types from Anthropic SDK
 * (defined locally to avoid ESM import issues)
 */
interface TextBlock {
  type: 'text';
  text: string;
}

interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ToolResultBlockParam {
  type: 'tool_result';
  tool_use_id: string;
  content?: string | unknown;
  is_error?: boolean;
}

/**
 * Type guard for TextBlock from Anthropic SDK
 */
function isTextBlock(block: unknown): block is TextBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    'type' in block &&
    block.type === 'text' &&
    'text' in block
  );
}

/**
 * Type guard for ToolUseBlock from Anthropic SDK
 */
function isToolUseBlock(block: unknown): block is ToolUseBlock {
  return (
    typeof block === 'object' &&
    block !== null &&
    'type' in block &&
    block.type === 'tool_use' &&
    'id' in block &&
    'name' in block &&
    'input' in block
  );
}

/**
 * Type guard for ToolResultBlockParam
 */
function isToolResultBlock(block: unknown): block is ToolResultBlockParam {
  return (
    typeof block === 'object' &&
    block !== null &&
    'type' in block &&
    block.type === 'tool_result' &&
    'tool_use_id' in block
  );
}

/**
 * Type guard for SDKResultMessage
 * Validates that result message has all required stats fields.
 * Uses bracket notation for index signature compatibility (TS4111).
 */
function isSDKResultMessage(msg: SDKMessage): msg is SDKResultMessage {
  if (msg.type !== 'result') return false;

  // Check top-level required fields exist and have correct types
  if (
    !('total_cost_usd' in msg) ||
    !('usage' in msg) ||
    !('duration_ms' in msg) ||
    typeof msg['total_cost_usd'] !== 'number' ||
    typeof msg['duration_ms'] !== 'number'
  ) {
    return false;
  }

  // Validate nested usage object
  const usage = msg['usage'];
  if (typeof usage !== 'object' || usage === null) return false;

  return (
    'input_tokens' in usage &&
    'output_tokens' in usage &&
    typeof usage.input_tokens === 'number' &&
    typeof usage.output_tokens === 'number'
  );
}

/**
 * Export type guard for external use
 */
export { isSDKResultMessage };

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
      switch (sdkMessage.type) {
        case 'assistant':
          return this.transformAssistantToFlatEvents(
            sdkMessage as SDKAssistantMessage,
            sessionId
          );

        case 'user':
          return this.transformUserToFlatEvents(
            sdkMessage as SDKUserMessage,
            sessionId
          );

        case 'system':
          // Skip system messages (init, etc.) - they contain metadata
          // that shouldn't be displayed as chat messages in the UI.
          return [];

        case 'result':
          // Skip result messages - they contain session summary metadata
          // (cost, duration, tokens) that shouldn't appear as chat bubbles.
          // This data is handled via callback in StreamTransformer.
          return [];

        case 'stream_event':
          // Process partial streaming events for real-time UI updates
          return this.transformStreamEventToFlatEvents(sdkMessage, sessionId);

        default:
          this.logger.warn(
            '[SdkMessageTransformer] Unknown message type',
            sdkMessage
          );
          return [];
      }
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
    sdkMessage: SDKMessage,
    sessionId?: SessionId
  ): FlatStreamEventUnion[] {
    const { event } = sdkMessage;

    // Skip non-content events
    if (!event || typeof event !== 'object') {
      return [];
    }

    const eventType = (event as { type?: string }).type;
    const blockIndex = (event as { index?: number }).index ?? 0;

    // Capture parent_tool_use_id for nested agent messages
    // This is present on stream_event messages from sub-agents
    const parentToolUseId = sdkMessage['parent_tool_use_id'] as
      | string
      | undefined;

    switch (eventType) {
      // ========== MESSAGE LIFECYCLE ==========

      case 'message_start': {
        // Capture UUID from message.id - this is the canonical message ID
        const message = (event as { message?: { id?: string } }).message;
        const messageId = message?.id || `stream-msg-${Date.now()}`;

        // Track current message ID (simple variable tracking)
        this.currentMessageId = messageId;

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

        // Clear tracking (assistant message will emit message_complete)
        this.currentMessageId = null;

        return [];
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

            // Find tool_start event by blockIndex to get toolCallId
            // (In flat event model, we need to track toolCallId separately)
            // For now, use a generated ID - frontend will associate by blockIndex
            const toolDeltaEvent: ToolDeltaEvent = {
              id: generateEventId(),
              eventType: 'tool_delta',
              timestamp: Date.now(),
              sessionId: sessionId || '',
              messageId: this.currentMessageId,
              toolCallId: `tool-block-${blockIndex}`, // Placeholder - real ID from tool_start
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

    // 1. Emit message_start
    const messageStartEvent: MessageStartEvent = {
      id: generateEventId(),
      eventType: 'message_start',
      timestamp: Date.now(),
      sessionId: sessionId || '',
      messageId: uuid,
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
          messageId: uuid,
          delta: block.text,
          blockIndex: textBlockIndex,
          parentToolUseId: parent_tool_use_id ?? undefined,
        };
        events.push(textDeltaEvent);
        textBlockIndex++;
      } else if (isToolUseBlock(block)) {
        // Emit tool_start event
        const isTaskTool = block.name === 'Task';

        // Extract agent-specific fields for Task tools
        const agentType = isTaskTool
          ? (block.input as { subagent_type?: string }).subagent_type
          : undefined;
        const agentDescription = isTaskTool
          ? (block.input as { description?: string }).description
          : undefined;
        const agentPrompt = isTaskTool
          ? (block.input as { prompt?: string }).prompt
          : undefined;

        const toolStartEvent: ToolStartEvent = {
          id: generateEventId(),
          eventType: 'tool_start',
          timestamp: Date.now(),
          sessionId: sessionId || '',
          messageId: uuid,
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
            messageId: uuid,
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
          messageId: uuid,
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
      messageId: uuid,
      stopReason: message.stop_reason,
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
      textContent = message.content
        .filter(isTextBlock)
        .map((block: TextBlock) => block.text)
        .join('\n');
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
    if (textContent) {
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
    }

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
  }
}
