/**
 * Task index store — unit specs.
 *
 * `InMemoryTaskIndexStore` is exercised directly (runs everywhere). The
 * `SqliteTaskIndexStore` suite opens a real better-sqlite3 `:memory:` db and
 * applies migrations 0029 + 0031; it is SKIPPED automatically when the native module
 * cannot load in this environment (known NODE_MODULE_VERSION mismatch) — QA
 * owns the env fix. The parity block asserts both impls return identical rows.
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type { SqliteConnectionService } from '@ptah-extension/persistence-sqlite';
import { EMPTY_TASK_FILTER, buildTaskGraph } from '@ptah-extension/shared';
import type {
  ExcludedTaskFolder,
  TaskSpecSummary,
} from '@ptah-extension/shared';
import { MIGRATIONS } from '@ptah-extension/persistence-sqlite';
import {
  InMemoryTaskIndexStore,
  SqliteTaskIndexStore,
  type ITaskIndexStore,
} from './task-index.store';

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

/**
 * DDL for the task_specs tables, used to seed the `:memory:` db.
 *
 * BOTH migrations are applied, in order: 0029 creates the table and 0031 adds
 * the metadata columns. Seeding from 0029 alone would give the SQLite suite a
 * schema no shipped database ever has, and every metadata assertion below would
 * fail on a missing column rather than on the behaviour it means to test.
 */
const taskSpecsDdl = [29, 31]
  .map((version) => MIGRATIONS.find((m) => m.version === version)?.sql ?? '')
  .join('\n');

const ROOT = 'd:/tmp/ws-index';

function task(
  overrides: Partial<TaskSpecSummary> & { id: string },
): TaskSpecSummary {
  return {
    id: overrides.id,
    folderName: overrides.folderName ?? overrides.id,
    status: overrides.status ?? 'backlog',
    type: overrides.type ?? 'FEATURE',
    title: overrides.title ?? overrides.id,
    dependsOn: overrides.dependsOn ?? [],
    labels: overrides.labels ?? [],
    duplicates: overrides.duplicates ?? [],
    relatesTo: overrides.relatesTo ?? [],
    created:
      'created' in overrides
        ? (overrides.created ?? null)
        : '2026-07-14T10:00:00.000Z',
    updated:
      'updated' in overrides
        ? (overrides.updated ?? null)
        : '2026-07-14T10:00:00.000Z',
    frontmatterValid: overrides.frontmatterValid ?? true,
    validationIssues: overrides.validationIssues ?? [],
    ...(overrides.description !== undefined
      ? { description: overrides.description }
      : {}),
    ...(overrides.executor !== undefined
      ? { executor: overrides.executor }
      : {}),
    ...(overrides.estimate !== undefined
      ? { estimate: overrides.estimate }
      : {}),
    ...(overrides.parent !== undefined ? { parent: overrides.parent } : {}),
  };
}

const SEED: TaskSpecSummary[] = [
  task({
    id: 'TASK_2026_001',
    status: 'backlog',
    created: '2026-07-10T00:00:00.000Z',
  }),
  task({
    id: 'TASK_2026_002',
    status: 'done',
    type: 'BUGFIX',
    created: '2026-07-12T00:00:00.000Z',
  }),
  task({
    id: 'TASK_2026_003',
    status: 'done',
    created: '2026-07-11T00:00:00.000Z',
  }),
];

/** `n` distinct excluded folders, cycling through every typed reason. */
function excludedRows(n: number): ExcludedTaskFolder[] {
  const reasons: ExcludedTaskFolder['reason'][] = [
    'no_carrier',
    'no_frontmatter',
    'yaml_unparseable',
    'invalid_status',
    'missing_title',
    'unreadable',
  ];
  return Array.from({ length: n }, (_unused, i) => ({
    folderName: `TASK_2026_${String(900 + i).padStart(3, '0')}`,
    reason: reasons[i % reasons.length],
  }));
}

// ── shared contract exercised against any ITaskIndexStore ────────────────────

