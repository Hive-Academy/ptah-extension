import 'reflect-metadata';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IEmbedder } from '@ptah-extension/persistence-sqlite';
import {
  SqliteConnectionService,
  VecStatusService,
} from '@ptah-extension/persistence-sqlite';
import { CodeSymbolStore, type CodeSymbolInsert } from './code-symbol.store';

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-code-symbol-test-'));
  return path.join(dir, 'ptah.db');
}

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function makeDeterministicEmbedder(dim = 384): IEmbedder {
  return {
    dim,
    modelId: 'test/deterministic',
    embed: jest.fn(async (texts: readonly string[]) =>
      texts.map((text, i) => {
        const arr = new Float32Array(dim);
        const seed = text.length + i;
        for (let j = 0; j < dim; j++) {
          arr[j] = ((seed + j) % 13) / 13;
        }
        return arr;
      }),
    ),
    dispose: jest.fn(async () => undefined),
  };
}

function makeEntry(over: Partial<CodeSymbolInsert> = {}): CodeSymbolInsert {
  return {
    workspaceRoot: '/test/ws',
    filePath: '/test/ws/src/a.ts',
    kind: 'function',
    symbolName: 'foo',
    subject: 'code:/test/ws/src/a.ts#foo',
    text: 'function foo() { return 1; }',
    tokenCount: 8,
    ...over,
  };
}

