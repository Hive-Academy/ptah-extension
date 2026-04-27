/**
 * Background agent streaming event types + FlatStreamEventUnion.
 *
 * Extracted from execution-node.types.ts (TASK_2025_291 Wave C2) — zero behavior change.
 */

import type {
  AgentStartEvent,
  CompactionCompleteEvent,
  CompactionStartEvent,
  FlatStreamEvent,
  MessageCompleteEvent,
  MessageDeltaEvent,
  MessageStartEvent,
  SignatureDeltaEvent,
  TextDeltaEvent,
  ThinkingDeltaEvent,
  ThinkingStartEvent,
  ToolDeltaEvent,
  ToolResultEvent,
  ToolStartEvent,
} from './stream';

/**
 * Background agent started event
 *
 * Emitted when a subagent is spawned with run_in_background: true, or when
 * a running foreground agent is moved to the background by the user.
 * The SDK returns an immediate placeholder tool_result and the subagent
 * continues executing independently of the main agent's turn.
 */
export interface BackgroundAgentStartedEvent extends FlatStreamEvent {
  readonly eventType: 'background_agent_started';
  /** Links to the parent Task tool_use that spawned this agent */
  readonly toolCallId: string;
  /** Agent subtype (e.g., 'Explore', 'software-architect') */
  readonly agentType: string;
  /** Short task description from Task tool args */
  readonly agentDescription?: string;
  /** Short agent identifier (e.g., "adcecb2") from SDK SubagentStart hook */
  readonly agentId?: string;
  /** Path to background agent output file (from SDK placeholder tool_result) */
  readonly outputFilePath?: string;
  /** Tab ID for routing events to the correct webview tab */
  readonly tabId?: string;
}

/**
 * Background agent progress event
 *
 * Emitted periodically while a background agent executes. Contains streaming
 * summary deltas from the agent's JSONL transcript file. These events flow
 * through a separate delivery path (WebviewManager.broadcastMessage) since
 * they outlive the main agent's streaming loop.
 */
export interface BackgroundAgentProgressEvent extends FlatStreamEvent {
  readonly eventType: 'background_agent_progress';
  /** Links to the parent Task tool_use */
  readonly toolCallId: string;
  /** Short agent identifier for lookup */
  readonly agentId: string;
  /** New summary text delta from the agent's transcript */
  readonly summaryDelta?: string;
  /** Current agent execution status */
  readonly status: 'running' | 'completed' | 'error';
  /** Tab ID for routing */
  readonly tabId?: string;
}

/**
 * Background agent completed event
 *
 * Emitted when a background subagent finishes execution (SubagentStop hook fires).
 * Contains the final result and usage statistics. Used to update the UI with
 * completion notification and allow viewing the agent's output.
 */
export interface BackgroundAgentCompletedEvent extends FlatStreamEvent {
  readonly eventType: 'background_agent_completed';
  /** Links to the parent Task tool_use */
  readonly toolCallId: string;
  /** Short agent identifier */
  readonly agentId: string;
  /** Agent type (e.g., 'software-architect', 'Explore') for display when start event was missed */
  readonly agentType?: string;
  /** Final result text from the agent */
  readonly result?: string;
  /** Total cost in USD */
  readonly cost?: number;
  /** Execution duration in milliseconds */
  readonly duration?: number;
  /** Tab ID for routing */
  readonly tabId?: string;
}

/**
 * Background agent stopped event
 *
 * Emitted when a background agent is explicitly stopped by the user
 * (via TaskStop tool or UI action). Distinguished from completed to
 * show appropriate UI state (stopped vs. finished).
 */
export interface BackgroundAgentStoppedEvent extends FlatStreamEvent {
  readonly eventType: 'background_agent_stopped';
  /** Links to the parent Task tool_use */
  readonly toolCallId: string;
  /** Short agent identifier */
  readonly agentId: string;
  /** Agent type for display when start event was missed */
  readonly agentType?: string;
  /** Tab ID for routing */
  readonly tabId?: string;
}

/**
 * Union type for all flat events - enables discriminated unions
 */
export type FlatStreamEventUnion =
  | MessageStartEvent
  | TextDeltaEvent
  | ThinkingStartEvent
  | ThinkingDeltaEvent
  | ToolStartEvent
  | ToolDeltaEvent
  | ToolResultEvent
  | AgentStartEvent
  | MessageCompleteEvent
  | MessageDeltaEvent
  | SignatureDeltaEvent
  | CompactionStartEvent
  | CompactionCompleteEvent
  | BackgroundAgentStartedEvent
  | BackgroundAgentProgressEvent
  | BackgroundAgentCompletedEvent
  | BackgroundAgentStoppedEvent;
