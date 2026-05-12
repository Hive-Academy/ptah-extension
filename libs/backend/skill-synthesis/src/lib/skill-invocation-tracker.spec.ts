/**
 * SkillInvocationTracker specs — verifies that recordInvocation persists
 * the invocation, increments the right counter, and triggers promotion
 * evaluation when success_count crosses the configured threshold.
 */
import 'reflect-metadata';
import { SkillInvocationTracker } from './skill-invocation-tracker';
import type { SkillCandidateStore } from './skill-candidate.store';
import type { SkillPromotionService } from './skill-promotion.service';
import type {
  CandidateId,
  SkillCandidateRow,
  SkillSynthesisSettings,
} from './types';

const noopLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as ConstructorParameters<typeof SkillInvocationTracker>[0];

const SETTINGS: SkillSynthesisSettings = {
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
  judgeEnabled: false,
  minJudgeScore: 6.0,
  judgeModel: 'inherit',
  maxPinnedSkills: 10,
  curatorEnabled: false,
  curatorIntervalHours: 24,
};

function row(overrides: Partial<SkillCandidateRow> = {}): SkillCandidateRow {
  return {
    id: 'cand_x' as CandidateId,
    name: 'do-thing',
    description: 'd',
    bodyPath: '/SKILL.md',
    sourceSessionIds: [],
    trajectoryHash: 'h',
    embeddingRowid: null,
    status: 'candidate',
    successCount: 0,
    failureCount: 0,
    createdAt: 1,
    promotedAt: null,
    rejectedAt: null,
    rejectedReason: null,
    pinned: false,
    ...overrides,
  };
}

describe('SkillInvocationTracker', () => {
  function setup(initial: SkillCandidateRow) {
    const store = {
      findById: jest.fn(() => initial),
      recordInvocation: jest.fn(() => ({
        id: 'inv1',
        skillId: initial.id,
        sessionId: 's1',
        succeeded: true,
        invokedAt: 1,
        notes: null,
      })),
      incrementSuccess: jest.fn(),
      incrementFailure: jest.fn(),
    } as unknown as jest.Mocked<SkillCandidateStore>;
    const promotion = {
      evaluate: jest.fn(() => ({
        promoted: true,
        reason: 'promoted',
        candidate: { ...initial, status: 'promoted' as const },
      })),
    } as unknown as jest.Mocked<SkillPromotionService>;
    const tracker = new SkillInvocationTracker(noopLogger, store, promotion);
    return { store, promotion, tracker };
  }

  it('records a success, increments successCount, and skips promotion below threshold', async () => {
    const { store, promotion, tracker } = setup(row({ successCount: 1 }));
    (store.incrementSuccess as jest.Mock).mockReturnValue(2);
    const result = await tracker.recordInvocation(
      { skillId: 'cand_x' as CandidateId, sessionId: 's1', succeeded: true },
      SETTINGS,
    );
    expect(store.recordInvocation).toHaveBeenCalledTimes(1);
    expect(store.incrementSuccess).toHaveBeenCalledWith('cand_x');
    expect(store.incrementFailure).not.toHaveBeenCalled();
    expect(result.successCount).toBe(2);
    expect(promotion.evaluate).not.toHaveBeenCalled();
    expect(result.promotion).toBeNull();
  });

  it('triggers promotion evaluation when successCount reaches threshold', async () => {
    const { store, promotion, tracker } = setup(row({ successCount: 2 }));
    (store.incrementSuccess as jest.Mock).mockReturnValue(3);
    const result = await tracker.recordInvocation(
      { skillId: 'cand_x' as CandidateId, sessionId: 's1', succeeded: true },
      SETTINGS,
    );
    expect(promotion.evaluate).toHaveBeenCalledTimes(1);
    expect(result.promotion?.promoted).toBe(true);
    expect(result.successCount).toBe(3);
  });

  it('does not trigger promotion on a failed invocation', async () => {
    const { store, promotion, tracker } = setup(row({ successCount: 5 }));
    (store.incrementFailure as jest.Mock).mockReturnValue(1);
    const result = await tracker.recordInvocation(
      { skillId: 'cand_x' as CandidateId, sessionId: 's1', succeeded: false },
      SETTINGS,
    );
    expect(store.incrementFailure).toHaveBeenCalledWith('cand_x');
    expect(store.incrementSuccess).not.toHaveBeenCalled();
    expect(promotion.evaluate).not.toHaveBeenCalled();
    expect(result.failureCount).toBe(1);
  });

  it('does not trigger promotion for a candidate that is already promoted', async () => {
    const { store, promotion, tracker } = setup(
      row({ successCount: 9, status: 'promoted' }),
    );
    (store.incrementSuccess as jest.Mock).mockReturnValue(10);
    await tracker.recordInvocation(
      { skillId: 'cand_x' as CandidateId, sessionId: 's1', succeeded: true },
      SETTINGS,
    );
    expect(promotion.evaluate).not.toHaveBeenCalled();
  });

  it('throws when the skill does not exist', async () => {
    const { store, tracker } = setup(row());
    (store.findById as jest.Mock).mockReturnValueOnce(null);
    await expect(
      tracker.recordInvocation(
        { skillId: 'missing' as CandidateId, sessionId: 's1', succeeded: true },
        SETTINGS,
      ),
    ).rejects.toThrow(/not found/);
  });

  it('swallows promotion evaluation errors as non-fatal', async () => {
    const { store, promotion, tracker } = setup(row({ successCount: 2 }));
    (store.incrementSuccess as jest.Mock).mockReturnValue(3);
    (promotion.evaluate as jest.Mock).mockImplementation(() => {
      throw new Error('boom');
    });
    const result = await tracker.recordInvocation(
      { skillId: 'cand_x' as CandidateId, sessionId: 's1', succeeded: true },
      SETTINGS,
    );
    expect(result.successCount).toBe(3);
    expect(result.promotion).toBeNull();
  });
});
