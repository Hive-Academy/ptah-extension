import type { ExecGitBufferResult, ExecGitResult } from '../utils/exec-git';
import { GitReviewReaderService } from './git-review-reader.service';

const sha = (digit: string): string => digit.repeat(40);
const ok = (stdout: string): ExecGitResult => ({
  stdout,
  stderr: '',
  exitCode: 0,
});

describe('GitReviewReaderService', () => {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(() => jest.clearAllMocks());

  it('warns with counts only when name-status and numstat entries diverge', async () => {
    const textRunner = jest.fn(
      async (args: string[]): Promise<ExecGitResult> => {
        if (args[0] === 'rev-parse') {
          return ok(args.at(-1)?.startsWith('base') ? sha('1') : sha('2'));
        }
        if (args[0] === 'merge-base') return ok(sha('1'));
        if (args.includes('--name-status')) return ok('M\0one.ts\0A\0two.ts\0');
        return ok('3\t1\tone.ts\0');
      },
    );
    const reader = new GitReviewReaderService(
      logger as never,
      undefined,
      256,
      textRunner,
    );

    const result = await reader.reviewChanges('/repo', 'base', 'head');

    expect(result.success).toBe(true);
    expect(result.files).toHaveLength(2);
    expect(logger.warn).toHaveBeenCalledWith(
      '[GitReviewReaderService] review parser count mismatch',
      { nameStatusCount: 2, matchedNumstatCount: 1 },
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('one.ts');
  });

  it('evicts old issued pairs, rejects them, and re-issues on reviewChanges', async () => {
    const refShas: Record<string, string> = {
      base1: sha('1'),
      head1: sha('2'),
      base2: sha('3'),
      head2: sha('4'),
      base3: sha('5'),
      head3: sha('6'),
    };
    const textRunner = jest.fn(
      async (args: string[]): Promise<ExecGitResult> => {
        if (args[0] === 'rev-parse' && args.includes('--end-of-options')) {
          const ref = args.at(-1)?.replace(/\^\{commit\}$/, '') ?? '';
          return ok(refShas[ref] ?? '');
        }
        if (args[0] === 'merge-base') return ok(args[1]);
        if (args.includes('--name-status')) return ok('M\0file.ts\0');
        if (args.includes('--numstat')) return ok('1\t0\tfile.ts\0');
        return ok('true');
      },
    );
    const bufferRunner = jest.fn(
      async (): Promise<ExecGitBufferResult> => ({
        stdout: Buffer.from('body'),
        stderr: '',
        exitCode: 0,
      }),
    );
    const reader = new GitReviewReaderService(
      logger as never,
      undefined,
      2,
      textRunner,
      bufferRunner,
    );

    for (const pair of [1, 2, 3]) {
      await reader.reviewChanges('/repo', `base${pair}`, `head${pair}`);
    }
    const evicted = await reader.reviewFile('/repo', {
      baseSha: sha('1'),
      headSha: sha('2'),
      path: 'file.ts',
    });

    expect(evicted.success).toBe(false);
    expect(evicted.error).toBe(
      'This file was not issued by the selected review.',
    );
    expect(bufferRunner).not.toHaveBeenCalled();

    await reader.reviewChanges('/repo', 'base1', 'head1');
    const reissued = await reader.reviewFile('/repo', {
      baseSha: sha('1'),
      headSha: sha('2'),
      path: 'file.ts',
    });

    expect(reissued.success).toBe(true);
    expect(bufferRunner).toHaveBeenCalledTimes(2);
    expect(
      textRunner.mock.calls.filter(([args]) => args.includes('--name-status')),
    ).toHaveLength(4);
  });
});
