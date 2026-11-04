import { ReviewRepositoryUnavailableError } from './context-stage.runner';
import { ContextStageRunner } from './context-stage.runner';
import { ReviewWorktreeService } from '../context/review-worktree.service';
import { ReviewContextService } from '../context/review-context.service';
import { ReviewDependenciesService } from '../context/review-dependencies.service';
import { ReviewChecksService } from '../context/review-checks.service';
import { IncrementalScopeService } from '../context/incremental-scope.service';
import type { IReviewRepository } from '../persistence/review-repository.interface';
import type { IGitHubReviewPort } from '@ptah-extension/review-contracts';
import type { ReviewQueueClaim } from '../review-queue.service';

const claim: ReviewQueueClaim = {
  repo: { owner: 'Hive-Academy', name: 'PtahCode' }, prNumber: 1,
  headSha: 'a'.repeat(40), attemptId: 'attempt-1', trigger: 'poll',
  queuedAt: '2026-11-03T00:00:00Z', lease: { owner: 'worker', expiresAt: '2026-11-03T01:00:00Z' },
};
const readRepository = Object.create(null) as IReviewRepository;
readRepository.getLastReviewedHead = jest.fn().mockResolvedValue(null);
readRepository.getOpenFailures = jest.fn().mockResolvedValue([]);

