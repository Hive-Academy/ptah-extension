/**
 * Session budget stage function (TASK_2026_597 N7, decision 13).
 *
 * Pure, no DI: maps one stats snapshot (the SAME `SessionStatsEntry` the chat
 * chip renders) and the validated settings to a budget figure and a stage.
 * `SessionBudgetService` owns the per-session state and the side effects; this
 * file only decides numbers.
 *
 * Measure (F6):
 * - unit `tokens`: `used = tokenCount` — the figure the chip displays. A
 *   missing `tokenCount` is "no figure", never 0. `lowerBound` when the
 *   snapshot's coverage is `partial`.
 * - unit `cost`: `totalCost` when known; else the priced part (`knownCost`)
 *   as `cost-lower-bound` when pricing is `partial`; else (nothing priced)
 *   `weighted-fallback`: weighted tokens against `fallbackWeightedTokens`.
 *   A session that entered `weighted-fallback` keeps it until the settings
 *   change, so the measure never flaps between units.
 *
 * Stage: the highest percent band reached (`< tighten`, `≥ tighten`,
 * `≥ handoff`, `≥ 100`), raised to `handoff` once the main loop compacted
 * `handoffAfterCompactions` times. Stages only rise, except after `extend`
 * or a settings change (the caller passes `resetStage`).
 */

import type {
  SessionBudgetConfig,
  SessionBudgetMeasure,
  SessionBudgetStage,
  SessionBudgetState,
  SessionStatsEntry,
} from '@ptah-extension/shared';
import { weightedSessionTokens } from './weighted-tokens';

/** Each "Allow 20% more" adds this fraction of the configured limit. */
export const SESSION_BUDGET_EXTENSION_FRACTION = 0.2;

const STAGE_RANK: Readonly<Record<SessionBudgetStage, number>> = {
  unknown: 0,
  normal: 1,
  tighten: 2,
  handoff: 3,
  limit: 4,
};

export function sessionBudgetStageRank(stage: SessionBudgetStage): number {
  return STAGE_RANK[stage];
}

/** The higher of two stages. */
export function higherSessionBudgetStage(
  a: SessionBudgetStage,
  b: SessionBudgetStage,
): SessionBudgetStage {
  return STAGE_RANK[a] >= STAGE_RANK[b] ? a : b;
}

/** The configured limit plus 20% of it per extension. */
export function effectiveSessionBudgetLimit(
  base: number,
  extensions: number,
): number {
  return base * (1 + SESSION_BUDGET_EXTENSION_FRACTION * extensions);
}

export interface SessionBudgetMeasurement {
  readonly measure: SessionBudgetMeasure;
  /** `null` when the snapshot carries no figure for the measure. */
  readonly used: number | null;
  /** Effective limit in the measure's unit, extensions included. */
  readonly limit: number;
  readonly lowerBound: boolean;
}

export interface SessionBudgetMeasureOptions {
  readonly extensions: number;
  /** Keep `weighted-fallback` (the session already entered it). */
  readonly stickyWeightedFallback: boolean;
}

/** The budget figure of one snapshot under the given settings (F6). */
export function measureSessionBudget(
  snapshot: SessionStatsEntry,
  config: SessionBudgetConfig,
  options: SessionBudgetMeasureOptions,
): SessionBudgetMeasurement {
  const partialCoverage = snapshot.coverage === 'partial';

  if (config.unit === 'tokens') {
    return {
      measure: 'tokens',
      used: snapshot.tokenCount ?? null,
      limit: effectiveSessionBudgetLimit(config.tokens, options.extensions),
      lowerBound: partialCoverage,
    };
  }

  const weightedFallback = (): SessionBudgetMeasurement => ({
    measure: 'weighted-fallback',
    used: weightedSessionTokens(snapshot.tokens),
    limit: effectiveSessionBudgetLimit(
      config.fallbackWeightedTokens,
      options.extensions,
    ),
    lowerBound: partialCoverage,
  });

  if (options.stickyWeightedFallback) return weightedFallback();

  const usdLimit = effectiveSessionBudgetLimit(config.usd, options.extensions);
  if (snapshot.totalCost !== null) {
    return {
      measure: 'cost',
      used: snapshot.totalCost,
      limit: usdLimit,
      lowerBound: partialCoverage,
    };
  }
  if (snapshot.pricingCoverage === 'partial') {
    return {
      measure: 'cost-lower-bound',
      used: snapshot.knownCost ?? null,
      limit: usdLimit,
      lowerBound: true,
    };
  }
  return weightedFallback();
}

/** `used / limit × 100`; `null` without a figure. */
export function sessionBudgetPercent(
  used: number | null,
  limit: number,
): number | null {
  if (used === null || !(limit > 0)) return null;
  return (used / limit) * 100;
}

/**
 * The percent band `used` falls in. Compared as `used × 100 ≥ band × limit`
 * so a figure exactly on a boundary never rounds below it.
 */
