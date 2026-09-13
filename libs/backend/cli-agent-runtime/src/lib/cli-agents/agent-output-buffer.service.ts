import { injectable, inject } from 'tsyringe';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
import { AgentId } from '@ptah-extension/shared';
import type {
  AgentOutputDelta,
  CliOutputSegment,
  FlatStreamEventUnion,
} from '@ptah-extension/shared';
import {
  MAX_BUFFER_SIZE,
  OUTPUT_FLUSH_INTERVAL,
  MAX_ACCUMULATED_SEGMENTS,
  MAX_ACCUMULATED_STREAM_EVENTS,
  STREAM_EVENTS_CAP_SLACK,
  type PendingDelta,
  createEmptyPendingDelta,
  countNewlines,
  trimBufferToLowWater,
  capStreamEvents,
  mergeConsecutiveTextSegments,
} from './agent-process-manager-helpers';
import type { TrackedAgent } from './tracked-agent';

@injectable()
export class AgentOutputBuffer {
  /** Pending output deltas per agent (throttled to OUTPUT_FLUSH_INTERVAL) */
  private readonly pendingDeltas = new Map<string, PendingDelta>();
  /** Flush timers per agent */
  private readonly flushTimers = new Map<string, NodeJS.Timeout>();

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * Append a chunk to an agent's output buffer, trimming with hysteresis.
   *
   * This is the hottest per-chunk path in the manager: on the ptah-cli path
   * `SdkHandle.onOutput` fires once per `text_delta`, i.e. once per token. Two
   * rules keep it O(chunk) instead of O(buffer):
   *
   * - **Trim to a LOW-WATER mark, not to the cap.** The previous version cut
   *   only the overflow, which left the buffer sitting on `MAX_BUFFER_SIZE` so
   *   the next token trimmed again and copied the whole megabyte. Cutting back
   *   to `BUFFER_LOW_WATER_SIZE` amortizes the copy over the 256 KB of headroom
   *   it buys (TASK_2026_323 B1).
   * - **No regex for the newline count.** `data.match(/\n/g)` allocated a match
   *   array per chunk; `countNewlines` walks the same bytes and allocates none.
   *
   * The line counter tracks lines CURRENTLY in the buffer, so a trim subtracts
   * the newlines it dropped — counted once, at trim time, over the dropped
   * prefix only.
   */
  appendOutput(
    agentId: string,
    tracked: TrackedAgent,
    stream: 'stdout' | 'stderr',
    data: string,
    onFlushDue: () => void,
  ): void {
    const key = stream === 'stdout' ? 'stdoutBuffer' : 'stderrBuffer';
    const lineCountKey =
      stream === 'stdout' ? 'stdoutLineCount' : 'stderrLineCount';

    tracked[key] += data;
    tracked[lineCountKey] += countNewlines(data);

    if (tracked[key].length > MAX_BUFFER_SIZE) {
      const trim = trimBufferToLowWater(tracked[key]);
      tracked[key] = trim.buffer;
      tracked[lineCountKey] = Math.max(
        0,
        tracked[lineCountKey] - trim.linesDropped,
      );
      tracked.truncated = true;
    }

    this.pendingFor(agentId)[stream] += data;
    this.scheduleFlush(agentId, onFlushDue);
  }

  /**
   * Accumulate a structured segment for throttled emission.
   * Shares the same flush timer as text deltas.
   */
  appendSegment(
    agentId: string,
    tracked: TrackedAgent | undefined,
    segment: CliOutputSegment,
    onFlushDue: () => void,
  ): void {
    this.pendingFor(agentId).segments.push(segment);
    if (
      tracked &&
      tracked.accumulatedSegments.length < MAX_ACCUMULATED_SEGMENTS
    ) {
      tracked.accumulatedSegments.push(segment);
    }
    this.scheduleFlush(agentId, onFlushDue);
  }

