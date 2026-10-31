/**
 * Route-decide pipeline (part A §6, Batch 21).
 *
 * Gather, constrain, score, spread, then at most two decision-model
 * requests. A live System One 404/405 is handed to
 * `recheckAfterLiveNotFound`. This service never calls `markUnsupported`
 * (decision #46, R3-2).
 */
import {
  GateResultSchema,
  PreflightResultSchema,
  type GateResult,
  type PreflightResult,
  type RouteDecideResult,
} from './contracts/route-decide-result.schema';
import {
  RouteDecideArgsSchema,
  type RouteDecideArgs,
} from './contracts/route-decide-args.schema';
import {
  loggableErrorName,
  type LoggableErrorName,
} from '@ptah-extension/shared';
import type { DecisionModelConfig } from './decision-model/decision-model.config';
import { DecisionCaller } from './decision-model/decision-caller';
import type { StructuredDecisionCompleter } from './decision-model/structured-decision.port';
import type { SystemOneClientOptions } from './decision-model/system-one.client';
import type { LaneModelListing } from './lane-model-listing.port';
import type { LaneRoutingLogger } from './lane-routing-logger';
import type { RouteCandidateSource } from './route-candidate-source.port';
import { assembleGateResult } from './pipeline/assemble-gate';
import {
  emptyTally,
  noteUsage,
  preflightQuestions,
  readPreflight,
  usageOf,
} from './pipeline/preflight-answer';
import {
  gatherRouteCall,
  type GatheredCall,
  type RouteMatrix,
  type RouteRotation,
} from './pipeline/gather';
import {
  runFixedRequest,
  runLaneRequest,
  type ModelRequestOutcome,
  type SystemOneCaller,
} from './pipeline/model-refine';
import {
  dispatchMode,
  implementersOf,
  isReviewPhase,
  laneQuestion,
  planRoutePhases,
  storePass,
  type DispatchMode,
  type GateArgs,
  type OpenedCaller,
  type PassContext,
  type PhasePlan,
  type PhaseResolution,
} from './pipeline/phase-plan';
import { isSendable } from './pipeline/phase-resolve';
import type { RoutingCandidate } from './ranking/candidate.types';
import {
  emptyRotationState,
  rotationKey,
  withPick,
} from './ranking/rotation.store';
import { overallConfidence } from './reasons/confidence';
import { compilePreflightReasons } from './reasons/compile-reasons';
import type { PreflightReuseCache } from './scope/preflight-reuse-cache';
import {
  MODEL_LISTING_BUDGET_MS,
  QUESTIONS_PER_REQUEST,
  REQUEST_SIZE_LIMIT_BYTES,
} from './routing-constants';

export interface RouteDecideSeams {
  readonly now?: () => number;
  readonly maxRequestBytes?: number;
  readonly listingBudgetMs?: number;
  /** Receives the options the default client would use, including the timeout. */
  readonly systemOne?: (options: SystemOneClientOptions) => SystemOneCaller;
}

export interface RouteDecideDependencies {
  readonly config: DecisionModelConfig;
  readonly matrix: RouteMatrix;
  readonly rotation: RouteRotation;
  readonly logger: LaneRoutingLogger;
  readonly listing?: LaneModelListing;
  readonly structured?: StructuredDecisionCompleter;
  readonly reuse?: PreflightReuseCache;
  readonly seams?: RouteDecideSeams;
}

type PreflightArgs = Extract<RouteDecideArgs, { stage: 'pre-flight' }>;

/**
 * Plain class. The register function builds it with `useFactory` because
 * the listing and structured ports are optional and the seams are not
 * constructor tokens.
 */
export class RouteDecideService {
  private readonly decisionCaller: DecisionCaller;

  constructor(private readonly deps: RouteDecideDependencies) {
    this.decisionCaller = new DecisionCaller(deps);
  }

