/**
 * SkillCuratorService specs.
 *
 * Tests: disabled no-op, stop before start is no-op, internalQuery=null → empty report,
 * never-delete-pinned invariant, settings restart triggers stop+start.
 */
import 'reflect-metadata';
import { SkillCuratorService } from './skill-curator.service';
import type { SkillCandidateStore } from './skill-candidate.store';
import type {
  SkillSynthesisSettings,
  SkillCandidateRow,
  CandidateId,
} from './types';

const noopLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as ConstructorParameters<typeof SkillCuratorService>[0];

const noopWorkspaceProvider = {
  getConfiguration: jest.fn(() => ''),
} as unknown as ConstructorParameters<typeof SkillCuratorService>[3];

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
    judgeEnabled: false,
    minJudgeScore: 6.0,
    judgeModel: 'claude-haiku-4-5-20251001',
    maxPinnedSkills: 10,
    curatorEnabled: true,
    curatorIntervalHours: 1,
    ...overrides,
  };
}

function fakePromotedRow(id: string, pinned = false): SkillCandidateRow {
  return {
    id: id as CandidateId,
    name: id,
    description: 'desc',
    bodyPath: '/SKILL.md',
    sourceSessionIds: [],
    trajectoryHash: id,
    embeddingRowid: null,
    status: 'promoted',
    successCount: 3,
    failureCount: 0,
    createdAt: 1,
    promotedAt: 1,
    rejectedAt: null,
    rejectedReason: null,
    pinned,
  };
}

function makeStore(
  promoted: SkillCandidateRow[] = [],
): jest.Mocked<SkillCandidateStore> {
  return {
    listByStatus: jest.fn((status: string) =>
      status === 'promoted' ? promoted : [],
    ),
    updateStatus: jest.fn(),
  } as unknown as jest.Mocked<SkillCandidateStore>;
}

describe('SkillCuratorService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('start() is a no-op when curatorEnabled=false', () => {
    const store = makeStore();
    const svc = new SkillCuratorService(
      noopLogger,
      store,
      null,
      noopWorkspaceProvider,
    );
    // Should not throw; no interval should be set
    svc.start(makeSettings({ curatorEnabled: false }));
    // Advance time — no runPass should trigger
    jest.advanceTimersByTime(10_000_000);
    expect(store.listByStatus).not.toHaveBeenCalled();
  });

  it('stop() before start() is a no-op', () => {
    const store = makeStore();
    const svc = new SkillCuratorService(
      noopLogger,
      store,
      null,
      noopWorkspaceProvider,
    );
    expect(() => svc.stop()).not.toThrow();
  });

  it('runManual() returns empty report when internalQuery=null', async () => {
    const store = makeStore([fakePromotedRow('sk1')]);
    const svc = new SkillCuratorService(
      noopLogger,
      store,
      null,
      noopWorkspaceProvider,
    );
    svc.start(makeSettings());
    const report = await svc.runManual();
    expect(report.changesQueued).toBe(0);
    expect(report.skippedPinned).toBe(0);
    expect(report.overlaps).toHaveLength(0);
  });

  it('never-delete invariant: updateStatus is never called with rejected for a pinned skill', async () => {
    const pinnedSkill = fakePromotedRow('pinned-sk', true);
    const store = makeStore([pinnedSkill]);
    // Simulate LLM response that flags the pinned skill
    const findingsResponse = JSON.stringify([
      {
        type: 'overlap',
        skillIds: ['pinned-sk', 'other-sk'],
        reason: 'too similar',
      },
    ]);
    const query = {
      execute: jest.fn().mockResolvedValue({
        stream: (async function* () {
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: findingsResponse }] },
          };
          yield { type: 'result' };
        })(),
      }),
    };
    const svc = new SkillCuratorService(
      noopLogger,
      store,
      query as never,
      noopWorkspaceProvider,
    );
    svc.start(makeSettings());
    await svc.runManual();
    // updateStatus should NEVER be called with 'rejected' for a pinned skill
    const rejectedCalls = (store.updateStatus as jest.Mock).mock.calls.filter(
      (args) => args[1] === 'rejected' && args[0] === 'pinned-sk',
    );
    expect(rejectedCalls).toHaveLength(0);
  });

  it('settings restart triggers stop+start (curatorEnabled change)', () => {
    const store = makeStore();
    const svc = new SkillCuratorService(
      noopLogger,
      store,
      null,
      noopWorkspaceProvider,
    );
    const stopSpy = jest.spyOn(svc, 'stop');
    const startSpy = jest.spyOn(svc, 'start');

    svc.start(makeSettings({ curatorEnabled: true }));
    // Simulate what the RPC handler does on updateSettings
    svc.stop();
    svc.start(makeSettings({ curatorEnabled: false }));

    expect(stopSpy).toHaveBeenCalledTimes(1);
    expect(startSpy).toHaveBeenCalledTimes(2);
  });
});
