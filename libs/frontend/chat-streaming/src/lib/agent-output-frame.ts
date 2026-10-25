/**
 * Per-frame application of queued CLI agent output (TASK_2026_628 batch 4a).
 *
 * `AgentMonitorStore` queues output deltas per agent and applies them once
 * per frame; these helpers hold the queue shape and the per-agent fold. Not
 * exported from the library barrel.
 */

import type {
  CliOutputSegment,
  FlatStreamEventUnion,
} from '@ptah-extension/shared';
import { addCliUsage, hasReportedCliCacheTokens } from '@ptah-extension/shared';
import type { MonitoredAgent } from './agent-monitor.store';
import {
  MAX_FRONTEND_BUFFER,
  appendToBuffer,
  capSegments,
  capStreamEventsInPlace,
} from './agent-output-retention';

/**
 * Output deltas for one agent that arrived since the last frame. Raw text
 * only: the stdout/stderr head notice is written when the frame applies it.
 */
export interface PendingAgentOutput {
  stdout: string;
  stderr: string;
  /** Incoming segments, adjacent prose merged by the same rule as the card. */
  segments: CliOutputSegment[];
  /**
   * Characters of segment content queued since the last flush. Adjacent prose
   * merges into one segment, so the segment count alone does not bound the
   * queue; this does (see `AgentMonitorStore.onAgentOutput`).
   */
  segmentChars: number;
  /** Usage reports of every incoming segment, in arrival order. */
  usages: NonNullable<CliOutputSegment['usage']>[];
  streamEvents: FlatStreamEventUnion[];
  /** Number of deltas that carried stream events (one revision each). */
  streamDeltas: number;
}

/**
 * Append segments to `target` in place. When the first incoming segment has
 * the same prose type (text or thinking) as the current last one, the two are
 * merged into a new object that keeps the earlier segment's fields, unless
 * they belong to different provider messages (`messageId`).
 */
export function appendMergingProse(
  target: CliOutputSegment[],
  incoming: readonly CliOutputSegment[],
): void {
  if (incoming.length === 0) return;
  const lastIdx = target.length - 1;
  const last = lastIdx >= 0 ? target[lastIdx] : undefined;
  const first = incoming[0];
  let start = 0;
  if (
    last &&
    (last.type === 'text' || last.type === 'thinking') &&
    last.type === first.type &&
    last.messageId === first.messageId
  ) {
    target[lastIdx] = { ...last, content: last.content + first.content };
    start = 1;
  }
  for (let i = start; i < incoming.length; i++) target.push(incoming[i]);
}

/**
 * Apply one frame's queued output to an agent: one clone, the same per-field
 * rules a single delta used to apply.
 */
export function applyPendingOutput(
  agent: MonitoredAgent,
  pending: PendingAgentOutput,
  dropped: { stdout: number; stderr: number } | undefined,
): MonitoredAgent {
  let updated: MonitoredAgent = {
    ...agent,
    stdout: appendToBuffer(
      agent.stdout,
      pending.stdout,
      dropped?.stdout ?? 0,
      MAX_FRONTEND_BUFFER,
    ),
    stderr: appendToBuffer(
      agent.stderr,
      pending.stderr,
      dropped?.stderr ?? 0,
      MAX_FRONTEND_BUFFER,
    ),
  };

  if (pending.segments.length > 0) {
    // Fold usage from the raw incoming reports first: `capSegments` may drop
    // usage-bearing segments, so it may not see usage first.
    let usageTotals = agent.usageTotals ?? null;
    // A restored card's usage reads "unknown" (null) by design (Req 8.4):
    // folding the first live segment of a re-opened run would publish a
    // partial run total as known. Stay null while the card is restored and
    // nothing is known yet; a card that somehow holds a total still folds.
    if (!(agent.restored === true && agent.usageTotals === null)) {
      for (const usage of pending.usages) {
        usageTotals = addCliUsage(usageTotals, usage);
      }
    }
    // One copy per frame (the array identity is what tells the card's `@for`
    // to re-diff). `capSegments` folds the prose it drops and marks what it
    // could not fold.
    const segments = agent.segments.slice();
    appendMergingProse(segments, pending.segments);
    updated = {
      ...updated,
      usageTotals,
      segments: capSegments(segments),
      ...(hasReportedCliCacheTokens(usageTotals)
        ? { cacheReported: true }
        : {}),
    };
  }

  if (pending.streamDeltas > 0) {
    // Append in place — streamEvents shares its reference across deltas, so
    // this is O(new events) with no whole-array copy. The bumped
    // streamRevision (one per delta, as before) drives the card to recompute.
    for (const ev of pending.streamEvents) updated.streamEvents.push(ev);
    capStreamEventsInPlace(updated.streamEvents);
    updated.streamRevision = agent.streamRevision + pending.streamDeltas;
  }

  return updated;
}