  async decide(
    args: unknown,
    source: RouteCandidateSource,
    context?: { readonly sessionKey?: string },
  ): Promise<RouteDecideResult> {
    const parsed = RouteDecideArgsSchema.safeParse(args);
    if (!parsed.success) {
      throw schemaError('invalid route decide args', parsed.error);
    }
    if (parsed.data.stage === 'pre-flight') {
      if (context?.sessionKey !== undefined && this.deps.reuse !== undefined) {
        const fingerprint = JSON.stringify(this.deps.config.getSelection());
        const cached = this.deps.reuse.get(context.sessionKey, fingerprint);
        if (cached !== null) {
          const reused = PreflightResultSchema.safeParse({
            ...cached,
            reasons: [...cached.reasons, 'reused host pre-flight result'],
            usage: {
              requests: 0,
              inputTokens: null,
              outputTokens: null,
              costUsd: null,
            },
          });
          if (!reused.success) {
            throw schemaError(
              'route decide result failed schema',
              reused.error,
            );
          }
          return reused.data;
        }
      }
      return this.decidePreflight(parsed.data);
    }
    return this.decideGate(parsed.data, source);
  }

  private async decidePreflight(args: PreflightArgs): Promise<PreflightResult> {
    const caller = await this.decisionCaller.openCaller();
    const tally = emptyTally();
    let outcome: ModelRequestOutcome | null = null;
    if (caller.kind === 'system-one' || caller.kind === 'structured') {
      outcome = await runFixedRequest({
        request: args.request,
        questions: preflightQuestions(),
        maxRequestBytes: this.maxBytes,
        dispatch: this.decisionCaller.dispatchFor(caller),
        logger: this.deps.logger,
      });
      await this.decisionCaller.noteLive(caller, outcome);
      noteUsage(tally, outcome);
    }
    const read = readPreflight(caller, outcome);
    const reasons = compilePreflightReasons({
      answers: [read.taskType.facts, read.depth.facts],
      missingInputs: [],
    });
    const result: PreflightResult = {
      stage: 'pre-flight',
      taskType: read.taskType.answer,
      depth: read.depth.answer,
      overallConfidence: overallConfidence([
        {
          source: read.taskType.answer.source,
          reportedConfidence: read.taskType.answer.confidence,
        },
        {
          source: read.depth.answer.source,
          reportedConfidence: read.depth.answer.confidence,
        },
      ]),
      reasons: [...reasons],
      usage: usageOf(tally),
    };
    const validated = PreflightResultSchema.safeParse(result);
    if (!validated.success) {
      throw schemaError('route decide result failed schema', validated.error);
    }
    return validated.data;
  }

  private async decideGate(
    args: GateArgs,
    source: RouteCandidateSource,
  ): Promise<GateResult> {
    const caller = await this.decisionCaller.openCaller();
    const mode = dispatchMode(caller);
    const gathered = await gatherRouteCall({
      source,
      listing: this.deps.listing,
      matrix: this.deps.matrix,
      rotation: this.deps.rotation,
      logger: this.deps.logger,
      nowMs: this.nowMs,
      listingBudgetMs: this.listingBudget,
    });
    const inputRowIds: string[] = [];
    const remember = (candidates: readonly RoutingCandidate[]): void => {
      for (const candidate of candidates) {
        if (!inputRowIds.includes(candidate.id)) inputRowIds.push(candidate.id);
      }
    };

    let cursor = gathered.rotation;
    const nonReview = args.phases.filter((phase) => !isReviewPhase(phase.kind));
    const pass1 = planRoutePhases(
      nonReview,
      args,
      gathered,
      cursor,
      true,
      [],
      remember,
    );
    cursor = pass1.cursor;
    const pass1Run = await this.runPass(pass1.plans, args, caller, mode);
    const resolutions = new Map<string, PhaseResolution>();
    const plans = new Map<string, PhasePlan>();
    storePass(pass1.plans, pass1Run.context, plans, resolutions);

    const reviews = args.phases.filter((phase) => isReviewPhase(phase.kind));
    const pass2 = planRoutePhases(
      reviews,
      args,
      gathered,
      cursor,
      false,
      implementersOf(pass1.plans, resolutions),
      remember,
    );
    const pass2Run = await this.runPass(pass2.plans, args, caller, mode);
    storePass(pass2.plans, pass2Run.context, plans, resolutions);

    const tally = emptyTally();
    noteUsage(tally, pass1Run.outcome);
    noteUsage(tally, pass2Run.outcome);
    const result = assembleGateResult(
      args,
      gathered,
      plans,
      resolutions,
      inputRowIds,
      tally,
      [pass1Run.outcome, pass2Run.outcome],
    );
    const validated = GateResultSchema.safeParse(result);
    if (!validated.success) {
      throw schemaError('route decide result failed schema', validated.error);
    }
    await this.persistRotation(gathered, validated.data);
    return validated.data;
  }

