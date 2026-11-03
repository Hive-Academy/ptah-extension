/**
 * Phase planning for one route-decide call: candidates, constraints,
 * scores, and spread order.
 */
import {
  LANE_DEFAULT_MODEL,
  type LaneLimitState,
  type OutcomeTaskKind,
} from '@ptah-extension/shared';

import type { SystemOneTarget } from '../decision-model/decision-model.config';
import type { DecisionModelSelection } from '../decision-model/decision-model.types';
import type { DecisionOption } from '../decision-model/decision-payload';
import type { RouteDecideArgs } from '../contracts/route-decide-args.schema';
import type { GatheredCall } from './gather';
import type { LaneQuestion, ModelRequestOutcome } from './model-refine';
import { resolvePhase } from './phase-resolve';
import {
  toSubagentCandidate,
  type RoutingCandidate,
} from '../ranking/candidate.types';
import {
  constrainPhase,
  REVIEW_PHASE_KINDS,
  type ConstrainPhaseInput,
  type KnownPhaseExecutor,
  type PhaseConstraintResult,
  type PhaseKind,
} from '../ranking/hard-constraints';
import { score, type CandidateScore } from '../ranking/score';
import { spread, type SpreadResult } from '../ranking/spread';
import type { FallbackCause } from '../reasons/compile-reasons';

const LANE_INSTRUCTIONS = 'Choose the executor for this phase.';

/** Built-in subagent role for a phase kind (part A, Assumption A4). */
const DEFAULT_ROLE: Readonly<Record<PhaseKind, string>> = {
  plan: 'project-manager',
  architecture: 'software-architect',
  implement: 'backend-developer',
  review: 'code-logic-reviewer',
  'document-review': 'code-logic-reviewer',
  research: 'researcher-expert',
  tests: 'senior-tester',
  docs: 'technical-content-writer',
  'visual-review': 'visual-reviewer',
  design: 'ui-ux-designer',
};

export const BUILTIN_SUBAGENT_ROLES: ReadonlySet<string> = new Set(
  Object.values(DEFAULT_ROLE),
);

export type GateArgs = Extract<RouteDecideArgs, { stage: 'gate-0.1' }>;

type GatePhase = GateArgs['phases'][number];

export type OpenedCaller =
  | { readonly kind: 'unset' }
  | { readonly kind: 'blocked'; readonly cause: FallbackCause }
  | {
      readonly kind: 'system-one';
      /** The selection the target was resolved for (404 re-check identity). */
      readonly selection: DecisionModelSelection;
      readonly target: SystemOneTarget;
      readonly provider: 'ollama' | 'jev';
    }
  | {
      readonly kind: 'structured';
      readonly providerId: string;
      readonly model: string;
    };

export type DispatchMode = 'ranking' | 'blocked' | 'model';

export interface ScoredCandidate {
  readonly candidate: RoutingCandidate;
  readonly scored: CandidateScore;
}

export interface PhasePlan {
  readonly phaseId: string;
  readonly kind: PhaseKind;
  readonly taskKind: OutcomeTaskKind;
  readonly constraint: PhaseConstraintResult;
  readonly ranked: readonly ScoredCandidate[];
  readonly spread: SpreadResult | null;
}

export interface ChosenResolution {
  readonly kind: 'chosen';
  readonly source: 'model' | 'ranking' | 'pin';
  readonly candidate: RoutingCandidate;
  readonly cause: FallbackCause | null;
  readonly proposal: {
    readonly option: string;
    readonly confidence: number | null;
  } | null;
  readonly reported: number | null;
}

export interface UnavailableResolution {
  readonly kind: 'unavailable';
}

export type PhaseResolution = ChosenResolution | UnavailableResolution;

export interface PassContext {
  readonly mode: DispatchMode;
  readonly blockedCause: FallbackCause | null;
  readonly limited: ReadonlySet<string>;
  readonly outcome: ModelRequestOutcome | null;
}

