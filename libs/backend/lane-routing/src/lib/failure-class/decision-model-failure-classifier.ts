/**
 * Decision-model failure classifier (SC-4, Req 10.3 / 12.5).
 *
 * One choice question whose options are `LANE_FAILURE_CLASSES`, with the
 * classification input as `state`. At most one decision-model request.
 * Unset selection makes none. The call never rejects: a transport failure,
 * a confidence below the threshold, or an answer outside the five classes
 * is null.
 *
 * The payload is built from scratch. Only the pinned field set can leave
 * the machine (NFR Security). Acceptance is `validateChoiceAnswer`
 * (threshold 0.5, strict less-than, null confidence is not low).
 */
import {
  LANE_FAILURE_CLASSES,
  type LaneFailureClass,
  type LaneFailureClassificationInput,
  type LaneFailureClassifier,
} from '@ptah-extension/shared';

import { systemOneUrl } from '../decision-model/decision-endpoint.url';
import type { DecisionModelConfig } from '../decision-model/decision-model.config';
import type { DecisionModelSelection } from '../decision-model/decision-model.types';
import type {
  StructuredDecisionCompleter,
  StructuredDecisionRequest,
} from '../decision-model/structured-decision.port';
import {
  SYSTEM_ONE_PATH,
  type SystemOneFetch,
} from '../decision-model/system-one.client';
import { SystemOneResultSchema } from '../decision-model/system-one.schema';
import type { LaneRoutingLogger } from '../lane-routing-logger';
import { validateChoiceAnswer } from '../pipeline/answer-validation';
import {
  DECISION_REQUEST_TIMEOUT_MS,
  DECISION_RETURN_MARGIN_MS,
  REQUEST_SIZE_LIMIT_BYTES,
} from '../routing-constants';

/** Question key for the single failure-class choice. */
export const FAILURE_CLASS_QUESTION_KEY = 'failureClass' as const;

const FAILURE_CLASS_INSTRUCTIONS =
  'Classify this lane failure. Choose only one of the offered classes.';

const FAILURE_CLASS_OPTIONS: ReadonlySet<string> = new Set(
  LANE_FAILURE_CLASSES,
);

/**
 * Per-request abort budget of a structured call: the routing timeout plus
 * the return margin. A System One call uses its target's own budget,
 * `target.timeoutMs + DECISION_RETURN_MARGIN_MS` (DC8).
 */
export const FAILURE_CLASSIFICATION_TIMEOUT_MS =
  DECISION_REQUEST_TIMEOUT_MS + DECISION_RETURN_MARGIN_MS;

const encoder = new TextEncoder();

/** Ids, enums and numbers copied off the classification input. No text. */
export interface FailureClassificationState {
  readonly runId: string;
  readonly executorKind: LaneFailureClassificationInput['executorKind'];
  readonly family: string;
  readonly status: LaneFailureClassificationInput['status'];
  readonly verdict: LaneFailureClassificationInput['verdict'];
  readonly failureKind: string | null;
  readonly exitCode: number | null;
  readonly durationMs: number | null;
}

export interface FailureClassificationQuestion {
  readonly type: 'choice';
  readonly instructions: string;
  readonly criteria: Readonly<Record<string, string>>;
}

/**
 * What one classification request carries. `state` is the input. The only
 * question offers the five failure classes.
 */
export interface FailureClassificationPayload {
  readonly state: FailureClassificationState;
  readonly questions: {
    readonly [FAILURE_CLASS_QUESTION_KEY]: FailureClassificationQuestion;
  };
}

export interface FailureClassifierSeams {
  /** System One transport. Node's global `fetch` when omitted. */
  readonly fetch?: SystemOneFetch;
  /** Overrides every per-request budget (structured and System One). */
  readonly timeoutMs?: number;
}

export interface DecisionModelFailureClassifierDependencies {
  readonly config: DecisionModelConfig;
  readonly logger: LaneRoutingLogger;
  /** Present only when the host registered `STRUCTURED_DECISION`. */
  readonly structured?: StructuredDecisionCompleter;
  readonly seams?: FailureClassifierSeams;
}

type StructuredSelection = Extract<
  DecisionModelSelection,
  { kind: 'structured' }
>;
/** Every kind that calls a `/v1/systemone` endpoint. */
type SystemOneSelection = Exclude<
  DecisionModelSelection,
  { kind: 'unset' | 'structured' }
>;

/**
 * `LANE_ROUTING_TOKENS.FAILURE_CLASSIFIER`. Plain class: the register
 * function builds it with `useFactory` because the structured port is
 * optional.
 */
export class DecisionModelFailureClassifier implements LaneFailureClassifier {
  constructor(
    private readonly deps: DecisionModelFailureClassifierDependencies,
  ) {}