function runContract(makeStore: () => ITaskIndexStore): void {
  it('replaceWorkspace inserts rows + records excluded count', () => {
    const store = makeStore();
    store.replaceWorkspace(ROOT, SEED, excludedRows(85));
    expect(store.listByWorkspace(ROOT)).toHaveLength(3);
    expect(store.getMeta(ROOT)?.excludedCount).toBe(85);
  });

  it('replaceWorkspace persists the excluded ROWS, not just the count', () => {
    const store = makeStore();
    const excluded = excludedRows(3);
    store.replaceWorkspace(ROOT, SEED, excluded);

    const meta = store.getMeta(ROOT);
    expect(meta?.excluded).toEqual(excluded);
    expect(meta?.excludedCount).toBe(excluded.length);
  });

  it('replaceWorkspace clears excluded rows that no longer apply', () => {
    const store = makeStore();
    store.replaceWorkspace(ROOT, SEED, excludedRows(4));
    store.replaceWorkspace(ROOT, SEED, []);

    expect(store.getMeta(ROOT)?.excluded).toEqual([]);
    expect(store.getMeta(ROOT)?.excludedCount).toBe(0);
  });

  it('does not leak the excluded array back to the caller', () => {
    const store = makeStore();
    store.replaceWorkspace(ROOT, SEED, excludedRows(2));

    const first = store.getMeta(ROOT);
    first?.excluded.push({ folderName: 'MUTATED', reason: 'unreadable' });

    expect(store.getMeta(ROOT)?.excluded.map((e) => e.folderName)).toEqual([
      'TASK_2026_900',
      'TASK_2026_901',
    ]);
  });

  it('orders newest-first by created (null last)', () => {
    const store = makeStore();
    store.replaceWorkspace(
      ROOT,
      [
        task({ id: 'TASK_2026_010', created: null }),
        task({ id: 'TASK_2026_011', created: '2026-07-13T00:00:00.000Z' }),
        task({ id: 'TASK_2026_012', created: '2026-07-09T00:00:00.000Z' }),
      ],
      [],
    );
    expect(store.listByWorkspace(ROOT).map((t) => t.id)).toEqual([
      'TASK_2026_011',
      'TASK_2026_012',
      'TASK_2026_010',
    ]);
  });

  it('filters by status and type', () => {
    const store = makeStore();
    store.replaceWorkspace(ROOT, SEED, []);
    expect(store.listByWorkspace(ROOT, { status: ['done'] })).toHaveLength(2);
    expect(store.listByWorkspace(ROOT, { type: ['BUGFIX'] })).toHaveLength(1);
    expect(
      store.listByWorkspace(ROOT, { status: ['done'], type: ['FEATURE'] }),
    ).toHaveLength(1);
  });

  // ── the shared filter spec, through the store (TASK_2026_181, Task 6.3) ─────
  //
  // These run against the SQL row set as well as the Map one, which is the only
  // way to know the metadata columns round-trip into a shape the shared
  // predicate can actually read. `labels` and `estimate` are JSON/TEXT columns
  // on the SQLite side and plain arrays on the in-memory side; a filter that
  // works on one and not the other would be invisible without this.

  const FILTER_SEED: TaskSpecSummary[] = [
    task({
      id: 'TASK_2026_020',
      status: 'in_progress',
      labels: ['Licensing', 'ui'],
      estimate: 'L',
      executor: 'backend-developer',
    }),
    task({
      id: 'TASK_2026_021',
      status: 'backlog',
      labels: ['licensing '],
      estimate: 'XS',
      parent: 'TASK_2026_020',
    }),
    task({ id: 'TASK_2026_022', status: 'backlog', labels: ['ui'] }),
  ];

  it('applies a label facet from the shared spec', () => {
    const store = makeStore();
    store.replaceWorkspace(ROOT, FILTER_SEED, []);
    const rows = store.listByWorkspace(ROOT, {
      filter: {
        ...EMPTY_TASK_FILTER,
        labels: ['LICENSING'],
        labelsMode: 'any',
      },
    });
    // `Licensing`, `licensing ` and `LICENSING` are ONE label (labelKey).
    expect(rows.map((t) => t.id).sort()).toEqual([
      'TASK_2026_020',
      'TASK_2026_021',
    ]);
  });

  it('applies the estimate facet, including `unestimated`', () => {
    const store = makeStore();
    store.replaceWorkspace(ROOT, FILTER_SEED, []);
    expect(
      store
        .listByWorkspace(ROOT, {
          filter: { ...EMPTY_TASK_FILTER, unestimated: true },
        })
        .map((t) => t.id),
    ).toEqual(['TASK_2026_022']);
    expect(
      store
        .listByWorkspace(ROOT, {
          filter: { ...EMPTY_TASK_FILTER, estimates: ['L'] },
        })
        .map((t) => t.id),
    ).toEqual(['TASK_2026_020']);
  });

  it('applies a graph-backed facet without being handed a graph', () => {
    const store = makeStore();
    store.replaceWorkspace(ROOT, FILTER_SEED, []);
    expect(
      store
        .listByWorkspace(ROOT, {
          filter: { ...EMPTY_TASK_FILTER, parentage: ['child'] },
        })
        .map((t) => t.id),
    ).toEqual(['TASK_2026_021']);
  });

  it('ANDs the spec with the legacy status list', () => {
    const store = makeStore();
    store.replaceWorkspace(ROOT, FILTER_SEED, []);
    expect(
      store
        .listByWorkspace(ROOT, {
          status: ['backlog'],
          filter: { ...EMPTY_TASK_FILTER, labels: ['ui'] },
        })
        .map((t) => t.id),
    ).toEqual(['TASK_2026_022']);
  });

  it('returns nothing when the spec and the legacy list contradict', () => {
    const store = makeStore();
    store.replaceWorkspace(ROOT, FILTER_SEED, []);
    // NOT "no constraint" — the empty intersection means no task qualifies.
    expect(
      store.listByWorkspace(ROOT, {
        status: ['backlog'],
        filter: { ...EMPTY_TASK_FILTER, statuses: ['in_progress'] },
      }),
    ).toEqual([]);
  });

  it('preserves the newest-first ordering through the filter', () => {
    const store = makeStore();
    store.replaceWorkspace(
      ROOT,
      [
        task({
          id: 'TASK_2026_030',
          labels: ['ui'],
          created: '2026-07-09T00:00:00.000Z',
        }),
        task({
          id: 'TASK_2026_031',
          labels: ['ui'],
          created: '2026-07-13T00:00:00.000Z',
        }),
        task({
          id: 'TASK_2026_032',
          labels: ['other'],
          created: '2026-07-11T00:00:00.000Z',
        }),
      ],
      [],
    );
    expect(
      store
        .listByWorkspace(ROOT, {
          filter: { ...EMPTY_TASK_FILTER, labels: ['ui'] },
        })
        .map((t) => t.id),
    ).toEqual(['TASK_2026_031', 'TASK_2026_030']);
  });

  it('replaceWorkspace is idempotent — rebuild equivalent to fresh', () => {
    const store = makeStore();
    store.replaceWorkspace(ROOT, SEED, excludedRows(5));
    store.replaceWorkspace(ROOT, SEED, excludedRows(5));
    expect(store.listByWorkspace(ROOT)).toHaveLength(3);
  });

  it('deleteByFolder removes a single row', () => {
    const store = makeStore();
    store.replaceWorkspace(ROOT, SEED, []);
    store.deleteByFolder(ROOT, 'TASK_2026_002');
    expect(store.listByWorkspace(ROOT).map((t) => t.id)).not.toContain(
      'TASK_2026_002',
    );
  });

  it('upsertMany updates existing + inserts new without clobbering the workspace', () => {
    const store = makeStore();
    store.replaceWorkspace(ROOT, SEED, []);
    store.upsertMany(ROOT, [
      task({ id: 'TASK_2026_001', status: 'in_progress' }),
      task({ id: 'TASK_2026_099', status: 'blocked' }),
    ]);
    const rows = store.listByWorkspace(ROOT);
    expect(rows).toHaveLength(4);
    expect(rows.find((t) => t.id === 'TASK_2026_001')?.status).toBe(
      'in_progress',
    );
  });

  it('preserves dependsOn + validationIssues round-trip', () => {
    const store = makeStore();
    store.replaceWorkspace(
      ROOT,
      [
        task({
          id: 'TASK_2026_050',
          dependsOn: ['TASK_2026_001', 'TASK_2026_002'],
          frontmatterValid: false,
          validationIssues: [
            { field: 'type', code: 'invalid_type', message: 'bad type' },
            // A finding that NAMES an entry. `ref` needs no column of its own —
            // the whole array is one JSON blob — but "needs no column" is a
            // claim about the store, so it gets asserted rather than assumed.
            // Two entries under one field are only distinguishable by `ref`, so
            // a store that dropped it would silently collapse them downstream.
            {
              field: 'relates_to',
              code: 'dangling_relation',
              message: 'points at nothing',
              ref: 'TASK_2026_900',
            },
          ],
        }),
      ],
      [],
    );
    const row = store.listByWorkspace(ROOT)[0];
    expect(row.dependsOn).toEqual(['TASK_2026_001', 'TASK_2026_002']);
    expect(row.frontmatterValid).toBe(false);
    expect(row.validationIssues[0].code).toBe('invalid_type');
    expect(row.validationIssues[0].ref).toBeUndefined();
    expect(row.validationIssues[1].ref).toBe('TASK_2026_900');
  });

  // ── the five metadata columns (TASK_2026_181) ─────────────────────────────
  //
  // Run against BOTH impls. The board reads whichever the lazy DI factory
  // picked, and the user never learns which — so a field that survives one
  // store and not the other is a bug that only reproduces on the machine where
  // the native module failed to load.

  it('round-trips all five metadata fields', () => {
    const store = makeStore();
    store.replaceWorkspace(
      ROOT,
      [
        task({
          id: 'TASK_2026_070',
          labels: ['licensing', 'needs:design'],
          estimate: 'L',
          parent: 'TASK_2026_001',
          duplicates: ['TASK_2026_002'],
          relatesTo: ['TASK_2026_003', 'TASK_2026_004'],
        }),
      ],
      [],
    );
    const row = store.listByWorkspace(ROOT)[0];
    expect(row.labels).toEqual(['licensing', 'needs:design']);
    expect(row.estimate).toBe('L');
    expect(row.parent).toBe('TASK_2026_001');
    expect(row.duplicates).toEqual(['TASK_2026_002']);
    expect(row.relatesTo).toEqual(['TASK_2026_003', 'TASK_2026_004']);
  });

  it('round-trips a task carrying NO metadata as empty arrays + absent scalars', () => {
    const store = makeStore();
    store.replaceWorkspace(ROOT, [task({ id: 'TASK_2026_071' })], []);
    const row = store.listByWorkspace(ROOT)[0];
    expect(row.labels).toEqual([]);
    expect(row.duplicates).toEqual([]);
    expect(row.relatesTo).toEqual([]);
    expect(row.estimate).toBeUndefined();
    expect(row.parent).toBeUndefined();
  });

  it('upsert REPLACES the metadata arrays rather than merging them', () => {
    const store = makeStore();
    store.replaceWorkspace(
      ROOT,
      [task({ id: 'TASK_2026_072', labels: ['a', 'b'], estimate: 'XL' })],
      [],
    );
    store.upsertMany(ROOT, [task({ id: 'TASK_2026_072', labels: ['c'] })]);

    const row = store.listByWorkspace(ROOT)[0];
    // Full replacement, both ways: the new labels win AND the estimate that is
    // no longer declared is gone. A merge here would make it impossible to
    // ever clear a field through the index.
    expect(row.labels).toEqual(['c']);
    expect(row.estimate).toBeUndefined();
  });

  it('does not hand back a live reference to a stored metadata array', () => {
    const store = makeStore();
    store.replaceWorkspace(
      ROOT,
      [task({ id: 'TASK_2026_073', labels: ['x'] })],
      [],
    );

    store.listByWorkspace(ROOT)[0].labels.push('MUTATED');

    expect(store.listByWorkspace(ROOT)[0].labels).toEqual(['x']);
  });
}

