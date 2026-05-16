/**
 * AgentProcessManager helpers — stateless pure utilities.
 *
 * Extracted from `agent-process-manager.service.ts` as .
 *
 * These helpers have no instance dependencies and no I/O; they are safe to call
 * from anywhere. The manager retains all stateful logic (child-process tracking,
 * event emission, timers, DI'd services).
 *
 * Library-internal module — not exported from the package barrel.
 */

import type {
  CliOutputSegment,
  FlatStreamEventUnion,
} from '@ptah-extension/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum output buffer size per agent (1MB) */
export const MAX_BUFFER_SIZE = 1024 * 1024;

/** Default timeout: 1 hour */
export const DEFAULT_TIMEOUT = 60 * 60 * 1000;

/** Maximum timeout: 1 hour */
export const MAX_TIMEOUT = 60 * 60 * 1000;

/** Grace period for SIGTERM before SIGKILL: 5 seconds */
export const KILL_GRACE_PERIOD = 5000;

/** TTL for completed agents before cleanup from map: 30 minutes */
export const COMPLETED_AGENT_TTL = 30 * 60 * 1000;

/** Throttle interval for output delta events: 200ms */
export const OUTPUT_FLUSH_INTERVAL = 200;

/** Graceful delay (ms) after exit before emitting agent:exited, giving the UI time to process last output chunks */
export const GRACEFUL_EXIT_DELAY_MS = 3000;

/** Maximum number of accumulated segments kept per agent for persistence */
export const MAX_ACCUMULATED_SEGMENTS = 500;

/**
 * Maximum number of stream events kept per agent for persistence.
 * Higher than segments because stream events are finer-grained —
 * a single tool call may produce dozens of delta events.
 * Matches the frontend MAX_STREAM_EVENTS cap in agent-monitor.store.ts.
 */
export const MAX_ACCUMULATED_STREAM_EVENTS = 2000;

/** Maximum stdout size (bytes) returned for persistence */
export const MAX_STDOUT_PERSISTENCE_SIZE = 100 * 1024; // 100 KB

/** Landmark event types that establish tree structure and must be preserved during capping */
export const LANDMARK_EVENT_TYPES = new Set<string>([
  'message_start',
  'tool_start',
  'agent_start',
  'thinking_start',
  'message_complete',
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Buffered output deltas per agent, flushed every OUTPUT_FLUSH_INTERVAL */
export interface PendingDelta {
  stdout: string;
  stderr: string;
  segments: CliOutputSegment[];
  streamEvents: FlatStreamEventUnion[];
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function createEmptyPendingDelta(): PendingDelta {
  return { stdout: '', stderr: '', segments: [], streamEvents: [] };
}

/**
 * Return the last `n` lines of a string.
 * Pure utility — no dependencies.
 */
export function tailLines(str: string, n: number): string {
  const lines = str.split('\n');
  return lines.slice(-n).join('\n');
}

/**
 * Cap stream events buffer by dropping oldest delta events while preserving
 * landmark events that establish the execution tree structure.
 * Landmarks (message_start, tool_start, etc.) are always kept.
 * The remaining budget is filled with the most recent non-landmark (delta) events.
 * Events are returned in their original order.
 *
 * Mirrors the frontend capStreamEvents() in agent-monitor.store.ts.
 */
export function capStreamEvents(
  events: FlatStreamEventUnion[],
  max: number,
): FlatStreamEventUnion[] {
  if (events.length <= max) return events;

  const landmarks: Array<{ event: FlatStreamEventUnion; index: number }> = [];
  const deltas: Array<{ event: FlatStreamEventUnion; index: number }> = [];
  for (let i = 0; i < events.length; i++) {
    if (LANDMARK_EVENT_TYPES.has(events[i].eventType)) {
      landmarks.push({ event: events[i], index: i });
    } else {
      deltas.push({ event: events[i], index: i });
    }
  }

  const deltasBudget = max - landmarks.length;
  if (deltasBudget <= 0) {
    return landmarks.slice(-max).map((l) => l.event);
  }

  const keptDeltas = deltas.slice(-deltasBudget);
  const merged = [...landmarks, ...keptDeltas].sort(
    (a, b) => a.index - b.index,
  );
  return merged.map((m) => m.event);
}

/**
 * Merge consecutive segments of the same streamable type into a single segment.
 * SDK adapters (e.g. Copilot) emit per-token text/thinking segments which causes
 * one-word-per-line rendering in the agent card. This collapses adjacent
 * segments of the same type while preserving segment-type boundaries.
 *
 * Mergeable types: 'text', 'thinking' (both are content-only streaming types).
 */
export function mergeConsecutiveTextSegments(
  segments: CliOutputSegment[],
): CliOutputSegment[] {
  if (segments.length <= 1) return segments;

  const result: CliOutputSegment[] = [];
  let buffer = '';
  let bufferType: 'text' | 'thinking' | null = null;

  for (const seg of segments) {
    if (seg.type === 'text' || seg.type === 'thinking') {
      if (bufferType === seg.type) {
        // Same type — accumulate
        buffer += seg.content;
      } else {
        // Different type — flush previous buffer
        if (buffer && bufferType) {
          result.push({ type: bufferType, content: buffer });
        }
        buffer = seg.content;
        bufferType = seg.type;
      }
    } else {
      // Non-mergeable segment — flush buffer and push
      if (buffer && bufferType) {
        result.push({ type: bufferType, content: buffer });
        buffer = '';
        bufferType = null;
      }
      result.push(seg);
    }
  }

  if (buffer && bufferType) {
    result.push({ type: bufferType, content: buffer });
  }

  return result;
}
