import type { JsonlReaderService } from '@ptah-extension/agent-sdk';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type {
  SqliteDatabase,
  SqliteDatabaseFactory,
  SqliteStatement,
} from '@ptah-extension/persistence-sqlite';
import type { CuratorRateLimitService } from '@ptah-extension/agent-sdk';
import type { Logger } from '@ptah-extension/vscode-core';
import * as path from 'node:path';
import { resolveOpener } from './queue/queue-db.test-support';

type TranscriptMessage = {
  type: 'user' | 'assistant';
  message: { role: 'user' | 'assistant'; content: unknown };
};

type QueueDatabase = ReturnType<NonNullable<ReturnType<typeof resolveOpener>>>;

export interface ReachabilityDatabaseFactory {
  binding: 'better-sqlite3' | 'node:sqlite';
  factory: SqliteDatabaseFactory;
}

function adaptStatement(statement: ReturnType<QueueDatabase['prepare']>): SqliteStatement {
  return {
    run: (...params: unknown[]) =>
      statement.run(...params) as ReturnType<SqliteStatement['run']>,
    get: (...params: unknown[]) => statement.get(...params),
    all: (...params: unknown[]) => statement.all(...params),
    iterate: (...params: unknown[]) =>
      statement.all(...params)[Symbol.iterator](),
  };
}

/**
 * A1 adapter. The shared queue opener deliberately exposes only the store
 * subset. node:sqlite therefore needs the lifecycle surface used by the real
 * SqliteConnectionService; better-sqlite3 already has it and is passed through.
 */
function adaptNodeDatabase(raw: QueueDatabase): SqliteDatabase {
  let open = true;
  const pragma = (text: string, options?: { simple?: boolean }): unknown => {
    if (/=/.test(text) || /^wal_checkpoint\(/i.test(text)) {
      raw.exec(`PRAGMA ${text}`);
      return undefined;
    }
    const rows = raw.prepare(`PRAGMA ${text}`).all() as Array<
      Record<string, unknown>
    >;
    if (!options?.simple) return rows;
    const first = rows[0];
    return first ? Object.values(first)[0] : undefined;
  };
  return {
    exec: (sql: string) => raw.exec(sql),
    prepare: (sql: string) => adaptStatement(raw.prepare(sql)),
    pragma,
    close: () => {
      if (!open) return;
      raw.close();
      open = false;
    },
    get open() {
      return open;
    },
    get inTransaction() {
      return false;
    },
    transaction: <T extends (...args: unknown[]) => unknown>(fn: T): T =>
      function (this: unknown, ...args: Parameters<T>): ReturnType<T> {
        raw.exec('BEGIN IMMEDIATE');
        try {
          const result = fn.apply(this, args) as ReturnType<T>;
          raw.exec('COMMIT');
          return result;
        } catch (error: unknown) {
          raw.exec('ROLLBACK');
          throw error;
        }
      } as T,
  };
}

export function resolveReachabilityDatabaseFactory(): ReachabilityDatabaseFactory | null {
  const opener = resolveOpener();
  if (!opener) return null;
  const probe = opener(':memory:');
  const isBetterSqlite =
    typeof (probe as unknown as { pragma?: unknown }).pragma === 'function';
  probe.close();
  return {
    binding: isBetterSqlite ? 'better-sqlite3' : 'node:sqlite',
    factory: (file: string) => {
      const raw = opener(file);
      return isBetterSqlite
        ? (raw as unknown as SqliteDatabase)
        : adaptNodeDatabase(raw);
    },
  };
}

const text = (role: 'user' | 'assistant', value: string): TranscriptMessage => ({
  type: role,
  message: { role, content: [{ type: 'text', text: value }] },
});

const tool = (name: string, input: Record<string, unknown>): TranscriptMessage => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'tool_use', name, input }] },
});

export function codeWorkTranscript(workspaceRoot: string): TranscriptMessage[] {
  return [
    text('user', `Update ${workspaceRoot}/src/worker.ts and verify the workspace.`),
    tool('Edit', { file_path: `${workspaceRoot}/src/worker.ts` }),
    text('user', `The edit under ${workspaceRoot} completed.`),
    tool('Bash', { command: `cd ${workspaceRoot} && npx nx test worker` }),
    text('assistant', `The tests for ${workspaceRoot} pass.`),
  ];
}

export function chatTranscript(workspaceRoot: string): TranscriptMessage[] {
  const long = `Discussing architecture in ${workspaceRoot}. ${'conversation only '.repeat(70)}`;
  return Array.from({ length: 8 }, (_, index) =>
    text(index % 2 === 0 ? 'user' : 'assistant', `${long} turn ${index + 1}`),
  );
}

export function makeJsonlReader(
  transcripts: ReadonlyMap<string, TranscriptMessage[]>,
): JsonlReaderService {
  return {
    findSessionsDirectory: jest.fn(async (workspaceRoot: string) =>
      path.join(workspaceRoot, '.sessions'),
    ),
    readJsonlMessages: jest.fn(async (filePath: string) => {
      const sessionId = path.basename(filePath, '.jsonl');
      const transcript = transcripts.get(sessionId);
      if (!transcript) throw new Error(`missing fixture transcript: ${sessionId}`);
      return transcript;
    }),
  } as unknown as JsonlReaderService;
}

export function makeWorkspace(
  root: string,
  settings: ReadonlyMap<string, unknown>,
): IWorkspaceProvider {
  return {
    getWorkspaceFolders: () => [root],
    getWorkspaceRoot: () => root,
    getConfiguration: <T>(_section: string, key: string, fallback?: T) =>
      (settings.has(key) ? settings.get(key) : fallback) as T | undefined,
    setConfiguration: jest.fn(async () => undefined),
    onDidChangeConfiguration: jest.fn() as never,
    onDidChangeWorkspaceFolders: jest.fn() as never,
  };
}

export function makeRateLimit(): CuratorRateLimitService {
  return {
    tryAcquire: jest.fn(() => ({ allowed: true })),
    refund: jest.fn(),
    snapshot: jest.fn(() => null),
  } as unknown as CuratorRateLimitService;
}

export function makeReachabilityLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}
