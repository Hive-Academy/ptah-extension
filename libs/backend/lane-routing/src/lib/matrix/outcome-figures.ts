import {
  SUBAGENT_LANE_ID,
  type LaneOutcomeSummary,
  type OutcomeTaskKind,
} from '@ptah-extension/shared';
import type { DecisionOutcomeFigures } from '../decision-model/decision-payload';
import { dedupeByRun } from './local-derivation';

export type OutcomeFigureLookup = (
  laneId: string,
  taskKind: OutcomeTaskKind,
) => DecisionOutcomeFigures | null;

export const EMPTY_OUTCOME_FIGURES: OutcomeFigureLookup = () => null;

/** Aggregate verified delivery results by lane and task kind. */
export function outcomeFiguresFrom(
  summaries: readonly LaneOutcomeSummary[],
): OutcomeFigureLookup {
  const figures = new Map<string, DecisionOutcomeFigures>();
  for (const summary of dedupeByRun(summaries)) {
    const { laneId, taskKind, verdict } = summary;
    if (
      laneId === SUBAGENT_LANE_ID ||
      !/\S/.test(laneId) ||
      taskKind === null
    ) {
      continue;
    }
    if (verdict === 'unverified') continue;

    const key = JSON.stringify([laneId, taskKind]);
    const previous = figures.get(key);
    figures.set(key, {
      laneId,
      taskKind,
      delivered: (previous?.delivered ?? 0) + (verdict === 'delivered' ? 1 : 0),
      failed:
        (previous?.failed ?? 0) +
        (verdict === 'failed' || verdict === 'no-deliverable' ? 1 : 0),
    });
  }
  return (laneId, taskKind) =>
    figures.get(JSON.stringify([laneId, taskKind])) ?? null;
}