  async classify(
    input: LaneFailureClassificationInput,
  ): Promise<LaneFailureClass | null> {
    let failureClass: LaneFailureClass | null = null;
    try {
      failureClass = await this.classifyOnce(input);
    } catch (error: unknown) {
      this.deps.logger.warn(
        '[lane-routing] failure classification failed',
        classificationErrorFacts(input.runId, error),
      );
    }
    return failureClass;
  }

  private async classifyOnce(
    input: LaneFailureClassificationInput,
  ): Promise<LaneFailureClass | null> {
    const selection = this.deps.config.getSelection();
    if (selection.kind === 'unset') return null;
    const payload = buildFailureClassificationPayload(input);
    if (selection.kind === 'structured') {
      return this.classifyStructured(selection, payload, input.runId);
    }
    return this.classifySystemOne(selection, payload, input.runId);
  }

  private async classifyStructured(
    selection: StructuredSelection,
    payload: FailureClassificationPayload,
    runId: string,
  ): Promise<LaneFailureClass | null> {
    const structured = this.deps.structured;
    if (structured === undefined) {
      this.deps.logger.warn(
        '[lane-routing] structured decision port is not registered',
        { runId, providerId: selection.providerId },
      );
      return null;
    }
    const prompt = JSON.stringify(payload);
    const jsonSchema = failureClassificationSchema();
    const bytes = encoder.encode(
      JSON.stringify({ prompt, jsonSchema }),
    ).byteLength;
    if (bytes > REQUEST_SIZE_LIMIT_BYTES) {
      this.deps.logger.warn(
        '[lane-routing] failure classification payload is too large',
        { runId, bodyBytes: bytes },
      );
      return null;
    }
    const budgetMs = this.timeoutMs();
    const request: StructuredDecisionRequest = {
      providerId: selection.providerId,
      model: selection.model,
      prompt,
      jsonSchema,
      signal: AbortSignal.timeout(budgetMs),
    };
    const pending = structured.complete(request);
    const raced = await raceClassification(pending, budgetMs, (error) => {
      this.deps.logger.warn(
        '[lane-routing] failure classification rejected after the deadline',
        classificationErrorFacts(runId, error),
      );
    });
    if (raced.expired) return null;
    return acceptedFailureClass(raced.value);
  }

  private async classifySystemOne(
    selection: SystemOneSelection,
    payload: FailureClassificationPayload,
    runId: string,
  ): Promise<LaneFailureClass | null> {
    const target = await this.deps.config.resolveSystemOneTarget();
    if (target === null) {
      this.deps.logger.warn(
        '[lane-routing] failure classification has no system one target',
        { runId },
      );
      return null;
    }
    if (selection.kind === 'jev' && target.apiKey === undefined) {
      this.deps.logger.warn(
        '[lane-routing] failure classification has no jev credential',
        { runId },
      );
      return null;
    }
    const body = JSON.stringify({
      model: target.model,
      state: payload.state,
      questions: payload.questions,
    });
    const bodyBytes = encoder.encode(body).byteLength;
    if (bodyBytes > REQUEST_SIZE_LIMIT_BYTES) {
      this.deps.logger.warn(
        '[lane-routing] failure classification payload is too large',
        { runId, bodyBytes },
      );
      return null;
    }
    const signal = AbortSignal.timeout(
      this.timeoutMs(target.timeoutMs + DECISION_RETURN_MARGIN_MS),
    );
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (target.apiKey !== undefined) {
      headers['authorization'] = `Bearer ${target.apiKey}`;
    }
    const response = await this.transport()(
      systemOneUrl(target.baseUrl, SYSTEM_ONE_PATH),
      { method: 'POST', headers, body, signal },
    );
    const bodyText = await response.text();
    if (response.status === 401 || response.status === 403) {
      this.deps.logger.warn(
        '[lane-routing] failure classification was rejected',
        { runId, cause: 'auth', status: response.status },
      );
      return null;
    }
    if (!response.ok) {
      this.deps.logger.warn(
        '[lane-routing] failure classification was rejected',
        { runId, cause: 'provider-error', status: response.status },
      );
      return null;
    }
    const parsed = parseJsonBody(bodyText, runId, this.deps.logger);
    if (parsed === undefined) return null;
    const validated = SystemOneResultSchema.safeParse(parsed);
    if (!validated.success) {
      this.deps.logger.warn(
        '[lane-routing] failure classification answer was rejected',
        { runId, cause: 'bad-output' },
      );
      return null;
    }
    return acceptedFailureClass(validated.data);
  }

  /** The seam's budget when set, else `defaultMs`. */
  private timeoutMs(defaultMs = FAILURE_CLASSIFICATION_TIMEOUT_MS): number {
    return this.deps.seams?.timeoutMs ?? defaultMs;
  }

