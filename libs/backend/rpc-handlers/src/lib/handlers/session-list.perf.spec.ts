/**
 * AC1 — `session:list` p95 < 200 ms over 500 seeded sessions (TASK_2026_580).
 *
 * Real `SessionOrganizationStore` and `SessionOrganizationService` on a temp
 * SQLite database file with migrations 1..50 applied, seeded with 500
 * organization rows (mixed status and priority, archived included), 250 task
 * links and 100 PR links. The metadata store is a fake returning the 500
 * sessions. The real `session:list` handler runs 20 times with the sidebar's
 * filtered query; the spec asserts p95 < 200 ms and the exact `total`.
 *
 * The transcript probe of `~/.claude/projects` is stubbed (no projects
 * directory) so the measurement does not depend on the developer's disk.
 *
 * better-sqlite3 is tried first, then Node's built-in `node:sqlite`. When
 * NEITHER loads, the suite FAILS — it never skips.
 */
import 'reflect-metadata';

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import type { PathLike } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { performance } from 'perf_hooks';

jest.mock('fs/promises', () => ({
  ...jest.requireActual('fs/promises'),
  access: jest.fn(),
  readdir: jest.fn(),
}));

import {
  MIGRATIONS,
  type SqliteConnectionService,
} from '@ptah-extension/persistence-sqlite';
import {
  normalizeWorkspaceRoot,
  type IFileSystemProvider,
  type IPlatformInfo,
  type IOutputChannel,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import {
  SessionOrganizationService,
  SessionOrganizationStore,
  type SessionOrganizationMetadataReader,
} from '@ptah-extension/session-organization';
import type {
  SessionMetadataStore,
  SessionStatsReaderService,
  SdkAgentAdapter,
} from '@ptah-extension/agent-sdk';
import type {
  Logger,
  RpcHandler,
  SentryService,
} from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  createMockSentryService,
  type MockRpcHandler,
} from '@ptah-extension/vscode-core/testing';
import {
  SESSION_PRIORITIES,
  SESSION_WORKFLOW_STATUSES,
  type SessionPriority,
  type SessionWorkflowStatus,
} from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';

import { SessionRpcHandlers } from './session-rpc.handlers';