  private async runPass(
    plans: readonly PhasePlan[],
    args: GateArgs,
    caller: OpenedCaller,
    mode: DispatchMode,
  ): Promise<{
    readonly outcome: ModelRequestOutcome | null;
    readonly context: PassContext;
  }> {
    const sendable = mode === 'ranking' ? [] : plans.filter(isSendable);
    const send = sendable.slice(0, QUESTIONS_PER_REQUEST);
    const limited = new Set(
      sendable.slice(QUESTIONS_PER_REQUEST).map((plan) => plan.phaseId),
    );
    let outcome: ModelRequestOutcome | null = null;
    if (
      mode === 'model' &&
      send.length > 0 &&
      (caller.kind === 'system-one' || caller.kind === 'structured')
    ) {
      outcome = await runLaneRequest({
        provider:
          caller.kind === 'structured' ? 'structuredOutput' : caller.provider,
        request: args.request,
        phases: send.map(laneQuestion),
        maxRequestBytes: this.maxBytes,
        dispatch: this.decisionCaller.dispatchFor(caller),
        logger: this.deps.logger,
      });
      await this.decisionCaller.noteLive(caller, outcome);
    }
    return {
      outcome,
      context: {
        mode,
        blockedCause: caller.kind === 'blocked' ? caller.cause : null,
        limited,
        outcome,
      },
    };
  }

  private async persistRotation(
    gathered: GatheredCall,
    result: GateResult,
  ): Promise<void> {
    if (gathered.rotationUnavailable) return;
    const chosen = result.roster.filter((entry) => entry.status === 'chosen');
    if (chosen.length === 0) return;
    let picks = emptyRotationState();
    for (const entry of chosen) {
      picks = withPick(
        picks,
        rotationKey(entry.phaseId, entry.taskKind),
        entry.executor.id,
      );
    }
    try {
      await this.deps.rotation.save(picks);
    } catch (error: unknown) {
      this.deps.logger.warn(
        '[lane-routing] rotation state could not be saved',
        errorFacts(error),
      );
    }
  }

  private get nowMs(): number {
    return this.deps.seams?.now?.() ?? Date.now();
  }

  private get maxBytes(): number {
    return this.deps.seams?.maxRequestBytes ?? REQUEST_SIZE_LIMIT_BYTES;
  }

  private get listingBudget(): number {
    return this.deps.seams?.listingBudgetMs ?? MODEL_LISTING_BUDGET_MS;
  }
}

function schemaError(
  prefix: string,
  error: {
    readonly issues: readonly {
      readonly path: readonly PropertyKey[];
      readonly message: string;
    }[];
  },
): Error {
  const first = error.issues[0];
  const path =
    first !== undefined && first.path.length > 0
      ? first.path.map((part) => String(part)).join('.')
      : 'stage';
  return new Error(`${prefix} at ${path}: ${first?.message ?? 'invalid'}`);
}

/**
 * Log facts of a rejection from the key store, the target resolver or the
 * rotation store. Its `name` and `code` are set by that dependency and can
 * carry a key (a key can even equal a real Node code), so only the fixed
 * `loggableErrorName` category is logged and the code is never read.
 */
function errorFacts(error: unknown): { readonly name: LoggableErrorName } {
  return { name: loggableErrorName(error) };
}
