/**
 * SkillCuratorService specs (TASK_2026_578 facade).
 *
 * Two halves:
 *  - the pass orchestration, with the retirement, umbrella and enhancement
 *    collaborators mocked: order, stats, report, event, fail-soft per step and
 *    the one exempt-slug set;
 *  - accept and the startup reconcile on a REAL migrated in-memory database
 *    with the REAL `SkillPromotionService`, `SkillSuggestionStore`,
 *    `SkillRegistryStore` and `SkillMdGenerator`, so the transaction rules
 *    (R-f, R-f2) are proven against rollback rather than against mocks.
 *
 * `os.homedir()` is redirected so curator reports land in a temp directory.
 */
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { MIGRATIONS } from '@ptah-extension/persistence-sqlite';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { SkillCuratorService } from './skill-curator.service';
import { SkillCandidateStore } from './skill-candidate.store';
import { SkillSuggestionStore } from './skill-suggestion.store';
import {
  SkillRegistryStore,
  type SkillRegistryEntry,
} from './skill-registry.store';
import { SkillMdGenerator, SKILLS_ROOT_KEY } from './skill-md-generator';
import {
  SkillPromotionService,
  SUGGESTION_TRAJECTORY_PREFIX,
} from './skill-promotion.service';
import type {
  SkillRetirementResult,
  SkillRetirementService,
} from './lifecycle/skill-retirement.service';
import type {
  SkillUmbrellaMergeService,
  UmbrellaPassResult,
} from './lifecycle/skill-umbrella-merge.service';
import {
  MERGED_INTO_PREFIX,
  unjudgedVerdictFields,
  unmeasuredGateFields,
  type CandidateId,
  type SkillCandidateRow,
  type SkillSuggestionRow,
  type SkillSynthesisSettings,
} from './types';
import {
  asConnection,
  resolveOpener,
  type TestDatabase,
} from './queue/queue-db.test-support';

jest.mock('node:os', () => {
  const actual = jest.requireActual<typeof import('node:os')>('node:os');
  const nodePath = jest.requireActual<typeof import('node:path')>('node:path');
  return {
    ...actual,
    homedir: () => nodePath.join(actual.tmpdir(), 'ptah-curator-spec-home'),
  };
});

type Ctor = ConstructorParameters<typeof SkillCuratorService>;

function makeLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
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

function umbrellaResult(
  overrides: Partial<UmbrellaPassResult> = {},
): UmbrellaPassResult {
  return {
    umbrellasCreated: 0,
    umbrellasRejected: 0,
    judgeRejectedMembers: 0,
    singletonsSurfaced: 0,
    candidatesMerged: 0,
    suggestionsMerged: 0,
    purged: 0,
    purgeSkippedReason: 'already-complete',
    clustersRemaining: 0,
    rateLimited: false,
    mergedIds: [],
    purgedIds: [],
    ...overrides,
  };
}

function makeUmbrella(result: Partial<UmbrellaPassResult> = {}) {
  return {
    runPass: jest.fn(async (..._args: unknown[]): Promise<UmbrellaPassResult> =>
      umbrellaResult(result),
    ),
  };
}

function makeRetirement() {
  return {
    run: jest.fn(
      async (..._args: unknown[]): Promise<SkillRetirementResult> => ({
        dormant: 0,
        retired: 0,
        skippedPinned: 0,
        skippedExempt: 0,
        skippedUncontained: 0,
        dormantSlugs: [],
        retiredSlugs: [],
      }),
    ),
    removeMaterializations: jest.fn(
      async (rows: readonly SkillCandidateRow[], ..._rest: unknown[]) =>
        rows.map((r) => r.name),
    ),
  };
}

const allowingRateLimiter = {
  tryAcquire: jest.fn(() => ({ allowed: true })),
  snapshot: jest.fn(() => null),
};

function promotedRow(name: string, pinned = false): SkillCandidateRow {
  return {
    id: `id-${name}` as CandidateId,
    name,
    description: 'desc',
    bodyPath: '/SKILL.md',
    sourceSessionIds: [],
    trajectoryHash: name,
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
    workspaceRoot: null,
    ...unjudgedVerdictFields(),
    ...unmeasuredGateFields(),
  };
}

// ─── Pass orchestration (mocked collaborators) ─────────────────────────────

