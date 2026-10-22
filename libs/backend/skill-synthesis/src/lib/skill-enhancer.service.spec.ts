import 'reflect-metadata';
import {
  SkillEnhancerService,
  ProposalNotFoundError,
  PROPOSAL_TTL_MS,
  MAX_CACHED_PROPOSALS,
} from './skill-enhancer.service';
import { type SkillSynthesisSettings } from './types';
import type { JudgeDecision } from './skill-judge.service';
import type { AgentScorecard } from '@ptah-extension/shared';
import { ENHANCE_TIMEOUT_DEFAULT_MS } from '@ptah-extension/platform-core';
import { ProviderNetworkBackoffs } from './lanes/provider-network-backoffs';

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
    evictionDecayRate: 0.95,
    generalizationContextThreshold: 3,
    dedupClusterThreshold: 0.78,
    prefilterMinEdits: 1,
    prefilterMinToolUses: 2,
    judgeEnabled: true,
    minJudgeScore: 6.0,
    judgeModel: 'claude-haiku-4-5-20251001',
    judgeProvider: '',
    enhanceTimeoutMs: ENHANCE_TIMEOUT_DEFAULT_MS,
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

function makeStreamQuery(messages: readonly unknown[]) {
  return {
    execute: jest.fn().mockImplementation(async () => ({
      stream: (async function* () {
        for (const msg of messages) yield msg;
      })(),
      abort: jest.fn(),
      close: jest.fn(),
    })),
  };
}

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
  registry: { getBySlug: jest.Mock; markEnhanced: jest.Mock };
  judge: { judge: jest.Mock };
  internalQuery: { execute: jest.Mock };
  repropagation: { repropagate: jest.Mock };
  specFindings: { getRecentFindings: jest.Mock };
  scorecard: { getScorecards: jest.Mock };
  authResolver?: { resolve: jest.Mock } | null;
  workspaceProvider: {
    getConfiguration: jest.Mock;
    getWorkspaceRoot: jest.Mock;
  };
}

