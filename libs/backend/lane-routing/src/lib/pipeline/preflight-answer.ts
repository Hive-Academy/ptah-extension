/**
 * Preflight answers and the request usage tally. Task type and depth keep
 * their own value unions.
 */
import { TASK_TYPES } from '@ptah-extension/shared';

import { DEPTHS } from '../contracts/route-decide-args.schema';
import type { PreflightResult } from '../contracts/route-decide-result.schema';
import {
  criterionLabels,
  optionIndex,
  type FixedQuestion,
  type ModelRequestOutcome,
} from './model-refine';
import type { PreflightAnswerFacts } from '../reasons/compile-reasons';
import type { OpenedCaller } from './phase-plan';

export interface UsageTally {
  requests: number;
  input: number | null;
  output: number | null;
  successes: number;
}

const PREFLIGHT_QUESTIONS = [
  {
    key: 'task_type',
    name: 'taskType',
    instructions: 'Choose the task type.',
    values: TASK_TYPES,
  },
  {
    key: 'depth',
    name: 'depth',
    instructions: 'Choose the depth.',
    values: DEPTHS,
  },
] as const;

type SharedAnswer = Omit<PreflightResult['taskType'], 'value'>;

export interface PreflightRead {
  readonly taskType: {
    readonly answer: PreflightResult['taskType'];
    readonly facts: PreflightAnswerFacts;
  };
  readonly depth: {
    readonly answer: PreflightResult['depth'];
    readonly facts: PreflightAnswerFacts;
  };
}

export function preflightQuestions(): FixedQuestion[] {
  return PREFLIGHT_QUESTIONS.map((question) => ({
    key: question.key,
    instructions: question.instructions,
    criteria: criterionLabels(question.values),
  }));
}

export function readPreflight(
  caller: OpenedCaller,
  outcome: ModelRequestOutcome | null,
): PreflightRead {
  const taskQuestion = PREFLIGHT_QUESTIONS[0];
  const depthQuestion = PREFLIGHT_QUESTIONS[1];
  return {
    taskType: preflightAnswer(taskQuestion, caller, outcome),
    depth: preflightAnswer(depthQuestion, caller, outcome),
  };
}

export function emptyTally(): UsageTally {
  return { requests: 0, input: 0, output: 0, successes: 0 };
}

export function noteUsage(
  tally: UsageTally,
  outcome: ModelRequestOutcome | null,
): void {
  if (outcome === null || !outcome.sent) return;
  tally.requests += 1;
  if (!outcome.succeeded) return;
  tally.successes += 1;
  if (
    outcome.inputTokens === null ||
    outcome.outputTokens === null ||
    tally.input === null ||
    tally.output === null
  ) {
    tally.input = null;
    tally.output = null;
    return;
  }
  tally.input += outcome.inputTokens;
  tally.output += outcome.outputTokens;
}

export function usageOf(tally: UsageTally): PreflightResult['usage'] {
  return {
    requests: tally.requests,
    inputTokens: tally.successes === 0 ? null : tally.input,
    outputTokens: tally.successes === 0 ? null : tally.output,
    costUsd: null,
  };
}

function preflightAnswer<T extends string>(
  question: {
    readonly key: string;
    readonly name: 'taskType' | 'depth';
    readonly values: readonly T[];
  },
  caller: OpenedCaller,
  outcome: ModelRequestOutcome | null,
): {
  readonly answer: SharedAnswer & { readonly value: T | null };
  readonly facts: PreflightAnswerFacts;
} {
  const blocked = caller.kind === 'blocked' ? caller.cause : null;
  const validation = outcome?.answers.get(question.key);
  const sharedCause =
    outcome === null || !outcome.sent || outcome.requestCause !== null
      ? (outcome?.requestCause ?? blocked)
      : (validation?.cause ?? 'bad-output');
  const choice =
    validation !== undefined && validation.cause === null
      ? validation.choice
      : null;
  const accepted =
    outcome !== null &&
    outcome.sent &&
    outcome.requestCause === null &&
    choice !== null;
  const value = accepted ? labeledValue(question.values, choice) : null;
  const source = accepted && value !== null ? 'model' : 'skill-table';
  const cause = source === 'model' ? null : sharedCause;
  const proposal =
    validation !== undefined && validation.cause === 'low-confidence'
      ? validation.proposal
      : null;
  const confidence =
    source === 'model' && validation !== undefined
      ? validation.confidence
      : null;
  return {
    answer: {
      value,
      source,
      confidence,
      fallbackCause: cause,
      modelProposal: proposal,
    },
    facts: {
      name: question.name,
      source,
      reportedConfidence: confidence,
      fallbackCause: cause,
    },
  };
}

function labeledValue<T extends string>(
  values: readonly T[],
  label: string | null,
): T | null {
  if (label === null) return null;
  const index = optionIndex(label);
  if (index === null) return null;
  const value = values[index];
  return value === undefined ? null : value;
}