export function planRoutePhases(
  phases: readonly GatePhase[],
  args: GateArgs,
  gathered: GatheredCall,
  rotation: GatheredCall['rotation'],
  deferReviewerFamily: boolean,
  knownExecutors: readonly KnownPhaseExecutor[],
  remember: (candidates: readonly RoutingCandidate[]) => void,
): { readonly plans: PhasePlan[]; readonly cursor: GatheredCall['rotation'] } {
  const plans: PhasePlan[] = [];
  let cursor = rotation;
  for (const phase of phases) {
    const candidates = candidatesFor(phase, gathered);
    remember(candidates);
    const pin = args.pins?.find((entry) => entry.phaseId === phase.id);
    const constraint = constrainPhase(
      constraintInput(
        phase,
        candidates,
        pin?.executor,
        deferReviewerFamily,
        knownExecutors,
      ),
    );
    const taskKind = taskKindFor(phase.kind);
    if (constraint.status === 'unavailable') {
      plans.push({
        phaseId: phase.id,
        kind: phase.kind,
        taskKind,
        constraint,
        ranked: [],
        spread: null,
      });
      continue;
    }
    const pinModel = constraint.pinAccepted ? pin?.model : undefined;
    const scored = constraint.eligible.map((candidate) => ({
      candidate,
      scored: scoreCandidate(
        candidate,
        phase.kind,
        taskKind,
        pinModel,
        gathered,
      ),
    }));
    const spreadResult = spread({
      phaseId: phase.id,
      taskKind,
      candidates: scored.map((row) => ({
        candidate: row.candidate,
        score: row.scored.score,
      })),
      ...(args.preferences !== undefined
        ? { preferences: args.preferences }
        : {}),
      rotation: cursor,
    });
    cursor = spreadResult.rotation;
    plans.push({
      phaseId: phase.id,
      kind: phase.kind,
      taskKind,
      constraint,
      ranked: orderScored(scored, spreadResult.ranking),
      spread: spreadResult,
    });
  }
  return { plans, cursor };
}

export function storePass(
  planned: readonly PhasePlan[],
  context: PassContext,
  plans: Map<string, PhasePlan>,
  resolutions: Map<string, PhaseResolution>,
): void {
  for (const plan of planned) {
    plans.set(plan.phaseId, plan);
    resolutions.set(plan.phaseId, resolvePhase(plan, context));
  }
}

export function isReviewPhase(kind: PhaseKind): boolean {
  return REVIEW_PHASE_KINDS.some((entry) => entry === kind);
}

export function dispatchMode(caller: OpenedCaller): DispatchMode {
  if (caller.kind === 'unset') return 'ranking';
  if (caller.kind === 'blocked') return 'blocked';
  return 'model';
}

export function laneQuestion(plan: PhasePlan): LaneQuestion {
  return {
    phaseId: plan.phaseId,
    instructions: LANE_INSTRUCTIONS,
    options: plan.ranked.map(toOption),
  };
}

export function implementersOf(
  plans: readonly PhasePlan[],
  resolutions: ReadonlyMap<string, PhaseResolution>,
): KnownPhaseExecutor[] {
  const known: KnownPhaseExecutor[] = [];
  for (const plan of plans) {
    if (plan.kind !== 'implement') continue;
    const resolution = resolutions.get(plan.phaseId);
    if (resolution === undefined || resolution.kind !== 'chosen') continue;
    known.push({
      phaseId: plan.phaseId,
      kind: 'implement',
      family: resolution.candidate.family,
    });
  }
  return known;
}

function candidatesFor(
  phase: GatePhase,
  gathered: GatheredCall,
): RoutingCandidate[] {
  const role = phase.role ?? DEFAULT_ROLE[phase.kind];
  const candidates: RoutingCandidate[] = [...gathered.lanes];
  if (BUILTIN_SUBAGENT_ROLES.has(role) || gathered.roles.includes(role)) {
    candidates.push(toSubagentCandidate(role));
  }
  return candidates;
}

