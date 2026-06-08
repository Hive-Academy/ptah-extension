import 'reflect-metadata';
import { SkillEnhancerService } from './skill-enhancer.service';
import type { SkillSynthesisSettings } from './types';
import type { JudgeDecision } from './skill-judge.service';

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

const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

function makeInternalQuery(text: string) {
  return {
    execute: jest.fn().mockResolvedValue({
      stream: (async function* () {
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text }] },
        };
        yield { type: 'result' };
      })(),
      abort: jest.fn(),
      close: jest.fn(),
    }),
  };
}

interface Harness {
  svc: SkillEnhancerService;
  mirror: {
    getUserLayerRoots: jest.Mock;
    writeEnhancedSkill: jest.Mock;
    revert: jest.Mock;
  };
  candidates: {
    getInvocationStats: jest.Mock;
    getRecentSessionsForSlug: jest.Mock;
  };
  registry: { getBySlug: jest.Mock; markEnhanced: jest.Mock };
  judge: { judge: jest.Mock };
  internalQuery: { execute: jest.Mock };
  repropagation: { repropagate: jest.Mock };
}

function makeHarness(opts: {
  judgeDecision: JudgeDecision;
  candidateText: string;
  stats?: {
    total: number;
    succeeded: number;
    failed: number;
    distinctContexts: number;
  };
  lastEnhancedAt?: number | null;
  workspaceRoot?: string;
}): Harness {
  const workspaceProvider = {
    getConfiguration: jest.fn(() => ''),
    getWorkspaceRoot: jest.fn(() => opts.workspaceRoot ?? '/home/u/project'),
  };
  const mirror = {
    getUserLayerRoots: jest.fn(() => ({
      skills: '/home/u/.ptah/user/skills',
      agents: '/home/u/.ptah/user/agents',
      commands: '/home/u/.ptah/user/commands',
    })),
    writeEnhancedSkill: jest.fn().mockResolvedValue({
      slug: 'deep-research',
      historyTs: '1700000000000',
      currentContentHash: 'sha256:new',
    }),
    revert: jest.fn().mockResolvedValue({
      kind: 'skill',
      slug: 'deep-research',
      revertedFrom: '1700000000000',
      newHistoryTs: '1800000000000',
      restored: true,
    }),
  };
  const candidates = {
    getInvocationStats: jest.fn(
      () =>
        opts.stats ?? {
          total: 10,
          succeeded: 4,
          failed: 6,
          distinctContexts: 3,
        },
    ),
    getRecentSessionsForSlug: jest.fn(() => ['sess-1']),
  };
  const registry = {
    getBySlug: jest.fn(() => ({
      slug: 'deep-research',
      kind: 'skill',
      lastEnhancedAt:
        opts.lastEnhancedAt === undefined ? null : opts.lastEnhancedAt,
    })),
    markEnhanced: jest.fn(),
  };
  const judge = { judge: jest.fn().mockResolvedValue(opts.judgeDecision) };
  const trajectories = {
    extract: jest.fn().mockResolvedValue({
      canonicalText: 'did a thing',
      hash: 'h',
      turnCount: 5,
      sessionTurnCount: 5,
      shortDescription: 'd',
      slug: 's',
    }),
  };
  const internalQuery = makeInternalQuery(opts.candidateText);
  const repropagation = { repropagate: jest.fn().mockResolvedValue(undefined) };

  const svc = new SkillEnhancerService(
    logger as never,
    workspaceProvider as never,
    mirror as never,
    candidates as never,
    registry as never,
    judge as never,
    trajectories as never,
    internalQuery as never,
    repropagation as never,
  );

  return {
    svc,
    mirror,
    candidates,
    registry,
    judge,
    internalQuery,
    repropagation,
  };
}

// readFile is mocked so the clone "exists" without touching disk.
jest.mock('node:fs/promises', () => ({
  readFile: jest
    .fn()
    .mockResolvedValue(
      '---\nname: deep-research\ndescription: Research deeply\n---\nBody',
    ),
}));