describe('SkillCuratorService — pass orchestration', () => {
  interface Harness {
    svc: SkillCuratorService;
    logger: ReturnType<typeof makeLogger>;
    store: { [k: string]: jest.Mock };
    registry: { listAll: jest.Mock; getBySlug: jest.Mock } | null;
    enhancer: { isEligible: jest.Mock; enhance: jest.Mock } | null;
    suggestions: { [k: string]: jest.Mock };
    umbrella: ReturnType<typeof makeUmbrella>;
    retirement: ReturnType<typeof makeRetirement>;
  }

  function harness(
    options: {
      promoted?: SkillCandidateRow[];
      registryRows?: Array<Partial<SkillRegistryEntry>> | null;
      enhancer?: Harness['enhancer'];
      umbrella?: ReturnType<typeof makeUmbrella>;
      retirement?: ReturnType<typeof makeRetirement>;
      invocationTotal?: (slug: string) => number;
    } = {},
  ): Harness {
    const logger = makeLogger();
    const store = {
      listByStatus: jest.fn((status: string) =>
        status === 'promoted' ? (options.promoted ?? []) : [],
      ),
      getInvocationStats: jest.fn((slug: string) => {
        const total = options.invocationTotal?.(slug) ?? 0;
        return { total, succeeded: 0, failed: total, distinctContexts: 1 };
      }),
    };
    const registry =
      options.registryRows === null
        ? null
        : {
            listAll: jest.fn(() => options.registryRows ?? []),
            getBySlug: jest.fn(() => null),
          };
    const suggestions = {
      listAcceptedWithoutPromotedCandidate: jest.fn(() => []),
      findById: jest.fn(() => null),
      dismiss: jest.fn(),
      listByStatus: jest.fn(() => []),
    };
    const umbrella = options.umbrella ?? makeUmbrella();
    const retirement = options.retirement ?? makeRetirement();
    const enhancer = options.enhancer ?? null;
    const svc = new SkillCuratorService(
      logger as unknown as Ctor[0],
      store as unknown as Ctor[1],
      allowingRateLimiter as unknown as Ctor[2],
      registry as unknown as Ctor[3],
      enhancer as unknown as Ctor[4],
      suggestions as unknown as Ctor[5],
      umbrella as unknown as SkillUmbrellaMergeService,
      retirement as unknown as SkillRetirementService,
      {} as SkillPromotionService,
      { activeRoot: () => '/a' } as unknown as SkillMdGenerator,
    );
    return {
      svc,
      logger,
      store,
      registry,
      enhancer,
      suggestions,
      umbrella,
      retirement,
    };
  }

  it('start() schedules nothing when curatorEnabled=false, but still reconciles', async () => {
    jest.useFakeTimers();
    try {
      const h = harness();
      h.svc.start(makeSettings({ curatorEnabled: false }));
      jest.advanceTimersByTime(10 * 3_600_000);
      expect(h.retirement.run).not.toHaveBeenCalled();
      expect(
        h.suggestions.listAcceptedWithoutPromotedCandidate,
      ).toHaveBeenCalledTimes(1);
      h.svc.stop();
    } finally {
      jest.useRealTimers();
    }
  });

  it('the scheduled interval runs a pass', async () => {
    jest.useFakeTimers();
    try {
      const h = harness();
      h.svc.start(makeSettings({ curatorIntervalHours: 1 }));
      await jest.advanceTimersByTimeAsync(3_600_000);
      expect(h.retirement.run).toHaveBeenCalledTimes(1);
      h.svc.stop();
    } finally {
      jest.useRealTimers();
    }
  });

  it('stop() before start() is a no-op', () => {
    expect(() => harness().svc.stop()).not.toThrow();
  });

  it('runManual() before start returns an empty report', async () => {
    const h = harness();
    const report = await h.svc.runManual();
    expect(report).toMatchObject({
      reportPath: '',
      changesQueued: 0,
      skippedPinned: 0,
      suggestionsCreated: 0,
    });
    expect(h.retirement.run).not.toHaveBeenCalled();
  });

  it('runs retirement → umbrella → enhancement, then reports and emits the stats', async () => {
    const order: string[] = [];
    const retirement = makeRetirement();
    retirement.run.mockImplementation(async () => {
      order.push('retirement');
      return {
        dormant: 2,
        retired: 1,
        skippedPinned: 4,
        skippedExempt: 0,
        skippedUncontained: 1,
        dormantSlugs: ['a', 'b'],
        retiredSlugs: ['c'],
      };
    });
    const umbrella = makeUmbrella();
    umbrella.runPass.mockImplementation(async () => {
      order.push('umbrella');
      return umbrellaResult({
        umbrellasCreated: 1,
        singletonsSurfaced: 2,
        candidatesMerged: 3,
        suggestionsMerged: 1,
        purged: 5,
        purgeSkippedReason: null,
        clustersRemaining: 2,
        rateLimited: true,
      });
    });
    const enhancer = {
      isEligible: jest.fn(() => true),
      enhance: jest.fn(async () => {
        order.push('enhancement');
        return { changed: false };
      }),
    };
    const h = harness({
      retirement,
      umbrella,
      enhancer,
      registryRows: [{ kind: 'skill', slug: 'eligible', cloneStatus: 'clone' }],
      invocationTotal: () => 50,
    });
    const onEvent = jest.fn();
    const onPassComplete = jest.fn();
    h.svc.start(makeSettings(), { onEvent, onPassComplete });

    const report = await h.svc.runManual({ userInitiated: true });
    h.svc.stop();

    expect(order).toEqual(['retirement', 'umbrella', 'enhancement']);
    expect(retirement.run).toHaveBeenCalledWith({ userInitiated: true });
    expect(report.changesQueued).toBe(3 + 2 + 1 + 5);
    expect(report.suggestionsCreated).toBe(3);
    expect(report.skippedPinned).toBe(4);
    expect(report.lifecycle).toMatchObject({
      dormant: 2,
      retired: 1,
      merged: 3,
      suggestionsMerged: 1,
      purged: 5,
      purgeSkippedReason: null,
      clustersRemaining: 2,
      rateLimited: true,
      skippedUncontained: 1,
    });
    expect(report.reportPath).not.toBe('');
    const written = fs.readFileSync(report.reportPath, 'utf8');
    expect(written).toContain('Retired: 1');
    expect(written).toContain('Purged: 5');
    fs.rmSync(report.reportPath, { force: true });

    const passEvent = onEvent.mock.calls
      .map(([e]) => e)
      .find((e) => e.kind === 'curator-pass');
    expect(passEvent.stats).toMatchObject({
      suggestionsCreated: 3,
      umbrellasCreated: 1,
      singletonsSurfaced: 2,
      merged: 3,
      dormant: 2,
      retired: 1,
      purged: 5,
      purgeSkippedReason: null,
      clustersRemaining: 2,
      rateLimited: true,
      skippedPinned: 4,
      changesQueued: 11,
    });
    expect(onPassComplete).toHaveBeenCalledTimes(1);
  });

  it("surfaces purgeSkippedReason 'failed' in the report and the event", async () => {
    const h = harness({
      umbrella: makeUmbrella({ purgeSkippedReason: 'failed' }),
    });
    const onEvent = jest.fn();
    h.svc.start(makeSettings({ curatorEnabled: false }), { onEvent });
    const report = await h.svc.runManual();
    expect(report.lifecycle.purgeSkippedReason).toBe('failed');
    const passEvent = onEvent.mock.calls
      .map(([e]) => e)
      .find((e) => e.kind === 'curator-pass');
    expect(passEvent.stats.purgeSkippedReason).toBe('failed');
    expect(fs.readFileSync(report.reportPath, 'utf8')).toContain(
      'Skipped: failed',
    );
    fs.rmSync(report.reportPath, { force: true });
  });

  it('hands the umbrella ONE exempt set: owned slugs lowercased, plus pinned and case-variant promoted names', async () => {
    const h = harness({
      registryRows: [
        { kind: 'skill', slug: 'My-Skill', cloneStatus: 'authored' },
        { kind: 'skill', slug: 'edited', cloneStatus: 'diverged' },
        { kind: 'skill', slug: 'synth-one', cloneStatus: 'synth' },
        { kind: 'agent', slug: 'an-agent', cloneStatus: 'authored' },
      ],
      promoted: [
        promotedRow('MY-SKILL'),
        promotedRow('pinned-one', true),
        promotedRow('synth-one'),
      ],
    });
    h.svc.start(makeSettings({ curatorEnabled: false }));
    await h.svc.runManual();

    const exempt = h.umbrella.runPass.mock.calls[0][1] as Set<string>;
    expect([...exempt].sort()).toEqual(
      ['MY-SKILL', 'edited', 'my-skill', 'pinned-one'].sort(),
    );
  });

  it('skips the umbrella pass (fail closed) when no registry is bound; other steps still run', async () => {
    const h = harness({ registryRows: null });
    h.svc.start(makeSettings({ curatorEnabled: false }));
    const report = await h.svc.runManual();

    expect(h.umbrella.runPass).not.toHaveBeenCalled();
    expect(h.retirement.run).toHaveBeenCalledTimes(1);
    expect(report.lifecycle.umbrellaSkippedReason).toBe('registry-unavailable');
    expect(report.lifecycle.purgeSkippedReason).toBe('failed');
  });

  it('skips the umbrella pass (fail closed, no partial set) when the promoted read throws after the registry read', async () => {
    const h = harness({
      registryRows: [{ kind: 'skill', slug: 'owned', cloneStatus: 'authored' }],
      promoted: [promotedRow('pinned-one', true)],
    });
    h.store.listByStatus.mockImplementation(() => {
      throw new Error('database is locked');
    });
    h.svc.start(makeSettings({ curatorEnabled: false }));
    const report = await h.svc.runManual();

    expect(h.registry?.listAll).toHaveBeenCalled();
    expect(h.umbrella.runPass).not.toHaveBeenCalled();
    expect(report.lifecycle.umbrellaSkippedReason).toBe('registry-unavailable');
    expect(h.retirement.run).toHaveBeenCalledTimes(1);
    expect(h.logger.warn).toHaveBeenCalledWith(
      '[skill-curator] failed to read the exempt skill set',
      { error: 'database is locked' },
    );
  });

  it('a throwing retirement step does not stop the umbrella or the enhancement', async () => {
    const retirement = makeRetirement();
    retirement.run.mockRejectedValue(new Error('sweep boom'));
    const enhancer = {
      isEligible: jest.fn(() => true),
      enhance: jest.fn(async () => ({ changed: true })),
    };
    const h = harness({
      retirement,
      enhancer,
      registryRows: [{ kind: 'skill', slug: 'eligible', cloneStatus: 'clone' }],
      invocationTotal: () => 50,
    });
    h.svc.start(makeSettings({ curatorEnabled: false }));
    const report = await h.svc.runManual();

    expect(report.lifecycle.retirementSkippedReason).toBe('failed');
    expect(h.umbrella.runPass).toHaveBeenCalledTimes(1);
    expect(enhancer.enhance).toHaveBeenCalledTimes(1);
    expect(h.logger.warn).toHaveBeenCalledWith(
      '[skill-curator] retirement pass threw',
      { error: 'sweep boom' },
    );
  });

  it('a throwing umbrella step does not stop the enhancement or the report', async () => {
    const umbrella = makeUmbrella();
    umbrella.runPass.mockRejectedValue(new Error('umbrella boom'));
    const enhancer = {
      isEligible: jest.fn(() => true),
      enhance: jest.fn(async () => ({ changed: true })),
    };
    const h = harness({
      umbrella,
      enhancer,
      registryRows: [{ kind: 'skill', slug: 'eligible', cloneStatus: 'clone' }],
      invocationTotal: () => 50,
    });
    const onPassComplete = jest.fn();
    h.svc.start(makeSettings({ curatorEnabled: false }), { onPassComplete });
    const report = await h.svc.runManual();

    expect(report.lifecycle.umbrellaSkippedReason).toBe('failed');
    expect(enhancer.enhance).toHaveBeenCalledTimes(1);
    expect(onPassComplete).toHaveBeenCalledTimes(1);
  });

  it('enhancement: enhances threshold-crossing eligible slugs with their kind and the origin', async () => {
    const enhancer = {
      isEligible: jest.fn((slug: string) => slug !== 'not-eligible'),
      enhance: jest.fn(async () => ({ changed: true })),
    };
    const h = harness({
      enhancer,
      registryRows: [
        { kind: 'skill', slug: 'eligible', cloneStatus: 'clone' },
        { kind: 'skill', slug: 'too-few', cloneStatus: 'clone' },
        { kind: 'skill', slug: 'not-eligible', cloneStatus: 'clone' },
        { kind: 'agent', slug: 'an-agent', cloneStatus: 'clone' },
      ],
      invocationTotal: (slug) => (slug === 'too-few' ? 1 : 50),
    });
    h.svc.start(makeSettings({ curatorEnabled: false }));

    await h.svc.runManual();
    const slugs = (enhancer.enhance.mock.calls as unknown[][]).map((c) => c[0]);
    expect(slugs.sort()).toEqual(['an-agent', 'eligible']);
    expect(enhancer.enhance).toHaveBeenCalledWith(
      'an-agent',
      expect.anything(),
      { kind: 'agent', userInitiated: undefined },
    );

    enhancer.enhance.mockClear();
    await h.svc.runManual({ userInitiated: true });
    expect(enhancer.enhance).toHaveBeenCalledWith(
      'eligible',
      expect.anything(),
      { kind: 'skill', userInitiated: true },
    );
  });
});