function constraintInput(
  phase: GatePhase,
  candidates: readonly RoutingCandidate[],
  executor: string | undefined,
  deferReviewerFamily: boolean,
  knownExecutors: readonly KnownPhaseExecutor[],
): ConstrainPhaseInput {
  return {
    phase: {
      id: phase.id,
      kind: phase.kind,
      ...(phase.reviews !== undefined ? { reviews: phase.reviews } : {}),
    },
    candidates,
    ...(executor !== undefined ? { pin: { executor } } : {}),
    ...(deferReviewerFamily
      ? { deferReviewerFamily: true }
      : { knownExecutors }),
  };
}

function scoreCandidate(
  candidate: RoutingCandidate,
  kind: PhaseKind,
  taskKind: OutcomeTaskKind,
  pinModel: string | undefined,
  gathered: GatheredCall,
): CandidateScore {
  const tier = tierFor(kind);
  const facts =
    candidate.kind === 'lane' ? gathered.models.get(candidate.id) : undefined;
  const configuredModel =
    candidate.kind === 'subagent'
      ? { id: tier, provenance: 'tier' as const }
      : facts?.configuredModel;
  const scored = score(
    {
      candidate,
      ...(facts?.models !== undefined ? { models: facts.models } : {}),
      ...(configuredModel !== undefined ? { configuredModel } : {}),
    },
    taskKind,
    gathered.matrix,
  );
  if (pinModel === undefined) return scored;
  return applyPinModel(
    scored,
    candidate,
    pinModel,
    facts?.models ?? [],
    tier,
    taskKind,
    gathered,
  );
}

function applyPinModel(
  scored: CandidateScore,
  candidate: RoutingCandidate,
  pinModel: string,
  models: readonly {
    readonly id: string;
    readonly provenance: CandidateScore['provenance'];
  }[],
  tier: string,
  taskKind: OutcomeTaskKind,
  gathered: GatheredCall,
): CandidateScore {
  const listed = models.find((model) => model.id === pinModel);
  const laneDefault = pinModel === LANE_DEFAULT_MODEL;
  const tierPin = candidate.kind === 'subagent' && pinModel === tier;
  if (listed === undefined && !laneDefault && !tierPin) return scored;
  const modelId = laneDefault ? LANE_DEFAULT_MODEL : pinModel;
  const resolved = gathered.matrix.resolve(candidate.family, modelId, taskKind);
  const provenance = laneDefault
    ? 'lane-default'
    : tierPin
      ? 'tier'
      : listed === undefined
        ? scored.provenance
        : listed.provenance;
  return {
    ...scored,
    model: modelId,
    provenance,
    score: resolved.score,
    cell: resolved.cell,
    profileModel: resolved.profileModel,
    noProfile: resolved.noProfile,
  };
}

function tierFor(kind: PhaseKind): 'opus' | 'sonnet' {
  if (
    kind === 'plan' ||
    kind === 'architecture' ||
    kind === 'review' ||
    kind === 'document-review'
  ) {
    return 'opus';
  }
  return 'sonnet';
}

function taskKindFor(kind: PhaseKind): OutcomeTaskKind {
  switch (kind) {
    case 'plan':
    case 'architecture':
      return 'plan';
    case 'implement':
      return 'implement';
    case 'review':
    case 'document-review':
    case 'visual-review':
      return 'review';
    case 'research':
      return 'research';
    case 'tests':
      return 'tests';
    case 'docs':
    case 'design':
      return 'docs';
    default: {
      const unexpected: never = kind;
      throw new Error(`unexpected phase kind ${String(unexpected)}`);
    }
  }
}

function orderScored(
  scored: readonly ScoredCandidate[],
  ranking: SpreadResult['ranking'],
): ScoredCandidate[] {
  const byId = new Map(scored.map((row) => [row.candidate.id, row]));
  const ordered: ScoredCandidate[] = [];
  for (const row of ranking) {
    const found = byId.get(row.candidate.id);
    if (found !== undefined) ordered.push(found);
  }
  return ordered;
}

function toOption(row: ScoredCandidate): DecisionOption {
  return {
    laneId: row.candidate.id,
    family: row.candidate.family,
    model: row.scored.model,
    limitState: limitOf(row.candidate),
    score: row.scored.score,
  };
}

function limitOf(candidate: RoutingCandidate): LaneLimitState {
  return candidate.kind === 'lane' ? candidate.limitState : 'unknown';
}