export function sessionBudgetPercentBand(
  used: number | null,
  limit: number,
  config: Pick<SessionBudgetConfig, 'tightenPercent' | 'handoffPercent'>,
): SessionBudgetStage {
  if (used === null || !(limit > 0)) return 'unknown';
  const scaled = used * 100;
  if (scaled >= 100 * limit) return 'limit';
  if (scaled >= config.handoffPercent * limit) return 'handoff';
  if (scaled >= config.tightenPercent * limit) return 'tighten';
  return 'normal';
}

export interface SessionBudgetStageInput {
  /** The band of the current figure (`unknown` without one). */
  readonly band: SessionBudgetStage;
  readonly compactions: number;
  readonly handoffAfterCompactions: number;
  /** The stage before this evaluation; `null` when there is none. */
  readonly previous: SessionBudgetStage | null;
  /** True after `extend` or a settings change: the floor is dropped. */
  readonly resetStage: boolean;
}

/** The stage after one evaluation; it only rises unless `resetStage`. */
export function nextSessionBudgetStage(
  input: SessionBudgetStageInput,
): SessionBudgetStage {
  const computed =
    input.compactions >= input.handoffAfterCompactions
      ? higherSessionBudgetStage(input.band, 'handoff')
      : input.band;
  if (input.previous === null || input.resetStage) return computed;
  return higherSessionBudgetStage(input.previous, computed);
}

/**
 * Whether a snapshot may replace the state computed from an earlier one —
 * the same rule the tab applies to the stats it shows
 * (`tab-manager.service.ts` `acceptSessionStats`).
 *
 * - No state yet: accept anything.
 * - A lower revision than the last accepted one: ignore.
 * - No revision: a live snapshot is accepted only while no revisioned one was
 *   accepted; a resume snapshot only when no state exists.
 */
export function acceptsSessionBudgetSnapshot(
  previous: { readonly revision: number | null } | null,
  incomingRevision: number | undefined,
  source: 'live' | 'loaded',
): boolean {
  if (previous === null) return true;
  if (incomingRevision === undefined) {
    return source === 'live' && previous.revision === null;
  }
  return previous.revision === null || incomingRevision >= previous.revision;
}

export interface SessionBudgetEvaluationInput {
  readonly snapshot: SessionStatsEntry;
  readonly config: SessionBudgetConfig;
  /** The state before this evaluation; `null` before the first figure. */
  readonly previous: SessionBudgetState | null;
  readonly compactions: number;
  readonly extensions: number;
  /** Drop the stage floor (after `extend` or a settings change). */
  readonly resetStage: boolean;
  /** Drop the sticky `weighted-fallback` measure (a settings change). */
  readonly resetMeasure: boolean;
}

/** The figure and stage fields of a state; the service adds the rest. */
export type SessionBudgetFigure = Pick<
  SessionBudgetState,
  | 'stage'
  | 'unit'
  | 'measure'
  | 'used'
  | 'limit'
  | 'percent'
  | 'lowerBound'
  | 'revision'
  | 'compactions'
  | 'extensions'
  | 'blocked'
>;

/**
 * A measurement with no figure keeps the previous figure (same measure: only
 * `used` is carried, so a new extension still moves the limit). A settings
 * change drops it: the old figure may be in another unit.
 */
function keepPreviousFigure(
  measured: SessionBudgetMeasurement,
  previous: SessionBudgetState | null,
  resetMeasure: boolean,
): SessionBudgetMeasurement {
  if (measured.used !== null || previous === null || previous.used === null) {
    return measured;
  }
  if (resetMeasure) return measured;
  if (previous.measure === measured.measure) {
    return {
      ...measured,
      used: previous.used,
      lowerBound: previous.lowerBound,
    };
  }
  return {
    measure: previous.measure,
    used: previous.used,
    limit: previous.limit,
    lowerBound: previous.lowerBound,
  };
}

/**
 * Evaluate one snapshot. A snapshot with no figure for the measure keeps the
 * previous figure (an absent figure is not 0, F5); `unknown` therefore only
 * appears before the first figure. The compaction trigger still applies.
 */
export function evaluateSessionBudget(
  input: SessionBudgetEvaluationInput,
): SessionBudgetFigure {
  const { snapshot, config, previous } = input;
  const measured = measureSessionBudget(snapshot, config, {
    extensions: input.extensions,
    stickyWeightedFallback:
      !input.resetMeasure && previous?.measure === 'weighted-fallback',
  });
  const figure = keepPreviousFigure(measured, previous, input.resetMeasure);

  const stage = nextSessionBudgetStage({
    band: sessionBudgetPercentBand(figure.used, figure.limit, config),
    compactions: input.compactions,
    handoffAfterCompactions: config.handoffAfterCompactions,
    previous: previous?.stage ?? null,
    resetStage: input.resetStage,
  });

  return {
    stage,
    unit: config.unit,
    measure: figure.measure,
    used: figure.used,
    limit: figure.limit,
    percent: sessionBudgetPercent(figure.used, figure.limit),
    lowerBound: figure.lowerBound,
    revision: snapshot.revision ?? previous?.revision ?? null,
    compactions: input.compactions,
    extensions: input.extensions,
    blocked: stage === 'limit' && config.blockAtLimit,
  };
}
