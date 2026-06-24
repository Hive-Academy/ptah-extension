import {
  FlatStreamEventUnion,
  MessageStartEvent,
  TextDeltaEvent,
  ThinkingDeltaEvent,
  ToolStartEvent,
  ToolResultEvent,
  AgentStartEvent,
  MessageCompleteEvent,
  BackgroundAgentStartedEvent,
  calculateMessageCost,
  EventSource,
  isAgentDispatchTool,
} from '@ptah-extension/shared';

import {
  SDKAssistantMessage,
  isTextBlock,
  isThinkingBlock,
  isToolUseBlock,
  isToolResultBlock,
  isInterruptSentinelText,
} from '../types/sdk-types/claude-sdk.types';
import { generateEventId } from './message-transform-helpers';
import type {
  TransformerState,
  TransformerSessionId,
} from './transformer-state';
import type { TransformerHelpers } from './transformer-helpers';

export class AssistantMessageTransformer {
  transform(
    sdkMessage: SDKAssistantMessage,
    state: TransformerState,
    helpers: TransformerHelpers,
    sessionId?: TransformerSessionId,
  ): FlatStreamEventUnion[] {
    const { uuid, message, parent_tool_use_id } = sdkMessage;
    const events: FlatStreamEventUnion[] = [];

    const content = (message.content || []) as unknown as Array<{
      type: string;
      [key: string]: unknown;
    }>;

    const messageId = message?.id || uuid;

    if (
      content.length > 0 &&
      content.every(
        (block) => isTextBlock(block) && isInterruptSentinelText(block.text),
      )
    ) {
      helpers.logger.debug(
        '[SdkMessageTransformer] Skipping SDK interrupt sentinel message',
        { messageId },
      );
      return [];
    }

    if (state.activeSkillToolUseIdsCount() > 0) {
      helpers.logger.debug(
        '[SdkMessageTransformer] Clearing activeSkillToolUseIds on complete assistant message',
        { clearedIds: state.snapshotActiveSkillToolUseIds() },
      );
      state.clearActiveSkillToolUseIds();
    }

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

    for (let contentIndex = 0; contentIndex < content.length; contentIndex++) {
      const block = content[contentIndex];
      if (isThinkingBlock(block)) {
        if (block.thinking) {
          const thinkingDeltaEvent: ThinkingDeltaEvent = {
            id: generateEventId(),
            eventType: 'thinking_delta',
            timestamp: Date.now(),
            sessionId: sessionId || '',
            source: 'complete' as EventSource,
            messageId,
            delta: block.thinking,
            blockIndex: contentIndex,
            parentToolUseId: parent_tool_use_id ?? undefined,
          };
          events.push(thinkingDeltaEvent);
        }
      } else if (isTextBlock(block)) {
        const textDeltaEvent: TextDeltaEvent = {
          id: generateEventId(),
          eventType: 'text_delta',
          timestamp: Date.now(),
          sessionId: sessionId || '',
          source: 'complete' as EventSource,
          messageId,
          delta: block.text,
          blockIndex: contentIndex,
          parentToolUseId: parent_tool_use_id ?? undefined,
        };
        events.push(textDeltaEvent);
      } else if (isToolUseBlock(block)) {
        const isTaskTool = isAgentDispatchTool(block.name);

        let agentType: string | undefined;
        let agentDescription: string | undefined;
        let agentPrompt: string | undefined;

        if (isTaskTool && block.input) {
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

          const isBackground =
            'run_in_background' in block.input &&
            block.input['run_in_background'] === true;
          if (isBackground) {
            state.addBackgroundTaskToolUseId(block.id);
            helpers.subagentRegistry.markPendingBackground(block.id);
            helpers.logger.debug(
              '[SdkMessageTransformer] Detected background Task tool_use',
              {
                toolCallId: block.id,
                agentType,
                agentDescription,
              },
            );
          }
        }

        if (block.name === 'Skill') {
          state.addActiveSkillToolUseId(block.id);
          helpers.logger.debug(
            '[SdkMessageTransformer] Tracking Skill tool_use for content filtering',
            { toolCallId: block.id },
          );
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

        if (isTaskTool && !state.isTaskStartedEmitted(block.id)) {
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
            parentToolUseId: block.id,
          };
          events.push(agentStartEvent);
        }

        events.push(toolStartEvent);
      } else if (isToolResultBlock(block)) {
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

        if (state.hasBackgroundTaskToolUseId(block.tool_use_id)) {
          state.removeBackgroundTaskToolUseId(block.tool_use_id);

          const outputText =
            typeof block.content === 'string'
              ? block.content
              : JSON.stringify(block.content);
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
            toolCallId: block.tool_use_id,
            agentType: 'unknown',
            outputFilePath: outputFileMatch?.[1]?.trim(),
            parentToolUseId: parent_tool_use_id ?? undefined,
          };
          events.push(bgEvent);

          helpers.logger.debug(
            '[SdkMessageTransformer] Emitted background_agent_started event',
            {
              toolCallId: block.tool_use_id,
              outputFilePath: bgEvent.outputFilePath,
            },
          );
        }
      }
    }

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
      ? (calculateMessageCost(
          helpers.modelResolver.resolveForPricing(message.model || ''),
          tokenUsage,
        ) ?? undefined)
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
}
