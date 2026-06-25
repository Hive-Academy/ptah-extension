import {
  FlatStreamEventUnion,
  MessageStartEvent,
  TextDeltaEvent,
  ThinkingStartEvent,
  ThinkingDeltaEvent,
  ToolStartEvent,
  ToolDeltaEvent,
  MessageCompleteEvent,
  MessageDeltaEvent,
  SignatureDeltaEvent,
  EventSource,
  isAgentDispatchTool,
} from '@ptah-extension/shared';

import type { SDKPartialAssistantMessage } from '../types/sdk-types/claude-sdk.types';
import { generateEventId } from './message-transform-helpers';
import type {
  TransformerState,
  TransformerSessionId,
} from './transformer-state';
import type { TransformerHelpers } from './transformer-helpers';

export class StreamEventTransformer {
  transform(
    sdkMessage: SDKPartialAssistantMessage,
    state: TransformerState,
    helpers: TransformerHelpers,
    sessionId?: TransformerSessionId,
  ): FlatStreamEventUnion[] {
    const { event, parent_tool_use_id } = sdkMessage;

    if (!event || typeof event !== 'object') {
      return [];
    }

    const eventType = (event as { type?: string }).type;
    const blockIndex = (event as { index?: number }).index ?? 0;
    const parentToolUseId = parent_tool_use_id ?? undefined;
    const context = parentToolUseId || '';

    switch (eventType) {
      case 'message_start':
        return this.onMessageStart(
          event,
          sdkMessage,
          context,
          parentToolUseId,
          state,
          helpers,
          sessionId,
        );

      case 'message_delta':
        return this.onMessageDelta(event, context, state, helpers, sessionId);

      case 'message_stop':
        return this.onMessageStop(context, parentToolUseId, state, sessionId);

      case 'content_block_start':
        return this.onContentBlockStart(
          event,
          context,
          blockIndex,
          parentToolUseId,
          state,
          helpers,
          sessionId,
        );

      case 'content_block_delta':
        return this.onContentBlockDelta(
          event,
          context,
          blockIndex,
          parentToolUseId,
          state,
          helpers,
          sessionId,
        );

      case 'content_block_stop':
        return [];

      case 'ping':
        return [];

      case 'error': {
        const errorPayload = (
          event as { error?: { type?: string; message?: string } }
        ).error;
        helpers.logger.error(
          `[SdkMessageTransformer] Stream error: ${errorPayload?.type} - ${errorPayload?.message}`,
        );
        return [];
      }

      default:
        helpers.logger.debug(
          `[SdkMessageTransformer] Unknown event type: ${eventType}`,
        );
        return [];
    }
  }

  private onMessageStart(
    event: unknown,
    sdkMessage: SDKPartialAssistantMessage,
    context: string,
    parentToolUseId: string | undefined,
    state: TransformerState,
    helpers: TransformerHelpers,
    sessionId?: TransformerSessionId,
  ): FlatStreamEventUnion[] {
    const message = (
      event as {
        message?: {
          id?: string;
          model?: string;
          usage?: {
            input_tokens?: number;
            output_tokens?: number;
            cache_read_input_tokens?: number;
            cache_creation_input_tokens?: number;
          };
        };
      }
    ).message;

    const messageId =
      message?.id || sdkMessage.uuid || `stream-msg-${Date.now()}`;

    if (sessionId && message?.usage) {
      helpers.usageTracker.recordSessionUsage(sessionId, {
        input: message.usage.input_tokens,
        output: message.usage.output_tokens,
        cacheRead: message.usage.cache_read_input_tokens,
        cacheCreation: message.usage.cache_creation_input_tokens,
      });
    }

    state.setMessageId(context, messageId);

    if (message?.model) {
      state.setCurrentModel(context, message.model);
    }

    state.clearToolCallIdsForContext(context);

    if (state.activeSkillToolUseIdsCount() > 0) {
      helpers.logger.debug(
        '[SdkMessageTransformer] Clearing activeSkillToolUseIds on assistant message_start',
        { clearedIds: state.snapshotActiveSkillToolUseIds() },
      );
      state.clearActiveSkillToolUseIds();
    }

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

  private onMessageDelta(
    event: unknown,
    context: string,
    state: TransformerState,
    helpers: TransformerHelpers,
    sessionId?: TransformerSessionId,
  ): FlatStreamEventUnion[] {
    const usage = (
      event as {
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        };
      }
    ).usage;

    if (sessionId && usage) {
      helpers.usageTracker.recordSessionUsage(sessionId, {
        input: usage.input_tokens,
        output: usage.output_tokens,
        cacheRead: usage.cache_read_input_tokens,
        cacheCreation: usage.cache_creation_input_tokens,
      });
    }

    const currentMessageId = state.getMessageId(context);
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

  private onMessageStop(
    context: string,
    parentToolUseId: string | undefined,
    state: TransformerState,
    sessionId?: TransformerSessionId,
  ): FlatStreamEventUnion[] {
    const currentMessageId = state.getMessageId(context);
    const events: FlatStreamEventUnion[] = [];

    if (currentMessageId) {
      const contextModel = state.getCurrentModel(context);
      const messageCompleteEvent: MessageCompleteEvent = {
        id: generateEventId(),
        eventType: 'message_complete',
        timestamp: Date.now(),
        sessionId: sessionId || '',
        source: 'stream' as EventSource,
        messageId: currentMessageId,
        parentToolUseId,
        ...(contextModel && { model: contextModel }),
      };
      events.push(messageCompleteEvent);
    }

    state.clearMessageId(context);
    state.clearCurrentModel(context);
    state.clearToolCallIdsForContext(context);

    return events;
  }

  private onContentBlockStart(
    event: unknown,
    context: string,
    blockIndex: number,
    parentToolUseId: string | undefined,
    state: TransformerState,
    helpers: TransformerHelpers,
    sessionId?: TransformerSessionId,
  ): FlatStreamEventUnion[] {
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
    const currentMessageId = state.getMessageId(context);

    if (!currentMessageId) {
      helpers.logger.warn(
        `[SdkMessageTransformer] content_block_start but no active message for context: ${
          context || 'root'
        }`,
      );
      return [];
    }

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

    if (blockType === 'tool_use' && contentBlock?.id && contentBlock?.name) {
      const isTaskTool = isAgentDispatchTool(contentBlock.name);

      if (contentBlock.name === 'Skill') {
        state.addActiveSkillToolUseId(contentBlock.id);
        helpers.logger.debug(
          '[SdkMessageTransformer] Tracking Skill tool_use (streaming) for content filtering',
          { toolCallId: contentBlock.id },
        );
      }

      state.setToolCallId(context, blockIndex, contentBlock.id);

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

      return [toolStartEvent];
    }

    return [];
  }

  private onContentBlockDelta(
    event: unknown,
    context: string,
    blockIndex: number,
    parentToolUseId: string | undefined,
    state: TransformerState,
    helpers: TransformerHelpers,
    sessionId?: TransformerSessionId,
  ): FlatStreamEventUnion[] {
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

    const currentMessageId = state.getMessageId(context);

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

        return [textDeltaEvent];
      }

      case 'input_json_delta': {
        if (delta.partial_json === undefined) return [];

        const realToolCallId =
          state.getToolCallId(context, blockIndex) ||
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
        helpers.logger.debug(
          `[SdkMessageTransformer] Unknown delta type: ${delta.type}`,
        );
        return [];
    }
  }
}
