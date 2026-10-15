/**
 * Decision-model requests (data-flow steps 8 and 9, Requirements 12.2-12.6).
 *
 * One request is fitted under the byte cap by shrinking every phase to the
 * same option width, stopping at two options. Below that the request is not
 * sent. There are no retries. A live 404/405 is reported as `notFound` for
 * the caller to re-check; this module never persists a mark.
 */
import type { LaneRoutingLogger } from '../lane-routing-logger';
import {
  DECISION_REQUEST_TIMEOUT_MS,
  MIN_OPTIONS_PER_PHASE,
  OPTIONS_PER_PHASE_CAP,
  PROVIDER_OPTION_LIMIT,
  type DecisionOptionProvider,
} from '../routing-constants';
import {
  buildDecisionPayload,
  formatDecisionOptionLabel,
  type DecisionOption,
  type DecisionPayload,
} from '../decision-model/decision-payload';
import type { SystemOneTarget } from '../decision-model/decision-model.config';
import type { StructuredDecisionCompleter } from '../decision-model/structured-decision.port';
import {
  SystemOneClient,
  type SystemOneCallResult,
  type SystemOneClientOptions,
} from '../decision-model/system-one.client';
import type { FallbackCause } from '../reasons/compile-reasons';
import type { ChoiceValidation } from './answer-validation';
import {
  askedFromFixed,
  askedFromLane,
  callStructured,
  callSystemOne,
  emptyOutcome,
} from './model-call';

const encoder = new TextEncoder();

/** What the pipeline needs from a System One client. Tests stub this. */
export interface SystemOneCaller {
  decide(payload: DecisionPayload): Promise<SystemOneCallResult>;
}

export interface LaneQuestion {
  readonly phaseId: string;
  readonly instructions: string;
  /** Ranked options, rotation pick first. The fit slices this list. */
  readonly options: readonly DecisionOption[];
}

export interface FixedQuestion {
  readonly key: string;
  readonly instructions: string;
  /** Label `o1..` to criterion text. The enum is not shrunk. */
  readonly criteria: Readonly<Record<string, string>>;
}

export interface ModelRequestOutcome {
  readonly sent: boolean;
  readonly succeeded: boolean;
  /** Shared cause when the request was not sent or the whole response failed. */
  readonly requestCause: FallbackCause | null;
  /** Set only for a live HTTP 404/405. The pipeline re-checks; it does not mark. */
  readonly notFoundDetail: string | null;
  readonly answers: ReadonlyMap<string, ChoiceValidation>;
  /** Options actually offered, in label order. Empty when the request was not sent. */
  readonly offered: ReadonlyMap<string, readonly DecisionOption[]>;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}

export type ModelDispatch =
  | {
      readonly kind: 'system-one';
      readonly caller: SystemOneCaller;
      readonly model: string;
    }
  | {
      readonly kind: 'structured';
      readonly completer: StructuredDecisionCompleter;
      readonly providerId: string;
      readonly model: string;
      readonly signal: AbortSignal;
    };

/** Client options for one System One call. The timeout is the routing constant. */
export function systemOneClientOptions(
  target: SystemOneTarget,
): SystemOneClientOptions {
  return {
    baseUrl: target.baseUrl,
    model: target.model,
    timeoutMs: DECISION_REQUEST_TIMEOUT_MS,
    ...(target.apiKey !== undefined ? { apiKey: target.apiKey } : {}),
  };
}

/** Default caller. The pipeline passes `DECISION_REQUEST_TIMEOUT_MS`. */
export function openSystemOne(
  target: SystemOneTarget,
  logger: LaneRoutingLogger,
): SystemOneClient {
  return new SystemOneClient(systemOneClientOptions(target), { logger });
}

export async function runLaneRequest(input: {
  readonly provider: DecisionOptionProvider;
  readonly request: string;
  readonly phases: readonly LaneQuestion[];
  readonly maxRequestBytes: number;
  readonly dispatch: ModelDispatch;
  readonly logger: LaneRoutingLogger;
}): Promise<ModelRequestOutcome> {
  const fitted = fitLane(input);
  if (fitted === null) {
    return emptyOutcome('payload-too-large');
  }
  const asked = askedFromLane(input.phases, fitted.offered);
  if (input.dispatch.kind === 'system-one') {
    return callSystemOne(
      input.dispatch.caller,
      fitted.payload,
      fitted.offered,
      asked,
    );
  }
  return callStructured(
    input.dispatch,
    fitted.prompt,
    fitted.schema,
    fitted.offered,
    asked,
    input.logger,
  );
}

export async function runFixedRequest(input: {
  readonly request: string;
  readonly questions: readonly FixedQuestion[];
  readonly maxRequestBytes: number;
  readonly dispatch: ModelDispatch;
  readonly logger: LaneRoutingLogger;
}): Promise<ModelRequestOutcome> {
  const payload = buildDecisionPayload({
    request: input.request,
    questions: input.questions.map((question) => ({
      kind: 'fixed-criteria',
      phaseId: question.key,
      instructions: question.instructions,
      criteria: question.criteria,
    })),
    outcomeFigures: [],
  });
  const prompt = renderPrompt(input.request, input.questions);
  const schema = fixedSchema(input.questions);
  const model = input.dispatch.model;
  const bytes =
    input.dispatch.kind === 'system-one'
      ? bodyBytes(model, payload)
      : textBytes(JSON.stringify({ prompt, jsonSchema: schema }));
  if (bytes > input.maxRequestBytes) {
    return emptyOutcome('payload-too-large');
  }
  const offered = new Map<string, readonly DecisionOption[]>();
  const asked = askedFromFixed(input.questions);
  if (input.dispatch.kind === 'system-one') {
    return callSystemOne(input.dispatch.caller, payload, offered, asked);
  }
  return callStructured(
    input.dispatch,
    prompt,
    schema,
    offered,
    asked,
    input.logger,
  );
}

