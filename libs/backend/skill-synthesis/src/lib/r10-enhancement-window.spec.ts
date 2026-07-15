/**
 * R10 enabler (D7) — before/after enhancement windows are computable from
 * EXISTING columns; NO schema change is required.
 *
 * This store-level spec proves two facts the plan asserts (R10.1/R10.2):
 *
 *  1. `skill_registry.last_enhanced_at`, written by `SkillRegistryStore.markEnhanced`
 *     and read back via `getBySlug`, yields a per-`(kind, slug)` enhancement
 *     timestamp — the disk-snapshot counterpart (`UserLayerMirrorService.listHistory`)
 *     is already covered in `user-layer-enhance.spec.ts`.
 *  2. Raw per-invocation metrics rows are timestamped (`invoked_at`) and
 *     slug-keyed, so a future E-group task can compute pre/post aggregates with
 *     a plain `WHERE skill_slug = ? AND invoked_at < / >= lastEnhancedAt` — no
 *     new column, no migration.
 *
 * Uses a real in-memory better-sqlite3 DB carrying BOTH tables so the two
 * stores share one connection, exactly as the runtime wires them.
 */
import 'reflect-metadata';
import { SkillCandidateStore } from './skill-candidate.store';
import { SkillRegistryStore } from './skill-registry.store';
import { MIGRATIONS } from '@ptah-extension/persistence-sqlite';

const sqlSkillRegistry = MIGRATIONS.find((m) => m.version === 22)?.sql ?? '';
const sqlSkillRegistryPending =
  MIGRATIONS.find((m) => m.version === 23)?.sql ?? '';

interface BetterSqliteDb {
  exec(sql: string): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prepare(sql: string): {
    run(...args: any[]): any;
    get(...args: any[]): any;
    all(...args: any[]): any[];
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  transaction<T extends (...args: any[]) => any>(fn: T): T;
  close(): void;
}

let nativeAvailable = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const DB = require('better-sqlite3') as new (path: string) => {
    close(): void;
  };
  const probe = new DB(':memory:');
  probe.close();
  nativeAvailable = true;
} catch {
  nativeAvailable = false;
}

const maybe = nativeAvailable ? it : it.skip;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const DatabaseCtor = nativeAvailable
  ? (require('better-sqlite3') as new (path: string) => BetterSqliteDb)
  : null;

function createInMemoryDb(): BetterSqliteDb {
  if (!DatabaseCtor) throw new Error('native not available');
  const db = new DatabaseCtor(':memory:');
  db.exec(sqlSkillRegistry);
  db.exec(sqlSkillRegistryPending);
  db.exec(`
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
    CREATE INDEX idx_skill_inv_events_task
      ON skill_invocation_events(skill_slug, task_id);
  `);
  return db;
}

const noopLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

function makeVecStatus(): unknown {
  const diagnostic = {
    ok: false,
    reason: 'binary-missing',
    electronVersion: '40.0.0',
    processArch: 'x64',
    processPlatform: 'linux',
  };
  return {
    available: false,
    reason: diagnostic.reason,
    diagnostic,
    getStatus: () => ({
      available: false,
      reason: diagnostic.reason,
      diagnostic,
    }),
    on: () => ({ dispose: () => undefined }),
    refresh: () => undefined,
  };
}

function makeCandidateStore(db: BetterSqliteDb): SkillCandidateStore {
  return new SkillCandidateStore(
    noopLogger as never,
    { db, vecExtensionLoaded: false, isOpen: true } as never,
    makeVecStatus() as never,
  );
}

function makeRegistryStore(db: BetterSqliteDb): SkillRegistryStore {
  return new SkillRegistryStore(
    noopLogger as never,
    { db, isOpen: true } as never,
  );
}

function recordSubagentAt(
  store: SkillCandidateStore,
  slug: string,
  invokedAt: number,
): void {
  store.recordSkillEvent({
    skillSlug: slug,
    sessionId: `sess-${invokedAt}`,
    contextId: null,
    source: 'subagent',
    succeeded: true,
    isError: false,
    invokedAt,
    metrics: {
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: null,
      cacheCreationTokens: null,
      costUsd: 0.01,
      durationMs: 1000,
      toolCount: 3,
    },
    taskId: `TASK_2026_${invokedAt}`,
  });
}

