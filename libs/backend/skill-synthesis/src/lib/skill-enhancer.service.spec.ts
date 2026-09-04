import 'reflect-metadata';
import {
  SkillEnhancerService,
  ProposalNotFoundError,
  PROPOSAL_TTL_MS,
  MAX_CACHED_PROPOSALS,
  MAX_WIN_RATE_TO_AUTO_ENHANCE,
  MIN_INVOCATIONS_TO_ENHANCE,
} from './skill-enhancer.service';
import { JUDGE_DEFAULT_MODEL_ID, type SkillSynthesisSettings } from './types';
import type { JudgeDecision } from './skill-judge.service';
import type { AgentScorecard } from '@ptah-extension/shared';

function emptyScorecard(slug: string): AgentScorecard {
  return {
    slug,
    totalInvocations: 0,
    gradedCount: 0,
    gradedSuccessRate: null,
    avgInputTokens: null,
    avgOutputTokens: null,
    avgCacheReadTokens: null,
    totalInputTokens: null,
    totalOutputTokens: null,
    avgCostUsd: null,
    avgDurationMs: null,
    avgToolCount: null,
    recentVerdicts: [],
  };
}

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
    judgeEnabled: true,
    minJudgeScore: 6.0,
    judgeModel: 'claude-haiku-4-5-20251001',
    maxPinnedSkills: 10,
    curatorEnabled: false,
    curatorIntervalHours: 24,
    suggestionMinClusterSize: 2,
    suggestionMaxCandidates: 200,
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
    writeEnhancedFileClone: jest.Mock;
    revert: jest.Mock;
  };
  candidates: {
    getInvocationStats: jest.Mock;
    getRecentSessionsForSlug: jest.Mock;
    getWinRates: jest.Mock;
  };
  registry: { getBySlug: jest.Mock; markEnhanced: jest.Mock };
  judge: { judge: jest.Mock };
  internalQuery: { execute: jest.Mock };
  repropagation: { repropagate: jest.Mock };
  specFindings: { getRecentFindings: jest.Mock };
  scorecard: { getScorecards: jest.Mock };
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
  specFindings?: string | null;
  /** Scorecard returned for the slug; defaults to a no-data empty card. */
  scorecardCard?: AgentScorecard;
  /** When true, the scorecard service is not injected (dependency absent). */
  scorecardAbsent?: boolean;
  /**
   * The clone's MEASURED win rate. `undefined` (the default) means the store
   * reports nothing for this slug at all — unmeasured, which must leave the
   * eligibility decision to the invocation floor alone.
   */
  winRate?: number | null;
  /**
   * Settings this workspace has stored. Unseeded keys read `''`, which is what
   * every pre-existing case in this file relied on.
   */
  configSeed?: Record<string, string>;
  /**
   * The port the in-process MCP server is listening on, or `null` for a host
   * that started none. `undefined` injects no status port at all — the CLI.
   */
  mcpPort?: number | null;
}): Harness {
  const workspaceProvider = {
    getConfiguration: jest.fn(
      (_section: string, key: string) => opts.configSeed?.[key] ?? '',
    ),
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
    writeEnhancedFileClone: jest.fn().mockResolvedValue({
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
    getWinRates: jest.fn(() =>
      opts.winRate === undefined
        ? []
        : [
            {
              slug: 'deep-research',
              invocations: 5,
              wins: opts.winRate === null ? 0 : Math.round(opts.winRate * 5),
              unknown: opts.winRate === null ? 5 : 0,
              winRate: opts.winRate,
            },
          ],
    ),
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
  const specFindings = {
    getRecentFindings: jest.fn().mockResolvedValue(opts.specFindings ?? null),
  };
  const scorecard = {
    getScorecards: jest.fn((slugs: readonly string[]) => {
      const record: Record<string, AgentScorecard> = {};
      for (const s of slugs) {
        record[s] = opts.scorecardCard ?? emptyScorecard(s);
      }
      return record;
    }),
  };

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
    specFindings as never,
    (opts.scorecardAbsent ? null : scorecard) as never,
    (opts.mcpPort === undefined
      ? null
      : { getPort: () => opts.mcpPort ?? null }) as never,
  );

  return {
    svc,
    mirror,
    candidates,
    registry,
    judge,
    internalQuery,
    repropagation,
    specFindings,
    scorecard,
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
      judgeDecision: {
        status: 'scored',
        score: 8,
        criteria: null,
        reason: 'judge-verdict',
      },
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
      judgeDecision: {
        status: 'scored',
        score: 3,
        criteria: null,
        reason: 'judge-verdict',
      },
      candidateText: 'Improved body',
    });
    const result = await h.svc.enhance('deep-research', makeSettings());
    expect(result.changed).toBe(false);
    expect(result.skipReason).toBe('judge-rejected');
    expect(h.mirror.writeEnhancedSkill).not.toHaveBeenCalled();
    expect(h.registry.markEnhanced).not.toHaveBeenCalled();
    expect(h.repropagation.repropagate).not.toHaveBeenCalled();
  });

  it('an unscored verdict does NOT auto-write', async () => {
    const h = makeHarness({
      judgeDecision: {
        status: 'unscored',
        score: null,
        criteria: null,
        reason: 'judge-call-threw',
      },
      candidateText: 'Improved body',
    });
    const result = await h.svc.enhance('deep-research', makeSettings());
    expect(result.changed).toBe(false);
    expect(result.skipReason).toBe('judge-rejected');
    expect(h.mirror.writeEnhancedSkill).not.toHaveBeenCalled();
  });

  it('manual enhance WRITES on an unscored verdict — only an explicit low score refuses', async () => {
    const h = makeHarness({
      judgeDecision: {
        status: 'unscored',
        score: null,
        criteria: null,
        reason: 'judge-call-threw',
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
      judgeDecision: {
        status: 'scored',
        score: 8,
        criteria: null,
        reason: 'judge-verdict',
      },
      candidateText: 'Improved body',
      workspaceRoot: '/home/u/project',
    });
    await h.svc.enhance('deep-research', makeSettings());
    expect(h.internalQuery.execute).toHaveBeenCalledTimes(1);
    const cwd = h.internalQuery.execute.mock.calls[0][0].cwd as string;
    expect(cwd).not.toBe(process.cwd());
    expect(cwd).toBe('/home/u/project');
  });

  /**
   * `generateCandidate` is the SECOND, NON-LANE caller of `resolveJudgeModel`
   * (`skill-enhancer.service.ts:690`). It calls it directly and passes the
   * result to `internalQuery.execute` with no `auth` field, so the call rides
   * the ambient chat auth env rather than a lane override.
   *
   * That makes it an affected consumer of TASK_2026_250: this call site read
   * `llm.vscode.model` before that change and reads the active provider's
   * `provider.<authKey>.selectedModel` after it. Nothing exercised the model
   * argument here, so the switch shipped unpinned — these three cases are that
   * pin.
   */
  describe('enhance: the MCP wiring handed to InternalQuery', () => {
    const judgeDecision = {
      status: 'scored',
      score: 8,
      criteria: null,
      reason: 'judge-verdict',
    } as const;

    async function mcpFieldsSentWith(
      mcpPort: number | null | undefined,
    ): Promise<Record<string, unknown>> {
      const h = makeHarness({
        judgeDecision,
        candidateText: 'Improved body',
        mcpPort,
      });
      await h.svc.enhance('deep-research', makeSettings());
      expect(h.internalQuery.execute).toHaveBeenCalledTimes(1);
      return h.internalQuery.execute.mock.calls[0][0] as Record<
        string,
        unknown
      >;
    }

    it('reports the server as running, with its live port', async () => {
      // This path hardcoded `false` on a host where the server was
      // demonstrably listening, so an enhancement pass could not call a single
      // Ptah tool.
      const call = await mcpFieldsSentWith(51821);
      expect(call['mcpServerRunning']).toBe(true);
      expect(call['mcpPort']).toBe(51821);
    });

    it('reports false when the host started no MCP server', async () => {
      const call = await mcpFieldsSentWith(null);
      expect(call['mcpServerRunning']).toBe(false);
      expect(call['mcpPort']).toBeUndefined();
    });

    it('reports false in a host that registered no status port at all', async () => {
      const call = await mcpFieldsSentWith(undefined);
      expect(call['mcpServerRunning']).toBe(false);
    });
  });

  describe('enhance: the model handed to InternalQuery (TASK_2026_250)', () => {
    const judgeDecision = {
      status: 'scored',
      score: 8,
      criteria: null,
      reason: 'judge-verdict',
    } as const;

    /**
     * `judgeModel: 'inherit'` is NOT optional here, and the reason is a trap
     * worth naming: `makeSettings()`'s default is the literal
     * `'claude-haiku-4-5-20251001'` — an EXPLICIT model, which
     * `resolveJudgeModel` returns on its first line without reading any
     * setting. That literal is also the value of `JUDGE_DEFAULT_MODEL_ID`, so a
     * case written against the default would assert the right string for
     * entirely the wrong reason and pass against any implementation. Caught by
     * mutation-testing these cases against the pre-change resolver.
     */
    async function modelSentWith(
      configSeed: Record<string, string>,
    ): Promise<{ model: string; call: Record<string, unknown> }> {
      const h = makeHarness({
        judgeDecision,
        candidateText: 'Improved body',
        configSeed,
      });
      await h.svc.enhance(
        'deep-research',
        makeSettings({ judgeModel: 'inherit' }),
      );
      expect(h.internalQuery.execute).toHaveBeenCalledTimes(1);
      const call = h.internalQuery.execute.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      return { model: call['model'] as string, call };
    }

    it('passes resolveJudgeModel s output through unchanged — the active provider s model', async () => {
      const { model, call } = await modelSentWith({
        'provider.apiKey.selectedModel': 'active-chat-model',
      });
      expect(model).toBe('active-chat-model');
      // No `auth` override: this is why the ambient-env argument that justifies
      // the pinned default covers this caller too, despite it not being a lane.
      expect(call['auth']).toBeUndefined();
    });

    it('does not read the dead VS Code LM key even when it holds a value', async () => {
      const { model } = await modelSentWith({
        'llm.vscode.model': 'some-vendor/some-family',
      });
      expect(model).toBe(JUDGE_DEFAULT_MODEL_ID);
    });

    it('falls back to the shipped judge default when nothing is pinned', async () => {
      const { model } = await modelSentWith({});
      expect(model).toBe(JUDGE_DEFAULT_MODEL_ID);
    });

    it('sends an EXPLICIT judgeModel verbatim, consulting no setting', async () => {
      // The complement of the three cases above, and what makes their
      // `judgeModel: 'inherit'` load-bearing rather than decorative.
      const h = makeHarness({
        judgeDecision,
        candidateText: 'Improved body',
        configSeed: { 'provider.apiKey.selectedModel': 'active-chat-model' },
      });
      await h.svc.enhance(
        'deep-research',
        makeSettings({ judgeModel: 'an-explicitly-pinned-model' }),
      );
      const call = h.internalQuery.execute.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(call['model']).toBe('an-explicitly-pinned-model');
    });
  });

  it('spec findings: graded review verdict is injected into the enhance prompt', async () => {
    const h = makeHarness({
      judgeDecision: {
        status: 'scored',
        score: 8,
        criteria: null,
        reason: 'judge-verdict',
      },
      candidateText: 'Improved body',
      specFindings: 'REVIEW: missing error handling on the write path',
    });
    await h.svc.enhance('deep-research', makeSettings());
    expect(h.specFindings.getRecentFindings).toHaveBeenCalledWith(
      'deep-research',
    );
    const prompt = h.internalQuery.execute.mock.calls[0][0].prompt as string;
    expect(prompt).toContain('Graded review findings');
    expect(prompt).toContain('missing error handling on the write path');
  });

  it('cooldown: skips when lastEnhancedAt is recent', async () => {
    const h = makeHarness({
      judgeDecision: {
        status: 'scored',
        score: 8,
        criteria: null,
        reason: 'judge-verdict',
      },
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
      judgeDecision: {
        status: 'scored',
        score: 8,
        criteria: null,
        reason: 'judge-verdict',
      },
      candidateText: 'Improved body',
      stats: { total: 2, succeeded: 1, failed: 1, distinctContexts: 1 },
    });
    const result = await h.svc.enhance('deep-research', makeSettings());
    expect(result.changed).toBe(false);
    expect(result.skipReason).toBe('below-threshold');
  });

  it('a disabled judge does NOT auto-write', async () => {
    const h = makeHarness({
      judgeDecision: {
        status: 'disabled',
        score: null,
        criteria: null,
        reason: 'judge-disabled',
      },
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
      judgeDecision: {
        status: 'scored',
        score: 8,
        criteria: null,
        reason: 'judge-verdict',
      },
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
      judgeDecision: {
        status: 'scored',
        score: 9,
        criteria: null,
        reason: 'judge-verdict',
      },
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
      judgeDecision: {
        status: 'scored',
        score: 9,
        criteria: null,
        reason: 'judge-verdict',
      },
      candidateText: '---\nname: deep-research\n---\nImproved body',
    });
    const result = await h.svc.enhance('deep-research', makeSettings());
    expect(result.changed).toBe(false);
    expect(result.skipReason).toBe('invalid-candidate');
    expect(h.mirror.writeEnhancedSkill).not.toHaveBeenCalled();
  });

  it('revert: restores via mirror, marks enhanced, re-propagates', async () => {
    const h = makeHarness({
      judgeDecision: {
        status: 'scored',
        score: 8,
        criteria: null,
        reason: 'judge-verdict',
      },
      candidateText: 'x',
    });
    const result = await h.svc.revert('deep-research', '1700000000000');
    expect(result.reverted).toBe(true);
    expect(h.mirror.revert).toHaveBeenCalledWith({
      kind: 'skill',
      slug: 'deep-research',
      historyTs: '1700000000000',
      workspaceRoot: '/home/u/project',
    });
    expect(h.registry.markEnhanced).toHaveBeenCalledTimes(1);
    expect(h.repropagation.repropagate).toHaveBeenCalledTimes(1);
  });

  it('kind=agent: judge PASS writes via writeEnhancedFileClone + markEnhanced/repropagate agent', async () => {
    const h = makeHarness({
      judgeDecision: {
        status: 'scored',
        score: 8,
        criteria: null,
        reason: 'judge-verdict',
      },
      candidateText:
        '---\nname: deep-research\ndescription: Research deeply\n---\nImproved agent body',
    });
    const result = await h.svc.enhance('deep-research', makeSettings(), {
      kind: 'agent',
    });
    expect(result.changed).toBe(true);
    expect(result.kind).toBe('agent');
    expect(h.mirror.writeEnhancedFileClone).toHaveBeenCalledTimes(1);
    expect(h.mirror.writeEnhancedFileClone).toHaveBeenCalledWith({
      kind: 'agent',
      slug: 'deep-research',
      newBody: expect.stringContaining('Improved agent body'),
      workspaceRoot: '/home/u/project',
    });
    expect(h.mirror.writeEnhancedSkill).not.toHaveBeenCalled();
    expect(h.registry.markEnhanced).toHaveBeenCalledWith(
      'agent',
      'deep-research',
      expect.any(Number),
      'sha256:new',
    );
    expect(h.repropagation.repropagate).toHaveBeenCalledWith(
      'agent',
      'deep-research',
      expect.any(String),
    );
  });

  it('kind=agent: candidate lacking frontmatter is rejected (invalid-candidate)', async () => {
    const h = makeHarness({
      judgeDecision: {
        status: 'scored',
        score: 9,
        criteria: null,
        reason: 'judge-verdict',
      },
      candidateText: 'agent body with no frontmatter',
    });
    const result = await h.svc.enhance('deep-research', makeSettings(), {
      kind: 'agent',
    });
    expect(result.changed).toBe(false);
    expect(result.skipReason).toBe('invalid-candidate');
    expect(h.mirror.writeEnhancedFileClone).not.toHaveBeenCalled();
  });

  it('kind=command: frontmatter relaxed — writes even without name/description', async () => {
    const h = makeHarness({
      judgeDecision: {
        status: 'scored',
        score: 8,
        criteria: null,
        reason: 'judge-verdict',
      },
      candidateText: 'Improved command prompt without any frontmatter',
    });
    const result = await h.svc.enhance('deep-research', makeSettings(), {
      kind: 'command',
    });
    expect(result.changed).toBe(true);
    expect(result.kind).toBe('command');
    expect(h.mirror.writeEnhancedFileClone).toHaveBeenCalledWith({
      kind: 'command',
      slug: 'deep-research',
      newBody: 'Improved command prompt without any frontmatter',
      workspaceRoot: '/home/u/project',
    });
    expect(h.registry.markEnhanced).toHaveBeenCalledWith(
      'command',
      'deep-research',
      expect.any(Number),
      'sha256:new',
    );
    expect(h.repropagation.repropagate).toHaveBeenCalledWith(
      'command',
      'deep-research',
      expect.any(String),
    );
  });

  it('kind=command: cooldown lookup uses the command registry row', async () => {
    const h = makeHarness({
      judgeDecision: {
        status: 'scored',
        score: 8,
        criteria: null,
        reason: 'judge-verdict',
      },
      candidateText: 'Improved command body',
      lastEnhancedAt: Date.now(),
    });
    const result = await h.svc.enhance('deep-research', makeSettings(), {
      kind: 'command',
    });
    expect(result.skipReason).toBe('cooldown');
    expect(h.registry.getBySlug).toHaveBeenCalledWith(
      'command',
      'deep-research',
    );
  });

  it('revert kind=agent restores the flat clone and re-propagates as agent', async () => {
    const h = makeHarness({
      judgeDecision: {
        status: 'scored',
        score: 8,
        criteria: null,
        reason: 'judge-verdict',
      },
      candidateText: 'x',
    });
    h.mirror.revert.mockResolvedValueOnce({
      kind: 'agent',
      slug: 'deep-research',
      revertedFrom: '1700000000000',
      newHistoryTs: '1800000000000',
      restored: true,
    });
    const result = await h.svc.revert(
      'deep-research',
      '1700000000000',
      'agent',
    );
    expect(result.reverted).toBe(true);
    expect(h.mirror.revert).toHaveBeenCalledWith({
      kind: 'agent',
      slug: 'deep-research',
      historyTs: '1700000000000',
      workspaceRoot: '/home/u/project',
    });
    expect(h.registry.markEnhanced).toHaveBeenCalledWith(
      'agent',
      'deep-research',
      expect.any(Number),
    );
    expect(h.repropagation.repropagate).toHaveBeenCalledWith(
      'agent',
      'deep-research',
      expect.any(String),
    );
  });

  // ─── Batch 6: metrics-aware agent enhancement (R8) ────────────────────────

  const AGENT_CANDIDATE =
    '---\nname: deep-research\ndescription: Research deeply\n---\nImproved agent body';

  function scorecardWithData(): AgentScorecard {
    return {
      slug: 'deep-research',
      totalInvocations: 12,
      gradedCount: 7,
      gradedSuccessRate: 5 / 7,
      avgInputTokens: 48200,
      avgOutputTokens: 6100,
      avgCacheReadTokens: 210000,
      totalInputTokens: 578400,
      totalOutputTokens: 73200,
      avgCostUsd: 0.41,
      avgDurationMs: 252000,
      avgToolCount: 23,
      recentVerdicts: [
        { taskId: 'TASK_2026_155', succeeded: false, reconciledAt: 3 },
        { taskId: 'TASK_2026_154', succeeded: true, reconciledAt: 2 },
      ],
    };
  }

  it('agent + scorecard data: bounded block injected into prompt AND judge context', async () => {
    const h = makeHarness({
      judgeDecision: {
        status: 'scored',
        score: 8,
        criteria: null,
        reason: 'judge-verdict',
      },
      candidateText: AGENT_CANDIDATE,
      scorecardCard: scorecardWithData(),
    });
    await h.svc.enhance('deep-research', makeSettings(), { kind: 'agent' });

    const prompt = h.internalQuery.execute.mock.calls[0][0].prompt as string;
    expect(prompt).toContain('Measured scorecard for this agent');
    expect(prompt).toContain('Reconciled success rate: 71% (5/7 graded runs');
    expect(prompt).toContain('FAILED(TASK_2026_155)');
    expect(prompt).toContain('COMPLETE(TASK_2026_154)');
    expect(prompt).toContain(
      "reduce token consumption and fix recurring failure patterns while preserving the agent's role, triggers, and frontmatter routing",
    );

    // The judge received the SAME block as trailing context (R9).
    const judgeContext = h.judge.judge.mock.calls[0][3] as string;
    expect(judgeContext).toContain('Measured scorecard for this agent');
  });

  it('agent + scorecard data: injected block is ≤1,200 chars (R8.3)', async () => {
    const h = makeHarness({
      judgeDecision: {
        status: 'scored',
        score: 8,
        criteria: null,
        reason: 'judge-verdict',
      },
      candidateText: AGENT_CANDIDATE,
      scorecardCard: scorecardWithData(),
    });
    await h.svc.enhance('deep-research', makeSettings(), { kind: 'agent' });
    const prompt = h.internalQuery.execute.mock.calls[0][0].prompt as string;
    const block = prompt.slice(prompt.indexOf('Measured scorecard'));
    expect(block.length).toBeLessThanOrEqual(1200);
  });

  it('agent + NO scorecard data: prompt byte-identical to scorecard-service-absent (R8.2)', async () => {
    const withService = makeHarness({
      judgeDecision: {
        status: 'scored',
        score: 8,
        criteria: null,
        reason: 'judge-verdict',
      },
      candidateText: AGENT_CANDIDATE,
      // default emptyScorecard → no data
    });
    await withService.svc.enhance('deep-research', makeSettings(), {
      kind: 'agent',
    });
    const promptNoData = withService.internalQuery.execute.mock.calls[0][0]
      .prompt as string;

    const absent = makeHarness({
      judgeDecision: {
        status: 'scored',
        score: 8,
        criteria: null,
        reason: 'judge-verdict',
      },
      candidateText: AGENT_CANDIDATE,
      scorecardAbsent: true,
    });
    await absent.svc.enhance('deep-research', makeSettings(), {
      kind: 'agent',
    });
    const promptAbsent = absent.internalQuery.execute.mock.calls[0][0]
      .prompt as string;

    expect(promptNoData).toBe(promptAbsent);
    expect(promptNoData).not.toContain('Measured scorecard');
    // No block → judge context is undefined.
    expect(withService.judge.judge.mock.calls[0][3]).toBeUndefined();
  });

  it('kind=skill: scorecard never consulted and no block injected', async () => {
    const h = makeHarness({
      judgeDecision: {
        status: 'scored',
        score: 8,
        criteria: null,
        reason: 'judge-verdict',
      },
      candidateText:
        '---\nname: deep-research\ndescription: Research deeply\n---\nImproved body',
      scorecardCard: scorecardWithData(),
    });
    await h.svc.enhance('deep-research', makeSettings());
    expect(h.scorecard.getScorecards).not.toHaveBeenCalled();
    const prompt = h.internalQuery.execute.mock.calls[0][0].prompt as string;
    expect(prompt).not.toContain('Measured scorecard');
  });

  it('kind=command: scorecard never consulted and no block injected', async () => {
    const h = makeHarness({
      judgeDecision: {
        status: 'scored',
        score: 8,
        criteria: null,
        reason: 'judge-verdict',
      },
      candidateText: 'Improved command prompt',
      scorecardCard: scorecardWithData(),
    });
    await h.svc.enhance('deep-research', makeSettings(), { kind: 'command' });
    expect(h.scorecard.getScorecards).not.toHaveBeenCalled();
  });

  it('gates untouched: agent cooldown short-circuits before scorecard/LLM', async () => {
    const h = makeHarness({
      judgeDecision: {
        status: 'scored',
        score: 8,
        criteria: null,
        reason: 'judge-verdict',
      },
      candidateText: AGENT_CANDIDATE,
      scorecardCard: scorecardWithData(),
      lastEnhancedAt: Date.now(),
    });
    const result = await h.svc.enhance('deep-research', makeSettings(), {
      kind: 'agent',
    });
    expect(result.skipReason).toBe('cooldown');
    expect(h.scorecard.getScorecards).not.toHaveBeenCalled();
    expect(h.internalQuery.execute).not.toHaveBeenCalled();
  });

  it('gates untouched: agent below-threshold short-circuits before scorecard/LLM', async () => {
    const h = makeHarness({
      judgeDecision: {
        status: 'scored',
        score: 8,
        criteria: null,
        reason: 'judge-verdict',
      },
      candidateText: AGENT_CANDIDATE,
      scorecardCard: scorecardWithData(),
      stats: { total: 2, succeeded: 1, failed: 1, distinctContexts: 1 },
    });
    const result = await h.svc.enhance('deep-research', makeSettings(), {
      kind: 'agent',
    });
    expect(result.skipReason).toBe('below-threshold');
    expect(h.scorecard.getScorecards).not.toHaveBeenCalled();
    expect(h.internalQuery.execute).not.toHaveBeenCalled();
  });

  it('revert kind=command restores the flat clone', async () => {
    const h = makeHarness({
      judgeDecision: {
        status: 'scored',
        score: 8,
        criteria: null,
        reason: 'judge-verdict',
      },
      candidateText: 'x',
    });
    h.mirror.revert.mockResolvedValueOnce({
      kind: 'command',
      slug: 'deep-research',
      revertedFrom: '1700000000000',
      newHistoryTs: '1800000000000',
      restored: true,
    });
    const result = await h.svc.revert(
      'deep-research',
      '1700000000000',
      'command',
    );
    expect(result.reverted).toBe(true);
    expect(h.mirror.revert).toHaveBeenCalledWith({
      kind: 'command',
      slug: 'deep-research',
      historyTs: '1700000000000',
      workspaceRoot: '/home/u/project',
    });
  });
});

