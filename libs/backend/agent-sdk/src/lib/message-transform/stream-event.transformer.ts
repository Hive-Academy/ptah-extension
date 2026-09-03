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
import { toTurnStateEvent } from '../helpers/session-turn-state.registry';
import type {
  TransformerState,
  TransformerSessionId,
} from './transformer-state';
import type { TransformerHelpers } from './transformer-helpers';

/** The `message` payload of a `message_start` stream event. */
interface StreamStartMessage {
  id?: string;
  model?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

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
          sdkMessage,
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
    synthesized = false,
  ): FlatStreamEventUnion[] {
    const message = (event as { message?: StreamStartMessage }).message;

    if (sessionId && message?.usage) {
      helpers.usageTracker.recordSessionUsage(sessionId, {
        input: message.usage.input_tokens,
        output: message.usage.output_tokens,
        cacheRead: message.usage.cache_read_input_tokens,
        cacheCreation: message.usage.cache_creation_input_tokens,
      });
    }

    const activeMessageId = state.getMessageId(context);
    if (
      !synthesized &&
      activeMessageId &&
      state.isMessageSynthesized(context)
    ) {
      return this.reconcileSynthesizedStart(
        message,
        activeMessageId,
        context,
        parentToolUseId,
        state,
        helpers,
        sessionId,
      );
    }

    const messageId =
      message?.id || sdkMessage.uuid || `stream-msg-${Date.now()}`;

    state.setMessageId(context, messageId);

    if (synthesized) {
      state.markMessageSynthesized(context);
    }

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
      sessionId,
      source: 'stream' as EventSource,
      messageId,
      role: 'assistant',
      parentToolUseId,
    };

    // Root assistant turn start → 'generating', once per turn. Subagent
    // message_starts carry a parentToolUseId and never flip the phase.
    if (!parentToolUseId && sessionId) {
      const turn = helpers.turnState.markGenerating(sessionId);
      if (turn) {
        return [toTurnStateEvent(sessionId, turn), messageStartEvent];
      }
    }

    return [messageStartEvent];
  }

  /**
   * A real `message_start` for a context whose active message was synthesized
   * (D-5c). It describes the message that is ALREADY open, so it must not open
   * a second one.
   *
   * The synthesized id is kept rather than migrated to `message.id`. The id is
   * only a correlation key, and it was already published on the emitted
   * `message_start`, `tool_start` and `thinking_start`. Migrating it would mean
   * re-keying every consumer-side correlation as well, for no gain. So: no
   * second `message_start`, no `clearToolCallIdsForContext` (the early
   * `tool_use` mapping must survive so its `input_json_delta` still resolves
   * the real tool-call id), and no `clearActiveSkillToolUseIds` (a `Skill`
   * block in that same message is still active). Only the model is folded in,
   * because the synthesized start had none.
   */
  private reconcileSynthesizedStart(
    message: StreamStartMessage | undefined,
    activeMessageId: string,
    context: string,
    parentToolUseId: string | undefined,
    state: TransformerState,
    helpers: TransformerHelpers,
    sessionId?: TransformerSessionId,
  ): FlatStreamEventUnion[] {
    helpers.logger.debug(
      '[SdkMessageTransformer] real message_start for a synthesized message; ' +
        'reconciling into the open message instead of starting a second one',
      {
        context: context || 'root',
        messageId: activeMessageId,
        realMessageId: message?.id,
      },
    );

    if (message?.model) {
      state.setCurrentModel(context, message.model);
    }

    state.clearMessageSynthesized(context);

    // The synthesized start already flipped the root turn phase under the same
    // condition, and `markGenerating` is once per turn. This call therefore
    // returns null in the normal case; it only fires when the synthesis ran
    // without a session id.
    if (!parentToolUseId && sessionId) {
      const turn = helpers.turnState.markGenerating(sessionId);
      if (turn) {
        return [toTurnStateEvent(sessionId, turn)];
      }
    }

    return [];
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
      sessionId,
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
        sessionId,
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
    sdkMessage: SDKPartialAssistantMessage,
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
    let currentMessageId = state.getMessageId(context);
    const prelude: FlatStreamEventUnion[] = [];

    if (!currentMessageId) {
      helpers.logger.debug(
        '[SdkMessageTransformer] content_block_start arrived before message_start; ' +
          'synthesizing one so the block is not dropped',
        { context: context || 'root', blockType },
      );
      prelude.push(
        ...this.onMessageStart(
          { type: 'message_start', message: {} },
          sdkMessage,
          context,
          parentToolUseId,
          state,
          helpers,
          sessionId,
          true,
        ),
      );
      currentMessageId = state.getMessageId(context);
    }

    if (!currentMessageId) {
      return prelude;
    }

    if (blockType === 'thinking') {
      const thinkingStartEvent: ThinkingStartEvent = {
        id: generateEventId(),
        eventType: 'thinking_start',
        timestamp: Date.now(),
        sessionId,
        source: 'stream' as EventSource,
        messageId: currentMessageId,
        blockIndex,
        parentToolUseId,
      };

      return [...prelude, thinkingStartEvent];
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
        sessionId,
        source: 'stream' as EventSource,
        messageId: currentMessageId,
        toolCallId: contentBlock.id,
        toolName: contentBlock.name,
        isTaskTool,
        parentToolUseId,
      };

      return [...prelude, toolStartEvent];
    }

    return [...prelude];
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
          sessionId,
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
          sessionId,
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
          sessionId,
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
          sessionId,
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
