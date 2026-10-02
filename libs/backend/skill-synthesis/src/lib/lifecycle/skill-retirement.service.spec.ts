/**
 * SkillRetirementService — acceptance 3 (usage-based dormancy and retirement).
 *
 * Runs against the real `SkillCandidateStore` and `SkillRegistryStore` on one
 * in-memory SQLite connection, with a temporary active root on disk. The base
 * `skill_candidates` / `skill_invocation_events` tables are the pre-`0033`
 * shape the store spec uses; every later column set (`0032`, `0033`, `0036`,
 * `0037`, `0040`) and the registry (`0022`, `0023`) come from `MIGRATIONS`
 * itself, so a renamed column fails here instead of silently disagreeing.
 */
import 'reflect-metadata';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { MIGRATIONS } from '@ptah-extension/persistence-sqlite';
import { SkillCandidateStore } from '../skill-candidate.store';
import type { SkillMdGenerator } from '../skill-md-generator';
import { SkillRegistryStore, type CloneStatus } from '../skill-registry.store';
import type { SkillRepropagationPort } from '../skill-repropagation.port';
import { RETIRED_UNUSED_REASON, type SkillCandidateRow } from '../types';
import {
  resolveOpener,
  type TestDatabase,
} from '../queue/queue-db.test-support';
import {
  DORMANT_AFTER_DAYS_KEY,
  RETIRE_AFTER_DORMANT_DAYS_KEY,
  SkillRetirementService,
} from './skill-retirement.service';

const opener = resolveOpener();
const maybe = opener ? describe : describe.skip;

const sqlFor = (version: number): string =>
  MIGRATIONS.find((m) => m.version === version)?.sql ?? '';

const DAY = 86_400_000;
const T0 = 1_700_000_000_000;

