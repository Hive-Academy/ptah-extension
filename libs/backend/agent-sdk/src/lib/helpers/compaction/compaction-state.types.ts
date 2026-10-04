/**
 * Compaction coordinator state types (TASK_2026_597 A8, component 21).
 *
 * One coordinator owns the compaction state of every live session. The states
 * and the transitions between them are listed on {@link CompactionState}; the
 * coordinator itself is `compaction-coordinator.ts`.
 */

/**
 * Per-session compaction state.
 *
 * - `IDLE` → `ARMED` when the context reaches 80% of the effective window.
 * - `IDLE` or `ARMED` → `TRIGGERED` on a PreCompact hook (auto or manual).
 * - `TRIGGERED` → `COMPACTING` on the SDK `status: 'compacting'` message.
 * - `TRIGGERED` or `COMPACTING` → `COOLDOWN` on `compact_boundary`, recording
 *   the pre/post token counts.
 * - `COOLDOWN` → `IDLE` after the next turn ends.
 * - `TRIGGERED` or `COMPACTING` → `BACKOFF` when no boundary arrives within
 *   {@link COMPACTION_MAX_DWELL_MS}.
 * - `BACKOFF` → `IDLE` after one turn.
 * - `OBSERVE_ONLY` is entered at registration for the Codex proxy path and for
 *   any session class whose E2 experiment has not passed, and is never left.
 */
export const CompactionState = {
  IDLE: 'IDLE',
  ARMED: 'ARMED',
  TRIGGERED: 'TRIGGERED',
  COMPACTING: 'COMPACTING',
  COOLDOWN: 'COOLDOWN',
  BACKOFF: 'BACKOFF',
  OBSERVE_ONLY: 'OBSERVE_ONLY',
} as const;

export type CompactionState =
  (typeof CompactionState)[keyof typeof CompactionState];

/** Longest time a compaction may stay open (TRIGGERED or COMPACTING) before BACKOFF. */
export const COMPACTION_MAX_DWELL_MS = 180_000;

/** Share of the effective context window at which a session is ARMED. */
export const COMPACTION_ARM_RATIO = 0.8;

/** What the user sees when a manual `/compact` arrives while one is already open. */
export const COMPACTION_ALREADY_RUNNING_MESSAGE = 'compaction already running';

/** The event that caused a state change. */
export type CompactionTransitionTrigger =
  /** Context usage reached {@link COMPACTION_ARM_RATIO} of the window. */
  | 'threshold'
  /** PreCompact hook with `trigger: 'auto'`. */
  | 'auto'
  /** PreCompact hook with `trigger: 'manual'`. */
  | 'manual'
  /** SDK `status: 'compacting'` system message. */
  | 'status-compacting'
  /** SDK `compact_boundary` system message. */
  | 'compact-boundary'
  /** A turn ended. */
  | 'turn-end'
  /** No boundary within {@link COMPACTION_MAX_DWELL_MS}. */
  | 'dwell-timeout';

/** PreCompact hook trigger, as the SDK reports it. */
export type PreCompactTrigger = 'auto' | 'manual';

/**
 * The class of a session, which decides whether the coordinator may act on it
 * or only observe it.
 */
export interface CompactionSessionClass {
  /** The session runs through the Codex proxy path. */
  readonly codexProxy: boolean;
  /**
   * Result of the E2 experiment for this class: `true` passed, `false`
   * failed, `null` not run. Only `true` lets the coordinator act; the
   * auto-compact default is `null` today, so the default class observes.
   */
  readonly e2Passed: boolean | null;
}

/** One state change, as emitted to subscribers (logged at INFO by the executor). */
export interface CompactionStateChange {
  readonly sessionId: string;
  readonly from: CompactionState;
  readonly to: CompactionState;
  readonly trigger: CompactionTransitionTrigger;
  /** Tokens before compaction; present on the `compact-boundary` change. */
  readonly preTokens?: number;
  /** Tokens after compaction; present on the `compact-boundary` change when known. */
  readonly postTokens?: number;
}

export type CompactionStateListener = (change: CompactionStateChange) => void;

/** Context reading fed to the coordinator at a turn end. */
export interface CompactionContextReading {
  readonly totalTokens: number;
  /** Effective context window in tokens. */
  readonly maxTokens: number;
}

/** Token counts carried by `compact_boundary`. */
export interface CompactionBoundaryTokens {
  readonly preTokens: number;
  readonly postTokens?: number;
}

/** Decision for a manual `/compact` the user typed. */
export type ManualCompactDecision =
  | { readonly action: 'send' }
  | { readonly action: 'deduped'; readonly message: string };

/** Opaque timer handle returned by {@link CompactionTimers.setTimeout}. */
export type CompactionTimerHandle = unknown;

/** Timer seam, so specs can drive the dwell timeout without real time. */
export interface CompactionTimers {
  setTimeout(callback: () => void, ms: number): CompactionTimerHandle;
  clearTimeout(handle: CompactionTimerHandle): void;
}