describe('ContextStageRunner repository resolution', () => {
  it('feeds new-commit paths and old open failures into incremental evidence', async () => {
    const github = Object.create(null) as IGitHubReviewPort;
    github.getDiff = jest.fn().mockResolvedValue({ baseSha: 'b'.repeat(40), patch: 'full PR patch', truncated: false });
    const worktree = Object.create(ReviewWorktreeService.prototype) as ReviewWorktreeService;
    jest.spyOn(worktree, 'create').mockResolvedValue({ root: '/attempt', src: '/attempt/src', out: '/attempt/out', meta: '/attempt/meta' });
    jest.spyOn(worktree, 'snapshot').mockResolvedValue({ headSha: claim.headSha, checksum: 'checksum', files: [] });
    const context = Object.create(ReviewContextService.prototype) as ReviewContextService;
    jest.spyOn(context, 'diffSince').mockResolvedValue({ patch: 'incremental patch', changedPaths: ['src/new.ts'] });
    jest.spyOn(context, 'build').mockResolvedValue({ changedPaths: ['src/new.ts'], changedLockfiles: [],
      dependentPaths: ['src/caller.ts'], callers: [{ symbol: 'changedApi', path: 'src/caller.ts', line: 4, outsideDiff: true }] });
    const dependencies = Object.create(ReviewDependenciesService.prototype) as ReviewDependenciesService;
    jest.spyOn(dependencies, 'prepare').mockResolvedValue({ status: 'available', reason: null, source: 'test',
      lockfileSha256: null, scriptsDisabled: true, invocation: null });
    const checks = Object.create(ReviewChecksService.prototype) as ReviewChecksService;
    jest.spyOn(checks, 'run').mockResolvedValue([]);
    const repository = Object.create(null) as IReviewRepository;
    repository.getLastReviewedHead = jest.fn().mockResolvedValue('c'.repeat(40));
    repository.getOpenFailures = jest.fn().mockResolvedValue([{ id: 'root-1', path: 'src/old.ts' }]);
    const runner = new ContextStageRunner(github, { resolve: async () => ({ repoRoot: '/repo', attemptsRoot: '/attempts' }),
      settings: async () => null, baseConfig: async () => ({ version: 1 }) }, worktree, context, dependencies, checks,
    repository, new IncrementalScopeService());
    const result = await runner.run(claim);
    expect(context.diffSince).toHaveBeenCalledWith(claim.repo, '/attempt/src', 'c'.repeat(40), claim.headSha, expect.any(AbortSignal));
    expect(result.promptInput.diff).toBe('incremental patch');
    expect(JSON.parse(result.promptInput.deterministicEvidence).incrementalScope).toMatchObject({
      changedPaths: ['src/new.ts'], dependentPaths: ['src/caller.ts'], recheckFailureIds: ['root-1'],
      reviewPaths: ['src/new.ts', 'src/caller.ts', 'src/old.ts'], publishNewVerifiedRootsOnly: true,
    });
  });
  it('passes exported symbols and bounded changed-file checks into deterministic context', async () => {
    const github = Object.create(null) as IGitHubReviewPort;
    github.getDiff = jest.fn().mockResolvedValue({ baseSha: 'b'.repeat(40), patch: 'diff --git a/libs/backend/sample/src/a.ts b/libs/backend/sample/src/a.ts\n+export function changedApi() {}', truncated: false });
    const worktree = Object.create(ReviewWorktreeService.prototype) as ReviewWorktreeService;
    jest.spyOn(worktree, 'create').mockResolvedValue({ root: '/attempt', src: '/attempt/src', out: '/attempt/out', meta: '/attempt/meta' });
    jest.spyOn(worktree, 'snapshot').mockResolvedValue({ headSha: claim.headSha, checksum: 'checksum', files: [] });
    const context = Object.create(ReviewContextService.prototype) as ReviewContextService;
    const build = jest.spyOn(context, 'build').mockResolvedValue({ changedPaths: ['libs/backend/sample/src/a.ts'],
      changedLockfiles: [], dependentPaths: ['libs/backend/other/src/b.ts'],
      callers: [{ symbol: 'changedApi', path: 'libs/backend/other/src/b.ts', line: 4, outsideDiff: true }] });
    const dependencies = Object.create(ReviewDependenciesService.prototype) as ReviewDependenciesService;
    jest.spyOn(dependencies, 'prepare').mockResolvedValue({ status: 'available', reason: null, source: 'test',
      lockfileSha256: null, scriptsDisabled: true, invocation: null });
    const checks = Object.create(ReviewChecksService.prototype) as ReviewChecksService;
    const runChecks = jest.spyOn(checks, 'run').mockResolvedValue([]);
    const baseConfig = jest.fn().mockResolvedValue({ version: 1, pathInstructions: [{ glob: 'src/**', instruction: 'Check callers' }] });
    const runner = new ContextStageRunner(github, { resolve: async () => ({ repoRoot: '/repo', attemptsRoot: '/attempts' }),
      settings: async () => null, baseConfig }, worktree, context, dependencies, checks,
    readRepository, new IncrementalScopeService());
    const result = await runner.run(claim);
    expect(build).toHaveBeenCalledWith(claim.repo, '/attempt/src', ['libs/backend/sample/src/a.ts'], ['changedApi'], expect.any(AbortSignal));
    expect(runChecks.mock.calls[0]?.[2]).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'eslint', args: expect.arrayContaining(['libs/backend/sample/src/a.ts']) }),
      expect.objectContaining({ name: 'degradation-audit', args: expect.arrayContaining(['--changed-files', 'libs/backend/sample/src/a.ts']) }),
    ]));
    expect(result.promptInput.fileContent).toContain('libs/backend/other/src/b.ts');
    expect(result.promptInput.repositoryRules).toContain('Check callers');
    expect(baseConfig).toHaveBeenCalledWith(claim.repo, 'b'.repeat(40));
    baseConfig.mockResolvedValue({ version: 1, checks: { eslint: false, degradationAudit: true } });
    await runner.run(claim);
    expect(runChecks.mock.calls[1]?.[2]).toEqual([
      expect.objectContaining({ name: 'degradation-audit' }),
    ]);
  });
  it('rejects an expired attempt before repository work starts', async () => {
    const resolve = jest.fn();
    const worktree = Object.create(ReviewWorktreeService.prototype) as ReviewWorktreeService;
    const create = jest.spyOn(worktree, 'create');
    const runner = new ContextStageRunner(Object.create(null) as IGitHubReviewPort,
      { resolve, settings: async () => null, baseConfig: async () => null }, worktree,
      Object.create(ReviewContextService.prototype) as ReviewContextService,
      Object.create(ReviewDependenciesService.prototype) as ReviewDependenciesService,
      Object.create(ReviewChecksService.prototype) as ReviewChecksService,
      readRepository, new IncrementalScopeService());
    await expect(runner.run(claim, Date.now() - 1)).rejects.toThrow('deadline');
    expect(resolve).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
  it('rejects an unconfigured repository before touching a worktree or GitHub', async () => {
    const github = Object.create(null) as IGitHubReviewPort;
    github.getDiff = jest.fn();
    const worktree = Object.create(ReviewWorktreeService.prototype) as ReviewWorktreeService;
    const create = jest.spyOn(worktree, 'create');
    const runner = new ContextStageRunner(
      github,
      { resolve: async () => { throw new ReviewRepositoryUnavailableError(); }, settings: async () => null, baseConfig: async () => null },
      worktree,
      Object.create(ReviewContextService.prototype) as ReviewContextService,
      Object.create(ReviewDependenciesService.prototype) as ReviewDependenciesService,
      Object.create(ReviewChecksService.prototype) as ReviewChecksService,
      readRepository, new IncrementalScopeService(),
    );

    await expect(runner.run(claim)).rejects.toBeInstanceOf(ReviewRepositoryUnavailableError);
    expect(create).not.toHaveBeenCalled();
    expect(github.getDiff).not.toHaveBeenCalled();
  });
});
