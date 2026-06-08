import 'reflect-metadata';
import { SkillRegistryStore } from './skill-registry.store';
import type { SkillRegistryEntry } from './skill-registry.store';
import { MIGRATIONS } from '@ptah-extension/persistence-sqlite';

const sql0022SkillRegistry =
  MIGRATIONS.find((m) => m.version === 22)?.sql ?? '';

interface BetterSqliteDb {
  exec(sql: string): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prepare(sql: string): {
    run(...args: any[]): any;
    get(...args: any[]): any;
    all(...args: any[]): any[];
  };
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

const maybe = nativeAvailable ? describe : describe.skip;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const DatabaseCtor = nativeAvailable
  ? (require('better-sqlite3') as new (path: string) => BetterSqliteDb)
  : null;

function createInMemoryDb(): BetterSqliteDb {
  if (!DatabaseCtor) throw new Error('native not available');
  const db = new DatabaseCtor(':memory:');
  db.exec(sql0022SkillRegistry);
  return db;
}

const noopLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

function makeStore(db: BetterSqliteDb): SkillRegistryStore {
  return new SkillRegistryStore(
    noopLogger as never,
    {
      db,
      isOpen: true,
    } as never,
  );
}

function entry(
  overrides: Partial<SkillRegistryEntry> = {},
): SkillRegistryEntry {
  return {
    slug: 'deep-research',
    kind: 'skill',
    userPath: '/home/u/.ptah/user/skills/deep-research',
    originPluginId: 'ptah-core',
    originVersion: null,
    sourceHash: 'sha256:abc',
    cloneStatus: 'clone',
    diverged: false,
    historyDir: null,
    lastEnhancedAt: null,
    candidateId: null,
    ...overrides,
  };
}

maybe('SkillRegistryStore', () => {
  it('upsert inserts a new row retrievable by getBySlug', () => {
    const db = createInMemoryDb();
    try {
      const store = makeStore(db);
      store.upsert(entry());
      const row = store.getBySlug('skill', 'deep-research');
      expect(row).not.toBeNull();
      expect(row?.slug).toBe('deep-research');
      expect(row?.cloneStatus).toBe('clone');
      expect(row?.originPluginId).toBe('ptah-core');
      expect(row?.sourceHash).toBe('sha256:abc');
      expect(row?.diverged).toBe(false);
    } finally {
      db.close();
    }
  });

  it('upsert is idempotent on (kind, slug) and updates mutable fields', () => {
    const db = createInMemoryDb();
    try {
      const store = makeStore(db);
      store.upsert(entry({ sourceHash: 'sha256:v1' }));
      store.upsert(entry({ sourceHash: 'sha256:v2', cloneStatus: 'authored' }));
      const all = store.listAll();
      expect(all).toHaveLength(1);
      expect(all[0].sourceHash).toBe('sha256:v2');
      expect(all[0].cloneStatus).toBe('authored');
    } finally {
      db.close();
    }
  });

  it('listAll returns rows across kinds ordered by kind, slug', () => {
    const db = createInMemoryDb();
    try {
      const store = makeStore(db);
      store.upsert(entry({ kind: 'skill', slug: 'b' }));
      store.upsert(entry({ kind: 'agent', slug: 'a' }));
      store.upsert(entry({ kind: 'command', slug: 'c' }));
      const all = store.listAll();
      expect(all.map((r) => `${r.kind}/${r.slug}`)).toEqual([
        'agent/a',
        'command/c',
        'skill/b',
      ]);
    } finally {
      db.close();
    }
  });

  it('setDiverged flips diverged and clone_status to diverged', () => {
    const db = createInMemoryDb();
    try {
      const store = makeStore(db);
      store.upsert(entry());
      store.setDiverged('skill', 'deep-research', true);
      const row = store.getBySlug('skill', 'deep-research');
      expect(row?.diverged).toBe(true);
      expect(row?.cloneStatus).toBe('diverged');
    } finally {
      db.close();
    }
  });

  it('linkCandidate sets candidate_id and clone_status synth', () => {
    const db = createInMemoryDb();
    try {
      const store = makeStore(db);
      store.upsert(entry());
      store.linkCandidate('skill', 'deep-research', 'cand_123');
      const row = store.getBySlug('skill', 'deep-research');
      expect(row?.candidateId).toBe('cand_123');
      expect(row?.cloneStatus).toBe('synth');
    } finally {
      db.close();
    }
  });
});
