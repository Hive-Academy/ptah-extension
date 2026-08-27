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

/** Maximum output buffer size per agent (1MB) — the high-water mark that arms a trim. */
export const MAX_BUFFER_SIZE = 1024 * 1024;

/**
 * Low-water mark a trim cuts back to (75% of {@link MAX_BUFFER_SIZE}).
 *
 * This is the whole point of the hysteresis: a trim that only removes the
 * OVERFLOW leaves the buffer sitting exactly on the high-water mark, so the
 * very next chunk trims again and copies ~1 MB. On the ptah-cli path a "chunk"
 * is one token, so a saturated agent copied a megabyte per token and pinned the
 * event loop (TASK_2026_323 B1). Cutting back to 75% buys 256 KB of headroom
 * before the next trim, which makes the copy amortized O(1) per byte appended
 * (~3 bytes copied per byte in the steady state) instead of O(buffer) per chunk.
 */
export const BUFFER_LOW_WATER_SIZE = Math.floor(MAX_BUFFER_SIZE * 0.75);

/** Default timeout: 1 hour */
export const DEFAULT_TIMEOUT = 60 * 60 * 1000;

/** Maximum timeout: 1 hour */
export const MAX_TIMEOUT = 60 * 60 * 1000;

/** Grace period for SIGTERM before SIGKILL: 5 seconds */
export const KILL_GRACE_PERIOD = 5000;

/** TTL for completed agents before cleanup from map: 30 minutes */
export const COMPLETED_AGENT_TTL = 30 * 60 * 1000;

/**
 * Idle window after a turn ends before a continuation-capable agent's SDK
 * SUBPROCESS is released: 5 minutes.
 *
 * A continuation-capable handle deliberately outlives its first turn. On the
 * ptah-cli path `query()` is fed a prompt mailbox whose async generator only
 * returns once the mailbox is closed, and the mailbox is closed only on abort —
 * so `handle.continue()` has something to push into. The cost is that a
 * `claude.exe` sitting at 90-180 MB stays resident from the moment its task
 * finished until the host quits. Measured 2026-08-26: 16 of them, three hours
 * idle, machine at 99% memory (TASK_2026_323 B11).
 *
 * Five minutes is the trade: long enough that the follow-up box a user is
 * actually typing into still gets the cheap in-process continuation, short
 * enough that a fire-and-forget agent does not hold a process for the rest of
 * the session. Past it the record and its buffered output REMAIN (so
 * `ptah_agent_read` keeps answering until {@link COMPLETED_AGENT_TTL}); only
 * the operating-system process goes, and a follow-up resumes the conversation
 * by `cliSessionId` instead — which is why every ptah-cli spawn sets
 * `persistSession: true`.
 *
 * Overridable per user as `ptah.agentOrchestration.sdkIdleReleaseMs`, the same
 * settings surface as `maxConcurrentAgents`.
 */
export const SDK_IDLE_RELEASE_MS = 5 * 60 * 1000;

/**
 * Floor for the user-configured idle window, in milliseconds.
 *
 * `ptah.agentOrchestration.sdkIdleReleaseMs` declares `"minimum": 10000` in the
 * extension manifest, but that minimum is only enforced by the VS Code settings
 * UI. Every other way the value reaches us — a hand-edited `settings.json`,
 * `~/.ptah/settings.json`, the Electron and CLI settings stores — delivers it
 * unchecked, and a 50 ms window releases a continuation-capable subprocess
 * before the user has finished reading the answer they might follow up on.
 * The floor makes the declared minimum true wherever the value comes from.
 */
export const MIN_SDK_IDLE_RELEASE_MS = 10_000;

/**
 * Bounded wait after aborting an SDK handle that exposes no child PID.
 *
 * See `AgentProcessManager.killProcess` — for those handles the abort IS the
 * kill, and this is only how long we wait for the run to unwind before moving
 * on. The timer behind it must be unref'd: it runs on host-shutdown paths, and
 * a ref'd half-second is a half-second the process cannot exit.
 */
export const SDK_ABORT_SETTLE_MS = 500;

/**
 * Upper bound on how long `disposeAll()` waits for every release to settle.
 *
 * Host shutdown is not a place to block indefinitely: Electron's `will-quit` is
 * synchronous and VS Code gives `deactivate()` a finite budget. A release that
 * has not settled by then has already issued its abort and its tree-kill, so
 * the remaining wait buys nothing the OS will not finish on its own.
 */
export const DISPOSE_RELEASE_TIMEOUT_MS = 5000;

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
 *
 * This cap bounds what is PERSISTED. The frontend `AgentMonitorStore` keeps its
 * own, smaller cap (2 000, TASK_2026_323 R6) on what a live card renders; the
 * two are independent and neither catches the other's overflow, so do not
 * raise this number on the assumption that a downstream mirror will.
 */
export const MAX_ACCUMULATED_STREAM_EVENTS = 50000;

/** Recent events always retained regardless of type, so streaming text/thinking
 * near the tail (e.g. an agent's final verdict) survives capping. */
export const STREAM_EVENTS_TAIL_RESERVE = 600;

