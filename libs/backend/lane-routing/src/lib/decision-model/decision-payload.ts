import type { LaneLimitState } from '@ptah-extension/shared';
import type { SystemOneQuestions, SystemOneState } from './system-one.schema';

/** Request text is capped at the payload boundary (NFR Security, part A §12). */
export const REQUEST_TEXT_MAX_CHARS = 8000;

/** One offered (executor, model) pair with the facts its label may carry. */
export interface DecisionOption {
  readonly laneId: string;
  readonly family: string;
  readonly model: string;
  readonly limitState: LaneLimitState;
  readonly score: number;
}

/** A phase question whose options are ranked lane entries, labelled `o1..oN` in order. */
export interface LaneChoiceQuestionInput {
  readonly kind: 'lane-choice';
  readonly phaseId: string;
  readonly instructions: string;
  /** Top P with the rotation pick first (part A §6 step 8). */
  readonly options: readonly DecisionOption[];
}

/** A question with caller-authored criteria (pre-flight `task_type`, `depth`). */
export interface FixedCriteriaQuestionInput {
  readonly kind: 'fixed-criteria';
  readonly phaseId: string;
  readonly instructions: string;
  readonly criteria: Readonly<Record<string, string>>;
}

export type DecisionQuestionInput =
  LaneChoiceQuestionInput | FixedCriteriaQuestionInput;

/** Aggregated outcome figures for one lane and task kind. */
export interface DecisionOutcomeFigures {
  readonly laneId: string;
  readonly taskKind: string;
  readonly delivered: number;
  readonly failed: number;
}

export interface DecisionPayloadInput {
  readonly request: string;
  readonly questions: readonly DecisionQuestionInput[];
  readonly outcomeFigures: readonly DecisionOutcomeFigures[];
}

/** Request pieces the builder emits; the client adds the `model` field. */
export interface DecisionPayload {
  readonly state: SystemOneState;
  readonly questions: SystemOneQuestions;
}

/** The option text a `choice` criterion carries. Pinned by `decision-payload.spec.ts`. */
export function formatDecisionOptionLabel(option: DecisionOption): string {
  return [
    `lane ${option.laneId}`,
    `family ${option.family}`,
    `model ${option.model}`,
    `limit state ${option.limitState}`,
    `score ${option.score}`,
  ].join(', ');
}

/**
 * Build the System One request payload.
 *
 * Emits ONLY the pinned field set (NFR Security): request text, option labels
 * (lane id, family, model, limit state, score) and aggregated outcome
 * figures. The return value is built from scratch, so nothing else on the
 * input object can leave the machine through this function.
 */
export function buildDecisionPayload(
  input: DecisionPayloadInput,
): DecisionPayload {
  const state: SystemOneState = {
    request: input.request.slice(0, REQUEST_TEXT_MAX_CHARS),
    availableExecutors: {},
    pastOutcomes: {},
  };
  const questions: SystemOneQuestions = {};

  for (const question of input.questions) {
    const criteria: Record<string, string> = {};
    if (question.kind === 'lane-choice') {
      question.options.forEach((option, index) => {
        criteria[`o${index + 1}`] = formatDecisionOptionLabel(option);
        // Roster entry on first appearance: per-phase scores differ, and the
        // criteria labels stay authoritative for each question.
        if (!(option.laneId in state.availableExecutors)) {
          state.availableExecutors[option.laneId] = {
            family: option.family,
            model: option.model,
            limitState: option.limitState,
            score: option.score,
          };
        }
      });
    } else {
      Object.assign(criteria, question.criteria);
    }
    questions[question.phaseId] = {
      type: 'choice',
      instructions: question.instructions,
      criteria,
    };
  }

  for (const figures of input.outcomeFigures) {
    state.pastOutcomes[`${figures.laneId}/${figures.taskKind}`] = {
      delivered: figures.delivered,
      failed: figures.failed,
    };
  }

  return { state, questions };
}