/** `o1` is index 0. A label that is not `oN` has no index. */
export function optionIndex(label: string): number | null {
  const match = /^o(\d+)$/.exec(label);
  if (match === null) return null;
  const index = Number(match[1]) - 1;
  return index >= 0 ? index : null;
}

export function criterionLabels(
  values: readonly string[],
): Record<string, string> {
  const criteria: Record<string, string> = {};
  values.forEach((value, index) => {
    criteria[`o${index + 1}`] = value;
  });
  return criteria;
}

interface FittedLane {
  readonly payload: DecisionPayload;
  readonly prompt: string;
  readonly schema: Record<string, unknown>;
  readonly offered: ReadonlyMap<string, readonly DecisionOption[]>;
}

function fitLane(input: {
  readonly provider: DecisionOptionProvider;
  readonly request: string;
  readonly phases: readonly LaneQuestion[];
  readonly maxRequestBytes: number;
  readonly dispatch: ModelDispatch;
}): FittedLane | null {
  const cap = Math.min(
    OPTIONS_PER_PHASE_CAP,
    PROVIDER_OPTION_LIMIT[input.provider],
  );
  for (let width = cap; width >= MIN_OPTIONS_PER_PHASE; width -= 1) {
    const offered = sliceOptions(input.phases, width);
    const payload = buildDecisionPayload({
      request: input.request,
      questions: input.phases.map((phase) => ({
        kind: 'lane-choice' as const,
        phaseId: phase.phaseId,
        instructions: phase.instructions,
        options: offered.get(phase.phaseId) ?? [],
      })),
      outcomeFigures: [],
    });
    const questions = laneQuestions(input.phases, offered);
    const prompt = renderLanePrompt(input.request, questions);
    const schema = choiceSchema(questions);
    const bytes =
      input.dispatch.kind === 'system-one'
        ? bodyBytes(input.dispatch.model, payload)
        : textBytes(JSON.stringify({ prompt, jsonSchema: schema }));
    if (bytes <= input.maxRequestBytes) {
      return { payload, prompt, schema, offered };
    }
  }
  return null;
}

function sliceOptions(
  phases: readonly LaneQuestion[],
  width: number,
): Map<string, readonly DecisionOption[]> {
  const offered = new Map<string, readonly DecisionOption[]>();
  for (const phase of phases) {
    offered.set(phase.phaseId, phase.options.slice(0, width));
  }
  return offered;
}

function laneQuestions(
  phases: readonly LaneQuestion[],
  offered: ReadonlyMap<string, readonly DecisionOption[]>,
): readonly {
  readonly phaseId: string;
  readonly instructions: string;
  readonly options: readonly DecisionOption[];
}[] {
  return phases.map((phase) => ({
    phaseId: phase.phaseId,
    instructions: phase.instructions,
    options: offered.get(phase.phaseId) ?? [],
  }));
}

function bodyBytes(model: string, payload: DecisionPayload): number {
  return textBytes(
    JSON.stringify({
      model,
      state: payload.state,
      questions: payload.questions,
    }),
  );
}

function textBytes(value: string): number {
  return encoder.encode(value).byteLength;
}

function renderLanePrompt(
  request: string,
  questions: readonly {
    readonly phaseId: string;
    readonly instructions: string;
    readonly options: readonly DecisionOption[];
  }[],
): string {
  const lines = [request];
  for (const question of questions) {
    lines.push(question.instructions);
    question.options.forEach((option, index) => {
      lines.push(`o${index + 1}: ${formatDecisionOptionLabel(option)}`);
    });
  }
  return lines.join('\n');
}

function renderPrompt(
  request: string,
  questions: readonly FixedQuestion[],
): string {
  const lines = [request];
  for (const question of questions) {
    lines.push(question.instructions);
    for (const [label, text] of Object.entries(question.criteria)) {
      lines.push(`${label}: ${text}`);
    }
  }
  return lines.join('\n');
}

function choiceSchema(
  questions: readonly {
    readonly phaseId: string;
    readonly options: readonly DecisionOption[];
  }[],
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const question of questions) {
    properties[question.phaseId] = {
      type: 'string',
      enum: question.options.map((_, index) => `o${index + 1}`),
    };
    required.push(question.phaseId);
  }
  return { type: 'object', additionalProperties: false, properties, required };
}

function fixedSchema(
  questions: readonly FixedQuestion[],
): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const question of questions) {
    properties[question.key] = {
      type: 'string',
      enum: Object.keys(question.criteria),
    };
    required.push(question.key);
  }
  return { type: 'object', additionalProperties: false, properties, required };
}
