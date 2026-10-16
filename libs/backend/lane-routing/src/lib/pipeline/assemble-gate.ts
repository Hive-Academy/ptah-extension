/**
 * Gate result assembly. Reasons come from the compilers; this module only
 * supplies the facts those compilers already accept.
 */
import { type LaneLimitState } from '@ptah-extension/shared';

import type {
  ChosenEntry,
  GateResult,
  UnavailableEntry,
} from '../contracts/route-decide-result.schema';
import type { DecisionOption } from '../decision-model/decision-payload';
import type { GatheredCall } from './gather';
import type { ModelRequestOutcome } from './model-refine';
import { usageOf, type UsageTally } from './preflight-answer';
import type { RoutingCandidate } from '../ranking/candidate.types';
import type { PhaseConstraintResult } from '../ranking/hard-constraints';
import type { SpreadResult } from '../ranking/spread';
import {
  compileGateReasons,
  type ChosenExecutor,
  type ChosenReasonFacts,
  type ExcludedCandidateFact,
  type UnavailableReasonFacts,
} from '../reasons/compile-reasons';
import {
  overallRosterConfidence,
  rosterEntryConfidence,
} from '../reasons/confidence';
import {
  type ChosenResolution,
  type GateArgs,
  type PhasePlan,
  type PhaseResolution,
} from './phase-plan';

interface ChosenDraft {
  readonly kind: 'chosen';
  readonly phaseId: string;
  readonly resolution: ChosenResolution;
  readonly plan: PhasePlan;
}

interface UnavailableDraft {
  readonly kind: 'unavailable';
  readonly phaseId: string;
  readonly plan: PhasePlan;
}

type Draft = ChosenDraft | UnavailableDraft;

export function assembleGateResult(
  args: GateArgs,
  gathered: GatheredCall,
  plans: ReadonlyMap<string, PhasePlan>,
  resolutions: ReadonlyMap<string, PhaseResolution>,
  inputRowIds: readonly string[],
  tally: UsageTally,
  outcomes: readonly (ModelRequestOutcome | null)[],
): GateResult {
  const chosenFacts: ChosenReasonFacts[] = [];
  const unavailableFacts: UnavailableReasonFacts[] = [];
  const excluded: ExcludedCandidateFact[] = [];
  const drafts: Draft[] = [];
  for (const phase of args.phases) {
    const plan = requiredPlan(plans, phase.id);
    const resolution = requiredResolution(resolutions, phase.id);
    pushExcluded(excluded, plan, offeredFrom(outcomes, phase.id));
    if (resolution.kind === 'unavailable') {
      if (plan.constraint.status !== 'unavailable') {
        throw new Error(`phase ${phase.id} constraint is not unavailable`);
      }
      unavailableFacts.push(unavailableFactsOf(plan, plan.constraint));
      drafts.push({ kind: 'unavailable', phaseId: phase.id, plan });
      continue;
    }
    chosenFacts.push(chosenFactsOf(plan, resolution, args.preferenceSource));
    drafts.push({ kind: 'chosen', phaseId: phase.id, resolution, plan });
  }
  const compiled = compileGateReasons({
    chosen: chosenFacts,
    unavailable: unavailableFacts,
    excluded,
    missingInputs: gathered.missing,
    inputRowIds,
  });
  const roster = rosterFrom(
    args,
    drafts,
    compiled.chosenReasons,
    compiled.unavailableReasons,
  );
  const reasons = [...compiled.reasons];
  for (const detail of gathered.detailReasons) {
    if (!reasons.includes(detail)) reasons.push(detail);
  }
  return {
    stage: 'gate-0.1',
    roster,
    overallSource: overallSourceOf(roster),
    overallConfidence: overallRosterConfidence(roster.map(confidenceEntry)),
    excluded,
    reasons,
    usage: usageOf(tally),
  };
}

