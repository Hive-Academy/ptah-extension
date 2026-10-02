import { TestBed } from '@angular/core/testing';
import { VSCodeService } from '@ptah-extension/core';
import type { GitHistoryCommit } from '@ptah-extension/shared';
import { GitHistoryService } from './git-history.service';

const mockRpcCall = jest.fn();
jest.mock('@ptah-extension/core', () => {
  const actual = jest.requireActual<Record<string, unknown>>(
    '@ptah-extension/core',
  );
  return {
    ...actual,
    rpcCall: (...args: unknown[]) => mockRpcCall(...args),
  };
});

const COMMIT: GitHistoryCommit = {
  sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
  shortSha: 'a1b2c3d',
  subject: 'feat: add hunk toolbar',
  authorName: 'Ada',
  authorDate: '2026-10-02T10:00:00+00:00',
  parentCount: 1,
  isRoot: false,
};

describe('GitHistoryService', () => {
  let service: GitHistoryService;

  beforeEach(() => {
    mockRpcCall.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    TestBed.configureTestingModule({
      providers: [{ provide: VSCodeService, useValue: {} }],
    });
    service = TestBed.inject(GitHistoryService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('reads git:log for the given workspace and returns the ok result', async () => {
    const data = {
      status: 'ok',
      mode: 'since-base',
      base: 'origin/main',
      branch: 'feat/x',
      commits: [COMMIT],
      truncated: false,
    };
    mockRpcCall.mockResolvedValue({ success: true, data });

    await expect(service.readLog('/ws/a')).resolves.toEqual(data);
    expect(mockRpcCall).toHaveBeenCalledWith(expect.anything(), 'git:log', {
      workspaceRoot: '/ws/a',
    });
  });

  it('passes a not-a-repository answer through', async () => {
    mockRpcCall.mockResolvedValue({
      success: true,
      data: { status: 'unavailable', reason: 'not-a-repository' },
    });
    await expect(service.readLog('/ws/a')).resolves.toEqual({
      status: 'unavailable',
      reason: 'not-a-repository',
    });
  });

  it.each([
    ['a transport failure', { success: false, error: 'boom' }],
    ['a missing payload', { success: true }],
    [
      'a malformed commit',
      {
        success: true,
        data: {
          status: 'ok',
          mode: 'recent',
          base: null,
          branch: 'main',
          commits: [{ sha: 1 }],
          truncated: false,
        },
      },
    ],
    [
      'an unknown mode',
      {
        success: true,
        data: {
          status: 'ok',
          mode: 'all',
          base: null,
          branch: 'main',
          commits: [],
          truncated: false,
        },
      },
    ],
  ])('turns %s into git-failed', async (_label, response) => {
    mockRpcCall.mockResolvedValue(response);
    await expect(service.readLog('/ws/a')).resolves.toEqual({
      status: 'unavailable',
      reason: 'git-failed',
    });
  });

  it('turns a thrown call into git-failed', async () => {
    mockRpcCall.mockRejectedValue(new Error('timeout'));
    await expect(service.readLog('/ws/a')).resolves.toEqual({
      status: 'unavailable',
      reason: 'git-failed',
    });
  });
});
