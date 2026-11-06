import type { LaneOutcomeSummary } from '@ptah-extension/shared';
import type { DecisionOutcomeFigures } from '../decision-model/decision-payload';
import { isCapacityFailure } from './local-derivation';

export function outcomeFigures(summaries: readonly LaneOutcomeSummary[]): readonly DecisionOutcomeFigures[] {
  const figures = new Map<string, { laneId: string; taskKind: string; delivered: number; failed: number }>();
  for (const row of summaries) {
    if (row.taskKind === null) continue;
    const key = JSON.stringify([row.laneId, row.taskKind]);
    let figure = figures.get(key);
    if (figure === undefined) {
      figure = { laneId: row.laneId, taskKind: row.taskKind, delivered: 0, failed: 0 };
      figures.set(key, figure);
    }
    if (row.verdict === 'delivered') figure.delivered += 1;
    if (row.verdict === 'failed' && !isCapacityFailure(row.failureClass)) figure.failed += 1;
  }
  return [...figures.values()].filter((figure) => figure.delivered > 0 || figure.failed > 0);
}