// ─── Preview-before-apply: generateProposal / applyProposal seam ────────────

describe('SkillEnhancerService — preview-before-apply', () => {
  beforeEach(() => jest.clearAllMocks());

  const PASS: JudgeDecision = {
    status: 'scored',
    score: 8,
    criteria: null,
    reason: 'judge-verdict',
  };
  const IMPROVED =
    '---\nname: deep-research\ndescription: Research deeply\n---\nImproved body';
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function passingHarness() {
    return makeHarness({ judgeDecision: PASS, candidateText: IMPROVED });
  }

  /**
   * `makeHarness` resolves `execute` to ONE async generator, so its stream is
   * exhausted after a single call (every existing test drives `enhance` once).
   * Tests that generate several proposals re-arm it with a fresh stream per
   * call.
   */
  function armRepeatableLlm(h: Harness, text: string): void {
    h.internalQuery.execute.mockImplementation(async () => ({
      stream: (async function* () {
        yield {
          type: 'assistant',
          message: { content: [{ type: 'text', text }] },
        };
        yield { type: 'result' };
      })(),
      abort: jest.fn(),
      close: jest.fn(),
    }));
  }

  it('generateProposal returns both bodies + an opaque proposalId', async () => {
    const h = passingHarness();
    const result = await h.svc.generateProposal(
      'deep-research',
      makeSettings(),
    );

    expect(result.proposed).toBe(true);
    expect(result.skipReason).toBeUndefined();
    expect(result.proposalId).toMatch(UUID_RE);
    expect(result.currentBody).toContain('Body');
    expect(result.proposedBody).toBe(IMPROVED);
    expect(result.judgeScore).toBe(8);
    expect(result.judgeReason).toBe('judge-verdict');
    expect(result.kind).toBe('skill');
  });

  it('generateProposal writes NOTHING to disk and does not mutate the registry', async () => {
    const h = passingHarness();
    await h.svc.generateProposal('deep-research', makeSettings());

    expect(h.mirror.writeEnhancedSkill).not.toHaveBeenCalled();
    expect(h.mirror.writeEnhancedFileClone).not.toHaveBeenCalled();
    expect(h.mirror.revert).not.toHaveBeenCalled();
    expect(h.registry.markEnhanced).not.toHaveBeenCalled();
    expect(h.repropagation.repropagate).not.toHaveBeenCalled();
  });

  it('generateProposal(kind=agent) still writes nothing', async () => {
    const h = passingHarness();
    const result = await h.svc.generateProposal(
      'deep-research',
      makeSettings(),
      { kind: 'agent' },
    );

    expect(result.proposed).toBe(true);
    expect(result.kind).toBe('agent');
    expect(h.mirror.writeEnhancedFileClone).not.toHaveBeenCalled();
    expect(h.registry.markEnhanced).not.toHaveBeenCalled();
  });

  it('applyProposal writes the exact previewed body without re-running the LLM', async () => {
    const h = passingHarness();
    const proposal = await h.svc.generateProposal(
      'deep-research',
      makeSettings(),
    );
    expect(h.internalQuery.execute).toHaveBeenCalledTimes(1);

    const applied = await h.svc.applyProposal(
      'skill',
      'deep-research',
      proposal.proposalId as string,
    );

    expect(applied.applied).toBe(true);
    expect(applied.historyTs).toBe('1700000000000');
    expect(applied.judgeScore).toBe(8);
    // The LLM ran once, during preview only.
    expect(h.internalQuery.execute).toHaveBeenCalledTimes(1);
    expect(h.mirror.writeEnhancedSkill).toHaveBeenCalledTimes(1);
    expect(h.mirror.writeEnhancedSkill).toHaveBeenCalledWith({
      slug: 'deep-research',
      newBody: IMPROVED,
    });
    expect(h.registry.markEnhanced).toHaveBeenCalledWith(
      'skill',
      'deep-research',
      expect.any(Number),
      'sha256:new',
    );
    expect(h.repropagation.repropagate).toHaveBeenCalledTimes(1);
  });

  it('applyProposal(kind=agent) routes through writeEnhancedFileClone', async () => {
    const h = passingHarness();
    const proposal = await h.svc.generateProposal(
      'deep-research',
      makeSettings(),
      { kind: 'agent' },
    );
    await h.svc.applyProposal(
      'agent',
      'deep-research',
      proposal.proposalId as string,
    );

    expect(h.mirror.writeEnhancedFileClone).toHaveBeenCalledWith({
      kind: 'agent',
      slug: 'deep-research',
      newBody: IMPROVED,
      workspaceRoot: '/home/u/project',
    });
    expect(h.mirror.writeEnhancedSkill).not.toHaveBeenCalled();
  });

  it('applyProposal with an unknown proposalId throws not-found and writes nothing', async () => {
    const h = passingHarness();
    await expect(
      h.svc.applyProposal(
        'skill',
        'deep-research',
        '00000000-0000-4000-8000-000000000000',
      ),
    ).rejects.toBeInstanceOf(ProposalNotFoundError);
    expect(h.mirror.writeEnhancedSkill).not.toHaveBeenCalled();
    expect(h.registry.markEnhanced).not.toHaveBeenCalled();
  });

  it('applyProposal never regenerates on a cache miss', async () => {
    const h = passingHarness();
    await h.svc
      .applyProposal(
        'skill',
        'deep-research',
        '00000000-0000-4000-8000-000000000000',
      )
      .catch(() => undefined);
    expect(h.internalQuery.execute).not.toHaveBeenCalled();
  });

  it('applyProposal rejects an expired proposal (TTL)', async () => {
    const h = passingHarness();
    const nowSpy = jest.spyOn(Date, 'now');
    const t0 = 1_700_000_000_000;
    nowSpy.mockReturnValue(t0);

    const proposal = await h.svc.generateProposal(
      'deep-research',
      makeSettings(),
    );
    expect(proposal.proposalId).not.toBeNull();

    nowSpy.mockReturnValue(t0 + PROPOSAL_TTL_MS + 1);
    let thrown: unknown;
    try {
      await h.svc.applyProposal(
        'skill',
        'deep-research',
        proposal.proposalId as string,
      );
    } catch (error: unknown) {
      thrown = error;
    }
    nowSpy.mockRestore();

    expect(thrown).toBeInstanceOf(ProposalNotFoundError);
    expect((thrown as ProposalNotFoundError).code).toBe('not-found');
    expect(h.mirror.writeEnhancedSkill).not.toHaveBeenCalled();
  });

  it('applyProposal rejects a slug mismatch (proposal belongs to another clone)', async () => {
    const h = passingHarness();
    const proposal = await h.svc.generateProposal(
      'deep-research',
      makeSettings(),
    );

    let thrown: unknown;
    try {
      await h.svc.applyProposal(
        'skill',
        'other-slug',
        proposal.proposalId as string,
      );
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProposalNotFoundError);
    expect((thrown as ProposalNotFoundError).code).toBe('mismatch');
    expect(h.mirror.writeEnhancedSkill).not.toHaveBeenCalled();
  });

  it('applyProposal rejects a kind mismatch', async () => {
    const h = passingHarness();
    const proposal = await h.svc.generateProposal(
      'deep-research',
      makeSettings(),
    );

    let thrown: unknown;
    try {
      await h.svc.applyProposal(
        'agent',
        'deep-research',
        proposal.proposalId as string,
      );
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProposalNotFoundError);
    expect((thrown as ProposalNotFoundError).code).toBe('mismatch');
  });

  it('a proposalId is single-use: re-applying throws instead of double-writing', async () => {
    const h = passingHarness();
    const proposal = await h.svc.generateProposal(
      'deep-research',
      makeSettings(),
    );
    await h.svc.applyProposal(
      'skill',
      'deep-research',
      proposal.proposalId as string,
    );

    await expect(
      h.svc.applyProposal(
        'skill',
        'deep-research',
        proposal.proposalId as string,
      ),
    ).rejects.toBeInstanceOf(ProposalNotFoundError);
    expect(h.mirror.writeEnhancedSkill).toHaveBeenCalledTimes(1);
  });

  it('cache is bounded: the oldest proposal is evicted past MAX_CACHED_PROPOSALS', async () => {
    const h = passingHarness();
    armRepeatableLlm(h, IMPROVED);
    const first = await h.svc.generateProposal('deep-research', makeSettings());
    expect(first.proposalId).not.toBeNull();

    for (let i = 0; i < MAX_CACHED_PROPOSALS; i += 1) {
      await h.svc.generateProposal('deep-research', makeSettings());
    }

    await expect(
      h.svc.applyProposal('skill', 'deep-research', first.proposalId as string),
    ).rejects.toBeInstanceOf(ProposalNotFoundError);
  });

  it('judge-rejected preview still returns the diff plus the reason', async () => {
    const h = makeHarness({
      judgeDecision: {
        status: 'scored',
        score: 3,
        criteria: null,
        reason: 'judge-verdict',
      },
      candidateText: IMPROVED,
    });
    const result = await h.svc.generateProposal(
      'deep-research',
      makeSettings(),
      { manual: true },
    );

    expect(result.proposed).toBe(false);
    expect(result.proposalId).toBeNull();
    expect(result.skipReason).toBe('judge-rejected');
    expect(result.proposedBody).toBe(IMPROVED);
    expect(result.currentBody).toContain('Body');
    expect(result.judgeScore).toBe(3);
    expect(h.mirror.writeEnhancedSkill).not.toHaveBeenCalled();
  });

  it('invalid-candidate preview yields no proposalId and no write', async () => {
    const h = makeHarness({
      judgeDecision: PASS,
      candidateText: 'Improved body with no frontmatter at all',
    });
    const result = await h.svc.generateProposal(
      'deep-research',
      makeSettings(),
    );

    expect(result.proposed).toBe(false);
    expect(result.proposalId).toBeNull();
    expect(result.skipReason).toBe('invalid-candidate');
    expect(h.mirror.writeEnhancedSkill).not.toHaveBeenCalled();
  });

  it('no-change preview short-circuits before the judge', async () => {
    const h = makeHarness({
      judgeDecision: PASS,
      candidateText:
        '---\nname: deep-research\ndescription: Research deeply\n---\nBody',
    });
    const result = await h.svc.generateProposal(
      'deep-research',
      makeSettings(),
    );

    expect(result.proposed).toBe(false);
    expect(result.skipReason).toBe('no-change');
    expect(result.proposalId).toBeNull();
    expect(h.judge.judge).not.toHaveBeenCalled();
  });

  it('cooldown preview is bypassed by manual (matching enhanceNow)', async () => {
    const h = makeHarness({
      judgeDecision: PASS,
      candidateText: IMPROVED,
      lastEnhancedAt: Date.now(),
    });

    const auto = await h.svc.generateProposal('deep-research', makeSettings());
    expect(auto.skipReason).toBe('cooldown');
    expect(h.internalQuery.execute).not.toHaveBeenCalled();

    const manual = await h.svc.generateProposal(
      'deep-research',
      makeSettings(),
      { manual: true },
    );
    expect(manual.proposed).toBe(true);
  });

  it('enhance() composes both halves: one LLM call, one write, one repropagate', async () => {
    const h = passingHarness();
    const result = await h.svc.enhance('deep-research', makeSettings());

    expect(result.changed).toBe(true);
    expect(result.historyTs).toBe('1700000000000');
    expect(result.judgeScore).toBe(8);
    expect(result.skipReason).toBeUndefined();
    expect(h.internalQuery.execute).toHaveBeenCalledTimes(1);
    expect(h.mirror.writeEnhancedSkill).toHaveBeenCalledTimes(1);
    expect(h.repropagation.repropagate).toHaveBeenCalledTimes(1);
  });

  it('enhance() leaves no proposal behind (the id it minted is consumed)', async () => {
    const h = passingHarness();
    armRepeatableLlm(h, IMPROVED);
    await h.svc.enhance('deep-research', makeSettings());

    // A fresh preview + apply still works and advances the write count by
    // exactly one — the id enhance() minted was consumed, not left dangling.
    const proposal = await h.svc.generateProposal(
      'deep-research',
      makeSettings(),
    );
    await h.svc.applyProposal(
      'skill',
      'deep-research',
      proposal.proposalId as string,
    );
    expect(h.mirror.writeEnhancedSkill).toHaveBeenCalledTimes(2);
  });

  it('enhance() stays fail-soft when the write path throws', async () => {
    const h = passingHarness();
    h.mirror.writeEnhancedSkill.mockRejectedValueOnce(new Error('EACCES'));

    const result = await h.svc.enhance('deep-research', makeSettings());
    expect(result.changed).toBe(false);
    expect(result.skipReason).toBe('error');
    expect(h.registry.markEnhanced).not.toHaveBeenCalled();
  });
});

