import type { GateResult, PreflightResult } from '../contracts/route-decide-result.schema';
import type { LaneRoutingLogMeta } from '../lane-routing-logger';
import type { OpenedCaller } from '../pipeline/phase-plan';

export interface DecisionSummaryFacts {
  readonly durationMs: number;
  readonly caller: OpenedCaller['kind'];
  readonly model: string | null;
  readonly timeoutMs: number | null;
  readonly reused: boolean;
  readonly outcomeFigures: number;
}

function usage(result: PreflightResult | GateResult, facts: DecisionSummaryFacts) {
  return {
    stage: result.stage,
    outcome: 'ok',
    durationMs: facts.durationMs,
    caller: facts.caller,
    model: facts.model,
    timeoutMs: facts.timeoutMs,
    requests: result.usage.requests,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    overallConfidence: result.overallConfidence,
    reused: facts.reused,
  };
}

export function preflightSummary(result: PreflightResult, facts: DecisionSummaryFacts): LaneRoutingLogMeta {
  return {
    ...usage(result, facts),
    answers: [
      { question: 'taskType', value: result.taskType.value, source: result.taskType.source,
        confidence: result.taskType.confidence, fallbackCause: result.taskType.fallbackCause,
        proposal: result.taskType.modelProposal?.option ?? null,
        proposalConfidence: result.taskType.modelProposal?.confidence ?? null },
      { question: 'depth', value: result.depth.value, source: result.depth.source,
        confidence: result.depth.confidence, fallbackCause: result.depth.fallbackCause,
        proposal: result.depth.modelProposal?.option ?? null,
        proposalConfidence: result.depth.modelProposal?.confidence ?? null },
    ],
  };
}

export function gateSummary(result: GateResult, facts: DecisionSummaryFacts): LaneRoutingLogMeta {
  return {
    ...usage(result, facts),
    overallSource: result.overallSource,
    outcomeFigures: facts.outcomeFigures,
    excluded: result.excluded.length,
    phases: result.roster.map((entry) => ({
      phaseId: entry.phaseId,
      status: entry.status,
      executor: entry.status === 'chosen' ? entry.executor.id : 'unavailable',
      model: entry.model,
      taskKind: entry.status === 'chosen' ? entry.taskKind : null,
      source: entry.source,
      confidence: entry.confidence,
      fallbackCause: entry.fallbackCause,
    })),
  };
}
