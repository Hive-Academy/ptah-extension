import * as phase from './phase';

describe('Tribunal phase entry', () => {
  it('exports only the approved pure runtime surface', () => {
    expect(Object.keys(phase).sort()).toEqual([
      'CRUCIBLE_ROLES',
      'DEFAULT_CRUCIBLE_ROUND_CAP',
      'MAX_CRUCIBLE_ROUND_CAP',
      'RELAY_ROLES',
      'TRIBUNAL_MOVES',
      'buildApprovedRootFraming',
      'buildTribunalFraming',
      'derivePhase',
      'laneTag',
      'rosterIsLaunchable',
      'roundCapFor',
    ]);
  });
});
