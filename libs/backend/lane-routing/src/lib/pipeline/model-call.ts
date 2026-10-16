/**
 * Sends one fitted decision-model request. A live HTTP 404/405 is reported
 * as `notFoundDetail` and is not marked here.
 */
import type { LaneRoutingLogger } from '../lane-routing-logger';
import type {
  DecisionOption,
  DecisionPayload,
} from '../decision-model/decision-payload';
import type { SystemOneResult } from '../decision-model/system-one.schema';
import type { FallbackCause } from '../reasons/compile-reasons';
import {
  DECISION_REQUEST_TIMEOUT_MS,
  DECISION_RETURN_MARGIN_MS,
} from '../routing-constants';
import {
  validateChoiceAnswer,
  type ChoiceValidation,
} from './answer-validation';
import type {
  FixedQuestion,
  LaneQuestion,
  ModelDispatch,
  ModelRequestOutcome,
  SystemOneCaller,
} from './model-refine';

interface AskedQuestion {
  readonly phaseId: string;
  readonly labels: readonly string[];
}

export function emptyOutcome(cause: FallbackCause): ModelRequestOutcome {
  return {
    sent: false,
    succeeded: false,
    requestCause: cause,
    notFoundDetail: null,
    answers: new Map(),
    offered: new Map(),
    inputTokens: null,
    outputTokens: null,
  };
}

export function askedFromLane(
  phases: readonly LaneQuestion[],
  offered: ReadonlyMap<string, readonly DecisionOption[]>,
): readonly AskedQuestion[] {
  return phases.map((phase) => ({
    phaseId: phase.phaseId,
    labels: (offered.get(phase.phaseId) ?? []).map(
      (_, index) => `o${index + 1}`,
    ),
  }));
}

export function askedFromFixed(
  questions: readonly FixedQuestion[],
): readonly AskedQuestion[] {
  return questions.map((question) => ({
    phaseId: question.key,
    labels: Object.keys(question.criteria),
  }));
}

export async function callSystemOne(
  caller: SystemOneCaller,
  payload: DecisionPayload,
  offered: ReadonlyMap<string, readonly DecisionOption[]>,
  questions: readonly AskedQuestion[],
): Promise<ModelRequestOutcome> {
  const result = await caller.decide(payload);
  if (!result.ok) {
    return {
      sent: true,
      succeeded: false,
      requestCause: result.cause,
      notFoundDetail: result.notFound ? result.detail : null,
      answers: new Map(),
      offered,
      inputTokens: null,
      outputTokens: null,
    };
  }
  const usage = result.result.usage;
  return {
    sent: true,
    succeeded: true,
    requestCause: null,
    notFoundDetail: null,
    answers: answersFromSystemOne(result.result, questions),
    offered,
    inputTokens: tokenCount(usage?.input_tokens),
    outputTokens: tokenCount(usage?.output_tokens),
  };
}

export async function callStructured(
  dispatch: Extract<ModelDispatch, { kind: 'structured' }>,
  prompt: string,
  schema: Record<string, unknown>,
  offered: ReadonlyMap<string, readonly DecisionOption[]>,
  questions: readonly AskedQuestion[],
  logger: LaneRoutingLogger,
): Promise<ModelRequestOutcome> {
  const pending = dispatch.completer.complete({
    providerId: dispatch.providerId,
    model: dispatch.model,
    prompt,
    jsonSchema: schema,
    signal: dispatch.signal,
  });
  let payload: unknown;
  try {
    const raced = await raceDeadline(
      pending,
      STRUCTURED_DEADLINE_MS,
      (error) => {
        logger.warn(
          '[lane-routing] structured decision rejected after the deadline',
          structuredFacts(error),
        );
      },
    );
    if (raced.expired) {
      return {
        sent: true,
        succeeded: false,
        requestCause: 'timeout',
        notFoundDetail: null,
        answers: new Map(),
        offered,
        inputTokens: null,
        outputTokens: null,
      };
    }
    payload = raced.value;
  } catch (error: unknown) {
    logger.warn(
      '[lane-routing] structured decision failed',
      structuredFacts(error),
    );
    return {
      sent: true,
      succeeded: false,
      requestCause: structuredCause(error),
      notFoundDetail: null,
      answers: new Map(),
      offered,
      inputTokens: null,
      outputTokens: null,
    };
  }
  const record = stringRecord(payload);
  if (record === null) {
    return {
      sent: true,
      succeeded: true,
      requestCause: 'bad-output',
      notFoundDetail: null,
      answers: new Map(),
      offered,
      inputTokens: null,
      outputTokens: null,
    };
  }
  return {
    sent: true,
    succeeded: true,
    requestCause: null,
    notFoundDetail: null,
    answers: answersFromRecord(record, questions),
    offered,
    inputTokens: null,
    outputTokens: null,
  };
}

