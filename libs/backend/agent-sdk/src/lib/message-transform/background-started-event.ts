/**
 * Builder for the `background_agent_started` event emitted when the SDK returns
 * the immediate placeholder tool_result for a `run_in_background: true` Task.
 *
 * Both tool_result sites (assistant and user messages) go through here. Neither
 * used to: each hardcoded `agentType: 'unknown'` and omitted `agentId`, so every
 * background chip in the tray rendered as "unknown" with no description and no
 * transcript action — the frontend gates that action on `hasRealAgentId`.
 *
 * Identity is assembled from two sources because neither is complete on its own:
 *
 *  - The `SubagentRegistryService` record holds the SDK-issued `agentId` and the
 *    `teammateName`, but only once the `SubagentStart` hook has fired — which
 *    can be after the placeholder tool_result.
 *  - The `TransformerState` entry holds `subagent_type` and `description`, read
 *    off the spawning tool_use block, which is the only message carrying them.
 *
 * `'unknown'` remains the last resort, not the default.
 */

import type {
  BackgroundAgentStartedEvent,
  EventSource,
} from '@ptah-extension/shared';
import { generateEventId } from './message-transform-helpers';
import type {
  TransformerState,
  TransformerSessionId,
} from './transformer-state';
import type { TransformerHelpers } from './transformer-helpers';

export interface BackgroundStartedEventParams {
  readonly toolCallId: string;
  /** Raw tool_result content — scanned for the SDK's `output_file:` line. */
  readonly content: unknown;
  readonly messageId: string;
  readonly sessionId?: TransformerSessionId;
  readonly parentToolUseId?: string;
  readonly state: TransformerState;
  readonly helpers: TransformerHelpers;
}

export function buildBackgroundAgentStartedEvent(
  params: BackgroundStartedEventParams,
): BackgroundAgentStartedEvent {
  const { toolCallId, content, messageId, sessionId, parentToolUseId } = params;
  const record = params.helpers.subagentRegistry.get(toolCallId);
  const spawn = params.state.getBackgroundTaskInfo(toolCallId);

  const outputText =
    typeof content === 'string' ? content : JSON.stringify(content);
  const outputFileMatch = outputText?.match(/output_file:\s*(.+?)(?:\n|$)/i);

  return {
    id: generateEventId(),
    eventType: 'background_agent_started',
    timestamp: Date.now(),
    sessionId,
    source: 'complete' as EventSource,
    messageId,
    toolCallId,
    agentType: record?.agentType || spawn?.agentType || 'unknown',
    agentDescription: spawn?.agentDescription,
    agentId: record?.agentId,
    teammateName: record?.teammateName,
    outputFilePath: outputFileMatch?.[1]?.trim(),
    parentToolUseId,
  };
}