describe('InMemoryTaskIndexStore', () => {
  runContract(() => new InMemoryTaskIndexStore(makeLogger()));

  it('does not leak internal references (stored rows are cloned)', () => {
    const store = new InMemoryTaskIndexStore(makeLogger());
    const input = [task({ id: 'TASK_2026_060', dependsOn: ['X'] })];
    store.replaceWorkspace(ROOT, input, []);
    input[0].dependsOn.push('MUTATED');
    expect(store.listByWorkspace(ROOT)[0].dependsOn).toEqual(['X']);
  });
});

// ── SQLite impl — skipped when the native module can't load ──────────────────

interface BetterSqlite3Ctor {
  new (path: string): {
    exec(sql: string): unknown;
    prepare(sql: string): unknown;
    transaction<T extends (...a: unknown[]) => unknown>(fn: T): T;
    close(): void;
  };
}

function loadBetterSqlite3(): BetterSqlite3Ctor | null {
  try {
    const Ctor = require('better-sqlite3') as unknown as BetterSqlite3Ctor;
    // The native binding may `require` fine yet throw on instantiation when the
    // ABI mismatches (NODE_MODULE_VERSION 143 vs 137 in this env). Probe it.
    const probe = new Ctor(':memory:');
    probe.close();
    return Ctor;
  } catch {
    return null;
  }
}

