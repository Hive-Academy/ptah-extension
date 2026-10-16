/**
 * Confidence aggregation (Requirement 13.5).
 *
 * Pure: no clock, no I/O, no randomness. The same answers return the same
 * numbers.
 *
 * A model-sourced answer keeps the provider's confidence when it is a finite
 * number from 0 to 1, and null when the provider reports none (Requirement
 * 1.8). `ranking`, `pin`, `skill-table` and an unavailable entry contribute
 * null and are not model-sourced, even if a leftover number is still on the
 * object.
 *
 * Overall confidence is null when no answer is model-sourced, and null when
 * any model-sourced answer is null. Otherwise it is the minimum of the
 * model-sourced values. A null provider confidence is not a low-confidence
 * fallback: the threshold applies only to a reported number
 * (`confidence < CONFIDENCE_THRESHOLD`).
 *
 * The Gate 0.1 table prints U+2014 EM DASH for null (Requirement 8.3). That
 * mark is not the reason phrase. The reason phrase lives in
 * `compile-reasons.ts`.
 */
import { CONFIDENCE_THRESHOLD } from '../routing-constants';

export const ANSWER_SOURCES = [
  'model',
  'ranking',
  'pin',
  'skill-table',
] as const;

export type AnswerSource = (typeof ANSWER_SOURCES)[number];

export const ROSTER_CHOICE_SOURCES = ['model', 'ranking', 'pin'] as const;

export type RosterChoiceSource = (typeof ROSTER_CHOICE_SOURCES)[number];

export const PREFLIGHT_ANSWER_SOURCES = ['model', 'skill-table'] as const;

export type PreflightAnswerSource = (typeof PREFLIGHT_ANSWER_SOURCES)[number];

/** Requirement 8.3 table cell for a null confidence. */
export const NULL_CONFIDENCE_MARK = '\u2014';

export interface SourcedConfidence {
  readonly source: AnswerSource;
  /**
   * Provider confidence. Read only when `source` is `model`.
   * Null means the provider reported no native confidence.
   */
  readonly reportedConfidence: number | null;
}

export interface StageConfidenceResult {
  readonly stage: 'pre-flight' | 'gate-0.1';
  readonly answerConfidences: readonly (number | null)[];
  readonly overallConfidence: number | null;
  readonly lowConfidenceFallback: boolean;
}

export type ConfidenceRosterEntry =
  | {
      readonly status: 'chosen';
      readonly source: RosterChoiceSource;
      readonly reportedConfidence: number | null;
    }
  | { readonly status: 'unavailable' };

export function isModelSourced(source: AnswerSource): source is 'model' {
  return source === 'model';
}

function assertUnitInterval(value: number): void {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error('confidence must be a finite number from 0 to 1');
  }
}

/** Confidence stored on one answer. Non-model sources are always null. */
export function resolveAnswerConfidence(
  answer: SourcedConfidence,
): number | null {
  if (!isModelSourced(answer.source)) {
    return null;
  }
  if (answer.reportedConfidence === null) {
    return null;
  }
  assertUnitInterval(answer.reportedConfidence);
  return answer.reportedConfidence;
}

/**
 * Minimum over model-sourced answers, or null when that minimum would hide
 * a missing provider confidence (Requirement 13.5).
 */
export function overallConfidence(
  answers: readonly SourcedConfidence[],
): number | null {
  let sawModel = false;
  let minimum: number | null = null;
  for (const answer of answers) {
    if (!isModelSourced(answer.source)) {
      continue;
    }
    sawModel = true;
    const value = resolveAnswerConfidence(answer);
    if (value === null) {
      return null;
    }
    minimum = minimum === null || value < minimum ? value : minimum;
  }
  if (!sawModel || minimum === null) {
    return null;
  }
  return minimum;
}

/** Unavailable entries never enter the minimum (Requirement 2.7, 13.5). */
export function overallRosterConfidence(
  entries: readonly ConfidenceRosterEntry[],
): number | null {
  const answers: SourcedConfidence[] = [];
  for (const entry of entries) {
    if (entry.status === 'unavailable') {
      continue;
    }
    answers.push({
      source: entry.source,
      reportedConfidence: entry.reportedConfidence,
    });
  }
  return overallConfidence(answers);
}

/** Chosen entries keep a provider value only when the source is `model`. */
export function rosterEntryConfidence(
  entry: ConfidenceRosterEntry,
): number | null {
  if (entry.status === 'unavailable') {
    return null;
  }
  return resolveAnswerConfidence({
    source: entry.source,
    reportedConfidence: entry.reportedConfidence,
  });
}

/**
 * True only for a reported number strictly below `CONFIDENCE_THRESHOLD`.
 * Null is not low confidence (Requirement 1.8).
 */
export function appliesLowConfidenceFallback(
  reportedConfidence: number | null,
): boolean {
  if (reportedConfidence === null) {
    return false;
  }
  assertUnitInterval(reportedConfidence);
  return reportedConfidence < CONFIDENCE_THRESHOLD;
}

/** Digits for a reported confidence, or the table mark for null. */
export function formatConfidence(confidence: number | null): string {
  if (confidence === null) {
    return NULL_CONFIDENCE_MARK;
  }
  assertUnitInterval(confidence);
  return JSON.stringify(confidence);
}

/**
 * Both stages share one rule. Callers pass the answers that belong to that
 * stage: task type and depth at pre-flight, chosen roster entries at
 * gate-0.1. Unavailable entries stay out of `answers`; use
 * `overallRosterConfidence` when the roster still contains them.
 */
export function compileStageConfidence(
  stage: 'pre-flight' | 'gate-0.1',
  answers: readonly SourcedConfidence[],
): StageConfidenceResult {
  const answerConfidences = answers.map((answer) =>
    resolveAnswerConfidence(answer),
  );
  const lowConfidenceFallback = answers.some(
    (answer) =>
      isModelSourced(answer.source) &&
      appliesLowConfidenceFallback(answer.reportedConfidence),
  );
  return {
    stage,
    answerConfidences,
    overallConfidence: overallConfidence(answers),
    lowConfidenceFallback,
  };
}
