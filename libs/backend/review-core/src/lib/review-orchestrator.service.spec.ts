import { Logger } from '@ptah-extension/vscode-core';
import type { IGitHubReviewPort } from '@ptah-extension/review-contracts';
import { ReviewOrchestratorService } from './review-orchestrator.service';
import { ReviewQueueService, type ReviewQueueClaim } from './review-queue.service';
import { ReviewPolicyService } from './review-policy.service';
import type { IReviewRepository, ReviewStageRecord } from './persistence/review-repository.interface';
import { DiscoveryStageRunner } from './stages/discovery-stage.runner';
import { ContextStageRunner, type ContextStageResult } from './stages/context-stage.runner';
import { TriageStageRunner } from './stages/triage-stage.runner';
import { LensStageRunner } from './stages/lens-stage.runner';
import { VerificationStageRunner } from './stages/verification-stage.runner';
import { PublicationStageRunner } from './stages/publication-stage.runner';

const sha = 'a'.repeat(40);
const claim: ReviewQueueClaim = { repo: { owner: 'Hive-Academy', name: 'PtahCode' }, prNumber: 1,
  headSha: sha, attemptId: 'attempt-1', trigger: 'poll', queuedAt: '2026-11-03T00:00:00Z',
  lease: { owner: 'worker', expiresAt: '2026-11-03T01:00:00Z' } };
const contextValue: ContextStageResult = { attemptRoot: '/attempt', coverage: [], promptInput: {
  headSha: sha, title: '', body: '', diff: '', comments: '', fileContent: '', deterministicEvidence: '', repositoryRules: '',
} };
const settings = { repositories: [{ owner: 'Hive-Academy', name: 'PtahCode', enabled: true, dryRun: true, publicationPaused: false }],
  maintainerLogins: ['maintainer'], pollMinutes: 10, globalPublicationPaused: false, fallbackFamilies: [] };

function fixture() {
  const stages = new Map<string, ReviewStageRecord>();
  const checkpoints = new Map<string, unknown>();
  const key = (name: string, ordinal: number) => `${name}:${ordinal}`;
  const repository: IReviewRepository = {
    enqueueDiscovered: jest.fn(), enqueueManual: jest.fn(),
    claimNext: jest.fn().mockResolvedValueOnce(claim).mockResolvedValue(null),
    heartbeat: jest.fn(), release: jest.fn().mockResolvedValue(true), reconcileExpiredLeases: jest.fn().mockResolvedValue(0),
    getAttempt: jest.fn(), getStages: async () => [...stages.values()],
    saveStage: async (row) => { stages.set(key(row.stage, row.ordinal), row); },
    saveCheckpoint: async (_id, name, ordinal, data) => { checkpoints.set(key(name, ordinal), data); },
    getCheckpoint: async (_id, name, ordinal) => checkpoints.get(key(name, ordinal)) ?? null,
  };
  const queue = Object.create(ReviewQueueService.prototype) as ReviewQueueService;
  const claimMock = jest.spyOn(queue, 'claim').mockImplementation(async () => repository.claimNext('worker', '', ''));
  const release = jest.spyOn(queue, 'release').mockResolvedValue(true);
  jest.spyOn(queue, 'reconcileStartup').mockResolvedValue(0);
  const discovery = Object.create(DiscoveryStageRunner.prototype) as DiscoveryStageRunner;
  const discover = jest.spyOn(discovery, 'run').mockResolvedValue(1);
  const context = Object.create(ContextStageRunner.prototype) as ContextStageRunner;
  const contextRun = jest.spyOn(context, 'run').mockResolvedValue(contextValue);
  const triage = Object.create(TriageStageRunner.prototype) as TriageStageRunner;
  const triageRun = jest.spyOn(triage, 'run').mockResolvedValue({ status: 'partial', reason: 'no-confirmed-room' });
  const lenses = Object.create(LensStageRunner.prototype) as LensStageRunner;
  const lensRun = jest.spyOn(lenses, 'run').mockResolvedValue([]);
  const verification = Object.create(VerificationStageRunner.prototype) as VerificationStageRunner;
  const verificationRun = jest.spyOn(verification, 'run').mockResolvedValue([]);
  const publication = Object.create(PublicationStageRunner.prototype) as PublicationStageRunner;
  jest.spyOn(publication, 'run').mockResolvedValue({ artifactPath: '/attempt/out/review-preview.md',
    exportPath: '/attempt/out/review-export.json', acceptedCount: 0, suppressedCount: 0 });
  const github: IGitHubReviewPort = { getPull: jest.fn().mockResolvedValue({ number: 1, headSha: sha,
    baseSha: 'b'.repeat(40), state: 'open', draft: false, authorLogin: 'maintainer', headRepoId: 1, baseRepoId: 1, headIsFork: false }),
    getDiff: jest.fn(), listOpenPulls: jest.fn(), listOwnIssueComments: jest.fn(), listOwnReviewsAndThreads: jest.fn(),
    upsertWalkthrough: jest.fn(), createCommentReview: jest.fn(), replyToFinding: jest.fn() };
  const logger = Object.create(Logger.prototype) as Logger;
  jest.spyOn(logger, 'error').mockImplementation(() => undefined);
  const coordinator = new ReviewOrchestratorService(discovery, context, triage, lenses, verification, publication, queue,
    new ReviewPolicyService(), repository, github,
    { repoRoot: '/repo', attemptsRoot: '/attempts', settings: async () => settings, baseConfig: async () => null }, logger);
  return { coordinator, stages, checkpoints, repository, claimMock, release, discover, contextRun, triageRun, lensRun,
    verificationRun, github };
}

