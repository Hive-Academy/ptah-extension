import 'reflect-metadata';
import { MIGRATIONS } from '@ptah-extension/persistence-sqlite';
import type {
  CloneEntry,
  DivergedClone,
  UserLayerMirrorService,
  UserLayerRoots,
} from '@ptah-extension/agent-generation';
import { SkillRegistryStore } from './skill-registry.store';
import { SkillRegistryCatalogService } from './skill-registry-catalog.service';
import type { SkillCandidateStore } from './skill-candidate.store';

const sql0022 = MIGRATIONS.find((m) => m.version === 22)?.sql ?? '';
const sql0023 = MIGRATIONS.find((m) => m.version === 23)?.sql ?? '';

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
  db.exec(sql0022);
  db.exec(sql0023);
  return db;
}

const noopLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

const roots: UserLayerRoots = {
  skills: '/u/skills',
  agents: '/u/agents',
  commands: '/u/commands',
};

/**
 * A faithful UserLayerMirrorService double whose listClones() returns the
 * sidecar-derived entries the real reconcile engine writes. The fs reconcile
 * A/B/C state machine is exhaustively covered in agent-generation's
 * user-layer-reconcile.spec.ts; this spec proves the Electron glue
 * (reconcile.divergedSlugs → setDiverged/setPending → catalog.sync) lands in
 * the SQLite skill_registry.
 */
function makeMirror(clones: CloneEntry[]): UserLayerMirrorService {
  return {
    listClones: async () => clones,
    getUserLayerRoots: () => roots,
  } as unknown as UserLayerMirrorService;
}

function skillClone(overrides: Partial<CloneEntry> = {}): CloneEntry {
  return {
    slug: 'deep-research',
    kind: 'skill',
    pluginId: 'ptah-core',
    sourceHash: 'sha256:v1',
    diverged: false,
    lastEnhancedAt: null,
    pendingSourceHash: null,
    ...overrides,
  };
}

maybe('P2 reconcile → catalog wiring (Electron path)', () => {
  let db: BetterSqliteDb;
  let store: SkillRegistryStore;

  beforeEach(() => {
    db = createInMemoryDb();
    store = new SkillRegistryStore(
      noopLogger as never,
      {
        db,
        isOpen: true,
      } as never,
    );
  });

  afterEach(() => {
    db.close();
  });

  function makeCatalog(clones: CloneEntry[]): SkillRegistryCatalogService {
    const candidates = {
      findByName: () => null,
    } as unknown as SkillCandidateStore;
    return new SkillRegistryCatalogService(
      noopLogger as never,
      store,
      candidates,
      makeMirror(clones),
    );
  }

  // Mirror of reconcileUserLayer's Electron glue.
  async function applyDivergedAndSync(
    divergedSlugs: DivergedClone[],
    cloneStateAfter: CloneEntry[],
  ): Promise<void> {
    for (const diverged of divergedSlugs) {
      store.setDiverged(diverged.kind, diverged.slug, true);
      store.setPending(
        diverged.kind,
        diverged.slug,
        diverged.pendingSourceHash,
      );
    }
    await makeCatalog(cloneStateAfter).sync();
  }

  it('Case B: fast-forward updates the catalog row source_hash, stays non-diverged', async () => {
    await makeCatalog([skillClone({ sourceHash: 'sha256:v1' })]).sync();
    const before = store.getBySlug('skill', 'deep-research');
    expect(before?.diverged).toBe(false);
    expect(before?.sourceHash).toBe('sha256:v1');

    await applyDivergedAndSync(
      [],
      [skillClone({ sourceHash: 'sha256:v2', diverged: false })],
    );

    const row = store.getBySlug('skill', 'deep-research');
    expect(row?.diverged).toBe(false);
    expect(row?.cloneStatus).toBe('clone');
    expect(row?.sourceHash).toBe('sha256:v2');
    expect(row?.pendingSourceHash).toBeNull();
  });

  it('Case C: divergence sets skill_registry.diverged=1 + pending_source_hash', async () => {
    await makeCatalog([skillClone({ sourceHash: 'sha256:v1' })]).sync();

    await applyDivergedAndSync(
      [
        {
          kind: 'skill',
          slug: 'deep-research',
          pendingSourceHash: 'sha256:v2-upstream',
        },
      ],
      [
        skillClone({
          sourceHash: 'sha256:v1',
          diverged: true,
          pendingSourceHash: 'sha256:v2-upstream',
        }),
      ],
    );

    const row = store.getBySlug('skill', 'deep-research');
    expect(row?.diverged).toBe(true);
    expect(row?.cloneStatus).toBe('diverged');
    expect(row?.pendingSourceHash).toBe('sha256:v2-upstream');
  });

  it('Case C divergence persists even if the catalog re-sync runs first (setDiverged wins)', async () => {
    await makeCatalog([skillClone({ sourceHash: 'sha256:v1' })]).sync();

    store.setDiverged('skill', 'deep-research', true);
    store.setPending('skill', 'deep-research', 'sha256:pending');

    const row = store.getBySlug('skill', 'deep-research');
    expect(row?.diverged).toBe(true);
    expect(row?.pendingSourceHash).toBe('sha256:pending');
  });
});
