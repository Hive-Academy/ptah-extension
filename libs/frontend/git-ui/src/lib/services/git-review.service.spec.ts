import { TestBed } from '@angular/core/testing';
import { VSCodeService } from '@ptah-extension/core';
import { GitReviewService } from './git-review.service';
const rpc = jest.fn();
const state = { getState: jest.fn(), setState: jest.fn() };
jest.mock('@ptah-extension/core', () => ({
  ...jest.requireActual('@ptah-extension/core'),
  rpcCall: (...args: unknown[]) => rpc(...args),
}));
describe('GitReviewService', () => {
  beforeEach(() => {
    rpc.mockReset();
    state.getState.mockReturnValue([]);
    TestBed.configureTestingModule({
      providers: [
        GitReviewService,
        { provide: VSCodeService, useValue: state },
      ],
    });
  });
  afterEach(() => TestBed.resetTestingModule());
  it('partitions viewed state by workspace and SHA pair', async () => {
    rpc.mockResolvedValue({
      success: true,
      data: {
        success: true,
        base: { name: 'main', sha: 'a' },
        head: { name: 'feature', sha: 'b' },
        mergeBaseSha: 'c',
        files: [
          {
            path: 'a.ts',
            status: 'M',
            additions: 1,
            deletions: 0,
            binary: false,
          },
        ],
        totals: { additions: 1, deletions: 0, binaryFiles: 0 },
      },
    });
    const service = TestBed.inject(GitReviewService);
    service.switchWorkspace('/one');
    service.setMode('branch-review');
    await service.refresh();
    service.toggleViewed('a.ts');
    expect(service.isViewed('a.ts')).toBe(true);
    service.switchWorkspace('/two');
    expect(service.isViewed('a.ts')).toBe(false);
  });
});
