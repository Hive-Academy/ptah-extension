import { createRetentionSuites } from '../suites/memory/retention.suite';
import { createScopeWriteSuite } from '../suites/memory/scope-write.suite';
import {
  HOST_SUITE_PLACEMENTS,
  hostSuitePlacement,
  suitePlacementProblems,
  type SuitePlacement,
} from './suite-placement';

function problems(placements: readonly [string, SuitePlacement][]): string[] {
  const table = new Map(placements);
  return suitePlacementProblems(
    placements.map(([id]) => id),
    (id) => table.get(id) ?? 'any',
  ).map((problem) => `${problem.index}: ${problem.message}`);
}

describe('suitePlacementProblems', () => {
  it('accepts first, any, then a run of last suites', () => {
    expect(
      problems([
        ['f', 'first'],
        ['a', 'any'],
        ['l1', 'last'],
        ['l2', 'last'],
      ]),
    ).toEqual([]);
    expect(problems([])).toEqual([]);
  });

  it('refuses a first suite that is not first, including a second one', () => {
    expect(
      problems([
        ['f1', 'first'],
        ['f2', 'first'],
      ]),
    ).toEqual([
      '1: suite f2 must be the first host suite: it measures a database no other suite has written',
    ]);
  });

  it('refuses every non-last suite after the first last suite', () => {
    expect(
      problems([
        ['l', 'last'],
        ['a', 'any'],
        ['l2', 'last'],
        ['f', 'first'],
      ]),
    ).toEqual([
      '1: suite a must run before l, which archives and deletes every row of the shared database',
      '3: suite f must be the first host suite: it measures a database no other suite has written',
      '3: suite f must run before l, which archives and deletes every row of the shared database',
    ]);
  });
});

describe('HOST_SUITE_PLACEMENTS', () => {
  it('equals the placement each registered suite declares', () => {
    const declared = [
      createScopeWriteSuite(),
      ...createRetentionSuites({
        portOf: () => {
          throw new Error('not run');
        },
      }),
    ];
    expect(
      Object.fromEntries(
        declared.map((suite) => [suite.id, suite.placement ?? 'any']),
      ),
    ).toEqual(HOST_SUITE_PLACEMENTS);
  });

  it('defaults every other id to any', () => {
    expect(hostSuitePlacement('mem.liveness.audit')).toBe('any');
    expect(hostSuitePlacement('toString')).toBe('any');
  });
});