const Database = loadBetterSqlite3();
const describeSqlite = Database ? describe : describe.skip;

describeSqlite(
  'SqliteTaskIndexStore (:memory: + migrations 0029 + 0031)',
  () => {
    function makeStore(): ITaskIndexStore {
      const db = new (Database as BetterSqlite3Ctor)(':memory:');
      db.exec(taskSpecsDdl);
      const connection = { db } as unknown as SqliteConnectionService;
      return new SqliteTaskIndexStore(makeLogger(), connection);
    }

    runContract(makeStore);
  },
);

describe('store parity (InMemory vs SQLite)', () => {
  (Database ? it : it.skip)(
    'both impls return identical listByWorkspace output',
    () => {
      const mem = new InMemoryTaskIndexStore(makeLogger());
      const db = new (Database as BetterSqlite3Ctor)(':memory:');
      db.exec(taskSpecsDdl);
      const sqlite = new SqliteTaskIndexStore(makeLogger(), {
        db,
      } as unknown as SqliteConnectionService);

      mem.replaceWorkspace(ROOT, SEED, excludedRows(7));
      sqlite.replaceWorkspace(ROOT, SEED, excludedRows(7));

      expect(sqlite.listByWorkspace(ROOT)).toEqual(mem.listByWorkspace(ROOT));
      expect(sqlite.getMeta(ROOT)?.excludedCount).toBe(
        mem.getMeta(ROOT)?.excludedCount,
      );
      // The exclusion ROWS must agree too — the board names folders off these,
      // and the two impls are chosen by a lazy DI factory the user never sees.
      expect(sqlite.getMeta(ROOT)?.excluded).toEqual(
        mem.getMeta(ROOT)?.excluded,
      );
      expect(sqlite.getMeta(ROOT)?.excluded).toEqual(excludedRows(7));
    },
  );

  (Database ? it : it.skip)(
    'both impls return identical METADATA, populated and empty alike',
    () => {
      const seed: TaskSpecSummary[] = [
        task({
          id: 'TASK_2026_080',
          labels: ['licensing', 'needs:design', 'trailing '],
          estimate: 'XS',
          parent: 'TASK_2026_001',
          duplicates: ['TASK_2026_081'],
          relatesTo: ['TASK_2026_082', 'TASK_2026_083'],
          created: '2026-07-20T00:00:00.000Z',
        }),
        // The zero-metadata case belongs in the SAME assertion: the two impls
        // reach "empty" by different routes (a cloned array vs a JSON parse of
        // `'[]'`), and that is precisely where they could diverge.
        task({ id: 'TASK_2026_084', created: '2026-07-19T00:00:00.000Z' }),
      ];

      const mem = new InMemoryTaskIndexStore(makeLogger());
      const db = new (Database as BetterSqlite3Ctor)(':memory:');
      db.exec(taskSpecsDdl);
      const sqlite = new SqliteTaskIndexStore(makeLogger(), {
        db,
      } as unknown as SqliteConnectionService);

      mem.replaceWorkspace(ROOT, seed, []);
      sqlite.replaceWorkspace(ROOT, seed, []);

      expect(sqlite.listByWorkspace(ROOT)).toEqual(mem.listByWorkspace(ROOT));

      const fromSqlite = sqlite.listByWorkspace(ROOT)[0];
      expect(fromSqlite.labels).toEqual([
        'licensing',
        'needs:design',
        'trailing ',
      ]);
      expect(fromSqlite.estimate).toBe('XS');
      expect(fromSqlite.parent).toBe('TASK_2026_001');
      expect(fromSqlite.duplicates).toEqual(['TASK_2026_081']);
      expect(fromSqlite.relatesTo).toEqual(['TASK_2026_082', 'TASK_2026_083']);
    },
  );

  /**
   * The board derives parentage, rollups and inverse relations CLIENT-SIDE from
   * whatever the store hands back, so SQLite availability must gate nothing
   * (NFR-11). Comparing the summaries is not quite enough: the graph is built
   * out of the five metadata columns, and those are exactly the ones the two
   * impls reach by different routes (a cloned array vs a JSON parse of `'[]'`).
   */
  (Database ? it : it.skip)(
    'both impls yield an identical derived graph',
    () => {
      const seed: TaskSpecSummary[] = [
        task({ id: 'TASK_2026_090', labels: ['Licensing'] }),
        task({
          id: 'TASK_2026_091',
          parent: 'TASK_2026_090',
          status: 'done',
          labels: ['licensing '],
          relatesTo: ['TASK_2026_092'],
        }),
        task({
          id: 'TASK_2026_092',
          parent: 'TASK_2026_090',
          dependsOn: ['TASK_2026_091'],
          duplicates: ['TASK_2026_090'],
        }),
      ];

      const mem = new InMemoryTaskIndexStore(makeLogger());
      const db = new (Database as BetterSqlite3Ctor)(':memory:');
      db.exec(taskSpecsDdl);
      const sqlite = new SqliteTaskIndexStore(makeLogger(), {
        db,
      } as unknown as SqliteConnectionService);

      mem.replaceWorkspace(ROOT, seed, []);
      sqlite.replaceWorkspace(ROOT, seed, []);

      const fromMemory = buildTaskGraph(mem.listByWorkspace(ROOT));
      const fromSqlite = buildTaskGraph(sqlite.listByWorkspace(ROOT));

      expect([...fromSqlite.children]).toEqual([...fromMemory.children]);
      expect([...fromSqlite.rollup]).toEqual([...fromMemory.rollup]);
      expect([...fromSqlite.effectiveParent]).toEqual([
        ...fromMemory.effectiveParent,
      ]);
      expect([...fromSqlite.blocks]).toEqual([...fromMemory.blocks]);
      expect([...fromSqlite.duplicatedBy]).toEqual([
        ...fromMemory.duplicatedBy,
      ]);
      expect([...fromSqlite.related]).toEqual([...fromMemory.related]);
      expect(fromSqlite.knownLabels).toEqual(fromMemory.knownLabels);
      // Sanity: the fixture actually exercises the derivation.
      expect(fromMemory.rollup.get('TASK_2026_090')).toEqual({
        total: 2,
        done: 1,
        cancelled: 0,
        open: 1,
      });
      expect(fromMemory.knownLabels).toEqual(['Licensing']);
    },
  );
});