function makeHarness(opts: {
  judgeDecision: JudgeDecision;
  candidateText: string;
  lastEnhancedAt?: number | null;
  workspaceRoot?: string;
  specFindings?: string | null;
  /** Scorecard returned for the slug; defaults to a no-data empty card. */
  scorecardCard?: AgentScorecard;
  /** When true, the scorecard service is not injected (dependency absent). */
  scorecardAbsent?: boolean;
  /**
   * Settings this workspace has stored. Unseeded keys read `''`, which is what
   * every pre-existing case in this file relied on.
   */
  configSeed?: Record<string, unknown>;
  /**
   * The port the in-process MCP server is listening on, or `null` for a host
   * that started none. `undefined` injects no status port at all â€” the CLI.
   */
  mcpPort?: number | null;
  /** Replaces the one-text-block stream with these messages (C14 f). */
  streamMessages?: readonly unknown[];
  /** The library's per-provider network back-offs; absent = none injected. */
  networkBackoffs?: ProviderNetworkBackoffs;
  /** Optional auth resolver for provider resolution. */
  authResolver?: { resolve: jest.Mock } | null;
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
  const internalQuery = opts.streamMessages
    ? makeStreamQuery(opts.streamMessages)
    : makeInternalQuery(opts.candidateText);
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

  const authResolver =
    opts.authResolver !== undefined ? opts.authResolver : null;

  const svc = new SkillEnhancerService(
    logger as never,
    workspaceProvider as never,
    mirror as never,
    registry as never,
    judge as never,
    internalQuery as never,
    repropagation as never,
    specFindings as never,
    (opts.scorecardAbsent ? null : scorecard) as never,
    (opts.mcpPort === undefined
      ? null
      : { getPort: () => opts.mcpPort ?? null }) as never,
    opts.networkBackoffs ?? null,
    authResolver as never,
  );

  const generateProposal = svc.generateProposal.bind(svc);
  svc.generateProposal = (slug, settings, options = {}) =>
    generateProposal(slug, settings, { manual: true, ...options });
  const enhance = svc.enhance.bind(svc);
  svc.enhance = (slug, settings, options = {}) =>
    enhance(slug, settings, { manual: true, ...options });

  return {
    svc,
    mirror,
    registry,
    judge,
    internalQuery,
    repropagation,
    specFindings,
    scorecard,
    authResolver,
    workspaceProvider,
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

describe('SkillEnhancerService â€” preview-before-apply', () => {
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
    expect(result.draft).toMatchObject({
      before: expect.stringContaining('Body'),
      after: IMPROVED,
      sourceHash: expect.stringMatching(/^sha256:[0-9a-f]{64}$/),
      model: expect.any(String),
      diff: expect.stringContaining('+Improved body'),
      evidence: {
        trajectory: expect.any(String),
        findings: expect.any(String),
        scorecard: expect.any(String),
      },
    });
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

  it('logs a sanitized diagnostic when proposal generation fails', async () => {
    const h = passingHarness();
    logger.warn.mockClear();
    h.judge.judge.mockRejectedValueOnce(
      new Error('request failed bearer secret-token at https://example.test/?key=secret'),
    );

    const result = await h.svc.generateProposal('deep-research', makeSettings());

    expect(result.skipReason).toBe('error');
    expect(logger.warn).toHaveBeenCalledWith(
      '[skill-enhancer] proposal generation failed',
      expect.objectContaining({
        errorName: 'Error',
        errorMessage: expect.stringContaining('[credential]'),
      }),
    );
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('secret-token');
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('example.test');
  });

  it('provider failure returns a draft skip and leaves the clone untouched', async () => {
    const authResolver = {
      resolve: jest.fn().mockRejectedValue(new Error('provider unavailable')),
    };
    const h = makeHarness({
      judgeDecision: PASS,
      candidateText: IMPROVED,
      authResolver,
      configSeed: { 'skills.enhancement.provider': 'deepseek' },
    });

    const result = await h.svc.generateProposal(
      'deep-research',
      makeSettings(),
      { manual: true, userInitiated: true },
    );

    expect(result).toMatchObject({
      proposed: false,
      proposalId: null,
      skipReason: 'provider-unreachable',
    });
    expect(result.draft).toBeUndefined();
    expect(h.mirror.writeEnhancedSkill).not.toHaveBeenCalled();
    expect(h.mirror.writeEnhancedFileClone).not.toHaveBeenCalled();
    expect(h.registry.markEnhanced).not.toHaveBeenCalled();
    expect(h.judge.judge).not.toHaveBeenCalled();
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

  it('applyProposal hands the applyProposal click origin to the re-propagation (FU-17b)', async () => {
    const h = passingHarness();
    const proposal = await h.svc.generateProposal(
      'deep-research',
      makeSettings(),
    );

    await h.svc.applyProposal(
      'skill',
      'deep-research',
      proposal.proposalId as string,
      { userInitiated: true },
    );

    expect(h.repropagation.repropagate).toHaveBeenCalledWith(
      'skill',
      'deep-research',
      expect.any(String),
      { userInitiated: true },
    );
  });

  it('applyProposal with no origin re-propagates as background work', async () => {
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

    expect(h.repropagation.repropagate.mock.calls[0][3]).toEqual({});
  });

  it('applyProposal(kind=agent) routes through writeEnhancedFileClone', async () => {
    const h = passingHarness();
    const proposal = await h.svc.generateProposal(
      'deep-research',
      makeSettings(),
      { kind: 'agent' },
    );

    expect(h.scorecard.getScorecards).toHaveBeenCalledWith(
      ['deep-research'], '/home/u/project',
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
    // exactly one â€” the id enhance() minted was consumed, not left dangling.
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
  it('does not generate an automatic proposal', async () => {
    const h = passingHarness();
    const proposal = await h.svc.generateProposal('deep-research', makeSettings(), {
      manual: false,
    });
    expect(proposal.proposed).toBe(false);
    expect(h.internalQuery.execute).not.toHaveBeenCalled();
    expect(h.svc.isEligible('deep-research', makeSettings())).toBe(false);
  });

  it('reverts a user-selected enhancement', async () => {
    const h = passingHarness();
    const result = await h.svc.revert('deep-research', '1700000000000', 'skill', {
      userInitiated: true,
    });
    expect(result.reverted).toBe(true);
    expect(h.mirror.revert).toHaveBeenCalled();
    expect(h.registry.markEnhanced).toHaveBeenCalled();
  });
});