interface TestStatement {
  run(...params: unknown[]): { changes: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

interface TestDatabase {
  exec(sql: string): void;
  prepare(sql: string): TestStatement;
  close(): void;
  transaction?: (fn: (...args: unknown[]) => unknown) => unknown;
}

type DbOpener = (file: string) => TestDatabase;

function resolveOpener(): DbOpener | null {
  try {
    const Database = require('better-sqlite3') as new (
      file: string,
    ) => TestDatabase;
    new Database(':memory:').close();
    return (file) => new Database(file);
  } catch {
    // Electron's native ABI may not load in Jest; fall through to node:sqlite.
  }
  try {
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (file: string) => TestDatabase;
    };
    new DatabaseSync(':memory:').close();
    return (file) => new DatabaseSync(file);
  } catch {
    return null;
  }
}

/** better-sqlite3's `transaction` for the node:sqlite binding, which lacks it. */
function withTransaction(db: TestDatabase): TestDatabase {
  if (typeof db.transaction === 'function') return db;
  return {
    exec: (sql: string) => db.exec(sql),
    prepare: (sql: string) => db.prepare(sql),
    close: () => db.close(),
    transaction:
      (fn: (...args: unknown[]) => unknown) =>
      (...args: unknown[]) => {
        db.exec('BEGIN');
        try {
          const out = fn(...args);
          db.exec('COMMIT');
          return out;
        } catch (error: unknown) {
          db.exec('ROLLBACK');
          throw error;
        }
      },
  };
}

const opener = resolveOpener();

const WORKSPACE = '/perf/workspace';
const ROOT = normalizeWorkspaceRoot(WORKSPACE);
const SESSION_COUNT = 500;
const TASK_LINK_COUNT = 250;
const PR_LINK_COUNT = 100;
const RUNS = 20;
const P95_BUDGET_MS = 200;
const QUERY = {
  status: ['active', 'waiting'] as SessionWorkflowStatus[],
  priority: ['urgent', 'high'] as SessionPriority[],
  sort: 'priority' as const,
};

function sessionId(i: number): string {
  return `0d6f1c2a-1111-4a6b-8c1d-${i.toString(16).padStart(12, '0')}`;
}

interface SeedRow {
  sessionId: string;
  status: SessionWorkflowStatus;
  priority: SessionPriority;
}

/** Deterministic mix: every status (archived included) crossed with every priority. */
function seedRowFor(i: number): SeedRow {
  return {
    sessionId: sessionId(i),
    status: SESSION_WORKFLOW_STATUSES[i % SESSION_WORKFLOW_STATUSES.length],
    priority:
      SESSION_PRIORITIES[
        Math.floor(i / SESSION_WORKFLOW_STATUSES.length) %
          SESSION_PRIORITIES.length
      ],
  };
}

describe('session:list AC1 performance (real SQLite store)', () => {
  let tmpDir: string | undefined;
  let db: TestDatabase | undefined;
  let rpcHandler: MockRpcHandler;
  const seed = Array.from({ length: SESSION_COUNT }, (_, i) => seedRowFor(i));

  beforeAll(() => {
    if (!opener) {
      throw new Error(
        'No SQLite binding loaded (neither better-sqlite3 nor node:sqlite)',
      );
    }
    (fs.access as jest.Mock).mockRejectedValue(new Error('ENOENT'));
    (fs.readdir as jest.Mock).mockRejectedValue(new Error('ENOENT'));

    tmpDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'ptah-ac1-'));
    db = withTransaction(opener(path.join(tmpDir, 'ptah.db')));
    // Seeding speed only; the measured reads do not depend on durability.
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = OFF;');
    for (const migration of MIGRATIONS.filter((m) => m.version <= 50)) {
      if (migration.sql) db.exec(migration.sql);
    }

    const output = { appendLine: jest.fn() };
    const store = new SessionOrganizationStore(
      // Open AND migrated: the store reads as ready only once a migration run
      // has finished (`lastMigrationVersion > 0`).
      {
        db,
        isOpen: true,
        lastMigrationVersion: 50,
      } as unknown as SqliteConnectionService,
      output as unknown as IOutputChannel,
    );
    seed.forEach((row, i) => {
      store.upsertOrganization(
        ROOT,
        row.sessionId,
        { status: row.status, priority: row.priority, pinned: i % 50 === 0 },
        1_000 + i,
      );
    });
    for (let i = 0; i < TASK_LINK_COUNT; i++) {
      store.linkTask(
        ROOT,
        sessionId(i),
        {
          taskId: `TASK_2026_${String(i % 40).padStart(3, '0')}`,
          role: 'primary',
          source: 'user',
        },
        2_000 + i,
      );
    }
    for (let i = 0; i < PR_LINK_COUNT; i++) {
      store.addPrLink(
        ROOT,
        sessionId(i * 5),
        {
          url: `https://github.com/acme/repo/pull/${i + 1}`,
          number: i + 1,
          repo: 'acme/repo',
          state: 'open',
          source: 'agent',
        },
        3_000 + i,
      );
    }

    const metadataRows = seed
      .map((row, i) => ({
        sessionId: row.sessionId,
        name: `Session ${i}`,
        workspaceId: WORKSPACE,
        createdAt: 10_000 + i,
        lastActiveAt: 20_000 + i,
        totalCost: 0,
        totalTokens: { input: 0, output: 0 },
      }))
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
    const metadataStore = {
      get: jest.fn(
        async (id: string) =>
          metadataRows.find((r) => r.sessionId === id) ?? null,
      ),
      getForWorkspace: jest.fn(async () => metadataRows),
    };
    const organization = new SessionOrganizationService(
      store,
      metadataStore as unknown as SessionOrganizationMetadataReader,
      output as unknown as IOutputChannel,
    );
    const taskIndex = {
      list: jest.fn(async () => ({
        tasks: Array.from({ length: 40 }, (_, i) => ({
          id: `TASK_2026_${String(i).padStart(3, '0')}`,
        })),
        excluded: [],
        excludedCount: 0,
        specsDirExists: true,
      })),
    };

    rpcHandler = createMockRpcHandler();
    const handlers = new SessionRpcHandlers(
      createMockLogger() as unknown as Logger,
      rpcHandler as unknown as RpcHandler,
      metadataStore as unknown as SessionMetadataStore,
      {} as SessionStatsReaderService,
      createMockSentryService() as unknown as SentryService,
      createMockWorkspaceProvider({
        folders: [WORKSPACE],
      }) as unknown as IWorkspaceProvider,
      {} as IFileSystemProvider,
      {} as IPlatformInfo,
      {} as SdkAgentAdapter,
      {} as never,
      { get: jest.fn().mockReturnValue(undefined) } as never,
      {} as never,
      {} as never,
      {} as never,
      null,
      organization,
      taskIndex as never,
    );
    handlers.register();
  });

  afterAll(() => {
    db?.close();
    if (tmpDir) {
      fsSync.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 3 });
    }
  });

  it('has a SQLite binding to run against (fails instead of skipping)', () => {
    expect(opener).not.toBeNull();
  });

  it(`answers the filtered priority query with p95 < ${P95_BUDGET_MS} ms over ${RUNS} runs`, async () => {
    const statuses = new Set<string>(QUERY.status);
    const priorities = new Set<string>(QUERY.priority);
    const expectedTotal = seed.filter(
      (r) => statuses.has(r.status) && priorities.has(r.priority),
    ).length;
    expect(expectedTotal).toBeGreaterThan(0);

    const durations: number[] = [];
    for (let run = 0; run < RUNS; run++) {
      const startedAt = performance.now();
      const response = await rpcHandler.handleMessage({
        method: 'session:list',
        params: { workspacePath: WORKSPACE, limit: 50, offset: 0, ...QUERY },
        correlationId: `perf-${run}`,
      });
      durations.push(performance.now() - startedAt);

      expect(response.success).toBe(true);
      const data = response.data as {
        total: number;
        organizationAvailable?: boolean;
        sessions: Array<{ organization?: { priority: string } }>;
      };
      expect(data.organizationAvailable).toBe(true);
      expect(data.total).toBe(expectedTotal);
      expect(data.sessions).toHaveLength(Math.min(50, expectedTotal));
    }

    durations.sort((a, b) => a - b);
    const p95 = durations[Math.ceil(0.95 * durations.length) - 1];
    expect(p95).toBeLessThan(P95_BUDGET_MS);
  });
});
