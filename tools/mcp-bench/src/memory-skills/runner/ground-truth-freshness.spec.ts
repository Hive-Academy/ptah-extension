import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assertGroundTruthNotNewer,
  firstScoredRunsDir,
  GroundTruthFreshnessError,
  mergeGroundTruthRefs,
  readFirstScoredRuns,
  recordFirstScoredRuns,
  resolveGroundTruthCommits,
} from './ground-truth-freshness';
import type { GitRunner } from './read-path-guard';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

function fakeGit(
  status: string,
  log: string,
): GitRunner & { calls: string[][] } {
  const calls: string[][] = [];
  const git = (args: readonly string[]): string => {
    calls.push([...args]);
    if (args[0] === 'status') return status;
    if (args[0] === 'log') return log;
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
  return Object.assign(git, { calls });
}

describe('ground-truth freshness (design 10.1 guarantee 2)', () => {
  const ref = { id: 'gt-memory@v1', paths: ['fixtures/memory-facts.v1.jsonl'] };

  it('resolves the newest commit touching the ground-truth paths', () => {
    const git = fakeGit('', `${SHA_A}\u00002026-10-07T02:22:51+03:00\n`);
    expect(resolveGroundTruthCommits([ref], git)).toEqual([
      {
        id: 'gt-memory@v1',
        commit: SHA_A,
        committedAt: '2026-10-07T02:22:51+03:00',
      },
    ]);
    // Paths are passed as arguments after "--", never built into a string.
    expect(git.calls[1]).toEqual([
      'log',
      '-1',
      '--format=%H%x00%cI',
      '--',
      'fixtures/memory-facts.v1.jsonl',
    ]);
  });

  it('refuses uncommitted or untracked label changes', () => {
    const git = fakeGit(' M fixtures/memory-facts.v1.jsonl\n', '');
    expect(() => resolveGroundTruthCommits([ref], git)).toThrow(
      /uncommitted changes/,
    );
  });

  it('refuses a ground truth with no commit', () => {
    expect(() => resolveGroundTruthCommits([ref], fakeGit('', ''))).toThrow(
      /no commit touching/,
    );
  });

  it('refuses a commit newer than the first scored run, allows the same or an older one', () => {
    const ledger = {
      groundTruths: {
        'gt-memory@v1': {
          runId: 'ms-first',
          startedAt: '2026-10-07T00:00:00.000Z',
          commit: SHA_A,
          committedAt: '2026-10-06T23:00:00Z',
        },
      },
    } as const;
    expect(() =>
      assertGroundTruthNotNewer(
        [
          {
            id: 'gt-memory@v1',
            commit: SHA_B,
            committedAt: '2026-10-07T01:00:00Z',
          },
        ],
        ledger,
      ),
    ).toThrow(GroundTruthFreshnessError);
    expect(() =>
      assertGroundTruthNotNewer(
        [
          {
            id: 'gt-memory@v1',
            commit: SHA_A,
            committedAt: '2026-10-06T23:00:00Z',
          },
        ],
        ledger,
      ),
    ).not.toThrow();
    expect(() =>
      assertGroundTruthNotNewer(
        [
          {
            id: 'gt-memory@v1',
            commit: SHA_B,
            committedAt: '2026-10-06T22:00:00Z',
          },
        ],
        ledger,
      ),
    ).not.toThrow();
    // A new version id has no first scored run yet.
    expect(() =>
      assertGroundTruthNotNewer(
        [
          {
            id: 'gt-memory@v2',
            commit: SHA_B,
            committedAt: '2026-10-08T00:00:00Z',
          },
        ],
        ledger,
      ),
    ).not.toThrow();
  });

  it('never rewrites another id and keeps the first publisher on a race (review finding 4)', () => {
    const bench = mkdtempSync(join(tmpdir(), 'ptah-620-gtrace-'));
    try {
      const dir = firstScoredRunsDir(bench);
      const gtA = {
        id: 'gt-a@v1',
        commit: SHA_A,
        committedAt: '2026-10-06T23:00:00Z',
      };
      const gtB = {
        id: 'gt-b@v1',
        commit: SHA_B,
        committedAt: '2026-10-06T23:00:00Z',
      };
      recordFirstScoredRuns(dir, [gtA], {
        runId: 'ms-a',
        startedAt: '2026-10-07T00:00:00.000Z',
      });
      const [fileA] = readdirSync(dir);
      const bytesA = readFileSync(join(dir, fileA), 'utf8');

      // A second run that read the ledger before run A published (so it
      // believes both ids are new) publishes both: gt-a's link meets EEXIST
      // and run A's entry wins; gt-b is added beside it.
      const ledger = recordFirstScoredRuns(dir, [gtA, gtB], {
        runId: 'ms-b',
        startedAt: '2026-10-07T00:00:01.000Z',
      });
      expect(ledger.groundTruths['gt-a@v1'].runId).toBe('ms-a');
      expect(ledger.groundTruths['gt-b@v1'].runId).toBe('ms-b');
      expect(readFileSync(join(dir, fileA), 'utf8')).toBe(bytesA);
      // No temp file is left behind.
      expect(readdirSync(dir).filter((name) => name.endsWith('.tmp'))).toEqual(
        [],
      );
    } finally {
      rmSync(bench, { recursive: true, force: true });
    }
  });

  it('records only ids scored for the first time', () => {
    const bench = mkdtempSync(join(tmpdir(), 'ptah-620-gtledger-'));
    try {
      const path = firstScoredRunsDir(bench);
      expect(readFirstScoredRuns(path).groundTruths).toEqual({});
      const gt = {
        id: 'gt-memory@v1',
        commit: SHA_A,
        committedAt: '2026-10-06T23:00:00Z',
      };
      recordFirstScoredRuns(path, [gt], {
        runId: 'ms-1',
        startedAt: '2026-10-07T00:00:00.000Z',
      });
      const second = recordFirstScoredRuns(
        path,
        [
          gt,
          {
            id: 'gt-merge@v1',
            commit: SHA_B,
            committedAt: '2026-10-06T23:30:00Z',
          },
        ],
        { runId: 'ms-2', startedAt: '2026-10-07T01:00:00.000Z' },
      );
      expect(second.groundTruths['gt-memory@v1'].runId).toBe('ms-1');
      expect(second.groundTruths['gt-merge@v1'].runId).toBe('ms-2');
      expect(readFirstScoredRuns(path)).toEqual(second);
      expect(readdirSync(path)).toHaveLength(2);
    } finally {
      rmSync(bench, { recursive: true, force: true });
    }
  });

  it('merges refs by id and refuses one id with two path sets', () => {
    expect(
      mergeGroundTruthRefs([
        ref,
        { id: ref.id, paths: [...ref.paths, ...ref.paths] },
      ]),
    ).toEqual([ref]);
    expect(() =>
      mergeGroundTruthRefs([ref, { id: ref.id, paths: ['other.jsonl'] }]),
    ).toThrow(/two different path sets/);
  });
});
