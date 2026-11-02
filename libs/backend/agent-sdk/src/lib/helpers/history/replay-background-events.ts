/**
 * Historical `background_agent_*` events for session replay (TASK_2026_861
 * B2).
 *
 * Reload replays a background Task tool_use only as `tool_start` /
 * `agent_start` / `tool_result`, so the tray chip (`BackgroundAgentStore`)
 * was never rebuilt from history and a background task looked gone after a
 * reload. The live path announces the chip from the placeholder tool_result
 * via `buildBackgroundAgentStartedEvent`
 * (../../message-transform/background-started-event). This module is the
 * history path calls that same builder with the facts retained in JSONL,
 * then supplies historical identity and timing.
 *
 * Completion requires a correlated task notification or a final Task result.
 * An immediate launch placeholder leaves the chip running.
 */

import type {
  AgentCompletedEvent,
  BackgroundAgentCompletedEvent,
  BackgroundAgentStartedEvent,
  BackgroundAgentStoppedEvent,
} from '@ptah-extension/shared';
import { buildBackgroundAgentStartedEvent } from '../../message-transform/background-started-event';
import { readTaskResultAgentIds } from '../../message-transform/task-result-agent-binding';
import type {
  TransformerState,
  TransformerSessionId,
} from '../../message-transform/transformer-state';
import type { TransformerHelpers } from '../../message-transform/transformer-helpers';

/** What replay knows about one `run_in_background: true` Task tool_use. */
export interface ReplayBackgroundSpawn {
  /** The spawning Task tool_use id — the chip's exact identity. */
  readonly toolCallId: string;
  /** `subagent_type` from the tool_use input; may be empty in old transcripts. */
  readonly agentType: string;
  /** `description` from the tool_use input. */
  readonly agentDescription?: string;
  /** `name` from the tool_use input — the same source the live registry record
   * seeds the teammate name from. */
  readonly teammateName?: string;
  /** Original placeholder content, parsed by the live event builder. */
  readonly placeholderContent?: string;
}

/** Read `field` off a tool_use input when it is a string. */
function readInputString(
  input: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = input[field];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Collect the background-spawn facts of one Task tool_use, or null when the
 * input did not set `run_in_background: true` — foreground tasks replay
 * without any background event.
 */
export function readReplayBackgroundSpawn(
  toolCallId: string,
  input: Record<string, unknown>,
  placeholderContent: string | undefined,
): ReplayBackgroundSpawn | null {
  if (input['run_in_background'] !== true) {
    return null;
  }
  return {
    toolCallId,
    agentType: readInputString(input, 'subagent_type') ?? '',
    agentDescription: readInputString(input, 'description'),
    teammateName: readInputString(input, 'name')?.trim(),
    placeholderContent,
  };
}

/** A Task result with final output, rather than the SDK's launch placeholder. */
export function isFinalBackgroundToolResult(
  content: string,
  started: BackgroundAgentStartedEvent,
): boolean {
  const text = content.trim();
  return text.length > 0 &&
    readTaskResultAgentIds(text).length === 0 &&
    !started.outputFilePath &&
    !text.toLowerCase().includes('launched');
}

/** The historical `background_agent_started` for one replayed background Task. */
export function buildHistoricalBackgroundStartedEvent(params: {
  sessionId: string;
  messageId: string;
  timestamp: number;
  spawn: ReplayBackgroundSpawn;
}): BackgroundAgentStartedEvent {
  const { spawn } = params;
  // The live builder only reads these two members of each interface. Replay
  // supplies them from JSONL, without constructing a live transformer stack.
  const state = {
    getBackgroundTaskInfo: () => ({
      agentType: spawn.agentType,
      agentDescription: spawn.agentDescription,
    }),
  } as Partial<TransformerState> as TransformerState;
  const helpers = {
    subagentRegistry: {
      get: () => null,
    } as Partial<TransformerHelpers['subagentRegistry']> as TransformerHelpers['subagentRegistry'],
  } as Partial<TransformerHelpers> as TransformerHelpers;
  const liveEvent = buildBackgroundAgentStartedEvent({
    toolCallId: spawn.toolCallId,
    content: spawn.placeholderContent ?? '',
    messageId: params.messageId,
    sessionId: params.sessionId as TransformerSessionId,
    state,
    helpers,
  });
  return {
    ...liveEvent,
    id: `history-bg-started-${spawn.toolCallId}`,
    timestamp: params.timestamp,
    source: 'history',
    teammateName: spawn.teammateName,
  };
}

/**
 * The historical background terminal for a background Task whose correlated
 * completion the replay found. A `stopped` notification produces
 * `background_agent_stopped`; everything else produces
 * `background_agent_completed` (with the `failed` status kept).
 */
export function buildHistoricalBackgroundTerminalEvent(params: {
  sessionId: string;
  messageId: string;
  timestamp: number;
  started: BackgroundAgentStartedEvent;
  status: AgentCompletedEvent['status'];
  summary: string;
}): BackgroundAgentCompletedEvent | BackgroundAgentStoppedEvent {
  const { started } = params;
  // Required on both terminal types; '' resolves to the toolCallId identity
  // in the store's `resolveKey`, which is the fallback the chip was filed
  // under when the placeholder carried no agent id.
  const agentId = started.agentId ?? '';
  if (params.status === 'stopped') {
    return {
      id: `history-bg-terminal-${started.toolCallId}`,
      eventType: 'background_agent_stopped',
      timestamp: params.timestamp,
      sessionId: params.sessionId,
      source: 'history',
      messageId: params.messageId,
      toolCallId: started.toolCallId,
      agentId,
      agentType: started.agentType,
    };
  }
  return {
    id: `history-bg-terminal-${started.toolCallId}`,
    eventType: 'background_agent_completed',
    timestamp: params.timestamp,
    sessionId: params.sessionId,
    source: 'history',
    messageId: params.messageId,
    toolCallId: started.toolCallId,
    agentId,
    agentType: started.agentType,
    status: params.status === 'failed' ? 'failed' : 'completed',
    result: params.summary || undefined,
  };
}
