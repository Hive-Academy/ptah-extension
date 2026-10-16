import type { LaneLimitState } from '@ptah-extension/shared';

/**
 * Routing values (part A, "Routing constants"). One place for later specs
 * to import. Letters in the source plan: S scale, B band, T tie-break,
 * K rotation key, L rotation lifetime, P options per phase, Q questions.
 *
 * Comparisons that the numbers do not state by themselves:
 * - inside the closeness band when `top - score <= CLOSENESS_BAND`
 * - confidence falls back when `confidence < CONFIDENCE_THRESHOLD`
 * - a cell is stale when `now - asOf > STALENESS_AGE_MS`
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** S. Integer score scale, higher is better. */
export const SCORE_MIN = 0;
export const SCORE_MAX = 100;

/** Midpoint. A missing profile neither attracts nor repels. */
export const NEUTRAL_SCORE = 50;

/** Seed label map. Gaps are 15 and 30, both larger than `CLOSENESS_BAND`. */
export const SEED_LABEL_SCORE = {
  strong: 80,
  good: 65,
  weak: 35,
} as const;

export type SeedLabel = keyof typeof SEED_LABEL_SCORE;

/**
 * B. A difference equal to the band is inside it
 * (`top - score <= CLOSENESS_BAND`).
 */
export const CLOSENESS_BAND = 5;

/**
 * Limit order inside the band, best first. `at-limit` is excluded before
 * this order runs. Spellings match `LaneLimitState`
 * (`libs/shared/src/lib/utils/plan-limits/lane-state.ts`).
 */
export const INSIDE_BAND_LIMIT_ORDER = [
  'confirmed-room',
  'unknown',
  'near-limit',
] as const satisfies readonly LaneLimitState[];

export type InsideBandLimitState = (typeof INSIDE_BAND_LIMIT_ORDER)[number];

export const EXCLUDED_LIMIT_STATE = 'at-limit' satisfies LaneLimitState;

/**
 * T. Total tie-break after the band. Earlier steps win.
 * `preferredRank >= PREFERRED_RANK_MIN_RANKED` ranks before
 * `PREFERRED_RANK_UNRANKED` and before an absent rank.
 * Executor kind follows `TIE_BREAK_EXECUTOR_KIND_ORDER`.
 */
export const TIE_BREAK_STEPS = [
  'prefer',
  'preferredRank',
  'executorKind',
  'candidateId',
] as const;

export type TieBreakStep = (typeof TIE_BREAK_STEPS)[number];

export const PREFERRED_RANK_MIN_RANKED = 1;
export const PREFERRED_RANK_UNRANKED = 0;

export const TIE_BREAK_EXECUTOR_KIND_ORDER = ['lane', 'subagent'] as const;

export type TieBreakExecutorKind =
  (typeof TIE_BREAK_EXECUTOR_KIND_ORDER)[number];

/**
 * K. Rotation key is `${phaseId}${ROTATION_KEY_SEPARATOR}${taskKind}`
 * with `taskKind` an `OutcomeTaskKind` (`OUTCOME_TASK_KINDS` in
 * `@ptah-extension/shared`, the single task-kind union, plan R4j).
 * Phase ids belong to the caller.
 */
export const ROTATION_KEY_SEPARATOR = '|';

/** L. Global `IStateStorage` key. Map of rotation key to last chosen id. */
export const ROTATION_STORAGE_KEY = 'laneRouting.rotation.v1';

/** L. Oldest keys are dropped past this cap. */
export const ROTATION_MAX_KEYS = 200;

/**
 * P. Options per phase are `min(OPTIONS_PER_PHASE_CAP, provider limit)`.
 * Shrinking stops at `MIN_OPTIONS_PER_PHASE`; below that the request is
 * `payload-too-large`.
 */
export const OPTIONS_PER_PHASE_CAP = 4;
export const MIN_OPTIONS_PER_PHASE = 2;

export const PROVIDER_OPTION_LIMIT = {
  ollama: 26,
  jev: 255,
  structuredOutput: 8,
} as const;

export type DecisionOptionProvider = keyof typeof PROVIDER_OPTION_LIMIT;

/** Q. Questions in one decision-model request. */
export const QUESTIONS_PER_REQUEST = 32;

/** Per decision-model request, then the margin kept for the return path. */
export const DECISION_REQUEST_TIMEOUT_MS = 3000;
export const DECISION_RETURN_MARGIN_MS = 250;

/**
 * Per decision-model request to a `remote` target (DC8); `local` targets
 * keep `DECISION_REQUEST_TIMEOUT_MS`. Starts equal to the local timeout.
 * Plan Component 16 (remote timeout calibration) sets the final value from
 * the first keyed live run against Ollama Cloud.
 */
export const DECISION_REQUEST_TIMEOUT_REMOTE_MS = 3000;

/** Model lists for every row, each row raced on its own. */
export const MODEL_LISTING_BUDGET_MS = 2000;

/** Gather budget inside the overall call budget. Separate from listing. */
export const GATHER_BUDGET_MS = 2000;

export const MAX_DECISION_REQUESTS = 2;

/**
 * `GATHER_BUDGET_MS + MAX_DECISION_REQUESTS * (timeout + margin)`, with the
 * larger of the local and remote request timeouts.
 */
export const OVERALL_CALL_BUDGET_MS =
  GATHER_BUDGET_MS +
  MAX_DECISION_REQUESTS *
    (Math.max(DECISION_REQUEST_TIMEOUT_MS, DECISION_REQUEST_TIMEOUT_REMOTE_MS) +
      DECISION_RETURN_MARGIN_MS);

/** Falls back when `confidence < CONFIDENCE_THRESHOLD`. */
export const CONFIDENCE_THRESHOLD = 0.5;

/** Request body cap for every decision-model kind. */
export const REQUEST_SIZE_LIMIT_BYTES = 64 * 1024;

/** Stale when `now - asOf > STALENESS_AGE_MS`. */
export const STALENESS_AGE_DAYS = 180;
export const STALENESS_AGE_MS = STALENESS_AGE_DAYS * MS_PER_DAY;

/** Verified runs required in the window before a local value replaces a seed. */
export const MINIMUM_SAMPLE_COUNT = 5;

/** `sinceMs = now - OUTCOME_WINDOW_MS` for routing rates. */
export const OUTCOME_WINDOW_DAYS = 90;
export const OUTCOME_WINDOW_MS = OUTCOME_WINDOW_DAYS * MS_PER_DAY;

function assertRoutingConstantInvariants(): void {
  const strongToGood = SEED_LABEL_SCORE.strong - SEED_LABEL_SCORE.good;
  const goodToWeak = SEED_LABEL_SCORE.good - SEED_LABEL_SCORE.weak;
  if (CLOSENESS_BAND >= strongToGood || CLOSENESS_BAND >= goodToWeak) {
    throw new Error('CLOSENESS_BAND must be smaller than every seed-label gap');
  }
  if (OPTIONS_PER_PHASE_CAP < MIN_OPTIONS_PER_PHASE) {
    throw new Error(
      'OPTIONS_PER_PHASE_CAP must be at least MIN_OPTIONS_PER_PHASE',
    );
  }
}

assertRoutingConstantInvariants();
