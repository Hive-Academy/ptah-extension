/**
 * Lane budget guard (TASK_2026_597, component 16, R9.3/R9.4).
 *
 * Bounds a runaway lane by watching its `tool-call` segments:
 *
 * - At `steerAt` calls it asks for ONE steer message ("finish now").
 * - At `stopAt` calls it asks for a stop with `tool-call-budget`.
 * - When one identical call (tool name plus normalised `toolInput` JSON, else
 *   `toolArgs`, else the tool name alone) reaches `repeatAt` occurrences it
 *   asks for a stop with `repeat-call`. Cursor's adapter redacts or drops
 *   `toolInput`, so its keys can be coarser; that is accepted.
 * - File-edit calls (Write, Edit, Delete, ...) count toward the budget but not
 *   toward the repeat check: some adapters (Codex file changes) report only
 *   the path, so repeated normal edits to one file would share a key.
 *
 * The guard only decides. The manager delivers the steer and performs the
 * stop. One guard per tracked lane, dropped with the lane, and {@link reset}
 * when the caller starts a new turn on it. No timers; each segment costs one
 * map update.
 */

import type { CliOutputSegment, LaneStopReason } from '@ptah-extension/shared';

/** Tool names (lower-cased) that edit files; left out of the repeat check. */
const FILE_EDIT_TOOLS: ReadonlySet<string> = new Set([
  'write',
  'edit',
  'multiedit',
  'delete',
  'notebookedit',
  'apply_patch',
]);

export interface LaneBudgetThresholds {
  /** Tool calls after which ONE steer message is sent. */
  readonly steerAt: number;
  /** Tool calls after which the lane is stopped. */
  readonly stopAt: number;
  /** Occurrences of one identical call after which the lane is stopped. */
  readonly repeatAt: number;
}

/** What the manager should do after a segment. */
export type LaneBudgetAction =
  | { readonly kind: 'none' }
  | { readonly kind: 'steer'; readonly message: string }
  | { readonly kind: 'stop'; readonly stopReason: LaneStopReason };

const NONE: LaneBudgetAction = { kind: 'none' };

/** The steer text sent once at the steer threshold. */
export function laneBudgetSteerMessage(toolCalls: number): string {
  return `You have made ${toolCalls} tool calls. Stop exploring, finish the deliverable now, and report.`;
}

/**
 * Not decorated for tsyringe: the manager builds one per lane with the
 * thresholds the spawn environment resolved.
 */
export class LaneBudgetGuard {
  private toolCalls = 0;
  private steered = false;
  private stopped = false;
  private readonly repeats = new Map<string, number>();

  constructor(private readonly thresholds: LaneBudgetThresholds) {}

  /** Tool calls counted so far. */
  get toolCallCount(): number {
    return this.toolCalls;
  }

  /**
   * Count one segment. Non-`tool-call` segments are ignored. After a stop has
   * been asked for, every later segment returns `none`.
   */
  observe(segment: CliOutputSegment): LaneBudgetAction {
    if (this.stopped || segment.type !== 'tool-call') return NONE;

    this.toolCalls += 1;
    if (!isFileEdit(segment)) {
      const key = callKey(segment);
      const repeats = (this.repeats.get(key) ?? 0) + 1;
      this.repeats.set(key, repeats);
      if (repeats >= this.thresholds.repeatAt) {
        return this.stop('repeat-call');
      }
    }
    if (this.toolCalls >= this.thresholds.stopAt) {
      return this.stop('tool-call-budget');
    }
    if (!this.steered && this.toolCalls >= this.thresholds.steerAt) {
      this.steered = true;
      return { kind: 'steer', message: laneBudgetSteerMessage(this.toolCalls) };
    }
    return NONE;
  }

  /**
   * Start counting afresh for a new task the caller sent to the lane: counts,
   * repeats and the one-time steer are cleared. A guard that already asked
   * for a stop stays stopped.
   */
  reset(): void {
    if (this.stopped) return;
    this.toolCalls = 0;
    this.steered = false;
    this.repeats.clear();
  }

  private stop(stopReason: LaneStopReason): LaneBudgetAction {
    this.stopped = true;
    this.repeats.clear();
    return { kind: 'stop', stopReason };
  }
}

function isFileEdit(segment: CliOutputSegment): boolean {
  return FILE_EDIT_TOOLS.has((segment.toolName ?? '').toLowerCase());
}

function callKey(segment: CliOutputSegment): string {
  const name = segment.toolName ?? '';
  if (segment.toolInput !== undefined) {
    return `${name}\u0000${normalisedJson(segment.toolInput)}`;
  }
  if (segment.toolArgs !== undefined && segment.toolArgs !== '') {
    return `${name}\u0000${segment.toolArgs.trim()}`;
  }
  return name;
}

/** JSON with object keys sorted at every level, so key order does not matter. */
function normalisedJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) => {
    if (inner === null || typeof inner !== 'object' || Array.isArray(inner)) {
      return inner;
    }
    const record = inner as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(record).sort()) sorted[k] = record[k];
    return sorted;
  });
}
