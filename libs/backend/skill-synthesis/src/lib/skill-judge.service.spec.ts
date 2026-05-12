/**
 * SkillJudgeService specs — exercises the LLM-as-judge gate.
 *
 * Tests: disabled, no internalQuery, LLM throw, malformed JSON, score below
 * threshold, score at/above threshold.
 */
import 'reflect-metadata';
import { SkillJudgeService } from './skill-judge.service';
import type {
  SkillCandidateRow,
  SkillSynthesisSettings,
  CandidateId,
} from './types';

const noopLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as ConstructorParameters<typeof SkillJudgeService>[0];

const noopWorkspaceProvider = {
  getConfiguration: jest.fn(() => ''),
} as unknown as ConstructorParameters<typeof SkillJudgeService>[1];

function makeSettings(
  overrides: Partial<SkillSynthesisSettings> = {},
): SkillSynthesisSettings {
  return {
    enabled: true,
    successesToPromote: 3,
    dedupCosineThreshold: 0.85,
    maxActiveSkills: 50,
    candidatesDir: '',
    eligibilityMinTurns: 5,
    evictionDecayRate: 0.95,
    generalizationContextThreshold: 3,
    minTrajectoryFidelityRatio: 0.4,
    dedupClusterThreshold: 0.78,
    minAbstractionEditDistance: 0.3,
    judgeEnabled: true,
    minJudgeScore: 6.0,
    judgeModel: 'claude-haiku-4-5-20251001',
    maxPinnedSkills: 10,
    curatorEnabled: false,
    curatorIntervalHours: 24,
    ...overrides,
  };
}

function fakeCandidate(): SkillCandidateRow {
  return {
    id: 'cand_j' as CandidateId,
    name: 'judge-me',
    description: 'test skill',
    bodyPath: '/tmp/SKILL.md',
    sourceSessionIds: [],
    trajectoryHash: 'h',
    embeddingRowid: null,
    status: 'candidate',
    successCount: 3,
    failureCount: 0,
    createdAt: 1,
    promotedAt: null,
    rejectedAt: null,
    rejectedReason: null,
    pinned: false,
  };
}

function makeInternalQuery(response: string) {
  return {
    execute: jest.fn().mockResolvedValue({
      stream: (async function* () {
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text: response }] },
        };
        yield { type: 'result' };
      })(),
    }),
  };
}

describe('SkillJudgeService', () => {
  it('short-circuits when judgeEnabled=false — returns pass without calling LLM', async () => {
    const query = makeInternalQuery(
      '{"novelty":9,"actionability":9,"scope":9}',
    );
    const svc = new SkillJudgeService(
      noopLogger,
      noopWorkspaceProvider,
      query as never,
    );
    const settings = makeSettings({ judgeEnabled: false });
    const result = await svc.judge(fakeCandidate(), 'body text', settings);
    expect(result.passed).toBe(true);
    expect(result.reason).toBe('judge-disabled');
    expect(query.execute).not.toHaveBeenCalled();
  });

  it('short-circuits when internalQuery=null — returns pass', async () => {
    const svc = new SkillJudgeService(noopLogger, noopWorkspaceProvider, null);
    const result = await svc.judge(
      fakeCandidate(),
      'body text',
      makeSettings(),
    );
    expect(result.passed).toBe(true);
    expect(result.reason).toBe('judge-disabled');
  });

  it('fails open when LLM throws — returns passed=true with judge-error-passthrough', async () => {
    const badQuery = {
      execute: jest.fn().mockRejectedValue(new Error('network error')),
    };
    const svc = new SkillJudgeService(
      noopLogger,
      noopWorkspaceProvider,
      badQuery as never,
    );
    const result = await svc.judge(fakeCandidate(), 'body', makeSettings());
    expect(result.passed).toBe(true);
    expect(result.reason).toBe('judge-error-passthrough');
  });

  it('fails open when LLM returns malformed JSON — passed=true with judge-error-passthrough', async () => {
    const query = makeInternalQuery('this is not json at all');
    const svc = new SkillJudgeService(
      noopLogger,
      noopWorkspaceProvider,
      query as never,
    );
    const result = await svc.judge(fakeCandidate(), 'body', makeSettings());
    expect(result.passed).toBe(true);
    expect(result.reason).toBe('judge-error-passthrough');
  });

  it('returns passed=false when composite score < minJudgeScore', async () => {
    // novelty=3, actionability=4, scope=5 → avg=4.0 < 6.0
    const query = makeInternalQuery(
      '{"novelty":3,"actionability":4,"scope":5}',
    );
    const svc = new SkillJudgeService(
      noopLogger,
      noopWorkspaceProvider,
      query as never,
    );
    const result = await svc.judge(
      fakeCandidate(),
      'body',
      makeSettings({ minJudgeScore: 6.0 }),
    );
    expect(result.passed).toBe(false);
    expect(result.score).toBeCloseTo(4.0);
    expect(result.reason).toBe('judge-verdict');
  });

  it('returns passed=true when composite score >= minJudgeScore', async () => {
    // novelty=7, actionability=7, scope=7 → avg=7.0 >= 6.0
    const query = makeInternalQuery(
      '{"novelty":7,"actionability":7,"scope":7}',
    );
    const svc = new SkillJudgeService(
      noopLogger,
      noopWorkspaceProvider,
      query as never,
    );
    const result = await svc.judge(
      fakeCandidate(),
      'body',
      makeSettings({ minJudgeScore: 6.0 }),
    );
    expect(result.passed).toBe(true);
    expect(result.score).toBeCloseTo(7.0);
    expect(result.reason).toBe('judge-verdict');
  });
});