// ─── B4.3.2: win rate as an auto-enhance eligibility input ──────────────────

describe('SkillEnhancerService — win rate as an eligibility input', () => {
  const PASS: JudgeDecision = {
    status: 'scored',
    score: 8,
    criteria: null,
    reason: 'judge-verdict',
  };
  const IMPROVED =
    '---\nname: deep-research\ndescription: Research deeply\n---\nImproved body';

  /** Enough recorded usage that only the win rate can decide. */
  const USED = {
    total: MIN_INVOCATIONS_TO_ENHANCE + 5,
    succeeded: 4,
    failed: 6,
    distinctContexts: 3,
  };

  function harness(winRate: number | null | undefined) {
    return makeHarness({
      judgeDecision: PASS,
      candidateText: IMPROVED,
      stats: USED,
      winRate,
    });
  }

  beforeEach(() => jest.clearAllMocks());

  describe('isEligible', () => {
    it('blocks a clone whose MEASURED win rate is at or above the ceiling', () => {
      const h = harness(0.9);
      expect(h.svc.isEligible('deep-research', makeSettings())).toBe(false);
    });

    it('blocks exactly AT the ceiling (>=, not >)', () => {
      const h = harness(MAX_WIN_RATE_TO_AUTO_ENHANCE);
      expect(h.svc.isEligible('deep-research', makeSettings())).toBe(false);
    });

    it('allows just below the ceiling', () => {
      const h = harness(MAX_WIN_RATE_TO_AUTO_ENHANCE - 0.01);
      expect(h.svc.isEligible('deep-research', makeSettings())).toBe(true);
    });

    it('allows an UNMEASURED clone — null does not gate, the invocation floor decides', () => {
      // The store reports nothing at all for this slug.
      expect(
        harness(undefined).svc.isEligible('deep-research', makeSettings()),
      ).toBe(true);
      // ...and an explicit `winRate: null` row means the same thing.
      expect(
        harness(null).svc.isEligible('deep-research', makeSettings()),
      ).toBe(true);
    });

    it('allows a MEASURED 0 — the loser is exactly what enhancement is for', () => {
      const h = harness(0);
      expect(h.svc.isEligible('deep-research', makeSettings())).toBe(true);
    });

    it('keeps MIN_INVOCATIONS_TO_ENHANCE: too little usage still blocks, measured or not', () => {
      const thin = {
        total: MIN_INVOCATIONS_TO_ENHANCE - 1,
        succeeded: 1,
        failed: 3,
        distinctContexts: 1,
      };
      const unmeasured = makeHarness({
        judgeDecision: PASS,
        candidateText: IMPROVED,
        stats: thin,
      });
      const losing = makeHarness({
        judgeDecision: PASS,
        candidateText: IMPROVED,
        stats: thin,
        winRate: 0.1,
      });

      expect(unmeasured.svc.isEligible('deep-research', makeSettings())).toBe(
        false,
      );
      expect(losing.svc.isEligible('deep-research', makeSettings())).toBe(
        false,
      );
    });

    it('treats a failed win-rate read as unmeasured rather than as a verdict', () => {
      const h = harness(0.9);
      h.candidates.getWinRates.mockImplementation(() => {
        throw new Error('no such table: skill_session_verdicts');
      });
      expect(h.svc.isEligible('deep-research', makeSettings())).toBe(true);
    });
  });

  describe('generateProposal', () => {
    it('skips a winning clone with win-rate-sufficient and spends no LLM call', async () => {
      const h = harness(0.9);

      const result = await h.svc.generateProposal(
        'deep-research',
        makeSettings(),
      );

      expect(result.proposed).toBe(false);
      expect(result.proposalId).toBeNull();
      expect(result.skipReason).toBe('win-rate-sufficient');
      expect(h.internalQuery.execute).not.toHaveBeenCalled();
      expect(h.mirror.writeEnhancedSkill).not.toHaveBeenCalled();
    });

    it('manual bypasses the win-rate gate exactly as it bypasses the invocation floor', async () => {
      const h = harness(0.95);

      const result = await h.svc.generateProposal(
        'deep-research',
        makeSettings(),
        { manual: true },
      );

      expect(result.proposed).toBe(true);
      expect(result.skipReason).toBeUndefined();
      expect(h.internalQuery.execute).toHaveBeenCalledTimes(1);
    });

    it('proceeds for an UNMEASURED clone (null is not a high win rate)', async () => {
      const h = harness(null);

      const result = await h.svc.generateProposal(
        'deep-research',
        makeSettings(),
      );

      expect(result.proposed).toBe(true);
      expect(result.skipReason).toBeUndefined();
    });

    it('proceeds for a MEASURED 0 (0 is not "unmeasured")', async () => {
      const h = harness(0);

      const result = await h.svc.generateProposal(
        'deep-research',
        makeSettings(),
      );

      expect(result.proposed).toBe(true);
      expect(result.skipReason).toBeUndefined();
    });

    it('reports below-threshold, not win-rate-sufficient, when both would block', async () => {
      const h = makeHarness({
        judgeDecision: PASS,
        candidateText: IMPROVED,
        stats: {
          total: MIN_INVOCATIONS_TO_ENHANCE - 1,
          succeeded: 1,
          failed: 0,
          distinctContexts: 1,
        },
        winRate: 0.95,
      });

      const result = await h.svc.generateProposal(
        'deep-research',
        makeSettings(),
      );

      expect(result.skipReason).toBe('below-threshold');
    });

    it('enhance() surfaces the win-rate skip to its caller', async () => {
      const h = harness(0.9);

      const result = await h.svc.enhance('deep-research', makeSettings());

      expect(result.changed).toBe(false);
      expect(result.skipReason).toBe('win-rate-sufficient');
      expect(h.registry.markEnhanced).not.toHaveBeenCalled();
    });
  });
});
