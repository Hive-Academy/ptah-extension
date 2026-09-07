/**
 * Back-office activity wire contract (TASK_2026_380, component 14c).
 *
 * ## What this is for
 *
 * Ptah does a lot of work the user never sees: a cron run fires, the harness
 * reconciles, the embedder warms, a session import finishes. Today each of
 * those either logs to a file nobody opens or pushes a bespoke message that one
 * panel consumes. This type is the single shape all of them collapse into so a
 * passive ticker can render one ordered list instead of eight.
 *
 * ## Why there is no `'error'` level
 *
 * A ticker is a passive, non-focus-stealing surface. A user who looks away for
 * four seconds misses whatever it said, and that is fine for "cron run
 * finished". It is not fine for a real failure. If `'error'` existed here,
 * every subsystem that already has a nowhere-else-to-put-it failure would route
 * it through this channel, and the ticker would become the *de facto* error
 * surface by accident — the one place errors go and the one place they cannot
 * be seen. `'warn'` exists only to tint a run that completed in a degraded
 * state; a run that actually failed needs a channel the user cannot miss.
 */

/**
 * The subsystem an activity item came from.
 *
 * A closed set on purpose: the renderer maps each value to a label and an icon,
 * so an unknown source has nothing to render. {@link isActivityEventPayload}
 * drops payloads carrying one rather than showing a blank row.
 */
export type ActivitySource =
  | 'boot'
  | 'memory'
  | 'indexing'
  | 'skills'
  | 'cron'
  | 'harness'
  | 'sessions'
  | 'embedder'
  | 'vec'
  | 'database';

/** Every legal {@link ActivitySource} value, for runtime narrowing. */
export const ACTIVITY_SOURCE_VALUES = [
  'boot',
  'memory',
  'indexing',
  'skills',
  'cron',
  'harness',
  'sessions',
  'embedder',
  'vec',
  'database',
] as const satisfies readonly ActivitySource[];

/**
 * How prominently an item is tinted. See the file header for why `'error'` is
 * deliberately absent.
 */
export type ActivityLevel = 'info' | 'warn';

/** Every legal {@link ActivityLevel} value, for runtime narrowing. */
export const ACTIVITY_LEVEL_VALUES = [
  'info',
  'warn',
] as const satisfies readonly ActivityLevel[];

/**
 * One back-office activity item.
 *
 * `summary` is already formatted by the emitter — the renderer does no string
 * building, so a subsystem that knows the numbers writes the sentence once
 * rather than shipping fields the UI has to reassemble.
 */
export interface ActivityEventPayload {
  readonly source: ActivitySource;
  /** Subsystem-local discriminator, e.g. `'cron-run'`, `'reconcile'`, `'import'`. */
  readonly kind: string;
  /** One human sentence, already formatted by the emitter. */
  readonly summary: string;
  /** Epoch ms. */
  readonly timestamp: number;
  /** Defaults to `'info'` when absent. */
  readonly level?: ActivityLevel;
}

/** True when `value` is an {@link ActivitySource} literal. */
export function isActivitySource(value: unknown): value is ActivitySource {
  return (
    typeof value === 'string' &&
    (ACTIVITY_SOURCE_VALUES as readonly string[]).includes(value)
  );
}

/** True when `value` is an {@link ActivityLevel} literal. */
export function isActivityLevel(value: unknown): value is ActivityLevel {
  return (
    typeof value === 'string' &&
    (ACTIVITY_LEVEL_VALUES as readonly string[]).includes(value)
  );
}

/**
 * Narrow an unknown message payload to {@link ActivityEventPayload}.
 *
 * This is the frontend's only admission gate — the message client resolves to
 * `unknown`, the same reason `isRpcReadinessError` exists. A malformed payload
 * is dropped, never rendered: an item with a non-finite `timestamp` would sort
 * unpredictably in the ring, and one with no `summary` at all would render a
 * blank row the user cannot dismiss.
 *
 * An *empty-string* `summary` is admitted deliberately. It is a well-formed
 * payload from an emitter that had nothing to add, and the renderer falls back
 * to the `source` label for it. Rejecting it here would make that fallback
 * unreachable.
 */
export function isActivityEventPayload(
  value: unknown,
): value is ActivityEventPayload {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ActivityEventPayload>;
  return (
    isActivitySource(candidate.source) &&
    typeof candidate.kind === 'string' &&
    typeof candidate.summary === 'string' &&
    typeof candidate.timestamp === 'number' &&
    Number.isFinite(candidate.timestamp) &&
    (candidate.level === undefined || isActivityLevel(candidate.level))
  );
}
