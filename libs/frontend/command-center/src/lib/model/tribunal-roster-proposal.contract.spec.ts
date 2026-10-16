import {
  COMMAND_CENTER_PERSONA,
  TRIBUNAL_ROSTER_PROPOSAL_EXAMPLE,
  TRIBUNAL_ROSTER_PROPOSAL_TAG,
} from '@ptah-extension/chat-state';
import { SYSTEM_CLI_TYPES } from '@ptah-extension/shared';
import {
  CRUCIBLE_ROLES,
  RELAY_ROLES,
  TRIBUNAL_MOVES,
} from '@ptah-extension/tribunal-panel/phase';
import { parseRosterProposal } from './tribunal-roster-proposal';

describe('Tribunal roster persona contract', () => {
  it('parses the exact question text shown in the persona example', () => {
    const question = TRIBUNAL_ROSTER_PROPOSAL_EXAMPLE;
    expect(COMMAND_CENTER_PERSONA).toContain(
      `Example format (replace nonce, root ID, objective, and lanes with the current values): ${question}`,
    );
    expect(question.startsWith(`<${TRIBUNAL_ROSTER_PROPOSAL_TAG}>`)).toBe(true);
    expect(question.endsWith(`</${TRIBUNAL_ROSTER_PROPOSAL_TAG}>`)).toBe(true);
    expect(
      parseRosterProposal(question, 'root-from-request', 'nonce-from-request', {
        lanes: [
          { laneId: 'codex#1', family: 'codex', cli: 'codex', state: 'READY' },
        ],
        disabledClis: [],
      })?.proposalId,
    ).toBe('proposal-1');
  });

  it('names every schema field, delimiter, and allowed enum value', () => {
    expect(COMMAND_CENTER_PERSONA).toContain(
      `<${TRIBUNAL_ROSTER_PROPOSAL_TAG}>`,
    );
    expect(COMMAND_CENTER_PERSONA).toContain(
      `</${TRIBUNAL_ROSTER_PROPOSAL_TAG}>`,
    );
    for (const key of [
      'proposalId',
      'nonce',
      'rootSessionId',
      'move',
      'options',
      'objective',
      'rounds',
      'lanes',
      'laneId',
      'family',
      'displayName',
      'cli',
      'role',
    ])
      expect(COMMAND_CENTER_PERSONA).toContain(key);
    expect(COMMAND_CENTER_PERSONA).toContain(TRIBUNAL_MOVES.join(', '));
    expect(COMMAND_CENTER_PERSONA).toContain(
      [...SYSTEM_CLI_TYPES, 'ptah-cli'].join(', '),
    );
    expect(COMMAND_CENTER_PERSONA).toContain(
      [...RELAY_ROLES, ...CRUCIBLE_ROLES].join(', '),
    );
  });
});
