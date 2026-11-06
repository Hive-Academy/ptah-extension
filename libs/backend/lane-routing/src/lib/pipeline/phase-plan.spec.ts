import { toSubagentCandidate } from '../ranking/candidate.types';
import type { PhasePlan } from './phase-plan';
import { laneQuestion } from './phase-plan';
import { isSendable } from './phase-resolve';

function plan(scores: readonly number[]): PhasePlan {
  const candidates = scores.map((_, index) => toSubagentCandidate(`role-${index}`));
  return {
    phaseId: 'build', kind: 'implement', taskKind: 'implement',
    constraint: { phaseId: 'build', status: 'eligible', eligible: candidates, excluded: [], pinAccepted: false },
    spread: null,
    ranked: candidates.map((candidate, index) => ({
      candidate,
      scored: { candidate, model: 'auto', provenance: 'lane-default', score: scores[index], cell: { kind: 'unknown' }, profileModel: '*', noProfile: true },
    })),
  };
}

it('offers only the five-point band to the decision model', () => {
  const phase = plan([80, 76, 70]);
  expect(laneQuestion(phase).options.map((option) => option.score)).toEqual([80, 76]);
  expect(isSendable(phase)).toBe(true);
});

it('falls back to ranking when the band has one member', () => {
  const phase = plan([80, 70, 60]);
  expect(laneQuestion(phase).options).toHaveLength(1);
  expect(isSendable(phase)).toBe(false);
});
