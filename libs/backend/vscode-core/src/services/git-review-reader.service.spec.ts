import { GIT_DIFF_MAX_SIDE_BYTES } from '@ptah-extension/shared';
import {
  GitOutputLimitError,
  type ExecGitBufferResult,
  type ExecGitResult,
} from '../utils/exec-git';
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

  it('reports a blob past the per-side cap as too-large with its real size', async () => {
    const textRunner = jest.fn(
      async (args: string[]): Promise<ExecGitResult> => {
        if (args[0] === 'rev-parse' && args.includes('--end-of-options')) {
          return ok(sha(args.at(-1)?.startsWith('base') ? '1' : '2'));
        }
        if (args[0] === 'merge-base') return ok(sha('1'));
        if (args.includes('--name-status')) return ok('M\0file.ts\0');
        if (args.includes('--numstat')) return ok('1\t0\tfile.ts\0');
        if (args[0] === 'cat-file' && args[1] === '-s') {
          return ok('3145728\n');
        }
        return ok('true');
      },
    );
    const bufferRunner = jest.fn(
      async (): Promise<ExecGitBufferResult> => {
        throw new GitOutputLimitError('show', GIT_DIFF_MAX_SIDE_BYTES);
      },
    );
    const reader = new GitReviewReaderService(
      logger as never,
      undefined,
      256,
      textRunner,
      bufferRunner,
    );
    await reader.reviewChanges('/repo', 'base', 'head');
    const result = await reader.reviewFile('/repo', {
      baseSha: sha('1'),
      headSha: sha('2'),
      path: 'file.ts',
    });

    expect(result.success).toBe(true);
    expect(result.original).toEqual({
      outcome: 'too-large',
      byteLength: 3145728,
    });
    expect(
      textRunner.mock.calls.find(([args]) =>
        args.includes('cat-file'),
      )?.[0],
    ).toEqual(['cat-file', '-s', `${sha('1')}:file.ts`]);
  });

  it('falls back to the cap when the blob size probe fails', async () => {
    const textRunner = jest.fn(
      async (args: string[]): Promise<ExecGitResult> => {
        if (args[0] === 'rev-parse' && args.includes('--end-of-options')) {
          return ok(sha(args.at(-1)?.startsWith('base') ? '1' : '2'));
        }
        if (args[0] === 'merge-base') return ok(sha('1'));
        if (args.includes('--name-status')) return ok('M\0file.ts\0');
        if (args.includes('--numstat')) return ok('1\t0\tfile.ts\0');
        if (args[0] === 'cat-file') throw new Error('spawn failed');
        return ok('true');
      },
    );
    const bufferRunner = jest.fn(
      async (): Promise<ExecGitBufferResult> => {
        throw new GitOutputLimitError('show', GIT_DIFF_MAX_SIDE_BYTES);
      },
    );
    const reader = new GitReviewReaderService(
      logger as never,
      undefined,
      256,
      textRunner,
      bufferRunner,
    );
    await reader.reviewChanges('/repo', 'base', 'head');
    const result = await reader.reviewFile('/repo', {
      baseSha: sha('1'),
      headSha: sha('2'),
      path: 'file.ts',
    });

    expect(result.success).toBe(true);
    expect(result.original).toEqual({
      outcome: 'too-large',
      byteLength: GIT_DIFF_MAX_SIDE_BYTES,
    });
  });

  it('classifies a Git LFS pointer blob', async () => {
    const pointer = Buffer.from(
      'version https://git-lfs.github.com/spec/v1\n' +
        'oid sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef12345678\n' +
        'size 12345\n',
    );
    const textRunner = jest.fn(
      async (args: string[]): Promise<ExecGitResult> => {
        if (args[0] === 'rev-parse' && args.includes('--end-of-options')) {
          return ok(sha(args.at(-1)?.startsWith('base') ? '1' : '2'));
        }
        if (args[0] === 'merge-base') return ok(sha('1'));
        if (args.includes('--name-status')) return ok('M\0file.ts\0');
        if (args.includes('--numstat')) return ok('1\t0\tfile.ts\0');
        return ok('true');
      },
    );
    const bufferRunner = jest.fn(
      async (): Promise<ExecGitBufferResult> => ({
        stdout: pointer,
        stderr: '',
        exitCode: 0,
      }),
    );
    const reader = new GitReviewReaderService(
      logger as never,
      undefined,
      256,
      textRunner,
      bufferRunner,
    );
    await reader.reviewChanges('/repo', 'base', 'head');
    const result = await reader.reviewFile('/repo', {
      baseSha: sha('1'),
      headSha: sha('2'),
      path: 'file.ts',
    });

    expect(result.success).toBe(true);
    expect(result.original).toEqual({
      outcome: 'lfs-pointer',
      oid: 'sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef12345678',
      size: 12345,
    });
    expect(bufferRunner).toHaveBeenCalledWith(
      ['show', `${sha('1')}:file.ts`],
      '/repo',
      { maxOutputBytes: GIT_DIFF_MAX_SIDE_BYTES },
    );
  });
});
