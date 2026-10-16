import type { LaneLimitState, OutcomeTaskKind } from '@ptah-extension/shared';
import { CLOSENESS_BAND } from '../routing-constants';
import { toSubagentCandidate, type LaneCandidate } from './candidate.types';
import {
  emptyRotationState,
  lastCandidateId,
  rotationKey,
  withPick,
  type RotationState,
} from './rotation.store';
import {
  spread,
  type RankedCandidate,
  type SpreadInput,
  type SpreadPreferences,
  type SpreadResult,
} from './spread';

function lane(
  id: string,
  limitState: LaneLimitState = 'confirmed-room',
  preferredRank?: number,
): LaneCandidate {
  return {
    kind: 'lane',
    id,
    cli: 'codex',
    family: 'codex',
    installed: true,
    disabled: false,
    limitState,
    ...(preferredRank !== undefined ? { preferredRank } : {}),
  };
}

function ranked(
  id: string,
  score: number,
  limitState: LaneLimitState = 'confirmed-room',
  preferredRank?: number,
): RankedCandidate {
  return { candidate: lane(id, limitState, preferredRank), score };
}

function subagent(role: string, score: number): RankedCandidate {
  return { candidate: toSubagentCandidate(role), score };
}

function decide(
  candidates: readonly RankedCandidate[],
  rotation: RotationState = emptyRotationState(),
  preferences?: SpreadPreferences,
  phaseId = 'build',
  taskKind: OutcomeTaskKind = 'implement',
): SpreadResult {
  return spread({ phaseId, taskKind, candidates, preferences, rotation });
}

function pickId(result: SpreadResult): string {
  const id = result.pick?.candidate.id;
  if (id === undefined) throw new Error('expected a pick');
  return id;
}

function ids(result: SpreadResult): string[] {
  return result.ranking.map((entry) => entry.candidate.id);
}

describe('spread requirement 7.1', () => {
  it('chooses N different lanes across N consecutive decisions for one key', () => {
    const candidates = [ranked('a', 50), ranked('b', 50), ranked('c', 50)];
    const picks: string[] = [];
    let rotation = emptyRotationState();
    let changed = false;
    for (let step = 0; step < candidates.length; step += 1) {
      const result = decide(candidates, rotation);
      picks.push(pickId(result));
      changed = result.rotationChangedChoice;
      rotation = result.rotation;
    }

    expect(new Set(picks).size).toBe(candidates.length);
    expect(picks).toEqual(['a', 'b', 'c']);
    expect(changed).toBe(true);
    const wrapped = decide(candidates, rotation);
    expect(pickId(wrapped)).toBe('a');
    expect(wrapped.rotationChangedChoice).toBe(false);
    expect(wrapped.key).toBe('build|implement');
  });
});

describe('spread requirement 7.2', () => {
  it('chooses the confirmed-room lane when the other is within B and unknown', () => {
    const result = decide([
      ranked('unknown-lane', 80, 'unknown'),
      ranked('room', 78, 'confirmed-room'),
    ]);

    expect(pickId(result)).toBe('room');
    expect(ids(result)).toEqual(['room', 'unknown-lane']);
  });

  it('chooses confirmed-room over near-limit inside the band', () => {
    const result = decide([
      ranked('near', 80, 'near-limit'),
      ranked('room', 76, 'confirmed-room'),
    ]);

    expect(pickId(result)).toBe('room');
  });

  it('ranks unknown ahead of near-limit and does not treat unknown as room', () => {
    const unknownVsNear = decide([
      ranked('near', 50, 'near-limit'),
      ranked('missing', 50, 'unknown'),
    ]);
    expect(pickId(unknownVsNear)).toBe('missing');

    const roomWins = decide([
      ranked('missing', 80, 'unknown'),
      ranked('room', 76, 'confirmed-room'),
    ]);
    expect(pickId(roomWins)).toBe('room');
    expect(ids(roomWins)).toEqual(['room', 'missing']);
  });

  it('does not rotate a worse limit class into the pick', () => {
    const key = rotationKey('build', 'implement');
    const rotation = withPick(emptyRotationState(), key, 'missing');
    const result = decide(
      [ranked('missing', 80, 'unknown'), ranked('room', 80, 'confirmed-room')],
      rotation,
    );

    expect(pickId(result)).toBe('room');
  });
});

