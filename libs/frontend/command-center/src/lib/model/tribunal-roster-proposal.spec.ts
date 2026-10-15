import { parseRosterProposal, rankAvailableLanes } from './tribunal-roster-proposal';

const base = { proposalId: 'p1', nonce: 'n1', rootSessionId: 'root', move: 'council', options: ['Decline', 'Confirm'], objective: 'Review', rounds: 1, lanes: [{ laneId: 'codex#1', family: 'codex', displayName: 'Codex', cli: 'codex' }] };
const wrap = (value: unknown): string => `<TRIBUNAL_ROSTER_PROPOSAL>${JSON.stringify(value)}</TRIBUNAL_ROSTER_PROPOSAL>`;
describe('parseRosterProposal', () => {
  it('rejects non Decline first, stale nonce, wrong root and empty lanes', () => {
    expect(parseRosterProposal(wrap({ ...base, options: ['Confirm', 'Decline'] }), 'root', 'n1')).toBeNull();
    expect(parseRosterProposal(wrap(base), 'root', 'old')).toBeNull();
    expect(parseRosterProposal(wrap(base), 'other', 'n1')).toBeNull();
    expect(parseRosterProposal(wrap({ ...base, lanes: [] }), 'root', 'n1')).toBeNull();
  });
  it('rejects bad lane syntax, role, bounds and an unlaunchable roster', () => {
    expect(parseRosterProposal(wrap({ ...base, lanes: [{ ...base.lanes[0], laneId: 'bad id' }] }), 'root', 'n1')).toBeNull();
    expect(parseRosterProposal(wrap({ ...base, lanes: [{ ...base.lanes[0], role: 'hacker' }] }), 'root', 'n1')).toBeNull();
    expect(parseRosterProposal(wrap({ ...base, rounds: 3 }), 'root', 'n1')).toBeNull();
    expect(parseRosterProposal(wrap({ ...base, move: 'relay' }), 'root', 'n1')).toBeNull();
  });
  it('accepts a current launchable proposal', () => expect(parseRosterProposal(wrap(base), 'root', 'n1')?.proposalId).toBe('p1'));
  it('excludes AT LIMIT lanes and honors saved family preferences', () => {
    const available = [{ laneId: 'codex#1', family: 'codex', state: 'AT LIMIT' }, { laneId: 'copilot#1', family: 'copilot', state: 'READY' }, { laneId: 'cursor#1', family: 'cursor', state: 'READY' }];
    expect(parseRosterProposal(wrap(base), 'root', 'n1', available)).toBeNull();
    expect(rankAvailableLanes(available, ['cursor', 'copilot']).map((item) => item.laneId)).toEqual(['cursor#1', 'copilot#1']);
  });
});
