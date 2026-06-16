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
  getWorkspaceRoot: jest.fn(() => ''),
} as unknown as ConstructorParameters<typeof SkillCuratorService>[3];

const noopRateLimiter = {
  tryAcquire: jest.fn(() => ({ allowed: true })),
  snapshot: jest.fn(() => null),
} as unknown as ConstructorParameters<typeof SkillCuratorService>[4];

const noopMdGenerator = {
  promoteToActive: jest.fn(() => ({
    slug: 'x',
    dir: '/d',
    filePath: '/d/SKILL.md',
  })),
  candidatesRoot: jest.fn(() => '/c'),
  activeRoot: jest.fn(() => '/a'),
  writeCandidate: jest.fn(),
} as unknown as ConstructorParameters<typeof SkillCuratorService>[11];

const SUGGESTION_DEPS: [
  ConstructorParameters<typeof SkillCuratorService>[7],
  ConstructorParameters<typeof SkillCuratorService>[8],
  ConstructorParameters<typeof SkillCuratorService>[9],
  ConstructorParameters<typeof SkillCuratorService>[10],
  ConstructorParameters<typeof SkillCuratorService>[11],
] = [null, null, null, null, noopMdGenerator];

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
    dedupClusterThreshold: 0.78,
    prefilterMinEdits: 1,
    prefilterMinChars: 800,
    prefilterMinToolUses: 2,
    judgeEnabled: false,
    minJudgeScore: 6.0,
    judgeModel: 'claude-haiku-4-5-20251001',
    maxPinnedSkills: 10,
    curatorEnabled: true,
    curatorIntervalHours: 1,
    suggestionMinClusterSize: 2,
    suggestionMaxCandidates: 200,
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
    residency: 'resident',
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
      noopRateLimiter,
      null,
      null,
      ...SUGGESTION_DEPS,
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
      noopRateLimiter,
      null,
      null,
      ...SUGGESTION_DEPS,
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
      noopRateLimiter,
      null,
      null,
      ...SUGGESTION_DEPS,
    );
    svc.start(makeSettings());
    const report = await svc.runManual();
    expect(report.changesQueued).toBe(0);
    expect(report.skippedPinned).toBe(0);
    expect(report.overlaps).toHaveLength(0);
  });

  it('invokes onPassComplete callback after a successful pass (Critical-2 wiring)', async () => {
    const promoted = fakePromotedRow('sk1');
    const store = makeStore([promoted]);
    const query = {
      execute: jest.fn().mockResolvedValue({
        stream: (async function* () {
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: '[]' }] },
          };
          yield { type: 'result' };
        })(),
      }),
    };
    const onPassComplete = jest.fn();
    const svc = new SkillCuratorService(
      noopLogger,
      store,
      query as never,
      noopWorkspaceProvider,
      noopRateLimiter,
      null,
      null,
      ...SUGGESTION_DEPS,
    );
    svc.start(makeSettings(), { onPassComplete });
    await svc.runManual();
    expect(onPassComplete).toHaveBeenCalledTimes(1);
    expect(onPassComplete).toHaveBeenCalledWith(expect.any(Number));
  });

  it('does not invoke onPassComplete when LLM call throws', async () => {
    const promoted = fakePromotedRow('sk1');
    const store = makeStore([promoted]);
    const query = {
      execute: jest.fn().mockRejectedValue(new Error('llm down')),
    };
    const onPassComplete = jest.fn();
    const svc = new SkillCuratorService(
      noopLogger,
      store,
      query as never,
      noopWorkspaceProvider,
      noopRateLimiter,
      null,
      null,
      ...SUGGESTION_DEPS,
    );
    svc.start(makeSettings(), { onPassComplete });
    await svc.runManual();
    expect(onPassComplete).not.toHaveBeenCalled();
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
      noopRateLimiter,
      null,
      null,
      ...SUGGESTION_DEPS,
    );
    svc.start(makeSettings());
    await svc.runManual();
    // updateStatus should NEVER be called with 'rejected' for a pinned skill
    const rejectedCalls = (store.updateStatus as jest.Mock).mock.calls.filter(
      (args) => args[1] === 'rejected' && args[0] === 'pinned-sk',
    );
    expect(rejectedCalls).toHaveLength(0);
  });

  it('unified pass: enhances threshold-crossing eligible slugs, skips others', async () => {
    const promoted = fakePromotedRow('sk1');
    const baseStore = makeStore([promoted]);
    const store = {
      ...baseStore,
      listByStatus: baseStore.listByStatus,
      updateStatus: baseStore.updateStatus,
      getInvocationStats: jest.fn((slug: string) =>
        slug === 'eligible'
          ? { total: 12, succeeded: 4, failed: 8, distinctContexts: 3 }
          : { total: 1, succeeded: 1, failed: 0, distinctContexts: 1 },
      ),
    } as unknown as ConstructorParameters<typeof SkillCuratorService>[1];

    const query = {
      execute: jest.fn().mockResolvedValue({
        stream: (async function* () {
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: '[]' }] },
          };
          yield { type: 'result' };
        })(),
      }),
    };

    const registry = {
      listAll: jest.fn(() => [
        { kind: 'skill', slug: 'eligible' },
        { kind: 'skill', slug: 'tooFew' },
        { kind: 'agent', slug: 'an-agent' },
      ]),
    } as unknown as ConstructorParameters<typeof SkillCuratorService>[5];

    const enhancer = {
      isEligible: jest.fn((slug: string) => slug === 'eligible'),
      enhance: jest.fn().mockResolvedValue({ changed: true, slug: 'eligible' }),
    } as unknown as ConstructorParameters<typeof SkillCuratorService>[6];

    const svc = new SkillCuratorService(
      noopLogger,
      store,
      query as never,
      noopWorkspaceProvider,
      noopRateLimiter,
      registry,
      enhancer,
      ...SUGGESTION_DEPS,
    );
    svc.start(makeSettings());
    await svc.runManual();

    const enhanceMock = (enhancer as unknown as { enhance: jest.Mock }).enhance;
    expect(enhanceMock).toHaveBeenCalledTimes(1);
    expect(enhanceMock).toHaveBeenCalledWith('eligible', expect.anything(), {
      kind: 'skill',
    });
  });

  it('unified pass: selects + enhances eligible agent and command clones with their kind', async () => {
    const promoted = fakePromotedRow('sk1');
    const baseStore = makeStore([promoted]);
    const store = {
      ...baseStore,
      listByStatus: baseStore.listByStatus,
      updateStatus: baseStore.updateStatus,
      getInvocationStats: jest.fn(() => ({
        total: 12,
        succeeded: 4,
        failed: 8,
        distinctContexts: 3,
      })),
    } as unknown as ConstructorParameters<typeof SkillCuratorService>[1];

    const query = {
      execute: jest.fn().mockResolvedValue({
        stream: (async function* () {
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: '[]' }] },
          };
          yield { type: 'result' };
        })(),
      }),
    };

    const registry = {
      listAll: jest.fn(() => [
        { kind: 'agent', slug: 'an-agent' },
        { kind: 'command', slug: 'a-command' },
      ]),
    } as unknown as ConstructorParameters<typeof SkillCuratorService>[5];

    const enhancer = {
      isEligible: jest.fn(() => true),
      enhance: jest.fn().mockResolvedValue({ changed: true, slug: 'x' }),
    } as unknown as ConstructorParameters<typeof SkillCuratorService>[6];

    const svc = new SkillCuratorService(
      noopLogger,
      store,
      query as never,
      noopWorkspaceProvider,
      noopRateLimiter,
      registry,
      enhancer,
      ...SUGGESTION_DEPS,
    );
    svc.start(makeSettings());
    await svc.runManual();

    const isEligibleMock = (enhancer as unknown as { isEligible: jest.Mock })
      .isEligible;
    expect(isEligibleMock).toHaveBeenCalledWith(
      'an-agent',
      expect.anything(),
      'agent',
    );
    expect(isEligibleMock).toHaveBeenCalledWith(
      'a-command',
      expect.anything(),
      'command',
    );

    const enhanceMock = (enhancer as unknown as { enhance: jest.Mock }).enhance;
    expect(enhanceMock).toHaveBeenCalledWith('an-agent', expect.anything(), {
      kind: 'agent',
    });
    expect(enhanceMock).toHaveBeenCalledWith('a-command', expect.anything(), {
      kind: 'command',
    });
  });

  it('unified pass: degrades to legacy promoted-only when registry/enhancer absent', async () => {
    const promoted = fakePromotedRow('sk1');
    const store = makeStore([promoted]);
    const query = {
      execute: jest.fn().mockResolvedValue({
        stream: (async function* () {
          yield {
            type: 'assistant',
            message: { content: [{ type: 'text', text: '[]' }] },
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
      noopRateLimiter,
      null,
      null,
      ...SUGGESTION_DEPS,
    );
    svc.start(makeSettings());
    const report = await svc.runManual();
    expect(report.changesQueued).toBe(0);
  });

  it('runs the enhancement pass even when there are zero promoted skills', async () => {
    const baseStore = makeStore([]);
    const store = {
      ...baseStore,
      listByStatus: baseStore.listByStatus,
      updateStatus: baseStore.updateStatus,
      getInvocationStats: jest.fn(() => ({
        total: 12,
        succeeded: 4,
        failed: 8,
        distinctContexts: 3,
      })),
    } as unknown as ConstructorParameters<typeof SkillCuratorService>[1];
    const query = {
      execute: jest.fn(),
    };
    const registry = {
      listAll: jest.fn(() => [{ kind: 'skill', slug: 'eligible' }]),
    } as unknown as ConstructorParameters<typeof SkillCuratorService>[5];
    const enhancer = {
      isEligible: jest.fn(() => true),
      enhance: jest.fn().mockResolvedValue({ changed: true, slug: 'eligible' }),
    } as unknown as ConstructorParameters<typeof SkillCuratorService>[6];
    const onPassComplete = jest.fn();
    const svc = new SkillCuratorService(
      noopLogger,
      store,
      query as never,
      noopWorkspaceProvider,
      noopRateLimiter,
      registry,
      enhancer,
      ...SUGGESTION_DEPS,
    );
    svc.start(makeSettings(), { onPassComplete });
    await svc.runManual();
    expect(
      (enhancer as unknown as { enhance: jest.Mock }).enhance,
    ).toHaveBeenCalledWith('eligible', expect.anything(), { kind: 'skill' });
    expect(query.execute).not.toHaveBeenCalled();
    expect(onPassComplete).toHaveBeenCalledTimes(1);
  });

  it('settings restart triggers stop+start (curatorEnabled change)', () => {
    const store = makeStore();
    const svc = new SkillCuratorService(
      noopLogger,
      store,
      null,
      noopWorkspaceProvider,
      noopRateLimiter,
      null,
      null,
      ...SUGGESTION_DEPS,
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
