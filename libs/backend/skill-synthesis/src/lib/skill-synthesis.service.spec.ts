/**
 * SkillSynthesisService specs — orchestrator-level behavior:
 *   - settings.enabled gate, idempotent start, per-process session dedup
 *     against analyzedSessions, trajectory-hash dedup against the store.
 *   - Manual promote/reject pass-through to the underlying services.
 *
 * Heavy mocking of every collaborator avoids SQLite + filesystem.
 */
import 'reflect-metadata';
import { SkillSynthesisService } from './skill-synthesis.service';
import type { SkillCandidateStore } from './skill-candidate.store';
import type { SkillMdGenerator } from './skill-md-generator';
import type { SkillPromotionService } from './skill-promotion.service';
import type { TrajectoryExtractor } from './trajectory-extractor';
import type { CandidateId, SkillCandidateRow } from './types';

const noopLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
} as unknown as ConstructorParameters<typeof SkillSynthesisService>[0];

function fakeRow(
  overrides: Partial<SkillCandidateRow> = {},
): SkillCandidateRow {
  return {
    id: 'cand_existing' as CandidateId,
    name: 'do-thing',
    description: 'd',
    bodyPath: '/SKILL.md',
    sourceSessionIds: ['s'],
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

describe('SkillSynthesisService', () => {
  function setup(
    opts: {
      enabled?: boolean;
      vecLoaded?: boolean;
      isOpen?: boolean;
    } = {},
  ) {
    const connection = {
      isOpen: opts.isOpen ?? true,
      vecExtensionLoaded: opts.vecLoaded ?? false,
      openAndMigrate: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<
      ConstructorParameters<typeof SkillSynthesisService>[1]
    >;
    const workspaceProvider = {
      getConfiguration: jest.fn(
        (_section: string, key: string, fallback: unknown) => {
          if (key === 'skillSynthesis.enabled') return opts.enabled ?? true;
          return fallback;
        },
      ),
    } as unknown as jest.Mocked<
      ConstructorParameters<typeof SkillSynthesisService>[2]
    >;
    const store = {
      findByTrajectoryHash: jest.fn(() => null),
      registerCandidate: jest.fn(() => ({
        candidate: fakeRow(),
        reused: false,
      })),
      updateStatus: jest.fn(() => fakeRow({ status: 'rejected' })),
    } as unknown as jest.Mocked<SkillCandidateStore>;
    const md = {
      candidatesRoot: jest.fn(() => '/tmp/cands'),
      writeCandidate: jest.fn(() => ({
        slug: 'do-thing',
        dir: '/tmp/cands/do-thing',
        filePath: '/tmp/cands/do-thing/SKILL.md',
      })),
    } as unknown as jest.Mocked<SkillMdGenerator>;
    const promotion = {
      evaluate: jest.fn(() => ({
        promoted: true,
        reason: 'promoted',
        candidate: fakeRow({ status: 'promoted' }),
      })),
    } as unknown as jest.Mocked<SkillPromotionService>;
    const extractor = {
      extract: jest.fn().mockResolvedValue({
        hash: 'hash-1',
        canonicalText: 'canon',
        turnCount: 6,
        shortDescription: 'do thing',
        slug: 'do-thing',
      }),
    } as unknown as jest.Mocked<TrajectoryExtractor>;
    const sessionEndRegistry = {
      register: jest.fn(() => jest.fn()),
    } as unknown as ConstructorParameters<typeof SkillSynthesisService>[8];
    // curatorService is optional (arg index 7 in the new signature)
    const curatorService = null;
    const svc = new SkillSynthesisService(
      noopLogger,
      connection,
      workspaceProvider,
      store,
      md,
      promotion,
      extractor,
      curatorService,
      sessionEndRegistry,
    );
    return {
      svc,
      connection,
      workspaceProvider,
      store,
      md,
      promotion,
      extractor,
    };
  }

  it('start() opens+migrates when connection is closed', async () => {
    const { svc, connection } = setup({ isOpen: false });
    await svc.start();
    expect(connection.openAndMigrate).toHaveBeenCalledTimes(1);
  });

  it('start() is idempotent', async () => {
    const { svc, connection } = setup();
    await svc.start();
    await svc.start();
    expect(connection.openAndMigrate).not.toHaveBeenCalled(); // already open
  });

  it('start() short-circuits when settings.enabled=false', async () => {
    const { svc, connection } = setup({ enabled: false, isOpen: false });
    await svc.start();
    expect(connection.openAndMigrate).not.toHaveBeenCalled();
  });

  it('analyzeSession() returns null before start()', async () => {
    const { svc } = setup();
    expect(await svc.analyzeSession('s1', '/repo')).toBeNull();
  });

  it('analyzeSession() returns null when settings.enabled=false', async () => {
    const { svc, workspaceProvider } = setup();
    await svc.start();
    (workspaceProvider.getConfiguration as jest.Mock).mockImplementation(
      (_s: string, k: string, fb: unknown) =>
        k === 'skillSynthesis.enabled' ? false : fb,
    );
    expect(await svc.analyzeSession('s1', '/repo')).toBeNull();
  });

  it('analyzeSession() registers a fresh candidate when trajectory is novel', async () => {
    const { svc, store, md, extractor } = setup();
    await svc.start();
    const result = await svc.analyzeSession('s1', '/repo');
    expect(extractor.extract).toHaveBeenCalledWith(
      's1',
      '/repo',
      expect.any(Number),
    );
    expect(md.writeCandidate).toHaveBeenCalledTimes(1);
    expect(store.registerCandidate).toHaveBeenCalledTimes(1);
    expect(result?.reused).toBe(false);
  });

  it('analyzeSession() is idempotent for the same session within a process', async () => {
    const { svc, store } = setup();
    await svc.start();
    await svc.analyzeSession('s1', '/repo');
    const second = await svc.analyzeSession('s1', '/repo');
    expect(second).toBeNull();
    expect(store.registerCandidate).toHaveBeenCalledTimes(1);
  });

  it('analyzeSession() reuses an existing candidate when trajectoryHash already exists', async () => {
    const { svc, store } = setup();
    await svc.start();
    const existing = fakeRow({ id: 'cand_existing' as CandidateId });
    (store.findByTrajectoryHash as jest.Mock).mockReturnValue(existing);
    const result = await svc.analyzeSession('s1', '/repo');
    expect(result?.reused).toBe(true);
    expect(result?.candidate.id).toBe('cand_existing');
    expect(store.registerCandidate).not.toHaveBeenCalled();
  });

  it('analyzeSession() returns null when the extractor finds no eligible trajectory', async () => {
    const { svc, store, extractor } = setup();
    await svc.start();
    (extractor.extract as jest.Mock).mockResolvedValue(null);
    const result = await svc.analyzeSession('s1', '/repo');
    expect(result).toBeNull();
    expect(store.registerCandidate).not.toHaveBeenCalled();
  });

  it('analyzeSession() embeds via the optional embedder', async () => {
    const { svc, store } = setup();
    await svc.start();
    const embedVec = new Float32Array([0.1, 0.2]);
    const embedder = {
      embed: jest.fn().mockResolvedValue([embedVec]),
      dim: 2,
      modelId: 'test',
      dispose: jest.fn(),
    };
    await svc.analyzeSession('s1', '/repo', embedder);
    expect(embedder.embed).toHaveBeenCalledWith(['canon']);
    expect(store.registerCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ embedding: embedVec }),
    );
  });

  it('analyzeSession() continues without embedding when the embedder throws', async () => {
    const { svc, store } = setup();
    await svc.start();
    const embedder = {
      embed: jest.fn().mockRejectedValue(new Error('rate limited')),
      dim: 2,
      modelId: 'test',
      dispose: jest.fn(),
    };
    const result = await svc.analyzeSession('s1', '/repo', embedder);
    expect(result?.reused).toBe(false);
    expect(store.registerCandidate).toHaveBeenCalledWith(
      expect.objectContaining({ embedding: null }),
    );
  });

  it('promote() delegates to the promotion service with current settings', () => {
    const { svc, promotion } = setup();
    svc.promote('cand_x' as CandidateId);
    expect(promotion.evaluate).toHaveBeenCalledWith(
      'cand_x',
      expect.objectContaining({ enabled: true, successesToPromote: 3 }),
    );
    // nowFn is NOT passed — promotion service handles its own default
    expect((promotion.evaluate as jest.Mock).mock.calls[0]).toHaveLength(2);
  });

  it('reject() flips the candidate to rejected with the supplied reason', () => {
    const { svc, store } = setup();
    svc.reject('cand_x' as CandidateId, 'not useful');
    expect(store.updateStatus).toHaveBeenCalledWith('cand_x', 'rejected', {
      reason: 'not useful',
    });
  });

  it('readSettings() falls back to defaults when getConfiguration throws', () => {
    const { svc, workspaceProvider } = setup();
    (workspaceProvider.getConfiguration as jest.Mock).mockImplementation(() => {
      throw new Error('config unavailable');
    });
    const settings = svc.readSettings();
    expect(settings).toMatchObject({
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
      judgeModel: 'inherit',
      maxPinnedSkills: 10,
      curatorEnabled: true,
      curatorIntervalHours: 24,
    });
  });
});
