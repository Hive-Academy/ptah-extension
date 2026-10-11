import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import {
  MEMORY_SEED_ENV,
  MemorySeedEnvError,
  readMemorySeedRoots,
} from './memory-seed-env';

describe('readMemorySeedRoots', () => {
  const absolute = (name: string): string => resolve(tmpdir(), name);

  it('is null when the variable is unset or empty', () => {
    expect(readMemorySeedRoots({})).toBeNull();
    expect(readMemorySeedRoots({ [MEMORY_SEED_ENV]: '' })).toBeNull();
  });

  it('returns the three resolved absolute roots', () => {
    const roots = {
      rootA: absolute('a'),
      rootB: absolute('b'),
      worktreeOfA: absolute('wt'),
    };
    expect(
      readMemorySeedRoots({ [MEMORY_SEED_ENV]: JSON.stringify(roots) }),
    ).toEqual(roots);
  });

  it.each([
    ['not json', '{rootA'],
    [
      'a missing root',
      JSON.stringify({ rootA: absolute('a'), rootB: absolute('b') }),
    ],
    [
      'a relative root',
      JSON.stringify({
        rootA: 'a',
        rootB: absolute('b'),
        worktreeOfA: absolute('c'),
      }),
    ],
  ])('refuses %s with a typed error', (_label, raw) => {
    expect(() => readMemorySeedRoots({ [MEMORY_SEED_ENV]: raw })).toThrow(
      MemorySeedEnvError,
    );
  });
});
