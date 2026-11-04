import { IncrementalScopeService } from './incremental-scope.service';

const sha = 'a'.repeat(40);
const previous = 'b'.repeat(40);

describe('IncrementalScopeService', () => {
  const service = new IncrementalScopeService();

  it('includes new commit paths, unchanged callers and every old open failure', () => {
    expect(service.plan({ headSha: sha, previousReviewedHeadSha: previous,
      newCommitPaths: ['src/changed.ts', 'src/changed.ts'],
      touchedCallers: [{ path: 'src/caller.ts', outsideDiff: true }, { path: 'src/changed.ts', outsideDiff: false }],
      openFailures: [{ id: 'root-1', path: 'src/old.ts' }] })).toEqual({
      headSha: sha, previousReviewedHeadSha: previous, changedPaths: ['src/changed.ts'],
      dependentPaths: ['src/caller.ts'], recheckFailureIds: ['root-1'],
      reviewPaths: ['src/changed.ts', 'src/caller.ts', 'src/old.ts'], publishNewVerifiedRootsOnly: true,
    });
  });

  it('treats a first review as a full new-root pass', () => {
    expect(service.plan({ headSha: sha, previousReviewedHeadSha: null, newCommitPaths: ['src/new.ts'],
      touchedCallers: [], openFailures: [] }).publishNewVerifiedRootsOnly).toBe(false);
  });

  it('treats a same-head rerun as a recheck and rejects unsafe path inputs', () => {
    expect(service.plan({ headSha: sha, previousReviewedHeadSha: sha, newCommitPaths: [],
      touchedCallers: [], openFailures: [{ id: 'root-1', path: 'src/old.ts' }] }).reviewPaths).toEqual(['src/old.ts']);
    expect(() => service.plan({ headSha: sha, previousReviewedHeadSha: previous, newCommitPaths: ['../outside'],
      touchedCallers: [], openFailures: [] })).toThrow();
  });
});
