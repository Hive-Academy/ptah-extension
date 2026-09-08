/**
 * Degradation wire contract (TASK_2026_383, component 1).
 *
 * ## What this is for
 *
 * Ptah is full of sites that quietly fall back to a default when a capability
 * is missing: a keytar import that resolves to `null`, a worker factory that
 * was never registered, a `catch` that returns an empty array. Each of those is
 * a real product decision — the app keeps running — but today the decision
 * leaves no trace anyone can count. This is the one shape all of them collapse
 * into, so "how many capabilities degraded on this boot, and which" is a
 * machine-readable question instead of a log-grep.
 *
 * ## Why `code` is the load-bearing field
 *
 * `code` is the key a count is kept under, so it MUST be a stable string
 * literal written at the call site — never interpolated from an error message.
 * A code built from `error.message` produces a fresh bucket per failure and
 * makes the count meaningless, which is the exact failure mode this contract
 * exists to prevent. Human-readable prose belongs in `summary`; the varying
 * part of a failure belongs in `detail`.
 *
 * ## Why there is no surface for it here
 *
 * This file is the contract only — no emitter, no transport, no counting. The
 * emission seam is `DegradationReporter` in `@ptah-extension/vscode-core`, and
 * the only consumer today is the per-boot summary line. A user-facing panel is
 * a later product decision; the contract exists so the count is available
 * before anyone decides whether to render it.
 */

/**
 * The subsystem whose capability degraded.
 *
 * A closed set on purpose: a source is what a summary groups by, so an unknown
 * value has nothing to group under. {@link isDegradationEventPayload} drops
 * payloads carrying one. Widening this union is an ordinary append — add the
 * literal here and to {@link DEGRADATION_SOURCE_VALUES} together.
 */
export type DegradationSource =
  | 'boot'
  | 'database'
  | 'auth'
  | 'settings'
  | 'harness'
  | 'sessions'
  | 'indexing'
  | 'memory'
  | 'skills'
  | 'cron'
  | 'agent'
  | 'workspace';

/** Every legal {@link DegradationSource} value, for runtime narrowing. */
export const DEGRADATION_SOURCE_VALUES = [
  'boot',
  'database',
  'auth',
  'settings',
  'harness',
  'sessions',
  'indexing',
  'memory',
  'skills',
  'cron',
  'agent',
  'workspace',
] as const satisfies readonly DegradationSource[];

/**
 * How much the user actually lost.
 *
 * - `'expected'` — an optional capability is absent by design on this host. The
 *   keytar probe on a Linux box with no libsecret is the archetype: nothing is
 *   wrong, and a boot full of these is a healthy boot.
 * - `'degraded'` — the feature works in a reduced form. Something is worse than
 *   it should be and someone should look eventually.
 * - `'critical'` — a safety net is gone. "No worker factory, so no database
 *   backup was taken" is this level: nothing failed yet, and that is precisely
 *   why it needs to be loud now rather than at restore time.
 *
 * The severity is chosen by the CALL SITE, which is the only place that knows
 * what was lost. `DegradationReporter` never assigns or upgrades one.
 */
export type DegradationSeverity = 'expected' | 'degraded' | 'critical';

/** Every legal {@link DegradationSeverity} value, for runtime narrowing. */
export const DEGRADATION_SEVERITY_VALUES = [
  'expected',
  'degraded',
  'critical',
] as const satisfies readonly DegradationSeverity[];

/**
 * One "a capability degraded to a default" event.
 *
 * `summary` is already formatted by the emitter — a reader does no string
 * building, matching `ActivityEventPayload`'s rule, so the site that knows the
 * numbers writes the sentence once.
 */
export interface DegradationEventPayload {
  readonly source: DegradationSource;
  /**
   * Stable, dot-namespaced identifier for THIS site, e.g.
   * `'electron.boot.startOrJoin-failed'`. A string literal at the call site,
   * never interpolated — see the file header.
   */
  readonly code: string;
  readonly severity: DegradationSeverity;
  /** One human sentence, already formatted by the emitter. */
  readonly summary: string;
  /** Epoch ms. */
  readonly timestamp: number;
  /**
   * The varying part of the failure — an error message, a path, a probe result.
   * Never a secret: this crosses to the renderer.
   */
  readonly detail?: string;
}

/** True when `value` is a {@link DegradationSource} literal. */
export function isDegradationSource(
  value: unknown,
): value is DegradationSource {
  return (
    typeof value === 'string' &&
    (DEGRADATION_SOURCE_VALUES as readonly string[]).includes(value)
  );
}

/** True when `value` is a {@link DegradationSeverity} literal. */
export function isDegradationSeverity(
  value: unknown,
): value is DegradationSeverity {
  return (
    typeof value === 'string' &&
    (DEGRADATION_SEVERITY_VALUES as readonly string[]).includes(value)
  );
}

/**
 * Narrow an unknown message payload to {@link DegradationEventPayload}.
 *
 * Returns `false` rather than throwing, exactly like `isActivityEventPayload`:
 * this sits on the admission path of a channel whose whole purpose is that
 * nothing on it can break its caller.
 *
 * Two deliberate asymmetries with the activity guard:
 *
 * - An **empty `code` is rejected.** A count keyed on `''` is the meaningless
 *   bucket the contract exists to prevent, so an empty code is malformed rather
 *   than merely uninformative.
 * - An **empty `summary` is admitted.** It is a well-formed payload from an
 *   emitter that had nothing to add, and a reader falls back to the `code`.
 */
export function isDegradationEventPayload(
  value: unknown,
): value is DegradationEventPayload {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<DegradationEventPayload>;
  return (
    isDegradationSource(candidate.source) &&
    typeof candidate.code === 'string' &&
    candidate.code.length > 0 &&
    isDegradationSeverity(candidate.severity) &&
    typeof candidate.summary === 'string' &&
    typeof candidate.timestamp === 'number' &&
    Number.isFinite(candidate.timestamp) &&
    (candidate.detail === undefined || typeof candidate.detail === 'string')
  );
}