// ─── Accept and reconcile (real database) ──────────────────────────────────

const opener = resolveOpener();
const describeDb = opener ? describe : describe.skip;
const sqlFor = (version: number): string =>
  MIGRATIONS.find((m) => m.version === version)?.sql ?? '';

/** `skill_candidates` as `0003` declares it (incl. `name UNIQUE`), then later migrations. */
function createDb(): TestDatabase {
  if (!opener) throw new Error('no sqlite binding available');
  const db = opener(':memory:');
  db.exec(`
    CREATE TABLE skill_candidates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL,
      body_path TEXT NOT NULL,
      source_session_ids TEXT NOT NULL DEFAULT '[]',
      trajectory_hash TEXT NOT NULL UNIQUE,
      embedding_rowid INTEGER,
      status TEXT NOT NULL CHECK(status IN ('candidate','promoted','rejected')) DEFAULT 'candidate',
      success_count INTEGER NOT NULL DEFAULT 0,
      failure_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      promoted_at INTEGER,
      rejected_at INTEGER,
      rejected_reason TEXT,
      pinned INTEGER NOT NULL DEFAULT 0,
      residency TEXT NOT NULL DEFAULT 'resident' CHECK(residency IN ('resident','dormant'))
    );
    CREATE TABLE skill_invocation_events (
      id TEXT PRIMARY KEY,
      skill_slug TEXT NOT NULL,
      session_id TEXT NOT NULL,
      context_id TEXT,
      source TEXT NOT NULL,
      succeeded INTEGER NOT NULL,
      is_error INTEGER NOT NULL,
      invoked_at INTEGER NOT NULL,
      reconciled_at INTEGER,
      verdict_source TEXT,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cache_read_tokens INTEGER,
      cache_creation_tokens INTEGER,
      cost_usd REAL,
      duration_ms INTEGER,
      tool_count INTEGER,
      task_id TEXT
    );
  `);
  for (const version of [33, 36, 37, 32, 40, 34, 22, 23, 25, 51]) {
    db.exec(sqlFor(version));
  }
  return db;
}

