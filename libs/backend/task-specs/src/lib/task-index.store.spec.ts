/**
 * Task index store — unit specs.
 *
 * `InMemoryTaskIndexStore` is exercised directly (runs everywhere). The
 * `SqliteTaskIndexStore` suite opens a real better-sqlite3 `:memory:` db and
 * applies migration 0029; it is SKIPPED automatically when the native module
 * cannot load in this environment (known NODE_MODULE_VERSION mismatch) — QA
 * owns the env fix. The parity block asserts both impls return identical rows.
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type { SqliteConnectionService } from '@ptah-extension/persistence-sqlite';
import type { TaskSpecSummary } from '@ptah-extension/shared';
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

/** DDL for the task_specs tables (migration 0029), used to seed the :memory: db. */
const migration0029 = MIGRATIONS.find((m) => m.version === 29)?.sql ?? '';

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

// ── shared contract exercised against any ITaskIndexStore ────────────────────

function runContract(makeStore: () => ITaskIndexStore): void {
  it('replaceWorkspace inserts rows + records excluded count', () => {
    const store = makeStore();
    store.replaceWorkspace(ROOT, SEED, 85);
    expect(store.listByWorkspace(ROOT)).toHaveLength(3);
    expect(store.getMeta(ROOT)?.excludedCount).toBe(85);
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
      0,
    );
    expect(store.listByWorkspace(ROOT).map((t) => t.id)).toEqual([
      'TASK_2026_011',
      'TASK_2026_012',
      'TASK_2026_010',
    ]);
  });

  it('filters by status and type', () => {
    const store = makeStore();
    store.replaceWorkspace(ROOT, SEED, 0);
    expect(store.listByWorkspace(ROOT, { status: ['done'] })).toHaveLength(2);
    expect(store.listByWorkspace(ROOT, { type: ['BUGFIX'] })).toHaveLength(1);
    expect(
      store.listByWorkspace(ROOT, { status: ['done'], type: ['FEATURE'] }),
    ).toHaveLength(1);
  });

  it('replaceWorkspace is idempotent — rebuild equivalent to fresh', () => {
    const store = makeStore();
    store.replaceWorkspace(ROOT, SEED, 5);
    store.replaceWorkspace(ROOT, SEED, 5);
    expect(store.listByWorkspace(ROOT)).toHaveLength(3);
  });

  it('deleteByFolder removes a single row', () => {
    const store = makeStore();
    store.replaceWorkspace(ROOT, SEED, 0);
    store.deleteByFolder(ROOT, 'TASK_2026_002');
    expect(store.listByWorkspace(ROOT).map((t) => t.id)).not.toContain(
      'TASK_2026_002',
    );
  });

  it('upsertMany updates existing + inserts new without clobbering the workspace', () => {
    const store = makeStore();
    store.replaceWorkspace(ROOT, SEED, 0);
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
          ],
        }),
      ],
      0,
    );
    const row = store.listByWorkspace(ROOT)[0];
    expect(row.dependsOn).toEqual(['TASK_2026_001', 'TASK_2026_002']);
    expect(row.frontmatterValid).toBe(false);
    expect(row.validationIssues[0].code).toBe('invalid_type');
  });
}

describe('InMemoryTaskIndexStore', () => {
  runContract(() => new InMemoryTaskIndexStore(makeLogger()));

  it('does not leak internal references (stored rows are cloned)', () => {
    const store = new InMemoryTaskIndexStore(makeLogger());
    const input = [task({ id: 'TASK_2026_060', dependsOn: ['X'] })];
    store.replaceWorkspace(ROOT, input, 0);
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

describeSqlite('SqliteTaskIndexStore (:memory: + migration 0029)', () => {
  function makeStore(): ITaskIndexStore {
    const db = new (Database as BetterSqlite3Ctor)(':memory:');
    db.exec(migration0029);
    const connection = { db } as unknown as SqliteConnectionService;
    return new SqliteTaskIndexStore(makeLogger(), connection);
  }

  runContract(makeStore);
});

describe('store parity (InMemory vs SQLite)', () => {
  (Database ? it : it.skip)(
    'both impls return identical listByWorkspace output',
    () => {
      const mem = new InMemoryTaskIndexStore(makeLogger());
      const db = new (Database as BetterSqlite3Ctor)(':memory:');
      db.exec(migration0029);
      const sqlite = new SqliteTaskIndexStore(makeLogger(), {
        db,
      } as unknown as SqliteConnectionService);

      mem.replaceWorkspace(ROOT, SEED, 7);
      sqlite.replaceWorkspace(ROOT, SEED, 7);

      expect(sqlite.listByWorkspace(ROOT)).toEqual(mem.listByWorkspace(ROOT));
      expect(sqlite.getMeta(ROOT)?.excludedCount).toBe(
        mem.getMeta(ROOT)?.excludedCount,
      );
    },
  );
});
