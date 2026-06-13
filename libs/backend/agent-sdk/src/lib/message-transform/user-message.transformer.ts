import {
  FlatStreamEventUnion,
  MessageStartEvent,
  TextDeltaEvent,
  ToolResultEvent,
  MessageCompleteEvent,
  BackgroundAgentStartedEvent,
  EventSource,
} from '@ptah-extension/shared';

import {
  SDKUserMessage,
  TextBlock,
  ToolResultBlock,
  isInterruptSentinelText,
} from '../types/sdk-types/claude-sdk.types';
import { generateEventId } from './message-transform-helpers';
import type {
  TransformerState,
  TransformerSessionId,
} from './transformer-state';
import type { TransformerHelpers } from './transformer-helpers';

export class UserMessageTransformer {
  transform(
    sdkMessage: SDKUserMessage,
    state: TransformerState,
    helpers: TransformerHelpers,
    sessionId?: TransformerSessionId,
  ): FlatStreamEventUnion[] {
    const { uuid, message, parent_tool_use_id } = sdkMessage;
    const events: FlatStreamEventUnion[] = [];
    const messageId = uuid || `user-${Date.now()}`;

    if (Array.isArray(message.content)) {
      for (const block of message.content) {
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

          if (state.hasBackgroundTaskToolUseId(toolResultBlock.tool_use_id)) {
            state.removeBackgroundTaskToolUseId(toolResultBlock.tool_use_id);

            const outputText =
              typeof toolResultBlock.content === 'string'
                ? toolResultBlock.content
                : JSON.stringify(toolResultBlock.content);
            const outputFileMatch = outputText?.match(
              /output_file:\s*(.+?)(?:\n|$)/i,
            );

            const bgEvent: BackgroundAgentStartedEvent = {
              id: generateEventId(),
              eventType: 'background_agent_started',
              timestamp: Date.now(),
              sessionId: sessionId || '',
              source: 'complete' as EventSource,
              messageId,
              toolCallId: toolResultBlock.tool_use_id,
              agentType: 'unknown',
              outputFilePath: outputFileMatch?.[1]?.trim(),
              parentToolUseId: parent_tool_use_id ?? undefined,
            };
            events.push(bgEvent);
          }
        }
      }

      if (events.length > 0) {
        return events;
      }
    }

    let textContent = '';
    if (typeof message.content === 'string') {
      textContent = message.content;
    } else if (Array.isArray(message.content)) {
      textContent = message.content
        .filter(
          (block): block is TextBlock =>
            typeof block === 'object' &&
            block !== null &&
            'type' in block &&
            block.type === 'text' &&
            'text' in block,
        )
        .map((block) => block.text)
        .join('\n');
    }

    if (!textContent || !textContent.trim()) {
      helpers.logger.debug(
        '[SdkMessageTransformer] Skipping empty user message',
        {
          uuid,
        },
      );
      return [];
    }

    if (isInterruptSentinelText(textContent)) {
      helpers.logger.debug(
        '[SdkMessageTransformer] Skipping SDK interrupt sentinel message',
        { uuid },
      );
      return [];
    }

    const parentToolUseId = parent_tool_use_id ?? undefined;

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
}