describe('ReviewOrchestratorService', () => {
  it('polls on startup only when discovery is at least 48 hours old', async () => {
    const f = fixture();
    expect(await f.coordinator.startupPoll(Date.now() - 47 * 60 * 60 * 1000)).toBe(0);
    expect(f.discover).not.toHaveBeenCalled();
    expect(await f.coordinator.startupPoll(Date.now() - 49 * 60 * 60 * 1000)).toBe(1);
    expect(f.discover).toHaveBeenCalledTimes(1);
  });

  it('reuses a completed context checkpoint without rerunning context', async () => {
    const f = fixture();
    f.stages.set('context:0', { attemptId: claim.attemptId, stage: 'context', ordinal: 0, state: 'completed',
      startedAt: null, endedAt: null, outcome: 'completed', errorSummary: null, artifactHash: null, artifactPath: null });
    f.checkpoints.set('context:0', contextValue);
    await f.coordinator.drain('worker', Date.now() + 10_000);
    expect(f.contextRun).not.toHaveBeenCalled();
    expect(f.triageRun).toHaveBeenCalledTimes(1);
  });

  it.each([['no room', 'no-confirmed-room'], ['deadline', 'deadline']])('marks %s partial', async (_case, reason) => {
    const f = fixture();
    f.triageRun.mockResolvedValue({ status: 'partial', reason });
    await f.coordinator.drain('worker', Date.now() + 10_000);
    expect(f.release).toHaveBeenCalledWith(claim.attemptId, 'worker', 'partial');
  });

  it('supersedes when the head changes at a stage boundary', async () => {
    const f = fixture();
    let reads = 0;
    jest.spyOn(f.github, 'getPull').mockImplementation(async () => ({ number: 1, headSha: ++reads === 1 ? sha : 'c'.repeat(40),
      baseSha: 'b'.repeat(40), state: 'open', draft: false, authorLogin: 'maintainer', headRepoId: 1, baseRepoId: 1, headIsFork: false }));
    await f.coordinator.drain('worker', Date.now() + 10_000);
    expect(f.contextRun).toHaveBeenCalledTimes(1);
    expect(f.triageRun).not.toHaveBeenCalled();
    expect(f.release).toHaveBeenCalledWith(claim.attemptId, 'worker', 'superseded');
  });

  it('stops when trust is revoked on recheck', async () => {
    const f = fixture();
    let reads = 0;
    jest.spyOn(f.github, 'getPull').mockImplementation(async () => ({ number: 1, headSha: sha,
      baseSha: 'b'.repeat(40), state: 'open', draft: ++reads > 1, authorLogin: 'maintainer', headRepoId: 1, baseRepoId: 1, headIsFork: false }));
    await f.coordinator.drain('worker', Date.now() + 10_000);
    expect(f.triageRun).not.toHaveBeenCalled();
    expect(f.release).toHaveBeenCalledWith(claim.attemptId, 'worker', 'superseded');
  });
});