function countInWindow(
  db: BetterSqliteDb,
  slug: string,
  op: '<' | '>=',
  boundary: number,
): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n
       FROM skill_invocation_events
       WHERE skill_slug = ? AND invoked_at ${op} ?`,
    )
    .get(slug, boundary) as { n: number };
  return row.n;
}

describe('R10 enabler — enhancement window computability (no schema change)', () => {
  maybe(
    'markEnhanced writes a per-(kind, slug) last_enhanced_at timestamp',
    () => {
      const db = createInMemoryDb();
      try {
        const registry = makeRegistryStore(db);
        registry.upsert({
          slug: 'deep-research',
          kind: 'agent',
          userPath: '/home/u/.ptah/user/agents/deep-research.md',
          originPluginId: 'ptah-core',
          originVersion: null,
          sourceHash: 'sha256:abc',
          cloneStatus: 'clone',
          diverged: false,
          historyDir: null,
          lastEnhancedAt: null,
          candidateId: null,
          pendingSourceHash: null,
        });

        expect(
          registry.getBySlug('agent', 'deep-research')?.lastEnhancedAt,
        ).toBeNull();

        const enhancedAt = 1_700_000_000_000;
        registry.markEnhanced('agent', 'deep-research', enhancedAt);

        expect(
          registry.getBySlug('agent', 'deep-research')?.lastEnhancedAt,
        ).toBe(enhancedAt);
      } finally {
        db.close();
      }
    },
  );

  maybe(
    'metrics rows support before/after windows around last_enhanced_at',
    () => {
      const db = createInMemoryDb();
      try {
        const candidates = makeCandidateStore(db);
        const registry = makeRegistryStore(db);
        registry.upsert({
          slug: 'deep-research',
          kind: 'agent',
          userPath: '/home/u/.ptah/user/agents/deep-research.md',
          originPluginId: 'ptah-core',
          originVersion: null,
          sourceHash: 'sha256:abc',
          cloneStatus: 'clone',
          diverged: false,
          historyDir: null,
          lastEnhancedAt: null,
          candidateId: null,
          pendingSourceHash: null,
        });

        // Two runs BEFORE and three runs AFTER the enhancement boundary.
        recordSubagentAt(candidates, 'deep-research', 1000);
        recordSubagentAt(candidates, 'deep-research', 1500);
        const enhancedAt = 2000;
        registry.markEnhanced('agent', 'deep-research', enhancedAt);
        recordSubagentAt(candidates, 'deep-research', 2500);
        recordSubagentAt(candidates, 'deep-research', 3000);
        recordSubagentAt(candidates, 'deep-research', 3500);

        const lastEnhancedAt =
          registry.getBySlug('agent', 'deep-research')?.lastEnhancedAt ?? 0;
        expect(lastEnhancedAt).toBe(enhancedAt);

        // Pre/post aggregate windows computed from EXISTING columns only.
        expect(countInWindow(db, 'deep-research', '<', lastEnhancedAt)).toBe(2);
        expect(countInWindow(db, 'deep-research', '>=', lastEnhancedAt)).toBe(
          3,
        );
      } finally {
        db.close();
      }
    },
  );

  maybe(
    'windows are slug-scoped — a second slug never bleeds into the counts',
    () => {
      const db = createInMemoryDb();
      try {
        const candidates = makeCandidateStore(db);
        recordSubagentAt(candidates, 'deep-research', 1000);
        recordSubagentAt(candidates, 'deep-research', 3000);
        recordSubagentAt(candidates, 'other-agent', 1000);
        recordSubagentAt(candidates, 'other-agent', 3000);

        const boundary = 2000;
        expect(countInWindow(db, 'deep-research', '<', boundary)).toBe(1);
        expect(countInWindow(db, 'deep-research', '>=', boundary)).toBe(1);
        expect(countInWindow(db, 'other-agent', '<', boundary)).toBe(1);
        expect(countInWindow(db, 'other-agent', '>=', boundary)).toBe(1);
      } finally {
        db.close();
      }
    },
  );
});