  private transport(): SystemOneFetch {
    return this.deps.seams?.fetch ?? fetch;
  }
}

/**
 * Copy the classification input onto a fresh object. Anything else on the
 * argument stays off the payload.
 */
export function buildFailureClassificationPayload(
  input: LaneFailureClassificationInput,
): FailureClassificationPayload {
  const criteria: Record<string, string> = {};
  for (const failureClass of LANE_FAILURE_CLASSES) {
    criteria[failureClass] = failureClass;
  }
  const question: FailureClassificationQuestion = {
    type: 'choice',
    instructions: FAILURE_CLASS_INSTRUCTIONS,
    criteria,
  };
  return {
    state: {
      runId: input.runId,
      executorKind: input.executorKind,
      family: input.family,
      status: input.status,
      verdict: input.verdict,
      failureKind: input.failureKind,
      exitCode: input.exitCode,
      durationMs: input.durationMs,
    },
    questions: { [FAILURE_CLASS_QUESTION_KEY]: question },
  };
}

/** JSON schema for the structured-output path. One enum, no extra fields. */
export function failureClassificationSchema(): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  properties[FAILURE_CLASS_QUESTION_KEY] = {
    type: 'string',
    enum: [...LANE_FAILURE_CLASSES],
  };
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    required: [FAILURE_CLASS_QUESTION_KEY],
  };
}

/**
 * Map a model answer to a class, or null. Reads a flat structured object
 * (`{ failureClass, confidence? }`) or a System One envelope
 * (`{ answers: { failureClass: { choice, confidence?, probabilities? } } }`).
 */
export function acceptedFailureClass(
  payload: unknown,
): LaneFailureClass | null {
  const reported = readReportedChoice(payload);
  const validation = validateChoiceAnswer({
    choice: reported.choice,
    confidence: reported.confidence,
    offered: FAILURE_CLASS_OPTIONS,
  });
  if (validation.cause !== null || validation.choice === null) return null;
  return isLaneFailureClass(validation.choice) ? validation.choice : null;
}

function readReportedChoice(payload: unknown): {
  readonly choice: string | undefined;
  readonly confidence: number | null;
} {
  if (!isRecord(payload)) return { choice: undefined, confidence: null };
  const direct = readChoiceNode(payload[FAILURE_CLASS_QUESTION_KEY], payload);
  if (direct.choice !== undefined) return direct;
  const answers = payload['answers'];
  if (!isRecord(answers)) return { choice: undefined, confidence: null };
  return readChoiceNode(answers[FAILURE_CLASS_QUESTION_KEY], answers);
}

function readChoiceNode(
  value: unknown,
  sibling: Readonly<Record<string, unknown>>,
): {
  readonly choice: string | undefined;
  readonly confidence: number | null;
} {
  if (typeof value === 'string') {
    return { choice: value, confidence: reportedConfidence(sibling, value) };
  }
  if (!isRecord(value)) return { choice: undefined, confidence: null };
  const choice = value['choice'];
  if (typeof choice !== 'string') {
    return { choice: undefined, confidence: null };
  }
  return { choice, confidence: reportedConfidence(value, choice) };
}

/** Provider confidence, else the probability of the chosen option. */
function reportedConfidence(
  answer: Readonly<Record<string, unknown>>,
  choice: string,
): number | null {
  const confidence = answer['confidence'];
  if (typeof confidence === 'number') return confidence;
  const probabilities = answer['probabilities'];
  if (!isRecord(probabilities)) return null;
  const value = probabilities[choice];
  return typeof value === 'number' ? value : null;
}

function isLaneFailureClass(value: string): value is LaneFailureClass {
  for (const failureClass of LANE_FAILURE_CLASSES) {
    if (failureClass === value) return true;
  }
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `undefined` when the body is not JSON. A parse failure is logged once. */
function parseJsonBody(
  bodyText: string,
  runId: string,
  logger: LaneRoutingLogger,
): unknown | undefined {
  let parsed: unknown = undefined;
  let invalid = false;
  try {
    parsed = JSON.parse(bodyText);
  } catch (error: unknown) {
    invalid = true;
    logger.warn(
      '[lane-routing] failure classification response is not json',
      classificationErrorFacts(runId, error),
    );
  }
  if (invalid) return undefined;
  return parsed;
}

/**
 * The structured completer against the classification deadline. A late
 * rejection is logged. The timer is cleared on every exit. The deadline is
 * `DECISION_REQUEST_TIMEOUT_MS + DECISION_RETURN_MARGIN_MS` unless a seam
 * overrides `timeoutMs`.
 */
function raceClassification(
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

function classificationErrorFacts(
  runId: string,
  error: unknown,
): { readonly runId: string; readonly name: string } {
  return {
    runId,
    name: error instanceof Error ? error.name : 'UnknownError',
  };
}
