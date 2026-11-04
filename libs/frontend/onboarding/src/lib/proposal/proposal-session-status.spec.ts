import {
  proposalSessionStatus,
  PROPOSAL_SESSION_PRESENTATION,
  type ProposalSessionStatusInput,
  type ProposalSessionStatus,
} from './proposal-session-status';

const baseline: ProposalSessionStatusInput = {
  restoreState: 'ready',
  hasRecord: true,
  phase: 'done',
  reviewEligible: false,
};

describe('proposalSessionStatus', () => {
  it.each<[
    ProposalSessionStatus,
    Partial<ProposalSessionStatusInput>,
  ]>([
    ['loading', { restoreState: 'loading', hasRecord: false, phase: 'failed' }],
    ['not-connected', { hasRecord: false, phase: 'failed' }],
    ['failed', { phase: 'failed', reviewEligible: true }],
    ['stopping', { phase: 'cancelling', reviewEligible: true }],
    ['working', { phase: 'busy', reviewEligible: true }],
    ['working', { phase: 'sending', reviewEligible: true }],
    ['ready', { phase: 'done', reviewEligible: true }],
    ['waiting', { phase: 'done', reviewEligible: false }],
    ['waiting', { phase: 'idle', reviewEligible: false }],
  ])('returns %s for %j', (expected, overrides) => {
    expect(proposalSessionStatus({ ...baseline, ...overrides })).toBe(expected);
    expect(PROPOSAL_SESSION_PRESENTATION[expected].title).toBeTruthy();
  });
});