describe('SkillEnhancerService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('judge PASS (verdict): snapshots+writes+markEnhanced+repropagation once', async () => {
    const h = makeHarness({
      judgeDecision: { passed: true, score: 8, reason: 'judge-verdict' },
      candidateText:
        '---\nname: deep-research\ndescription: Research deeply\n---\nImproved body',
    });
    const result = await h.svc.enhance('deep-research', makeSettings());
    expect(result.changed).toBe(true);
    expect(h.mirror.writeEnhancedSkill).toHaveBeenCalledTimes(1);
    expect(h.registry.markEnhanced).toHaveBeenCalledWith(
      'skill',
      'deep-research',
      expect.any(Number),
      'sha256:new',
    );
    expect(h.repropagation.repropagate).toHaveBeenCalledTimes(1);
    expect(h.repropagation.repropagate).toHaveBeenCalledWith(
      'skill',
      'deep-research',
      expect.any(String),
    );
  });

  it('judge REJECT: no write, no markEnhanced, no repropagation', async () => {
    const h = makeHarness({
      judgeDecision: { passed: false, score: 3, reason: 'judge-verdict' },
      candidateText: 'Improved body',
    });
    const result = await h.svc.enhance('deep-research', makeSettings());
    expect(result.changed).toBe(false);
    expect(result.skipReason).toBe('judge-rejected');
    expect(h.mirror.writeEnhancedSkill).not.toHaveBeenCalled();
    expect(h.registry.markEnhanced).not.toHaveBeenCalled();
    expect(h.repropagation.repropagate).not.toHaveBeenCalled();
  });

  it('fail-open pass (judge-error-passthrough) does NOT auto-write', async () => {
    const h = makeHarness({
      judgeDecision: {
        passed: true,
        score: 10,
        reason: 'judge-error-passthrough',
      },
      candidateText: 'Improved body',
    });
    const result = await h.svc.enhance('deep-research', makeSettings());
    expect(result.changed).toBe(false);
    expect(result.skipReason).toBe('judge-rejected');
    expect(h.mirror.writeEnhancedSkill).not.toHaveBeenCalled();
  });

  it('manual enhance WRITES on a fail-open pass (verdict not required)', async () => {
    const h = makeHarness({
      judgeDecision: {
        passed: true,
        score: 10,
        reason: 'judge-error-passthrough',
      },
      candidateText:
        '---\nname: deep-research\ndescription: Research deeply\n---\nImproved body',
    });
    const result = await h.svc.enhance('deep-research', makeSettings(), {
      manual: true,
    });
    expect(result.changed).toBe(true);
    expect(h.mirror.writeEnhancedSkill).toHaveBeenCalledTimes(1);
  });

  it('R2: cwd passed to InternalQuery is NOT process.cwd()', async () => {
    const h = makeHarness({
      judgeDecision: { passed: true, score: 8, reason: 'judge-verdict' },
      candidateText: 'Improved body',
      workspaceRoot: '/home/u/project',
    });
    await h.svc.enhance('deep-research', makeSettings());
    expect(h.internalQuery.execute).toHaveBeenCalledTimes(1);
    const cwd = h.internalQuery.execute.mock.calls[0][0].cwd as string;
    expect(cwd).not.toBe(process.cwd());
    expect(cwd).toBe('/home/u/project');
  });

  it('cooldown: skips when lastEnhancedAt is recent', async () => {
    const h = makeHarness({
      judgeDecision: { passed: true, score: 8, reason: 'judge-verdict' },
      candidateText: 'Improved body',
      lastEnhancedAt: Date.now(),
    });
    const result = await h.svc.enhance('deep-research', makeSettings());
    expect(result.changed).toBe(false);
    expect(result.skipReason).toBe('cooldown');
    expect(h.internalQuery.execute).not.toHaveBeenCalled();
  });

  it('below-threshold: skips when total invocations under minimum', async () => {
    const h = makeHarness({
      judgeDecision: { passed: true, score: 8, reason: 'judge-verdict' },
      candidateText: 'Improved body',
      stats: { total: 2, succeeded: 1, failed: 1, distinctContexts: 1 },
    });
    const result = await h.svc.enhance('deep-research', makeSettings());
    expect(result.changed).toBe(false);
    expect(result.skipReason).toBe('below-threshold');
  });

  it('judge-disabled fail-open does NOT auto-write', async () => {
    const h = makeHarness({
      judgeDecision: { passed: true, score: 10, reason: 'judge-disabled' },
      candidateText:
        '---\nname: deep-research\ndescription: Research deeply\n---\nImproved body',
    });
    const result = await h.svc.enhance('deep-research', makeSettings());
    expect(result.changed).toBe(false);
    expect(result.skipReason).toBe('judge-rejected');
    expect(h.mirror.writeEnhancedSkill).not.toHaveBeenCalled();
    expect(h.registry.markEnhanced).not.toHaveBeenCalled();
    expect(h.repropagation.repropagate).not.toHaveBeenCalled();
  });

  it('no-change: identical candidate short-circuits before judge, no write', async () => {
    const h = makeHarness({
      judgeDecision: { passed: true, score: 8, reason: 'judge-verdict' },
      candidateText:
        '---\nname: deep-research\ndescription: Research deeply\n---\nBody',
    });
    const result = await h.svc.enhance('deep-research', makeSettings());
    expect(result.changed).toBe(false);
    expect(result.skipReason).toBe('no-change');
    expect(h.judge.judge).not.toHaveBeenCalled();
    expect(h.mirror.writeEnhancedSkill).not.toHaveBeenCalled();
    expect(h.registry.markEnhanced).not.toHaveBeenCalled();
    expect(h.repropagation.repropagate).not.toHaveBeenCalled();
  });

  it('invalid-candidate: judge passes but candidate lacks frontmatter → no write, clone untouched', async () => {
    const h = makeHarness({
      judgeDecision: { passed: true, score: 9, reason: 'judge-verdict' },
      candidateText: 'Improved body with no frontmatter at all',
    });
    const result = await h.svc.enhance('deep-research', makeSettings());
    expect(result.changed).toBe(false);
    expect(result.skipReason).toBe('invalid-candidate');
    expect(h.judge.judge).toHaveBeenCalledTimes(1);
    expect(h.mirror.writeEnhancedSkill).not.toHaveBeenCalled();
    expect(h.registry.markEnhanced).not.toHaveBeenCalled();
    expect(h.repropagation.repropagate).not.toHaveBeenCalled();
  });

  it('invalid-candidate: frontmatter present but missing description → no write', async () => {
    const h = makeHarness({
      judgeDecision: { passed: true, score: 9, reason: 'judge-verdict' },
      candidateText: '---\nname: deep-research\n---\nImproved body',
    });
    const result = await h.svc.enhance('deep-research', makeSettings());
    expect(result.changed).toBe(false);
    expect(result.skipReason).toBe('invalid-candidate');
    expect(h.mirror.writeEnhancedSkill).not.toHaveBeenCalled();
  });

  it('revert: restores via mirror, marks enhanced, re-propagates', async () => {
    const h = makeHarness({
      judgeDecision: { passed: true, score: 8, reason: 'judge-verdict' },
      candidateText: 'x',
    });
    const result = await h.svc.revert('deep-research', '1700000000000');
    expect(result.reverted).toBe(true);
    expect(h.mirror.revert).toHaveBeenCalledWith({
      kind: 'skill',
      slug: 'deep-research',
      historyTs: '1700000000000',
    });
    expect(h.registry.markEnhanced).toHaveBeenCalledTimes(1);
    expect(h.repropagation.repropagate).toHaveBeenCalledTimes(1);
  });
});