describe('CodeSymbolStore (native-gated)', () => {
  let nativeAvailable = false;
  try {
    require.resolve('better-sqlite3');
    require.resolve('sqlite-vec');
    const Database = require('better-sqlite3') as new (file: string) => {
      close(): void;
    };
    const probe = new Database(':memory:');
    probe.close();
    nativeAvailable = true;
  } catch {
    nativeAvailable = false;
  }

  const maybe = nativeAvailable ? it : it.skip;

  async function bootstrap(): Promise<{
    service: SqliteConnectionService;
    store: CodeSymbolStore;
    embedder: IEmbedder;
    dbPath: string;
  }> {
    const dbPath = makeTempDbPath();
    const logger = makeLogger();
    const service = new SqliteConnectionService(dbPath, logger);
    await service.openAndMigrate();
    expect(service.vecExtensionLoaded).toBe(true);
    const embedder = makeDeterministicEmbedder();
    const vecStatus = new VecStatusService(logger, service);
    const store = new CodeSymbolStore(logger, service, embedder, vecStatus);
    return { service, store, embedder, dbPath };
  }

  maybe(
    'insertBatch writes symbol + vec rows with matching rowid',
    async () => {
      const { service, store } = await bootstrap();
      try {
        const entries: CodeSymbolInsert[] = [
          makeEntry({
            symbolName: 'foo',
            subject: 'code:/test/ws/src/a.ts#foo',
          }),
          makeEntry({
            symbolName: 'bar',
            subject: 'code:/test/ws/src/a.ts#bar',
            text: 'function bar() { return 2; }',
          }),
        ];

        await store.insertBatch(entries);

        const symbolCount = (
          service.db
            .prepare('SELECT COUNT(*) AS n FROM code_symbols')
            .get() as { n: number }
        ).n;
        const vecCount = (
          service.db
            .prepare('SELECT COUNT(*) AS n FROM code_symbols_vec')
            .get() as { n: number }
        ).n;
        expect(symbolCount).toBe(2);
        expect(vecCount).toBe(2);

        const rowids = service.db
          .prepare(
            'SELECT s.rowid AS srowid, v.rowid AS vrowid FROM code_symbols s LEFT JOIN code_symbols_vec v ON v.rowid = s.rowid ORDER BY s.rowid',
          )
          .all() as Array<{ srowid: number; vrowid: number | null }>;
        expect(rowids).toHaveLength(2);
        for (const row of rowids) {
          expect(row.vrowid).toBe(row.srowid);
        }
      } finally {
        service.close();
      }
    },
  );

  maybe(
    're-running insertBatch for same (workspace_root, subject) updates without zeroing counts',
    async () => {
      const { service, store } = await bootstrap();
      try {
        const first = makeEntry({
          symbolName: 'foo',
          subject: 'code:/test/ws/src/a.ts#foo',
          text: 'first body',
          tokenCount: 3,
        });
        await store.insertBatch([first]);

        const firstSymbolRowid = (
          service.db
            .prepare(
              'SELECT rowid FROM code_symbols WHERE workspace_root = ? AND subject = ?',
            )
            .get(first.workspaceRoot, first.subject) as { rowid: number }
        ).rowid;

        const second: CodeSymbolInsert = {
          ...first,
          text: 'second body — updated',
          tokenCount: 9,
        };
        await store.insertBatch([second]);

        const symbolCount = (
          service.db
            .prepare('SELECT COUNT(*) AS n FROM code_symbols')
            .get() as { n: number }
        ).n;
        const vecCount = (
          service.db
            .prepare('SELECT COUNT(*) AS n FROM code_symbols_vec')
            .get() as { n: number }
        ).n;
        expect(symbolCount).toBe(1);
        expect(vecCount).toBe(1);

        const persistedText = (
          service.db
            .prepare(
              'SELECT text FROM code_symbols WHERE workspace_root = ? AND subject = ?',
            )
            .get(first.workspaceRoot, first.subject) as { text: string }
        ).text;
        expect(persistedText).toBe('second body — updated');

        const updatedSymbolRowid = (
          service.db
            .prepare(
              'SELECT rowid FROM code_symbols WHERE workspace_root = ? AND subject = ?',
            )
            .get(first.workspaceRoot, first.subject) as { rowid: number }
        ).rowid;
        expect(updatedSymbolRowid).toBe(firstSymbolRowid);

        const vecRowid = (
          service.db.prepare('SELECT rowid FROM code_symbols_vec').get() as {
            rowid: number;
          }
        ).rowid;
        expect(vecRowid).toBe(updatedSymbolRowid);
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'when vecExtensionLoaded is false, still inserts code_symbols rows',
    async () => {
      const dbPath = makeTempDbPath();
      const logger = makeLogger();
      const service = new SqliteConnectionService(dbPath, logger);
      await service.openAndMigrate();
      Object.defineProperty(service, 'vecExtensionLoaded', {
        configurable: true,
        get: () => false,
      });
      Object.defineProperty(service, 'vecLoadDiagnostic', {
        configurable: true,
        get: () => ({
          ok: false,
          reason: 'binary-missing',
          electronVersion: 'unknown',
          processArch: process.arch,
          processPlatform: process.platform,
        }),
      });
      const embedder = makeDeterministicEmbedder();
      const vecStatus = new VecStatusService(logger, service);
      const store = new CodeSymbolStore(logger, service, embedder, vecStatus);
      try {
        await store.insertBatch([
          makeEntry({
            symbolName: 'baz',
            subject: 'code:/test/ws/src/a.ts#baz',
          }),
        ]);

        const symbolCount = (
          service.db
            .prepare('SELECT COUNT(*) AS n FROM code_symbols')
            .get() as { n: number }
        ).n;
        expect(symbolCount).toBe(1);
        expect(embedder.embed).not.toHaveBeenCalled();
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'rolls back code_symbols when vec INSERT throws (transaction contract preserved)',
    async () => {
      const { service, store } = await bootstrap();
      try {
        await store.insertBatch([
          makeEntry({
            symbolName: 'pre',
            subject: 'code:/test/ws/src/a.ts#pre',
          }),
        ]);
        const before = (
          service.db
            .prepare('SELECT COUNT(*) AS n FROM code_symbols')
            .get() as { n: number }
        ).n;
        expect(before).toBe(1);

        const dbRef = service.db;
        const originalPrepare = dbRef.prepare.bind(dbRef);
        const prepareSpy = jest
          .spyOn(dbRef, 'prepare')
          .mockImplementation((sql: string) => {
            const stmt = originalPrepare(sql);
            if (/INTO code_symbols_vec/i.test(sql)) {
              return {
                ...stmt,
                run: () => {
                  throw new Error(
                    'Only integers are allows for primary key values on code_symbols_vec',
                  );
                },
              } as unknown as ReturnType<typeof originalPrepare>;
            }
            return stmt;
          });

        await expect(
          store.insertBatch([
            makeEntry({
              symbolName: 'should_roll_back',
              subject: 'code:/test/ws/src/a.ts#should_roll_back',
            }),
          ]),
        ).rejects.toThrow(/Only integers are allows/);

        prepareSpy.mockRestore();

        const after = (
          service.db
            .prepare('SELECT COUNT(*) AS n FROM code_symbols')
            .get() as { n: number }
        ).n;
        expect(after).toBe(1);
      } finally {
        service.close();
      }
    },
  );
});
