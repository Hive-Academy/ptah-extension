import type { IReviewRepository, ReviewStageRecord } from '../persistence/review-repository.interface';
import { ReviewLaneRunner } from '../lanes/review-lane.runner';
import { LensStageRunner } from './lens-stage.runner';
import type { ContextStageResult } from './context-stage.runner';
import type { ReviewQueueClaim } from '../review-queue.service';

const sha = 'a'.repeat(40);
const claim: ReviewQueueClaim = { repo: { owner: 'Hive-Academy', name: 'PtahCode' }, prNumber: 1,
  headSha: sha, attemptId: 'attempt-1', trigger: 'poll', queuedAt: '', lease: { owner: 'worker', expiresAt: '' } };
const context: ContextStageResult = { attemptRoot: '/attempt', coverage: [], promptInput: {
  headSha: sha, title: '', body: '', diff: '', comments: '', fileContent: '', deterministicEvidence: '', repositoryRules: '',
} };

describe('LensStageRunner checkpoints', () => {
  it('runs only lenses without a completed checkpoint after restart', async () => {
    const stages = new Map<string, ReviewStageRecord>();
    const checkpoints = new Map<string, unknown>();
    const repository: IReviewRepository = {
      getLastReviewedHead: jest.fn().mockResolvedValue(null), getOpenFailures: jest.fn().mockResolvedValue([]),
      getLastPollAt: jest.fn().mockResolvedValue(null), recordPoll: jest.fn(), saveFailure: jest.fn(),
      enqueueDiscovered: jest.fn(), enqueueManual: jest.fn(), recordDraft: jest.fn(), claimNext: jest.fn(), heartbeat: jest.fn(), release: jest.fn(),
      reconcileExpiredLeases: jest.fn(), getAttempt: jest.fn(),
      getStages: async () => [...stages.values()],
      saveStage: async (stage) => { stages.set(stage.stage, stage); },
      saveCheckpoint: async (_id, stage, _ordinal, data) => { checkpoints.set(stage, data); },
      getCheckpoint: async (_id, stage) => checkpoints.get(stage) ?? null,
    };
    const prior = 'lens:correctness-lifecycle';
    stages.set(prior, { attemptId: claim.attemptId, stage: prior, ordinal: 0, state: 'completed',
      startedAt: '', endedAt: '', outcome: 'completed', errorSummary: null, artifactHash: null, artifactPath: null });
    checkpoints.set(prior, { status: 'partial', reason: 'no-confirmed-room' });
    const lanes = Object.create(ReviewLaneRunner.prototype) as ReviewLaneRunner;
    const run = jest.spyOn(lanes, 'run').mockResolvedValue({ status: 'partial', reason: 'deadline' });
    run.mockResolvedValueOnce({ status: 'completed', family: 'codex', limitCheck: 'unavailable',
      output: { schemaVersion: 1, headSha: sha, findings: [], coverage: [] } });
    const results = await new LensStageRunner(lanes, repository).run(claim, context, Date.now() + 10_000);
    expect(results).toHaveLength(4);
    expect(results[0].result).toEqual({ status: 'partial', reason: 'no-confirmed-room' });
    expect(run).toHaveBeenCalledTimes(3);
    expect(stages.get('lens:security-privacy')?.state).toBe('interrupted');
    expect(checkpoints.get('lens:security-privacy')).toEqual({ status: 'partial', reason: 'deadline' });
    expect(stages.get('lens:security-privacy')?.errorSummary).toBe('deadline');
    expect(stages.get('lens:contracts-callers')?.errorSummary).toBe('Ran without a limit check');
  });
});