function chosenFactsOf(
  plan: PhasePlan,
  resolution: ChosenResolution,
  preferenceSource: string | undefined,
): ChosenReasonFacts {
  const row = plan.ranked.find(
    (entry) => entry.candidate.id === resolution.candidate.id,
  );
  if (row === undefined)
    throw new Error(
      `phase ${plan.phaseId} is missing a score for ${resolution.candidate.id}`,
    );
  const flags = choiceFlags(
    resolution.source,
    resolution.candidate.id,
    plan.spread,
  );
  return {
    phaseId: plan.phaseId,
    executor: executorOf(resolution.candidate),
    model: row.scored.model,
    score: row.scored.score,
    source: resolution.source,
    cell: row.scored.cell,
    limitState: limitOf(resolution.candidate),
    rotationChangedChoice: flags.rotation,
    preferenceChangedChoice: flags.preference,
    ...(preferenceSource !== undefined ? { preferenceSource } : {}),
    reportedConfidence: resolution.reported,
    fallbackCause: resolution.cause,
    ...(resolution.proposal !== null
      ? { modelProposalOption: resolution.proposal.option }
      : {}),
  };
}

function unavailableFactsOf(
  plan: PhasePlan,
  constraint: Extract<PhaseConstraintResult, { status: 'unavailable' }>,
): UnavailableReasonFacts {
  return {
    phaseId: plan.phaseId,
    exclusionReason: constraint.exclusionReason,
    excludedBy: constraint.excluded,
    pinRule: constraint.pinRule,
    needsDisclosedFallback: constraint.needsDisclosedFallback,
    source:
      constraint.exclusionReason === 'pin-unavailable' ? 'pin' : 'ranking',
  };
}

function choiceFlags(
  source: ChosenResolution['source'],
  candidateId: string,
  spreadResult: SpreadResult | null,
): { readonly rotation: boolean; readonly preference: boolean } {
  if (source === 'pin' || spreadResult === null || spreadResult.pick === null) {
    return { rotation: false, preference: false };
  }
  if (source === 'model' && candidateId !== spreadResult.pick.candidate.id) {
    return { rotation: false, preference: false };
  }
  return {
    rotation: spreadResult.rotationChangedChoice,
    preference: spreadResult.preferenceChangedChoice,
  };
}

function executorOf(candidate: RoutingCandidate): ChosenExecutor {
  if (candidate.kind === 'subagent') {
    return {
      kind: 'subagent',
      id: candidate.id,
      family: candidate.family,
      role: candidate.role,
    };
  }
  return {
    kind: 'lane',
    id: candidate.id,
    family: candidate.family,
    cli: candidate.cli,
    ...(candidate.ptahCliId !== undefined
      ? { ptahCliId: candidate.ptahCliId }
      : {}),
  };
}

function limitOf(candidate: RoutingCandidate): LaneLimitState {
  return candidate.kind === 'lane' ? candidate.limitState : 'unknown';
}

function pushExcluded(
  excluded: ExcludedCandidateFact[],
  plan: PhasePlan,
  offered: readonly DecisionOption[] | undefined,
): void {
  if (
    plan.constraint.status === 'eligible' ||
    plan.constraint.status === 'unavailable'
  ) {
    for (const entry of plan.constraint.excluded) {
      excluded.push({
        phaseId: plan.phaseId,
        candidate: entry.candidate,
        rule: entry.rule,
      });
    }
  }
  if (offered === undefined) return;
  const kept = new Set(offered.map((option) => option.laneId));
  for (const row of plan.ranked) {
    if (!kept.has(row.candidate.id)) {
      excluded.push({
        phaseId: plan.phaseId,
        candidate: row.candidate.id,
        rule: 'pruned',
      });
    }
  }
}

function offeredFrom(
  outcomes: readonly (ModelRequestOutcome | null)[],
  phaseId: string,
): readonly DecisionOption[] | undefined {
  for (const outcome of outcomes) {
    if (outcome === null || !outcome.sent) continue;
    const offered = outcome.offered.get(phaseId);
    if (offered !== undefined) return offered;
  }
  return undefined;
}

function rosterFrom(
  args: GateArgs,
  drafts: readonly Draft[],
  chosenReasons: readonly string[],
  unavailableReasons: readonly string[],
): (ChosenEntry | UnavailableEntry)[] {
  let chosenIndex = 0;
  let unavailableIndex = 0;
  const roster: (ChosenEntry | UnavailableEntry)[] = [];
  for (const draft of drafts) {
    if (draft.kind === 'unavailable') {
      const reason = reasonAt(
        unavailableReasons,
        unavailableIndex,
        draft.phaseId,
      );
      unavailableIndex += 1;
      roster.push(unavailableEntry(draft.plan, reason));
      continue;
    }
    const reason = withOnlyEligible(
      reasonAt(chosenReasons, chosenIndex, draft.phaseId),
      draft.plan,
    );
    chosenIndex += 1;
    roster.push(chosenEntry(draft, reason));
  }
  if (roster.length !== args.phases.length) {
    throw new Error('route decide roster does not cover every phase');
  }
  return roster;
}