function workspaceAt(root: string): IWorkspaceProvider {
  return {
    getWorkspaceRoot: () => '',
    getConfiguration: <T>(_section: string, key: string, fallback?: T) =>
      (key === SKILLS_ROOT_KEY ? root : fallback) as T,
  } as unknown as IWorkspaceProvider;
}

describeDb('SkillCuratorService — accept and reconcile on a real store', () => {
  let db: TestDatabase;
  let root: string;
  let logger: ReturnType<typeof makeLogger>;
  let store: SkillCandidateStore;
  let suggestions: SkillSuggestionStore;
  let registry: SkillRegistryStore;
  let md: SkillMdGenerator;
  let promotion: SkillPromotionService;
  let retirement: ReturnType<typeof makeRetirement>;
  let svc: SkillCuratorService;
  let seq: number;

  beforeEach(() => {
    db = createDb();
    seq = 0;
    root = fs.mkdtempSync(
      path.join(
        jest.requireActual<typeof import('node:os')>('node:os').tmpdir(),
        'ptah-curator-',
      ),
    );
    logger = makeLogger();
    const connection = asConnection(db);
    store = new SkillCandidateStore(logger as never, connection, {
      available: false,
    } as never);
    suggestions = new SkillSuggestionStore(logger as never, connection);
    registry = new SkillRegistryStore(logger as never, connection);
    md = new SkillMdGenerator(logger as never, workspaceAt(root));
    promotion = new SkillPromotionService(
      logger as never,
      store,
      md,
      null,
      null,
      registry,
    );
    retirement = makeRetirement();
    svc = new SkillCuratorService(
      logger as unknown as Ctor[0],
      store,
      allowingRateLimiter as unknown as Ctor[2],
      registry,
      null,
      suggestions,
      makeUmbrella() as unknown as SkillUmbrellaMergeService,
      retirement as unknown as SkillRetirementService,
      promotion,
      md,
    );
  });

  afterEach(() => {
    svc.stop();
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function addCandidate(name: string, pinned = false): SkillCandidateRow {
    seq += 1;
    const { candidate } = store.registerCandidate({
      name,
      description: `${name} skill`,
      bodyPath: path.join(root, name, 'SKILL.md'),
      sourceSessionIds: [`s-${seq}`],
      trajectoryHash: `hash-${seq}`,
      embedding: null,
      createdAt: seq,
    });
    if (pinned) {
      db.prepare(`UPDATE skill_candidates SET pinned = 1 WHERE id = ?`).run(
        candidate.id,
      );
    }
    return store.findById(candidate.id) as SkillCandidateRow;
  }

  /** A promoted member with a real directory and a `synth` registry row. */
  function addPromoted(name: string, pinned = false): SkillCandidateRow {
    const row = addCandidate(name, pinned);
    fs.mkdirSync(path.join(root, name), { recursive: true });
    fs.writeFileSync(path.join(root, name, 'SKILL.md'), `# ${name}\n`);
    registry.upsert(registryEntry(name, 'synth'));
    store.promoteAtomically(row.id, { promotedAt: 1, bodyPath: row.bodyPath });
    return store.findById(row.id) as SkillCandidateRow;
  }

  function registryEntry(
    slug: string,
    cloneStatus: SkillRegistryEntry['cloneStatus'],
    overrides: Partial<SkillRegistryEntry> = {},
  ): SkillRegistryEntry {
    return {
      slug,
      kind: 'skill',
      userPath: path.join(root, slug, 'SKILL.md'),
      originPluginId: null,
      originVersion: null,
      sourceHash: null,
      cloneStatus,
      diverged: false,
      historyDir: null,
      lastEnhancedAt: null,
      candidateId: null,
      pendingSourceHash: null,
      ...overrides,
    };
  }

  function addSuggestion(
    memberIds: string[],
    name = 'deploy-flow',
  ): SkillSuggestionRow {
    return suggestions.insert(
      {
        name,
        description: 'deploy the service',
        body: '# Deploy\n\nSteps.',
        memberSessionIds: ['s-1', 's-2'],
        memberCandidateIds: memberIds,
        clusterSize: memberIds.length,
        technologyFingerprint: 'general',
        judgeScore: 8,
      },
      'pending',
    );
  }

  const rowsWithHash = (hash: string): number =>
    (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM skill_candidates WHERE trajectory_hash = ?`,
        )
        .get(hash) as { n: number }
    ).n;

  describe('acceptSuggestion', () => {
    it('promotes, links the lineage, merges members and removes merged promoted directories after commit', async () => {
      const member = addCandidate('member-cand');
      const oldSkill = addPromoted('old-skill');
      const pinned = addPromoted('pinned-skill', true);
      const owned = addPromoted('owned-skill');
      registry.upsert(registryEntry('owned-skill', 'authored'));
      const sug = addSuggestion([member.id, oldSkill.id, pinned.id, owned.id]);

      const result = await svc.acceptSuggestion(sug.id, makeSettings(), {
        userInitiated: true,
      });

      expect(result.accepted).toBe(true);
      expect(result.filePath).toBe(path.join(root, 'deploy-flow', 'SKILL.md'));
      const promoted = store.findByName('deploy-flow');
      expect(promoted?.status).toBe('promoted');
      const after = suggestions.findById(sug.id);
      expect(after?.status).toBe('accepted');
      expect(after?.promotedCandidateId).toBe(promoted?.id);

      const reason = MERGED_INTO_PREFIX + sug.id;
      expect(store.findById(member.id)).toMatchObject({
        status: 'rejected',
        rejectedReason: reason,
      });
      expect(store.findById(oldSkill.id)).toMatchObject({
        status: 'rejected',
        rejectedReason: reason,
      });
      expect(registry.getBySlug('skill', 'old-skill')).toBeNull();
      // Pinned and user-owned members are skipped.
      expect(store.findById(pinned.id)?.status).toBe('promoted');
      expect(store.findById(owned.id)?.status).toBe('promoted');
      expect(registry.getBySlug('skill', 'owned-skill')?.cloneStatus).toBe(
        'authored',
      );

      expect(retirement.removeMaterializations).toHaveBeenCalledTimes(1);
      const [removedRows, origin] =
        retirement.removeMaterializations.mock.calls[0];
      expect(removedRows.map((r: SkillCandidateRow) => r.name)).toEqual([
        'old-skill',
      ]);
      expect(origin).toEqual({ userInitiated: true });
    });

    it('R-f2: a throw after the promotion write leaves the suggestion pending and no promoted row', async () => {
      const member = addCandidate('member-cand');
      const sug = addSuggestion([member.id]);
      jest.spyOn(store, 'rejectIfStatus').mockImplementation(() => {
        throw new Error('disk I/O error');
      });

      const result = await svc.acceptSuggestion(sug.id, makeSettings());

      expect(result).toEqual({ accepted: false, filePath: '' });
      expect(suggestions.findById(sug.id)?.status).toBe('pending');
      expect(suggestions.findById(sug.id)?.promotedCandidateId).toBeNull();
      expect(rowsWithHash(`${SUGGESTION_TRAJECTORY_PREFIX}${sug.id}`)).toBe(0);
      expect(store.findByName('deploy-flow')).toBeNull();
      expect(store.findById(member.id)?.status).toBe('candidate');
      expect(fs.existsSync(path.join(root, 'deploy-flow'))).toBe(false);
      expect(retirement.removeMaterializations).not.toHaveBeenCalled();
    });

    it('a plugin-owned registry slug (RegistrySlugOwnedByPluginError) answers accepted:false and keeps the suggestion pending', async () => {
      registry.upsert(
        registryEntry('deploy-flow', 'clone', { originPluginId: 'plugin-x' }),
      );
      const sug = addSuggestion([]);

      const result = await svc.acceptSuggestion(sug.id, makeSettings());

      expect(result).toEqual({ accepted: false, filePath: '' });
      expect(suggestions.findById(sug.id)?.status).toBe('pending');
      expect(rowsWithHash(`${SUGGESTION_TRAJECTORY_PREFIX}${sug.id}`)).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(
        '[skill-curator] accept failed; suggestion left pending',
        expect.objectContaining({
          errorName: 'RegistrySlugOwnedByPluginError',
        }),
      );
    });

    it('a generic promotion failure answers accepted:false and keeps the suggestion pending', async () => {
      const sug = addSuggestion([]);
      jest
        .spyOn(promotion, 'promoteSuggestion')
        .mockRejectedValue(new Error('disk full'));

      const result = await svc.acceptSuggestion(sug.id, makeSettings());

      expect(result).toEqual({ accepted: false, filePath: '' });
      expect(suggestions.findById(sug.id)?.status).toBe('pending');
      expect(logger.warn).toHaveBeenCalledWith(
        '[skill-curator] accept failed; suggestion left pending',
        expect.objectContaining({ error: 'disk full' }),
      );
    });

    it('takes the outcome from the transaction: a suggestion decided after the read rolls the promotion back', async () => {
      const sug = addSuggestion([]);
      const stale = suggestions.findById(sug.id) as SkillSuggestionRow;
      suggestions.dismiss(sug.id);
      jest.spyOn(suggestions, 'findById').mockReturnValueOnce(stale);

      const result = await svc.acceptSuggestion(sug.id, makeSettings());

      expect(result.accepted).toBe(false);
      expect(suggestions.findById(sug.id)?.status).toBe('dismissed');
      expect(store.findByName('deploy-flow')).toBeNull();
      expect(fs.existsSync(path.join(root, 'deploy-flow'))).toBe(false);
    });

    it('does not promote a suggestion that is not pending', async () => {
      const sug = addSuggestion([]);
      suggestions.dismiss(sug.id);
      const spy = jest.spyOn(promotion, 'promoteSuggestion');

      const result = await svc.acceptSuggestion(sug.id, makeSettings());

      expect(result.accepted).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('reconcileAcceptedSuggestions at start()', () => {
    /**
     * A suggestion accepted the pre-578 way: materialized through
     * `promoteToActive`, a registry row, `accept(id, null)`, no candidate row.
     */
    function legacyAccepted(
      cloneStatus: 'authored' | 'synth',
      memberIds: string[] = [],
    ): { suggestion: SkillSuggestionRow; slug: string } {
      const sug = addSuggestion(memberIds);
      const materialized = md.promoteToActive({
        slug: sug.name,
        description: sug.description,
        body: sug.body,
      });
      registry.upsert(registryEntry(materialized.slug, cloneStatus));
      suggestions.accept(sug.id, null);
      return { suggestion: sug, slug: materialized.slug };
    }

    /** An unrelated hand-written skill occupying the base slug. */
    function handWritten(slug: string): void {
      fs.mkdirSync(path.join(root, slug), { recursive: true });
      fs.writeFileSync(
        path.join(root, slug, 'SKILL.md'),
        `---\nname: ${slug}\ndescription: mine\n---\n\nMy own procedure.\n`,
      );
      registry.upsert(registryEntry(slug, 'authored'));
    }

    async function startAndSettle(): Promise<void> {
      svc.start(makeSettings({ curatorEnabled: false }));
      await svc.runManual();
    }

    it.each(['synth', 'authored'] as const)(
      'adopts a %s registry row with a suffixed slug and links the lineage, never the hand-written base slug',
      async (cloneStatus) => {
        handWritten('deploy-flow');
        const member = addCandidate('member-cand');
        const { suggestion, slug } = legacyAccepted(cloneStatus, [member.id]);
        expect(slug).toBe('deploy-flow-2');

        await startAndSettle();

        const adopted = store.findByName('deploy-flow-2');
        expect(adopted?.status).toBe('promoted');
        expect(suggestions.findById(suggestion.id)?.promotedCandidateId).toBe(
          adopted?.id,
        );
        expect(registry.getBySlug('skill', 'deploy-flow-2')).toMatchObject({
          cloneStatus: 'synth',
          candidateId: adopted?.id,
        });
        // The hand-written skill is untouched.
        expect(store.findByName('deploy-flow')).toBeNull();
        expect(registry.getBySlug('skill', 'deploy-flow')?.cloneStatus).toBe(
          'authored',
        );
        // Members merge exactly as on accept.
        expect(store.findById(member.id)?.rejectedReason).toBe(
          MERGED_INTO_PREFIX + suggestion.id,
        );
      },
    );

    it('a second start after a successful link adopts nothing and writes nothing', async () => {
      legacyAccepted('synth');
      await startAndSettle();
      svc.stop();
      const count = (
        db.prepare(`SELECT COUNT(*) AS n FROM skill_candidates`).get() as {
          n: number;
        }
      ).n;
      const adopt = jest.spyOn(promotion, 'adoptMaterializedSkill');

      await startAndSettle();

      expect(adopt).not.toHaveBeenCalled();
      expect(
        (
          db.prepare(`SELECT COUNT(*) AS n FROM skill_candidates`).get() as {
            n: number;
          }
        ).n,
      ).toBe(count);
    });

    it('a missing directory warns and leaves the row for the next start', async () => {
      const { slug, suggestion } = legacyAccepted('synth');
      fs.rmSync(path.join(root, slug), { recursive: true, force: true });

      await startAndSettle();

      expect(store.findByName(slug)).toBeNull();
      expect(suggestions.listAcceptedWithoutPromotedCandidate()).toHaveLength(
        1,
      );
      expect(logger.warn).toHaveBeenCalledWith(
        '[skill-curator] accepted suggestion has no provable skill directory; left for next start',
        expect.objectContaining({
          suggestionId: suggestion.id,
          reason: 'missing',
        }),
      );
    });

    it('a directory whose body is not the suggestion body is not adopted (name match alone)', async () => {
      handWritten('deploy-flow');
      const sug = addSuggestion([]);
      suggestions.accept(sug.id, null);

      await startAndSettle();

      expect(store.findByName('deploy-flow')).toBeNull();
      expect(suggestions.listAcceptedWithoutPromotedCandidate()).toHaveLength(
        1,
      );
    });

    it('two provable directories are ambiguous: warn, nothing adopted', async () => {
      const { suggestion } = legacyAccepted('synth');
      const twin = md.promoteToActive({
        slug: suggestion.name,
        description: suggestion.description,
        body: suggestion.body,
      });
      registry.upsert(registryEntry(twin.slug, 'synth'));

      await startAndSettle();

      expect(store.findByName('deploy-flow')).toBeNull();
      expect(store.findByName(twin.slug)).toBeNull();
      expect(logger.warn).toHaveBeenCalledWith(
        '[skill-curator] accepted suggestion has no provable skill directory; left for next start',
        expect.objectContaining({
          reason: 'ambiguous',
          slugs: ['deploy-flow', twin.slug],
        }),
      );
    });

    it('M-1: a slug held by a non-promoted candidate row is skipped with a warn, without throwing', async () => {
      const { slug } = legacyAccepted('synth');
      const holder = addCandidate(slug);
      const adopt = jest.spyOn(promotion, 'adoptMaterializedSkill');

      await expect(startAndSettle()).resolves.toBeUndefined();

      expect(adopt).not.toHaveBeenCalled();
      expect(store.findById(holder.id)?.status).toBe('candidate');
      expect(suggestions.listAcceptedWithoutPromotedCandidate()).toHaveLength(
        1,
      );
      expect(logger.warn).toHaveBeenCalledWith(
        '[skill-curator] accepted suggestion slug is held by a non-promoted candidate; not adopted',
        expect.objectContaining({ slug, candidateId: holder.id }),
      );
    });

    it('a throwing adopt is caught and warned; start() does not throw and the row stays for the next start', async () => {
      legacyAccepted('synth');
      jest
        .spyOn(promotion, 'adoptMaterializedSkill')
        .mockRejectedValue(new Error('adopt boom'));

      await expect(startAndSettle()).resolves.toBeUndefined();

      expect(suggestions.listAcceptedWithoutPromotedCandidate()).toHaveLength(
        1,
      );
      expect(logger.warn).toHaveBeenCalledWith(
        '[skill-curator] adopting an accepted suggestion failed (rolled back; retried next start)',
        expect.objectContaining({ error: 'adopt boom' }),
      );
    });

    /** The counts the last reconcile logged. */
    function lastReconcileCounts(): unknown {
      const calls = logger.info.mock.calls.filter(
        ([message]) =>
          message === '[skill-curator] accepted-suggestion reconcile done',
      );
      return calls.length > 0 ? calls[calls.length - 1][1] : undefined;
    }

    /** Whether no transaction is open: BEGIN fails inside one. */
    function outsideTransaction(): boolean {
      try {
        db.exec('BEGIN IMMEDIATE');
        db.exec('ROLLBACK');
        return true;
      } catch {
        return false;
      }
    }

    it('R-f2: a throw inside the adopt callback (after the link) rolls the whole adopt back; the next start adopts', async () => {
      const member = addCandidate('member-cand');
      const { suggestion, slug } = legacyAccepted('authored', [member.id]);
      const reject = jest
        .spyOn(store, 'rejectIfStatus')
        .mockImplementationOnce(() => {
          throw new Error('disk I/O error');
        });

      await expect(startAndSettle()).resolves.toBeUndefined();

      // The link UPDATE ran before the merge threw, and was rolled back.
      expect(reject).toHaveBeenCalledTimes(1);
      expect(
        suggestions.findById(suggestion.id)?.promotedCandidateId,
      ).toBeNull();
      expect(store.findByName(slug)).toBeNull();
      expect(
        rowsWithHash(`${SUGGESTION_TRAJECTORY_PREFIX}${suggestion.id}`),
      ).toBe(0);
      expect(registry.getBySlug('skill', slug)).toMatchObject({
        cloneStatus: 'authored',
        candidateId: null,
      });
      expect(store.findById(member.id)?.status).toBe('candidate');
      // The adopt never deletes the directory it did not create.
      expect(fs.existsSync(path.join(root, slug, 'SKILL.md'))).toBe(true);
      expect(retirement.removeMaterializations).not.toHaveBeenCalled();
      expect(lastReconcileCounts()).toMatchObject({ adopted: 0, failed: 1 });
      expect(logger.warn).toHaveBeenCalledWith(
        '[skill-curator] adopting an accepted suggestion failed (rolled back; retried next start)',
        expect.objectContaining({ error: 'disk I/O error' }),
      );

      reject.mockRestore();
      svc.stop();
      await startAndSettle();

      const adopted = store.findByName(slug);
      expect(adopted?.status).toBe('promoted');
      expect(suggestions.findById(suggestion.id)?.promotedCandidateId).toBe(
        adopted?.id,
      );
      expect(store.findById(member.id)?.rejectedReason).toBe(
        MERGED_INTO_PREFIX + suggestion.id,
      );
      expect(lastReconcileCounts()).toMatchObject({ adopted: 1, failed: 0 });
    });

    it('a registry row turned plugin clone after the proof (RegistrySlugOwnedByPluginError) counts as failed, without throwing', async () => {
      const { suggestion, slug } = legacyAccepted('synth');
      const original = promotion.adoptMaterializedSkill.bind(promotion);
      jest
        .spyOn(promotion, 'adoptMaterializedSkill')
        .mockImplementationOnce((input, settings, onCommit) => {
          registry.upsert(
            registryEntry(slug, 'clone', { originPluginId: 'plugin-x' }),
          );
          return original(input, settings, onCommit);
        });

      await expect(startAndSettle()).resolves.toBeUndefined();

      expect(store.findByName(slug)).toBeNull();
      expect(
        rowsWithHash(`${SUGGESTION_TRAJECTORY_PREFIX}${suggestion.id}`),
      ).toBe(0);
      expect(
        suggestions.findById(suggestion.id)?.promotedCandidateId,
      ).toBeNull();
      expect(registry.getBySlug('skill', slug)).toMatchObject({
        cloneStatus: 'clone',
        originPluginId: 'plugin-x',
        candidateId: null,
      });
      expect(lastReconcileCounts()).toMatchObject({ adopted: 0, failed: 1 });
      expect(logger.warn).toHaveBeenCalledWith(
        '[skill-curator] adopting an accepted suggestion failed (rolled back; retried next start)',
        expect.objectContaining({
          slug,
          errorName: 'RegistrySlugOwnedByPluginError',
        }),
      );
    });

    it('linkedOnly: a slug already held by a promoted row links that row and merges members, registering nothing new', async () => {
      const member = addCandidate('member-cand');
      const { suggestion, slug } = legacyAccepted('synth', [member.id]);
      const holder = addCandidate(slug);
      store.promoteAtomically(holder.id, {
        promotedAt: 1,
        bodyPath: holder.bodyPath,
      });
      const countRows = (): number =>
        (
          db.prepare(`SELECT COUNT(*) AS n FROM skill_candidates`).get() as {
            n: number;
          }
        ).n;
      const before = countRows();

      await startAndSettle();

      expect(suggestions.findById(suggestion.id)?.promotedCandidateId).toBe(
        holder.id,
      );
      expect(store.findById(holder.id)?.status).toBe('promoted');
      expect(countRows()).toBe(before);
      expect(
        rowsWithHash(`${SUGGESTION_TRAJECTORY_PREFIX}${suggestion.id}`),
      ).toBe(0);
      expect(store.findById(member.id)?.rejectedReason).toBe(
        MERGED_INTO_PREFIX + suggestion.id,
      );
      expect(lastReconcileCounts()).toMatchObject({ adopted: 1 });
    });

    it('runManual waits for an in-flight reconcile before the pass starts', async () => {
      const { suggestion, slug } = legacyAccepted('synth');
      const original = promotion.adoptMaterializedSkill.bind(promotion);
      let release: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      jest
        .spyOn(promotion, 'adoptMaterializedSkill')
        .mockImplementationOnce(async (input, settings, onCommit) => {
          await gate;
          return original(input, settings, onCommit);
        });
      let linkedWhenPassRan: string | null | undefined;
      retirement.run.mockImplementationOnce(async () => {
        linkedWhenPassRan = suggestions.findById(
          suggestion.id,
        )?.promotedCandidateId;
        return {
          dormant: 0,
          retired: 0,
          skippedPinned: 0,
          skippedExempt: 0,
          skippedUncontained: 0,
          dormantSlugs: [],
          retiredSlugs: [],
        };
      });

      svc.start(makeSettings({ curatorEnabled: false }));
      const pass = svc.runManual();
      await new Promise((resolve) => setImmediate(resolve));
      expect(retirement.run).not.toHaveBeenCalled();

      release();
      await pass;

      expect(retirement.run).toHaveBeenCalledTimes(1);
      expect(linkedWhenPassRan).toBe(store.findByName(slug)?.id);
      expect(linkedWhenPassRan).toBeTruthy();
    });

    it('merges a promoted member: rejects it, drops its registry row, and removes its directory after commit', async () => {
      const oldSkill = addPromoted('old-skill');
      const { suggestion } = legacyAccepted('synth', [oldSkill.id]);
      let committedAtRemoval = false;
      let memberStatusAtRemoval: string | undefined;
      retirement.removeMaterializations.mockImplementationOnce(
        async (rows: readonly SkillCandidateRow[]) => {
          committedAtRemoval = outsideTransaction();
          memberStatusAtRemoval = store.findById(oldSkill.id)?.status;
          return rows.map((r) => r.name);
        },
      );

      await startAndSettle();

      expect(store.findById(oldSkill.id)).toMatchObject({
        status: 'rejected',
        rejectedReason: MERGED_INTO_PREFIX + suggestion.id,
      });
      expect(registry.getBySlug('skill', 'old-skill')).toBeNull();
      expect(retirement.removeMaterializations).toHaveBeenCalledTimes(1);
      const [removedRows, origin] =
        retirement.removeMaterializations.mock.calls[0];
      expect(removedRows.map((r: SkillCandidateRow) => r.name)).toEqual([
        'old-skill',
      ]);
      expect(origin).toEqual({});
      expect(committedAtRemoval).toBe(true);
      expect(memberStatusAtRemoval).toBe('rejected');
    });
  });
});