/**
 * Overshoot tolerated above {@link MAX_ACCUMULATED_STREAM_EVENTS} before a
 * re-cap runs — the array equivalent of {@link BUFFER_LOW_WATER_SIZE}.
 *
 * `capStreamEvents` rebuilds the whole 50 000-entry array. Re-capping the
 * instant the array exceeds the cap means an agent past 50 000 events pays that
 * rebuild on EVERY subsequent event, which is B1's defect shape in array form.
 * Letting the array run 10% over first amortizes each rebuild across 5 000
 * events, at the cost of holding at most 55 000 rather than 50 000.
 */
export const STREAM_EVENTS_CAP_SLACK = 5000;

/** Maximum stdout size (bytes) returned for persistence */
export const MAX_STDOUT_PERSISTENCE_SIZE = 100 * 1024; // 100 KB

/** Landmark event types that establish tree structure and must be preserved during capping */
export const LANDMARK_EVENT_TYPES = new Set<string>([
  'message_start',
  'tool_start',
  'tool_result',
  'agent_start',
  'thinking_start',
  'message_complete',
]);

/** Buffered output deltas per agent, flushed every OUTPUT_FLUSH_INTERVAL */
export interface PendingDelta {
  stdout: string;
  stderr: string;
  segments: CliOutputSegment[];
  streamEvents: FlatStreamEventUnion[];
}

export function createEmptyPendingDelta(): PendingDelta {
  return { stdout: '', stderr: '', segments: [], streamEvents: [] };
}

/**
 * Count `\n` occurrences in `str[start, end)` without allocating.
 *
 * `(str.match(/\n/g) || []).length` allocates a regex match array — one array
 * plus one single-character string per newline — on EVERY output chunk. On the
 * ptah-cli path that is once per token. `indexOf` walks the same bytes and
 * allocates nothing.
 */
export function countNewlines(
  str: string,
  start = 0,
  end: number = str.length,
): number {
  let count = 0;
  let index = str.indexOf('\n', start);
  while (index !== -1 && index < end) {
    count++;
    index = str.indexOf('\n', index + 1);
  }
  return count;
}

/** Outcome of {@link trimBufferToLowWater}. */
export interface BufferTrimResult {
  /** The buffer after trimming (the same reference when no trim was needed). */
  buffer: string;
  /** Newlines removed with the dropped prefix — subtract this from the line counter. */
  linesDropped: number;
  /** True when bytes were actually dropped. */
  trimmed: boolean;
}

/**
 * Trim an output buffer back to {@link BUFFER_LOW_WATER_SIZE} once it passes
 * {@link MAX_BUFFER_SIZE}, cutting on a line boundary.
 *
 * The cut point is `length - BUFFER_LOW_WATER_SIZE`, advanced forward to the
 * next `\n` so the surviving buffer starts at a whole line. A buffer with no
 * newline after the cut point is cut mid-line at the cut point exactly — the
 * same fallback the previous overflow-only trim used.
 *
 * Newlines in the dropped prefix are counted ONCE here, at trim time, rather
 * than being recomputed from the survivor.
 */
export function trimBufferToLowWater(buffer: string): BufferTrimResult {
  if (buffer.length <= MAX_BUFFER_SIZE) {
    return { buffer, linesDropped: 0, trimmed: false };
  }

  const cutFrom = buffer.length - BUFFER_LOW_WATER_SIZE;
  const newlineIndex = buffer.indexOf('\n', cutFrom);
  const dropEnd = newlineIndex === -1 ? cutFrom : newlineIndex + 1;

  return {
    buffer: buffer.substring(dropEnd),
    linesDropped: countNewlines(buffer, 0, dropEnd),
    trimmed: true,
  };
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
 * Cap stream events buffer while keeping the live tail intact.
 * The most recent `STREAM_EVENTS_TAIL_RESERVE` events are always kept regardless
 * of type (so streaming text/thinking — e.g. a final verdict — never vanishes),
 * and the remaining budget is filled with the most recent landmark events before
 * the tail to preserve tree structure. Events are returned in original order.
 *
 * The frontend `AgentMonitorStore` applies the same landmark-plus-tail shape to
 * its own render cap (TASK_2026_323 R6); the two implementations are kept in
 * step by intent, not by a shared module.
 */
export function capStreamEvents(
  events: FlatStreamEventUnion[],
  max: number,
): FlatStreamEventUnion[] {
  if (events.length <= max) return events;

  const reserve = Math.min(STREAM_EVENTS_TAIL_RESERVE, max);
  const tailStart = events.length - reserve;
  const headBudget = max - reserve;
  const head: FlatStreamEventUnion[] = [];
  for (let i = tailStart - 1; i >= 0 && head.length < headBudget; i--) {
    if (LANDMARK_EVENT_TYPES.has(events[i].eventType)) {
      head.push(events[i]);
    }
  }
  head.reverse();
  return [...head, ...events.slice(tailStart)];
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
        buffer += seg.content;
      } else {
        if (buffer && bufferType) {
          result.push({ type: bufferType, content: buffer });
        }
        buffer = seg.content;
        bufferType = seg.type;
      }
    } else {
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