describe('spread requirement 7.3', () => {
  const leader = 80;

  it('pins the documented closeness band', () => {
    expect(CLOSENESS_BAND).toBe(5);
  });

  it('keeps a lane inside the band when it trails by B-1', () => {
    const key = rotationKey('build', 'implement');
    const rotation = withPick(emptyRotationState(), key, 'leader');
    const result = decide(
      [
        ranked('leader', leader),
        ranked('weaker', leader - (CLOSENESS_BAND - 1)),
      ],
      rotation,
    );

    expect(pickId(result)).toBe('weaker');
    expect(result.rotationChangedChoice).toBe(true);
  });

  it('keeps a lane inside the band when it trails by exactly B', () => {
    const key = rotationKey('build', 'implement');
    const rotation = withPick(emptyRotationState(), key, 'leader');
    const result = decide(
      [ranked('leader', leader), ranked('weaker', leader - CLOSENESS_BAND)],
      rotation,
    );

    expect(pickId(result)).toBe('weaker');
  });

  it('does not rotate a lane that trails by B+1', () => {
    const key = rotationKey('build', 'implement');
    const onLeader = withPick(emptyRotationState(), key, 'leader');
    const onWeaker = withPick(emptyRotationState(), key, 'weaker');
    const candidates = [
      ranked('leader', leader),
      ranked('weaker', leader - (CLOSENESS_BAND + 1)),
    ];

    expect(pickId(decide(candidates, onLeader))).toBe('leader');
    const held = decide(candidates, onWeaker);
    expect(pickId(held)).toBe('leader');
    expect(held.rotationChangedChoice).toBe(false);
    expect(ids(held)).toEqual(['leader', 'weaker']);
  });
});

describe('spread requirement 7.4', () => {
  it('returns the same choice for the same inputs and rotation state', () => {
    const rotation = withPick(
      emptyRotationState(),
      rotationKey('build', 'implement'),
      'a',
    );
    const input: SpreadInput = {
      phaseId: 'build',
      taskKind: 'implement',
      candidates: [
        ranked('a', 80),
        ranked('b', 78),
        ranked('c', 70, 'near-limit'),
      ],
      preferences: { prefer: ['b'] },
      rotation,
    };
    const before = rotation.entries.map((entry) => ({ ...entry }));

    expect(spread(input)).toEqual(spread(input));
    expect(rotation.entries).toEqual(before);
  });
});

describe('spread requirement 7.6', () => {
  it('drops an at-limit lane and keeps the others in rotation order', () => {
    const candidates = [ranked('a', 50), ranked('b', 50), ranked('c', 50)];
    let rotation = emptyRotationState();
    expect(pickId(decide(candidates, rotation))).toBe('a');
    rotation = decide(candidates, rotation).rotation;
    expect(pickId(decide(candidates, rotation))).toBe('b');
    rotation = decide(candidates, rotation).rotation;

    const skipped = decide(
      [ranked('a', 50), ranked('b', 50, 'at-limit'), ranked('c', 50)],
      rotation,
    );
    expect(pickId(skipped)).toBe('c');
    expect(ids(skipped)).toEqual(['c', 'a']);
    rotation = skipped.rotation;

    const returned = decide(candidates, rotation);
    expect(pickId(returned)).toBe('a');
    const reentered = decide(candidates, returned.rotation);
    expect(pickId(reentered)).toBe('b');
  });

  it('keeps tie-break order when the last lane becomes at-limit', () => {
    const key = rotationKey('build', 'implement');
    const rotation = withPick(emptyRotationState(), key, 'c');
    const result = decide(
      [
        ranked('a', 50, 'confirmed-room', 1),
        ranked('c', 50, 'at-limit', 2),
        ranked('b', 50, 'confirmed-room', 3),
      ],
      rotation,
    );

    expect(pickId(result)).toBe('b');
  });

  it('ignores an at-limit lane even when its score is higher', () => {
    const result = decide([ranked('hot', 100, 'at-limit'), ranked('room', 40)]);

    expect(pickId(result)).toBe('room');
    expect(ids(result)).toEqual(['room']);
  });
});

