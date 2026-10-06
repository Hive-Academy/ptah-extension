import { TestBed } from '@angular/core/testing';
import type { GitInfoResult } from '@ptah-extension/shared';
import { ReviewWorktreeStatusService } from './review-worktree-status.service';
import { ReviewDiffService } from './review-diff.service';

const mockRpcCall = jest.fn();
jest.mock('@ptah-extension/core', () => ({
  rpcCall: (...args: unknown[]) => mockRpcCall(...args),
  VSCodeService: class VSCodeService {},
}));
const { VSCodeService } = jest.requireMock('@ptah-extension/core');

const ROOT = '/ws/.claude-worktrees/feature';

function info(overrides: Partial<GitInfoResult> = {}): GitInfoResult {
  return {
    isGitRepo: true,
    branch: { branch: 'feature', upstream: null, ahead: 0, behind: 0 },
    files: [{ path: 'a.ts', status: 'M', staged: false }],
    ...overrides,
  };
}

const reviewDiff = { invalidateRoot: jest.fn() };

function makeService(): ReviewWorktreeStatusService {
  TestBed.configureTestingModule({
    providers: [
      { provide: VSCodeService, useValue: {} },
      { provide: ReviewDiffService, useValue: reviewDiff },
    ],
  });
  return TestBed.inject(ReviewWorktreeStatusService);
}

beforeEach(() => {
  mockRpcCall.mockReset();
  reviewDiff.invalidateRoot.mockReset();
});

describe('ReviewWorktreeStatusService', () => {
  it("reads the worktree's status through git:info with its root", async () => {
    const service = makeService();
    mockRpcCall.mockResolvedValue({ success: true, data: info() });

    const pending = service.load(ROOT);
    expect(service.status()).toMatchObject({ root: ROOT, loading: true });
    await pending;

    expect(mockRpcCall.mock.calls[0][1]).toBe('git:info');
    expect(mockRpcCall.mock.calls[0][2]).toEqual({ workspaceRoot: ROOT });
    expect(service.status()).toEqual({
      root: ROOT,
      loading: false,
      branch: 'feature',
      files: [{ path: 'a.ts', status: 'M', staged: false }],
      error: null,
    });
  });

  it("invalidates the root's cached diffs each time it loads", async () => {
    const service = makeService();
    mockRpcCall.mockResolvedValue({ success: true, data: info() });
    await service.load(ROOT);
    await service.load(ROOT);
    expect(reviewDiff.invalidateRoot).toHaveBeenCalledTimes(2);
    expect(reviewDiff.invalidateRoot).toHaveBeenCalledWith(ROOT);
  });

  it('a root the backend does not accept reads as not available, never as a clean tree', async () => {
    const service = makeService();
    mockRpcCall.mockResolvedValue({
      success: true,
      data: info({ isGitRepo: false, files: [] }),
    });
    await service.load(ROOT);
    expect(service.status()?.error).toContain('not available');
  });

  it('a transport failure, a throw or an unreadable status is an error', async () => {
    const service = makeService();
    mockRpcCall.mockResolvedValueOnce({ success: false, error: 'down' });
    await service.load(ROOT);
    expect(service.status()?.error).toContain('could not be read');

    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockRpcCall.mockRejectedValueOnce(new Error('boom'));
    await service.load(ROOT);
    expect(service.status()?.error).toContain('could not be read');

    mockRpcCall.mockResolvedValueOnce({
      success: true,
      data: info({ statusUnavailable: 'error' }),
    });
    await service.load(ROOT);
    expect(service.status()?.error).toContain('could not be read');
  });

  it('only the latest load lands, and clear drops one in flight', async () => {
    const service = makeService();
    let resolveFirst: (value: unknown) => void = () => undefined;
    mockRpcCall.mockReturnValueOnce(
      new Promise((resolve) => (resolveFirst = resolve)),
    );
    const first = service.load('/ws/old');
    mockRpcCall.mockResolvedValueOnce({ success: true, data: info() });
    await service.load(ROOT);
    resolveFirst({ success: true, data: info({ files: [] }) });
    await first;
    expect(service.status()?.root).toBe(ROOT);

    mockRpcCall.mockReturnValueOnce(
      new Promise((resolve) => (resolveFirst = resolve)),
    );
    const third = service.load(ROOT);
    service.clear();
    resolveFirst({ success: true, data: info() });
    await third;
    expect(service.status()).toBeNull();
  });

  it('a re-read of the same root keeps its files on screen until it lands', async () => {
    const service = makeService();
    mockRpcCall.mockResolvedValueOnce({ success: true, data: info() });
    await service.load(ROOT);
    mockRpcCall.mockReturnValueOnce(new Promise(() => undefined));
    void service.load(ROOT);
    expect(service.status()).toMatchObject({
      loading: true,
      branch: 'feature',
      files: [{ path: 'a.ts' }],
    });
  });
});