function createDb(): TestDatabase {
  if (!opener) throw new Error('no sqlite binding available');
  const db = opener(':memory:');
  db.exec(`
    CREATE TABLE skill_candidates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
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

    CREATE TABLE skill_invocations (
      id TEXT PRIMARY KEY,
      skill_id TEXT NOT NULL REFERENCES skill_candidates(id),
      session_id TEXT NOT NULL,
      succeeded INTEGER NOT NULL,
      invoked_at INTEGER NOT NULL,
      notes TEXT,
      context_id TEXT
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
  for (const version of [33, 36, 37, 32, 40, 22, 23]) {
    db.exec(sqlFor(version));
  }
  return db;
}

const logger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const vecStatus = {
  available: false,
  getStatus: () => ({ available: false, reason: 'binary-missing' }),
  on: () => ({ dispose: () => undefined }),
  refresh: () => undefined,
};

maybe('SkillRetirementService', () => {
  let db: TestDatabase;
  let activeRoot: string;
  let outsideRoot: string;
  let store: SkillCandidateStore;
  let registry: SkillRegistryStore;
  let repropagation: { repropagate: jest.Mock };
  let settings: Record<string, unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    db = createDb();
    const connection = { db, isOpen: true, vecExtensionLoaded: false };
    store = new SkillCandidateStore(
      logger as never,
      connection as never,
      vecStatus as never,
    );
    registry = new SkillRegistryStore(logger as never, connection as never);
    activeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'retire-active-'));
    outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'retire-outside-'));
    repropagation = { repropagate: jest.fn().mockResolvedValue(undefined) };
    settings = {};
  });

  afterEach(() => {
    db.close();
    fs.rmSync(activeRoot, { recursive: true, force: true });
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  });

  function makeService(
    registryStore: SkillRegistryStore | null = registry,
  ): SkillRetirementService {
    const mdGenerator = {
      activeRoot: () => activeRoot,
    } as unknown as SkillMdGenerator;
    const workspace = {
      getWorkspaceRoot: () => '/ws',
      getConfiguration: (_section: string, key: string, fallback: unknown) =>
        key in settings ? settings[key] : fallback,
    };
    return new SkillRetirementService(
      logger as never,
      store,
      registryStore,
      mdGenerator,
      repropagation as unknown as SkillRepropagationPort,
      workspace as never,
    );
  }

  /** A promoted skill materialized at `<root>/<dirName>/SKILL.md`. */
  function promoted(
    name: string,
    options: {
      root?: string;
      dirName?: string;
      cloneStatus?: CloneStatus;
      registrySlug?: string;
    } = {},
  ): SkillCandidateRow {
    const dir = path.join(options.root ?? activeRoot, options.dirName ?? name);
    fs.mkdirSync(dir, { recursive: true });
    const bodyPath = path.join(dir, 'SKILL.md');
    fs.writeFileSync(bodyPath, `# ${name}\n`, 'utf8');
    const { candidate } = store.registerCandidate({
      name,
      description: `desc ${name}`,
      bodyPath,
      sourceSessionIds: [],
      trajectoryHash: `hash-${name}`,
      embedding: null,
      createdAt: T0,
    });
    store.updateStatus(candidate.id, 'promoted', { promotedAt: T0 });
    registry.upsert({
      slug: options.registrySlug ?? name,
      kind: 'skill',
      userPath: dir,
      originPluginId: null,
      originVersion: null,
      sourceHash: null,
      cloneStatus: options.cloneStatus ?? 'synth',
      diverged: options.cloneStatus === 'diverged',
      historyDir: null,
      lastEnhancedAt: null,
      candidateId: candidate.id,
      pendingSourceHash: null,
    });
    return store.findById(candidate.id) as SkillCandidateRow;
  }

  function reload(row: SkillCandidateRow): SkillCandidateRow {
    return store.findById(row.id) as SkillCandidateRow;
  }

  const dirOf = (row: SkillCandidateRow): string => path.dirname(row.bodyPath);

  it('keeps a skill unused for 29 days resident', async () => {
    const row = promoted('idle-29');

    const result = await makeService().run({}, T0 + 29 * DAY);

    expect(reload(row)).toMatchObject({
      status: 'promoted',
      residency: 'resident',
    });
    expect(result.dormant).toBe(0);
    expect(result.retired).toBe(0);
    expect(repropagation.repropagate).not.toHaveBeenCalled();
  });

  it('turns a skill unused for 30 days dormant and repropagates it', async () => {
    const row = promoted('idle-30');

    const result = await makeService().run(
      { userInitiated: false },
      T0 + 30 * DAY,
    );

    expect(reload(row)).toMatchObject({
      status: 'promoted',
      residency: 'dormant',
    });
    expect(fs.existsSync(dirOf(row))).toBe(true);
    expect(result).toMatchObject({ dormant: 1, dormantSlugs: ['idle-30'] });
    expect(repropagation.repropagate).toHaveBeenCalledWith(
      'skill',
      'idle-30',
      '/ws',
      { userInitiated: false },
    );
  });

  it('retires a skill unused for 60 days: directory, status and synth registry row', async () => {
    const row = promoted('idle-60');

    const result = await makeService().run({}, T0 + 60 * DAY);

    expect(fs.existsSync(dirOf(row))).toBe(false);
    expect(reload(row)).toMatchObject({
      status: 'rejected',
      rejectedReason: RETIRED_UNUSED_REASON,
    });
    expect(registry.getBySlug('skill', 'idle-60')).toBeNull();
    expect(result).toMatchObject({ retired: 1, retiredSlugs: ['idle-60'] });
    expect(repropagation.repropagate).toHaveBeenCalledWith(
      'skill',
      'idle-60',
      '/ws',
      {},
    );
  });

  it('keeps the registry row when the retirement loses the race', async () => {
    const row = promoted('raced');
    jest.spyOn(store, 'rejectIfStatus').mockReturnValue(false);

    const result = await makeService().run({}, T0 + 60 * DAY);

    expect(registry.getBySlug('skill', 'raced')).not.toBeNull();
    expect(reload(row).status).toBe('promoted');
    // Filesystem first, by design: the directory is already gone when the
    // compare-and-set loses.
    expect(fs.existsSync(dirOf(row))).toBe(false);
    expect(result.retired).toBe(0);
    expect(result.retiredSlugs).toEqual([]);
  });

  it('leaves a pinned skill at 100 days untouched', async () => {
    const row = promoted('pinned');
    db.prepare(`UPDATE skill_candidates SET pinned = 1 WHERE id = ?`).run(
      row.id,
    );

    const result = await makeService().run({}, T0 + 100 * DAY);

    expect(reload(row)).toMatchObject({
      status: 'promoted',
      residency: 'resident',
    });
    expect(fs.existsSync(dirOf(row))).toBe(true);
    expect(registry.getBySlug('skill', 'pinned')).not.toBeNull();
    expect(result).toMatchObject({ skippedPinned: 1, dormant: 0, retired: 0 });
  });

  it.each<CloneStatus>(['authored', 'diverged'])(
    'leaves a %s-slug skill untouched',
    async (cloneStatus) => {
      const row = promoted(`user-${cloneStatus}`, { cloneStatus });

      const result = await makeService().run({}, T0 + 100 * DAY);

      expect(reload(row)).toMatchObject({
        status: 'promoted',
        residency: 'resident',
      });
      expect(fs.existsSync(dirOf(row))).toBe(true);
      expect(registry.getBySlug('skill', row.name)?.cloneStatus).toBe(
        cloneStatus,
      );
      expect(result).toMatchObject({ skippedExempt: 1, retired: 0 });
    },
  );

  it('resets the idle clock on an invocation event at day 50', async () => {
    const row = promoted('used-at-50');
    store.recordSkillEvent({
      skillSlug: 'used-at-50',
      sessionId: 'sess-50',
      contextId: null,
      source: 'tool-use',
      succeeded: true,
      isError: false,
      invokedAt: T0 + 50 * DAY,
    });

    const result = await makeService().run({}, T0 + 60 * DAY);

    expect(reload(row)).toMatchObject({
      status: 'promoted',
      residency: 'resident',
    });
    expect(fs.existsSync(dirOf(row))).toBe(true);
    expect(result.retired).toBe(0);
    expect(result.dormant).toBe(0);
  });

  it('does not delete a directory outside the active root', async () => {
    const row = promoted('escaped', { root: outsideRoot });

    const result = await makeService().run({}, T0 + 60 * DAY);

    expect(fs.existsSync(dirOf(row))).toBe(true);
    expect(reload(row).status).toBe('promoted');
    expect(registry.getBySlug('skill', 'escaped')).not.toBeNull();
    expect(result.retired).toBe(0);
    expect(result.skippedUncontained).toBe(1);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('not removed'),
      expect.objectContaining({ slug: 'escaped' }),
    );
  });

  it('does not delete a directory whose basename is not the slug', async () => {
    const row = promoted('slug-a', { dirName: 'someone-else' });

    const result = await makeService().run({}, T0 + 60 * DAY);

    expect(fs.existsSync(dirOf(row))).toBe(true);
    expect(reload(row).status).toBe('promoted');
    expect(result.retired).toBe(0);
    expect(result.skippedUncontained).toBe(1);
  });

  it('keeps an already-dormant row dormant without counting it again', async () => {
    const row = promoted('already-dormant');
    store.setResidency(row.id, 'dormant');

    const result = await makeService().run({}, T0 + 40 * DAY);

    expect(reload(row)).toMatchObject({
      status: 'promoted',
      residency: 'dormant',
    });
    expect(fs.existsSync(dirOf(row))).toBe(true);
    expect(result).toMatchObject({ dormant: 0, retired: 0 });
    expect(repropagation.repropagate).not.toHaveBeenCalled();
  });

  it('retires a dormant row once it reaches N + M idle days', async () => {
    const row = promoted('dormant-to-retired');
    store.setResidency(row.id, 'dormant');

    const result = await makeService().run({}, T0 + 60 * DAY);

    expect(reload(row)).toMatchObject({
      status: 'rejected',
      rejectedReason: RETIRED_UNUSED_REASON,
    });
    expect(fs.existsSync(dirOf(row))).toBe(false);
    expect(result).toMatchObject({ retired: 1, dormant: 0 });
  });

  it('exempts a row whose registry slug differs only in case', async () => {
    const row = promoted('my-skill', {
      registrySlug: 'My-Skill',
      cloneStatus: 'authored',
    });

    const result = await makeService().run({}, T0 + 100 * DAY);

    expect(reload(row).status).toBe('promoted');
    expect(fs.existsSync(dirOf(row))).toBe(true);
    expect(result).toMatchObject({ skippedExempt: 1, retired: 0 });
  });

  it('keeps the directory when the row is decided between the read and the retirement', async () => {
    const row = promoted('decided-meanwhile');
    const original = store.listPromotedLastUse.bind(store);
    jest.spyOn(store, 'listPromotedLastUse').mockImplementationOnce(() => {
      const snapshot = original();
      db.prepare(
        `UPDATE skill_candidates SET status = 'rejected', rejected_reason = 'merged-into:x' WHERE id = ?`,
      ).run(row.id);
      return snapshot;
    });

    const result = await makeService().run({}, T0 + 60 * DAY);

    expect(fs.existsSync(dirOf(row))).toBe(true);
    expect(reload(row).rejectedReason).toBe('merged-into:x');
    expect(registry.getBySlug('skill', 'decided-meanwhile')).not.toBeNull();
    expect(result).toMatchObject({ retired: 0, skippedUncontained: 0 });
  });

  it('keeps the directory when the registry row turns diverged after the pass started', async () => {
    const row = promoted('diverged-meanwhile');
    const original = registry.listAll.bind(registry);
    jest.spyOn(registry, 'listAll').mockImplementationOnce(() => {
      const snapshot = original();
      registry.setDiverged('skill', 'diverged-meanwhile', true);
      return snapshot;
    });

    const result = await makeService().run({}, T0 + 60 * DAY);

    expect(fs.existsSync(dirOf(row))).toBe(true);
    expect(reload(row).status).toBe('promoted');
    expect(registry.getBySlug('skill', 'diverged-meanwhile')?.cloneStatus).toBe(
      'diverged',
    );
    expect(result.retired).toBe(0);
  });

  it('skips the pass when no registry is bound (fails closed)', async () => {
    const dormantDue = promoted('no-registry-30');
    db.prepare(`UPDATE skill_candidates SET promoted_at = ? WHERE id = ?`).run(
      T0 + 70 * DAY,
      dormantDue.id,
    );
    const retireDue = promoted('no-registry-100');

    const result = await makeService(null).run({}, T0 + 100 * DAY);

    expect(reload(dormantDue).residency).toBe('resident');
    expect(reload(retireDue).status).toBe('promoted');
    expect(fs.existsSync(dirOf(retireDue))).toBe(true);
    expect(result).toMatchObject({
      dormant: 0,
      retired: 0,
      skippedReason: 'registry-unavailable',
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('no skill registry bound'),
    );
  });

  it('resolves with an empty result when the promoted-row read throws', async () => {
    jest.spyOn(store, 'listPromotedLastUse').mockImplementation(() => {
      throw new Error('db closed');
    });

    const result = await makeService().run({}, T0 + 100 * DAY);

    expect(result).toEqual({
      dormant: 0,
      retired: 0,
      skippedPinned: 0,
      skippedExempt: 0,
      skippedUncontained: 0,
      dormantSlugs: [],
      retiredSlugs: [],
    });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('failed to read promoted skills'),
      { error: 'db closed' },
    );
  });

  it('uses the 30/30 defaults when both settings are invalid', async () => {
    settings[DORMANT_AFTER_DAYS_KEY] = 0;
    settings[RETIRE_AFTER_DORMANT_DAYS_KEY] = 'thirty';
    const at29 = promoted('d29');
    db.prepare(`UPDATE skill_candidates SET promoted_at = ? WHERE id = ?`).run(
      T0 + 31 * DAY,
      at29.id,
    );
    const at30 = promoted('d30');
    db.prepare(`UPDATE skill_candidates SET promoted_at = ? WHERE id = ?`).run(
      T0 + 30 * DAY,
      at30.id,
    );
    const at60 = promoted('d60');

    const result = await makeService().run({}, T0 + 60 * DAY);

    expect(reload(at29).residency).toBe('resident');
    expect(reload(at30).residency).toBe('dormant');
    expect(reload(at60).status).toBe('rejected');
    expect(result).toMatchObject({ dormant: 1, retired: 1 });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('invalid retirement setting'),
      expect.objectContaining({ key: DORMANT_AFTER_DAYS_KEY }),
    );
  });

  it('honours valid settings', async () => {
    settings[DORMANT_AFTER_DAYS_KEY] = 5;
    settings[RETIRE_AFTER_DORMANT_DAYS_KEY] = 5;
    const row = promoted('short-lived');

    const result = await makeService().run({}, T0 + 10 * DAY);

    expect(reload(row).status).toBe('rejected');
    expect(result.retired).toBe(1);
  });

  it('leaves no partial write when the transaction throws mid-callback (R-f2)', async () => {
    const row = promoted('mid-throw');
    const other = promoted('next-row');
    db.prepare(`UPDATE skill_candidates SET promoted_at = ? WHERE id = ?`).run(
      T0 + 30 * DAY,
      other.id,
    );
    jest.spyOn(registry, 'remove').mockImplementation(() => {
      throw new Error('registry write failed');
    });

    const result = await makeService().run({}, T0 + 60 * DAY);

    // rejectIfStatus ran before the throw and was rolled back with it.
    expect(reload(row)).toMatchObject({
      status: 'promoted',
      rejectedReason: null,
    });
    expect(registry.getBySlug('skill', 'mid-throw')).not.toBeNull();
    expect(result.retired).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('retirement sweep failed'),
      expect.objectContaining({ slug: 'mid-throw' }),
    );
    // The loop continued past the failed row.
    expect(reload(other).residency).toBe('dormant');
  });

  it('skips the pass when the registry cannot be read', async () => {
    const row = promoted('unknown-owner');
    jest.spyOn(registry, 'listAll').mockImplementation(() => {
      throw new Error('registry unavailable');
    });

    const result = await makeService().run({}, T0 + 100 * DAY);

    expect(reload(row).status).toBe('promoted');
    expect(fs.existsSync(dirOf(row))).toBe(true);
    expect(result).toMatchObject({ dormant: 0, retired: 0 });
  });

  describe('removeMaterializations', () => {
    it('removes contained directories, keeps uncontained ones, and repropagates', async () => {
      const inside = promoted('merged-member');
      const outside = promoted('merged-outside', { root: outsideRoot });

      const removed = await makeService().removeMaterializations(
        [inside, outside],
        { userInitiated: true },
      );

      expect(removed).toEqual(['merged-member']);
      expect(fs.existsSync(dirOf(inside))).toBe(false);
      expect(fs.existsSync(dirOf(outside))).toBe(true);
      expect(repropagation.repropagate).toHaveBeenCalledTimes(1);
      expect(repropagation.repropagate).toHaveBeenCalledWith(
        'skill',
        'merged-member',
        '/ws',
        { userInitiated: true },
      );
    });
  });
});
