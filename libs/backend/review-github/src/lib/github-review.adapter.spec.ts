import type { ISecretStorage } from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';
import type { RepoIdentity } from '@ptah-extension/review-contracts';
import { GithubReviewAdapter } from './github-review.adapter';
import { GitHubReviewError } from './github-review.error';

const repo: RepoIdentity = { owner: 'Hive-Academy', name: 'PtahCode' };
const sha = 'a'.repeat(40);
const base = 'b'.repeat(40);
const pull = { number: 4, head: { sha, repo: { id: 2 } }, base: { sha: base, repo: { id: 1 } },
  state: 'open', draft: true, user: { login: 'author' } };
const response = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(body === null ? null : JSON.stringify(body), { status, headers });

function setup(fetcher: typeof fetch) {
  const get = jest.fn().mockResolvedValue('sensitive-token');
  const secrets = { get } as Pick<ISecretStorage, 'get'>;
  const logger = { warn: jest.fn(), error: jest.fn() } as Pick<Logger, 'warn' | 'error'>;
  const adapter = new GithubReviewAdapter(secrets as ISecretStorage, logger as Logger, fetcher);
  return { adapter, get, logger };
}

describe('GithubReviewAdapter', () => {
  it('paginates and maps fork, draft, author, and token headers', async () => {
    const fetcher = jest.fn().mockResolvedValueOnce(response([pull], 200, {
      etag: '"one"', link: '<https://api.github.com/repos/Hive-Academy/PtahCode/pulls?page=2>; rel="next"',
    })).mockResolvedValueOnce(response([], 200));
    const { adapter, get } = setup(fetcher);
    const first = await adapter.listOpenPulls(repo);
    expect(first.items[0]).toMatchObject({ headIsFork: true, draft: true, authorLogin: 'author', headRepoId: 2 });
    expect(first.nextPage).toBe(2);
    await adapter.listOpenPulls(repo, undefined, 2);
    expect(get).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer sensitive-token');
  });

  it('returns a prior matching snapshot on ETag 304', async () => {
    const fetcher = jest.fn().mockResolvedValueOnce(response([pull], 200, { etag: '"one"' }))
      .mockResolvedValueOnce(response(null, 304));
    const { adapter } = setup(fetcher);
    await adapter.listOpenPulls(repo);
    expect(await adapter.listOpenPulls(repo, '"one"')).toMatchObject({ notModified: true, items: [{ number: 4 }] });
    expect(fetcher.mock.calls[1][1].headers['If-None-Match']).toBe('"one"');
  });

  it.each([401, 403])('types authentication and scope errors for HTTP %i', async status => {
    const { adapter } = setup(jest.fn().mockResolvedValue(response({}, status)));
    await expect(adapter.getPull(repo, 4)).rejects.toMatchObject({
      code: status === 401 ? 'authentication' : 'permission',
    });
  });

  it('defers on rate limit with Retry-After', async () => {
    const { adapter } = setup(jest.fn().mockResolvedValue(response({}, 429, { 'retry-after': '2' })));
    await expect(adapter.getPull(repo, 4)).rejects.toMatchObject({ code: 'rate-limit', retryAt: expect.any(Date) });
  });

  it('rejects malformed JSON instead of returning empty results', async () => {
    const { adapter } = setup(jest.fn().mockResolvedValue(new Response('{broken', { status: 200 })));
    await expect(adapter.listOpenPulls(repo)).rejects.toMatchObject({ code: 'malformed-response' });
  });

  it('reads only bot-authored issue comments', async () => {
    const fetcher = jest.fn().mockResolvedValueOnce(response([
      { id: 1, body: 'ours', user: { login: 'bot' }, created_at: '2026-01-01T00:00:00Z' },
      { id: 2, body: 'other', user: { login: 'person' }, created_at: '2026-01-01T00:00:00Z' },
    ])).mockResolvedValueOnce(response({ login: 'bot' }));
    const { adapter } = setup(fetcher);
    expect((await adapter.listOwnIssueComments(repo, 4)).items.map(x => x.id)).toEqual([1]);
  });

  it('reads diff and file metadata and marks omitted patches truncated', async () => {
    const fetcher = jest.fn().mockResolvedValueOnce(response(pull))
      .mockResolvedValueOnce(new Response('diff --git a/x b/x', { status: 200 }))
      .mockResolvedValueOnce(response([{ filename: 'x', status: 'modified', additions: 1, deletions: 1, changes: 2 }]));
    const { adapter } = setup(fetcher);
    expect(await adapter.getDiff(repo, 4, sha)).toMatchObject({ headSha: sha, baseSha: base, truncated: true });
  });

  it('retries transient 5xx GET responses', async () => {
    const fetcher = jest.fn().mockResolvedValueOnce(response({}, 503)).mockResolvedValueOnce(response(pull));
    const { adapter } = setup(fetcher);
    expect((await adapter.getPull(repo, 4)).number).toBe(4);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('times out and keeps the token out of errors and logs', async () => {
    const fetcher = jest.fn((_url: URL | RequestInfo, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('sensitive-token')));
    }));
    const { adapter, logger } = setup(fetcher);
    jest.useFakeTimers();
    try {
      const pending = adapter.getPull(repo, 4);
      const assertion = expect(pending).rejects.toMatchObject({ code: 'timeout' });
      await jest.advanceTimersByTimeAsync(15_000);
      await assertion;
      expect(JSON.stringify(logger)).not.toContain('sensitive-token');
    } finally { jest.useRealTimers(); }
  });

  it('disables P1 publication with a typed error', async () => {
    const { adapter } = setup(jest.fn());
    await expect(adapter.upsertWalkthrough(repo, 4, 'x')).rejects.toBeInstanceOf(GitHubReviewError);
    await expect(adapter.upsertWalkthrough(repo, 4, 'x')).rejects.toMatchObject({ code: 'publication-unavailable' });
  });
});