function answersFromSystemOne(
  result: SystemOneResult,
  questions: readonly AskedQuestion[],
): Map<string, ChoiceValidation> {
  const answers = new Map<string, ChoiceValidation>();
  for (const question of questions) {
    const answer = result.answers[question.phaseId];
    const labels = new Set(question.labels);
    answers.set(
      question.phaseId,
      validateChoiceAnswer({
        choice: answer?.choice,
        confidence: answer === undefined ? null : reportedConfidence(answer),
        offered: labels,
      }),
    );
  }
  return answers;
}

function answersFromRecord(
  record: Readonly<Record<string, string>>,
  questions: readonly AskedQuestion[],
): Map<string, ChoiceValidation> {
  const answers = new Map<string, ChoiceValidation>();
  for (const question of questions) {
    answers.set(
      question.phaseId,
      validateChoiceAnswer({
        choice: record[question.phaseId],
        confidence: null,
        offered: new Set(question.labels),
      }),
    );
  }
  return answers;
}

function reportedConfidence(answer: {
  readonly choice: string;
  readonly confidence?: number;
  readonly probabilities?: Readonly<Record<string, number>>;
}): number | null {
  if (typeof answer.confidence === 'number') return answer.confidence;
  const probabilities = answer.probabilities;
  if (probabilities === undefined) return null;
  const value = probabilities[answer.choice];
  return typeof value === 'number' ? value : null;
}

function tokenCount(value: number | undefined): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return null;
  }
  return value;
}

function stringRecord(payload: unknown): Record<string, string> | null {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return null;
  }
  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value === 'string') record[key] = value;
  }
  return record;
}

const STRUCTURED_DEADLINE_MS =
  DECISION_REQUEST_TIMEOUT_MS + DECISION_RETURN_MARGIN_MS;

/**
 * The completer promise against the routing deadline. A late rejection is
 * logged and not rethrown. The timer is cleared on every exit.
 */
function raceDeadline(
  work: Promise<unknown>,
  budgetMs: number,
  onLateRejection: (error: unknown) => void,
): Promise<
  | { readonly expired: true }
  | { readonly expired: false; readonly value: unknown }
> {
  const deadlineWon = { current: false };
  const guarded = work.then(
    (value) => value,
    (error: unknown) => {
      if (deadlineWon.current) {
        onLateRejection(error);
        return undefined;
      }
      throw error;
    },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(() => resolve(), budgetMs);
  });
  const finish = async (): Promise<
    | { readonly expired: true }
    | { readonly expired: false; readonly value: unknown }
  > => {
    const winner = await Promise.race([
      guarded.then((value) => ({ expired: false as const, value })),
      deadline.then(() => ({ expired: true as const })),
    ]);
    if (winner.expired) {
      deadlineWon.current = true;
      return { expired: true };
    }
    return { expired: false, value: winner.value };
  };
  return finish().finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function structuredCause(error: unknown): FallbackCause {
  if (readName(error) === 'AbortError') return 'timeout';
  if (readName(error) !== 'StructuredDecisionError') return 'provider-error';
  const kind = readKind(error);
  if (kind === 'auth' || kind === 'unreachable' || kind === 'bad-output') {
    return kind;
  }
  return 'provider-error';
}

function structuredFacts(error: unknown): {
  readonly name: string;
  readonly kind?: string;
} {
  const name = readName(error) ?? 'UnknownError';
  const kind = readKind(error);
  return kind === undefined ? { name } : { name, kind };
}

function readName(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('name' in error)) {
    return undefined;
  }
  const name = error['name'];
  return typeof name === 'string' ? name : undefined;
}

function readKind(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('kind' in error)) {
    return undefined;
  }
  const kind = error['kind'];
  return typeof kind === 'string' ? kind : undefined;
}