describe('spread tie-break', () => {
  it('ranks the pick, the rest of the band, then others by score', () => {
    const key = rotationKey('build', 'implement');
    const rotation = withPick(emptyRotationState(), key, 'a');
    const result = decide(
      [
        ranked('a', 80),
        ranked('b', 80),
        ranked('c', 78, 'unknown'),
        ranked('d', 70),
      ],
      rotation,
    );

    expect(ids(result)).toEqual(['b', 'a', 'c', 'd']);
    expect(result.rotationChangedChoice).toBe(true);
  });

  it('orders a preferred id ahead of an earlier id inside the band', () => {
    const result = decide(
      [ranked('a', 50), ranked('b', 50)],
      emptyRotationState(),
      { prefer: ['b'] },
    );

    expect(pickId(result)).toBe('b');
    expect(result.preferenceChangedChoice).toBe(true);
    expect(result.rotationChangedChoice).toBe(false);
  });

  it('does not let a preference lift a lane across the band', () => {
    const result = decide(
      [ranked('a', 80), ranked('b', 70)],
      emptyRotationState(),
      { prefer: ['b'] },
    );

    expect(pickId(result)).toBe('a');
    expect(result.preferenceChangedChoice).toBe(false);
  });

  it('does not let a preference lift a near-limit lane over confirmed-room', () => {
    const result = decide(
      [ranked('room', 50), ranked('near', 50, 'near-limit')],
      emptyRotationState(),
      { prefer: ['near'] },
    );

    expect(pickId(result)).toBe('room');
    expect(result.preferenceChangedChoice).toBe(false);
  });

  it('orders preferredRank ascending, and ranked before unranked', () => {
    const result = decide([
      ranked('a', 50, 'confirmed-room', 0),
      ranked('c', 50),
      ranked('b', 50, 'confirmed-room', 2),
      ranked('d', 50, 'confirmed-room', 1),
    ]);

    expect(pickId(result)).toBe('d');
    expect(result.preferenceChangedChoice).toBe(true);
  });

  it('orders a lane ahead of a subagent in the same limit class', () => {
    const result = decide([subagent('alpha', 50), ranked('z', 50)]);

    expect(pickId(result)).toBe('z');
  });

  it('keeps a subagent with the best lane class and leaves a worse class out', () => {
    const result = decide([
      ranked('near', 50, 'near-limit'),
      ranked('room', 50),
      subagent('helper', 50),
    ]);

    expect(ids(result)).toEqual(['room', 'subagent:helper', 'near']);
  });

  it('does not treat a subagent as better than the best lane class', () => {
    const result = decide([
      ranked('missing', 50, 'unknown'),
      subagent('helper', 50),
    ]);

    expect(pickId(result)).toBe('missing');
  });

  it('rotates subagents by id when no lane is eligible', () => {
    const result = decide([subagent('b', 50), subagent('a', 50)]);

    expect(pickId(result)).toBe('subagent:a');
  });

  it('advances by tie-break order when the last pick is still eligible', () => {
    const key = rotationKey('build', 'implement');
    const rotation = withPick(emptyRotationState(), key, 'a');
    const result = decide(
      [
        ranked('b', 50, 'confirmed-room', 3),
        ranked('c', 50, 'confirmed-room', 2),
        ranked('a', 50, 'confirmed-room', 1),
      ],
      rotation,
    );

    expect(pickId(result)).toBe('c');
  });

  it('places a cursor whose candidate is absent by id order', () => {
    const key = rotationKey('build', 'implement');
    const rotation = withPick(emptyRotationState(), key, 'm');
    const result = decide(
      [
        ranked('a', 50, 'confirmed-room', 1),
        ranked('z', 50, 'confirmed-room', 3),
      ],
      rotation,
    );

    expect(pickId(result)).toBe('z');
  });

  it('leaves another phase key untouched', () => {
    const other = rotationKey('plan-phase', 'plan');
    const rotation = withPick(emptyRotationState(), other, 'kept');
    const result = decide([ranked('a', 50)], rotation);

    expect(lastCandidateId(result.rotation, other)).toBe('kept');
    expect(lastCandidateId(result.rotation, result.key)).toBe('a');
  });

  it('returns no pick when every lane is at-limit', () => {
    const rotation = emptyRotationState();
    const result = decide([ranked('a', 80, 'at-limit')], rotation);

    expect(result.pick).toBeNull();
    expect(result.ranking).toEqual([]);
    expect(result.rotation).toBe(rotation);
    expect(result.rotationChangedChoice).toBe(false);
    expect(result.preferenceChangedChoice).toBe(false);
  });

  it('rejects a duplicate candidate id', () => {
    expect(() => decide([ranked('a', 50), ranked('a', 40)])).toThrow(/unique/);
  });

  it('rejects a score off the routing scale', () => {
    expect(() => decide([ranked('a', 101)])).toThrow(/integer/);
  });
});