  /**
   * Accumulate a FlatStreamEventUnion event for throttled emission.
   * Shares the same flush timer as text deltas and segments.
   * Only Ptah CLI adapter produces these events.
   */
  appendStreamEvent(
    agentId: string,
    tracked: TrackedAgent | undefined,
    event: FlatStreamEventUnion,
    onFlushDue: () => void,
  ): void {
    this.pendingFor(agentId).streamEvents.push(event);
    if (tracked) {
      tracked.accumulatedStreamEvents.push(event);

      // Re-cap only once the array has run STREAM_EVENTS_CAP_SLACK entries past
      // the cap, not the moment it exceeds it. `capStreamEvents` rebuilds all
      // 50 000 entries; firing it on every event past the cap is the same
      // per-chunk full-buffer rescan as the stdout trim above, just in array
      // form. The slack amortizes each rebuild over 5 000 events.
      if (
        tracked.accumulatedStreamEvents.length >
        MAX_ACCUMULATED_STREAM_EVENTS + STREAM_EVENTS_CAP_SLACK
      ) {
        tracked.accumulatedStreamEvents = capStreamEvents(
          tracked.accumulatedStreamEvents,
          MAX_ACCUMULATED_STREAM_EVENTS,
        );
        // Log only the FIRST time the cap is hit for this agent. A long-running
        // agent crosses the cap on every subsequent event, so logging here
        // unconditionally floods the console and adds synchronous logging load
        // to the event loop per stream event.
        if (!tracked.streamCapLogged) {
          tracked.streamCapLogged = true;
          this.logger.debug(
            '[AgentProcessManager] Stream events cap reached, dropping oldest deltas (further drops for this agent are silent)',
            {
              agentId,
              cap: MAX_ACCUMULATED_STREAM_EVENTS,
            },
          );
        }
      }
    }
    this.scheduleFlush(agentId, onFlushDue);
  }

  /**
   * Take the accumulated deltas for an agent as one `AgentOutputDelta`.
   * Merges consecutive text segments to reduce webview overhead. Returns
   * undefined when nothing is pending or the record is gone.
   */
  takeDelta(
    agentId: string,
    tracked: TrackedAgent | undefined,
  ): AgentOutputDelta | undefined {
    this.flushTimers.delete(agentId);
    const pending = this.pendingDeltas.get(agentId);
    if (
      !pending ||
      (!pending.stdout &&
        !pending.stderr &&
        pending.segments.length === 0 &&
        pending.streamEvents.length === 0)
    )
      return undefined;

    if (!tracked) {
      this.pendingDeltas.delete(agentId);
      return undefined;
    }

    const mergedSegments = mergeConsecutiveTextSegments(pending.segments);

    const delta: AgentOutputDelta = {
      agentId: AgentId.from(agentId),
      stdoutDelta: pending.stdout,
      stderrDelta: pending.stderr,
      timestamp: Date.now(),
      ...(mergedSegments.length > 0 ? { segments: mergedSegments } : {}),
      ...(pending.streamEvents.length > 0
        ? { streamEvents: pending.streamEvents }
        : {}),
    };
    pending.stdout = '';
    pending.stderr = '';
    pending.segments = [];
    pending.streamEvents = [];

    return delta;
  }

  /**
   * Clean up flush timer for a specific agent.
   */
  discard(agentId: string): void {
    const timer = this.flushTimers.get(agentId);
    if (timer) {
      clearTimeout(timer);
      this.flushTimers.delete(agentId);
    }
    this.pendingDeltas.delete(agentId);
  }

  private pendingFor(agentId: string): PendingDelta {
    let pending = this.pendingDeltas.get(agentId);
    if (!pending) {
      pending = createEmptyPendingDelta();
      this.pendingDeltas.set(agentId, pending);
    }
    return pending;
  }

  /**
   * Arm the shared per-agent output flush timer if it is not already armed.
   * Text deltas, structured segments and stream events all coalesce onto it.
   *
   * Unref'ing the OUTPUT FLUSH timer is safe: while an agent is producing
   * output, the SDK subprocess's own stdio handles hold the loop open, so the
   * 200 ms flush always gets its tick. When nothing is producing output there
   * is nothing pending to flush, and `handleExit` flushes synchronously before
   * teardown regardless.
   */
  private scheduleFlush(agentId: string, onFlushDue: () => void): void {
    if (this.flushTimers.has(agentId)) return;
    const timer = setTimeout(onFlushDue, OUTPUT_FLUSH_INTERVAL);
    if (typeof (timer as { unref?: () => void }).unref === 'function') {
      (timer as { unref: () => void }).unref();
    }
    this.flushTimers.set(agentId, timer);
  }
}
