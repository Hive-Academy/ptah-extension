import { MAX_CRUCIBLE_ROUND_CAP } from '@ptah-extension/tribunal-panel/phase';
import {
  parseRosterProposal,
  rankAvailableLanes,
  type ProposalAvailability,
} from './tribunal-roster-proposal';

const lane = {
  laneId: 'codex#1',
  family: 'codex',
  displayName: 'Codex',
  cli: 'codex',
};
const base = {
  proposalId: 'p1',
  nonce: 'n1',
  rootSessionId: 'root',
  move: 'council',
  options: ['Decline', 'Confirm'],
  objective: 'Review',
  rounds: 1,
  lanes: [lane],
};
const wrap = (value: unknown): string =>
  `<TRIBUNAL_ROSTER_PROPOSAL>${JSON.stringify(value)}</TRIBUNAL_ROSTER_PROPOSAL>`;
const availability: ProposalAvailability = {
  lanes: [
    { laneId: 'codex#1', family: 'codex', cli: 'codex', state: 'READY' },
    { laneId: 'copilot#1', family: 'copilot', cli: 'copilot', state: 'READY' },
    { laneId: 'cursor#1', family: 'cursor', cli: 'cursor', state: 'READY' },
    { laneId: 'codex#2', family: 'codex', cli: 'codex', state: 'READY' },
    { laneId: 'codex#3', family: 'codex', cli: 'codex', state: 'READY' },
  ],
  disabledClis: [],
};
const parse = (value: unknown, current = availability) =>
  parseRosterProposal(wrap(value), 'root', 'n1', current);

describe('parseRosterProposal', () => {
  it('accepts a current roster and rejects wrong answer, nonce, root and empty roster', () => {
    expect(parse(base)?.proposalId).toBe('p1');
    expect(parse({ ...base, options: ['Confirm', 'Decline'] })).toBeNull();
    expect(parse({ ...base, nonce: 'old' })).toBeNull();
    expect(parse({ ...base, rootSessionId: 'other' })).toBeNull();
    expect(parse({ ...base, lanes: [] })).toBeNull();
  });
  it('rejects disabled, exhausted and missing lanes', () => {
    expect(
      parse(base, { ...availability, disabledClis: ['codex'] }),
    ).toBeNull();
    expect(
      parse(base, {
        ...availability,
        lanes: [{ ...availability.lanes[0], state: 'AT LIMIT' }],
      }),
    ).toBeNull();
    expect(parse(base, { lanes: [], disabledClis: [] })).toBeNull();
  });
  it('uses the Tribunal rule to block Relay self review', () => {
    const lanes = [
      { ...lane, role: 'plan' },
      { ...lane, laneId: 'codex#2', role: 'architect' },
      { ...lane, laneId: 'codex#3', role: 'implement' },
      {
        ...lane,
        laneId: 'copilot#1',
        cli: 'copilot',
        family: 'codex',
        role: 'review',
      },
    ];
    expect(parse({ ...base, move: 'relay', lanes })).toBeNull();
  });
  it('rejects roles on flat moves, duplicate IDs and round bounds', () => {
    expect(parse({ ...base, lanes: [{ ...lane, role: 'review' }] })).toBeNull();
    expect(parse({ ...base, lanes: [lane, lane] })).toBeNull();
    expect(parse({ ...base, rounds: MAX_CRUCIBLE_ROUND_CAP + 1 })).toBeNull();
  });
  it('ranks available lanes by saved family preference after filtering disabled and exhausted', () => {
    const current: ProposalAvailability = {
      lanes: [
        { ...availability.lanes[0], state: 'AT LIMIT' },
        availability.lanes[1],
        availability.lanes[2],
        availability.lanes[3],
      ],
      disabledClis: ['copilot'],
    };
    expect(
      rankAvailableLanes(current, ['cursor', 'codex']).map(
        (item) => item.laneId,
      ),
    ).toEqual(['cursor#1', 'codex#2']);
  });
});