function reasonAt(
  reasons: readonly string[],
  index: number,
  phaseId: string,
): string {
  const reason = reasons[index];
  if (reason === undefined) {
    throw new Error(`phase ${phaseId} is missing its compiled reason`);
  }
  return reason;
}

function unavailableEntry(plan: PhasePlan, reason: string): UnavailableEntry {
  if (plan.constraint.status !== 'unavailable') {
    throw new Error(`phase ${plan.phaseId} constraint is not unavailable`);
  }
  return {
    phaseId: plan.phaseId,
    status: 'unavailable',
    executor: 'unavailable',
    exclusionReason: plan.constraint.exclusionReason,
    excludedBy: [...plan.constraint.excluded],
    pinRule: plan.constraint.pinRule,
    needsDisclosedFallback: plan.constraint.needsDisclosedFallback,
    source:
      plan.constraint.exclusionReason === 'pin-unavailable' ? 'pin' : 'ranking',
    model: null,
    provenance: null,
    score: null,
    confidence: null,
    fallbackCause: null,
    reason,
  };
}

function chosenEntry(draft: ChosenDraft, reason: string): ChosenEntry {
  const row = draft.plan.ranked.find(
    (entry) => entry.candidate.id === draft.resolution.candidate.id,
  );
  if (row === undefined) {
    throw new Error(
      `phase ${draft.phaseId} is missing a score for ${draft.resolution.candidate.id}`,
    );
  }
  const confidence = rosterEntryConfidence({
    status: 'chosen',
    source: draft.resolution.source,
    reportedConfidence: draft.resolution.reported,
  });
  return {
    phaseId: draft.phaseId,
    status: 'chosen',
    executor: executorOf(draft.resolution.candidate),
    model: row.scored.model,
    provenance: row.scored.provenance,
    score: row.scored.score,
    source: draft.resolution.source,
    taskKind: draft.plan.taskKind,
    confidence,
    fallbackCause: draft.resolution.cause,
    modelProposal: draft.resolution.proposal,
    reason,
  };
}

function withOnlyEligible(reason: string, plan: PhasePlan): string {
  if (plan.constraint.status !== 'eligible' || plan.constraint.pinAccepted)
    return reason;
  if (plan.constraint.eligible.length !== 1) return reason;
  return `${reason}; only eligible candidate`;
}

function overallSourceOf(
  roster: readonly (ChosenEntry | UnavailableEntry)[],
): 'model' | 'ranking' | 'mixed' {
  let chosen = 0;
  let model = 0;
  for (const entry of roster) {
    if (entry.status !== 'chosen') continue;
    chosen += 1;
    if (entry.source === 'model') model += 1;
  }
  if (model === 0) return 'ranking';
  if (model === chosen) return 'model';
  return 'mixed';
}

function confidenceEntry(entry: ChosenEntry | UnavailableEntry):
  | {
      readonly status: 'chosen';
      readonly source: ChosenEntry['source'];
      readonly reportedConfidence: number | null;
    }
  | { readonly status: 'unavailable' } {
  if (entry.status === 'unavailable') return { status: 'unavailable' };
  return {
    status: 'chosen',
    source: entry.source,
    reportedConfidence: entry.confidence,
  };
}

function requiredPlan(
  plans: ReadonlyMap<string, PhasePlan>,
  phaseId: string,
): PhasePlan {
  const plan = plans.get(phaseId);
  if (plan === undefined) throw new Error(`phase ${phaseId} was not planned`);
  return plan;
}

function requiredResolution(
  resolutions: ReadonlyMap<string, PhaseResolution>,
  phaseId: string,
): PhaseResolution {
  const resolution = resolutions.get(phaseId);
  if (resolution === undefined)
    throw new Error(`phase ${phaseId} was not resolved`);
  return resolution;
}
