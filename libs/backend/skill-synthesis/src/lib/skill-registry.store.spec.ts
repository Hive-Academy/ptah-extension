import 'reflect-metadata';
import { SkillRegistryStore } from './skill-registry.store';
import type { SkillRegistryEntry } from './skill-registry.store';
import { MIGRATIONS } from '@ptah-extension/persistence-sqlite';
import {
  resolveOpener,
  type TestDatabase,
} from './queue/queue-db.test-support';

const sql0022SkillRegistry =
  MIGRATIONS.find((m) => m.version === 22)?.sql ?? '';
const sql0023SkillRegistryPending =
  MIGRATIONS.find((m) => m.version === 23)?.sql ?? '';

// `better-sqlite3` if it loads in this runner, else the built-in `node:sqlite`.
const opener = resolveOpener();

const maybe = opener ? describe : describe.skip;

function createInMemoryDb(): TestDatabase {
  if (!opener) throw new Error('no SQLite binding available');
  const db = opener(':memory:');
  db.exec(sql0022SkillRegistry);
  db.exec(sql0023SkillRegistryPending);
  return db;
}

const noopLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

function makeStore(db: TestDatabase): SkillRegistryStore {
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
    pendingSourceHash: null,
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

  it('upsert round-trips pendingSourceHash', () => {
    const db = createInMemoryDb();
    try {
      const store = makeStore(db);
      store.upsert(entry({ pendingSourceHash: 'sha256:pending' }));
      const row = store.getBySlug('skill', 'deep-research');
      expect(row?.pendingSourceHash).toBe('sha256:pending');
    } finally {
      db.close();
    }
  });

  it('setPending sets and clears pending_source_hash', () => {
    const db = createInMemoryDb();
    try {
      const store = makeStore(db);
      store.upsert(entry());
      store.setPending('skill', 'deep-research', 'sha256:new-upstream');
      let row = store.getBySlug('skill', 'deep-research');
      expect(row?.pendingSourceHash).toBe('sha256:new-upstream');
      store.setPending('skill', 'deep-research', null);
      row = store.getBySlug('skill', 'deep-research');
      expect(row?.pendingSourceHash).toBeNull();
    } finally {
      db.close();
    }
  });

  it('setPending is a no-op when the row is absent', () => {
    const db = createInMemoryDb();
    try {
      const store = makeStore(db);
      expect(() =>
        store.setPending('skill', 'missing', 'sha256:x'),
      ).not.toThrow();
      expect(store.getBySlug('skill', 'missing')).toBeNull();
    } finally {
      db.close();
    }
  });

  it('markEnhanced sets last_enhanced_at and source_hash', () => {
    const db = createInMemoryDb();
    try {
      const store = makeStore(db);
      store.upsert(entry({ sourceHash: 'sha256:orig' }));
      store.markEnhanced('skill', 'deep-research', 1700, 'sha256:enhanced');
      const row = store.getBySlug('skill', 'deep-research');
      expect(row?.lastEnhancedAt).toBe(1700);
      expect(row?.sourceHash).toBe('sha256:enhanced');
    } finally {
      db.close();
    }
  });

  it('markEnhanced without hash preserves existing source_hash', () => {
    const db = createInMemoryDb();
    try {
      const store = makeStore(db);
      store.upsert(entry({ sourceHash: 'sha256:orig' }));
      store.markEnhanced('skill', 'deep-research', 1800);
      const row = store.getBySlug('skill', 'deep-research');
      expect(row?.lastEnhancedAt).toBe(1800);
      expect(row?.sourceHash).toBe('sha256:orig');
    } finally {
      db.close();
    }
  });

  it('listAuthoredSlugs returns only authored skills', () => {
    const db = createInMemoryDb();
    try {
      const store = makeStore(db);
      store.upsert(
        entry({ kind: 'skill', slug: 'orchestrate', cloneStatus: 'authored' }),
      );
      store.upsert(
        entry({ kind: 'skill', slug: 'review', cloneStatus: 'authored' }),
      );
      store.upsert(
        entry({ kind: 'skill', slug: 'cloned', cloneStatus: 'clone' }),
      );
      store.upsert(
        entry({ kind: 'skill', slug: 'synthed', cloneStatus: 'synth' }),
      );
      store.upsert(
        entry({ kind: 'agent', slug: 'orchestrate', cloneStatus: 'authored' }),
      );

      const authored = store.listAuthoredSlugs();
      expect(authored.has('orchestrate')).toBe(true);
      expect(authored.has('review')).toBe(true);
      expect(authored.has('cloned')).toBe(false);
      expect(authored.has('synthed')).toBe(false);
      // The authored AGENT named 'orchestrate' is the same slug, so the set
      // still has 2 distinct skill slugs.
      expect(authored.size).toBe(2);
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

  describe('remove', () => {
    it('deletes a synth row by default and reports it', () => {
      const db = createInMemoryDb();
      try {
        const store = makeStore(db);
        store.upsert(entry({ slug: 'synthed', cloneStatus: 'synth' }));
        expect(store.remove('skill', 'synthed')).toBe(true);
        expect(store.getBySlug('skill', 'synthed')).toBeNull();
      } finally {
        db.close();
      }
    });

    it('leaves authored and diverged rows untouched', () => {
      const db = createInMemoryDb();
      try {
        const store = makeStore(db);
        store.upsert(entry({ slug: 'mine', cloneStatus: 'authored' }));
        store.upsert(entry({ slug: 'edited', cloneStatus: 'synth' }));
        store.setDiverged('skill', 'edited', true);

        expect(store.remove('skill', 'mine')).toBe(false);
        expect(store.remove('skill', 'edited')).toBe(false);

        expect(store.getBySlug('skill', 'mine')?.cloneStatus).toBe('authored');
        expect(store.getBySlug('skill', 'edited')?.cloneStatus).toBe(
          'diverged',
        );
      } finally {
        db.close();
      }
    });

    it('matches on kind as well as slug', () => {
      const db = createInMemoryDb();
      try {
        const store = makeStore(db);
        store.upsert(entry({ kind: 'agent', slug: 'x', cloneStatus: 'synth' }));
        store.upsert(entry({ kind: 'skill', slug: 'x', cloneStatus: 'synth' }));

        expect(store.remove('skill', 'x')).toBe(true);

        expect(store.getBySlug('skill', 'x')).toBeNull();
        expect(store.getBySlug('agent', 'x')).not.toBeNull();
      } finally {
        db.close();
      }
    });

    it('honours an explicit clone status and reports a missing row as false', () => {
      const db = createInMemoryDb();
      try {
        const store = makeStore(db);
        store.upsert(entry({ slug: 'cloned', cloneStatus: 'clone' }));

        expect(store.remove('skill', 'cloned')).toBe(false);
        expect(store.remove('skill', 'cloned', 'clone')).toBe(true);
        expect(store.remove('skill', 'never-there')).toBe(false);
      } finally {
        db.close();
      }
    });
  });
});
