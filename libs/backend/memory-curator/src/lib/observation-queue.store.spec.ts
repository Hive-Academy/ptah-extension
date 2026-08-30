import 'reflect-metadata';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  MIGRATIONS,
  SqliteConnectionService,
} from '@ptah-extension/persistence-sqlite';
import {
  OBSERVATION_TOOL_INPUT_MAX_BYTES,
  OBSERVATION_TOOL_RESPONSE_MAX_BYTES,
  ObservationQueueStore,
  type ObservationQueueInsert,
} from './observation-queue.store';

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function makeTempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-obs-queue-test-'));
  return path.join(dir, 'ptah.db');
}

export interface RawStatement {
  run(...params: unknown[]): { changes: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  iterate(...params: unknown[]): IterableIterator<unknown>;
}

interface RawDb {
  exec(sql: string): void;
  prepare(sql: string): RawStatement;
  close(): void;
}

/**
 * better-sqlite3 when its native binary matches the running Node ABI, the
 * built-in `node:sqlite` binding otherwise. Mirrors
 * `observation-queue.store.rekey.spec.ts` — a spec whose subject is a SQLite
 * access pattern should not go dark because a prebuilt `.node` is stale.
 */
function resolveOpener(): ((file: string) => RawDb) | null {
  try {
    const Database = require('better-sqlite3') as new (file: string) => RawDb;
    new Database(':memory:').close();
    return (file) => new Database(file);
  } catch {
    // Falls through to the built-in binding.
  }
  try {
    const { DatabaseSync } = require('node:sqlite') as {
      DatabaseSync: new (file: string) => RawDb;
    };
    new DatabaseSync(':memory:').close();
    return (file) => new DatabaseSync(file);
  } catch {
    return null;
  }
}

/**
 * Complete a raw handle so it satisfies `SqliteDatabase`.
 *
 * `ObservationQueueStore.flush` writes its batch through `db.transaction(...)`,
 * which better-sqlite3 provides and `node:sqlite`'s `DatabaseSync` does not.
 */
function asSqliteDatabase(db: RawDb): unknown {
  const native = db as unknown as {
    transaction?: (fn: (...args: unknown[]) => unknown) => unknown;
  };
  if (typeof native.transaction === 'function') return db;
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

describe('ObservationQueueStore (native-gated)', () => {
  let nativeAvailable = false;
  try {
    require.resolve('better-sqlite3');
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
    store: ObservationQueueStore;
  }> {
    const dbPath = makeTempDbPath();
    const logger = makeLogger();
    const service = new SqliteConnectionService(dbPath, logger);
    await service.openAndMigrate();
    const store = new ObservationQueueStore(logger, service);
    return { service, store };
  }

  maybe(
    'insert + drainForSession returns rows in capture order, oldest first',
    async () => {
      const { service, store } = await bootstrap();
      try {
        const baseRow: ObservationQueueInsert = {
          sessionId: 'session-α',
          workspaceRoot: '/ws/A',
          kind: 'tool-use',
          toolName: 'Read',
        };
        store.enqueue(baseRow);
        store.enqueue({ ...baseRow, kind: 'assistant-turn', toolName: null });
        store.enqueue({ ...baseRow, kind: 'user-prompt', toolName: null });

        // No timer wait: `drainForSession` flushes the pending batch first, so
        // batching is invisible to every reader (TASK_2026_323 B2).
        const drained = store.drainForSession('session-α');
        expect(drained.length).toBe(3);
        expect(drained[0].kind).toBe('tool-use');
        expect(drained[1].kind).toBe('assistant-turn');
        expect(drained[2].kind).toBe('user-prompt');
        expect(store.pendingCount).toBe(0);
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'drainForSession respects the limit clamp (max 2000, min 1)',
    async () => {
      const { service, store } = await bootstrap();
      try {
        for (let i = 0; i < 5; i++) {
          store.enqueue({
            sessionId: 'session-β',
            workspaceRoot: null,
            kind: 'tool-use',
          });
        }
        expect(store.drainForSession('session-β', 2).length).toBe(2);
        expect(store.drainForSession('session-β', 0).length).toBe(1);
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'markProcessed sets processed_at and excludes rows from subsequent drains',
    async () => {
      const { service, store } = await bootstrap();
      try {
        store.enqueue({
          sessionId: 'session-γ',
          workspaceRoot: '/ws/B',
          kind: 'tool-use',
        });
        store.enqueue({
          sessionId: 'session-γ',
          workspaceRoot: '/ws/B',
          kind: 'assistant-turn',
        });

        const drained = store.drainForSession('session-γ');
        expect(drained.length).toBe(2);
        store.markProcessed(drained.map((r) => r.id));

        expect(store.drainForSession('session-γ').length).toBe(0);
        expect(store.countUnprocessed('session-γ')).toBe(0);
      } finally {
        service.close();
      }
    },
  );

  maybe('truncates tool_response_text to 16 KB at insert', async () => {
    const { service, store } = await bootstrap();
    try {
      const oversized = 'x'.repeat(OBSERVATION_TOOL_RESPONSE_MAX_BYTES + 4096);
      store.enqueue({
        sessionId: 'session-δ',
        workspaceRoot: null,
        kind: 'tool-use',
        toolName: 'Read',
        toolResponseText: oversized,
      });
      const [row] = store.drainForSession('session-δ');
      const text = row.toolResponseText ?? '';
      const byteLen = Buffer.byteLength(text, 'utf8');
      expect(byteLen).toBeLessThanOrEqual(OBSERVATION_TOOL_RESPONSE_MAX_BYTES);
      expect(byteLen).toBeGreaterThan(0);
    } finally {
      service.close();
    }
  });

  maybe(
    'countUnprocessed reports only unprocessed rows for the session',
    async () => {
      const { service, store } = await bootstrap();
      try {
        store.enqueue({
          sessionId: 'session-ε',
          workspaceRoot: null,
          kind: 'tool-use',
        });
        store.enqueue({
          sessionId: 'session-ε',
          workspaceRoot: null,
          kind: 'tool-use',
        });
        expect(store.countUnprocessed('session-ε')).toBe(2);
        const drained = store.drainForSession('session-ε');
        store.markProcessed([drained[0].id]);
        expect(store.countUnprocessed('session-ε')).toBe(1);
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'peekForSession returns most-recent rows regardless of processed_at and does NOT mark processed',
    async () => {
      const { service, store } = await bootstrap();
      try {
        store.enqueue({
          sessionId: 'session-peek',
          workspaceRoot: '/ws',
          kind: 'tool-use',
          toolName: 'Read',
        });
        store.enqueue({
          sessionId: 'session-peek',
          workspaceRoot: '/ws',
          kind: 'assistant-turn',
        });
        const drained = store.drainForSession('session-peek');
        store.markProcessed(drained.map((r) => r.id));

        const peeked = store.peekForSession('session-peek', 10);
        expect(peeked.length).toBe(2);
        expect(peeked[0].capturedAt).toBeGreaterThanOrEqual(
          peeked[peeked.length - 1].capturedAt,
        );

        const stillUnprocessed = store.countUnprocessed('session-peek');
        expect(stillUnprocessed).toBe(0);

        const reDrained = store.drainForSession('session-peek');
        expect(reDrained.length).toBe(0);
      } finally {
        service.close();
      }
    },
  );

  maybe('peekForSession clamps limit between 1 and 500', async () => {
    const { service, store } = await bootstrap();
    try {
      for (let i = 0; i < 3; i++) {
        store.enqueue({
          sessionId: 'session-clamp',
          workspaceRoot: null,
          kind: 'tool-use',
        });
      }
      expect(store.peekForSession('session-clamp', 0).length).toBe(1);
      expect(store.peekForSession('session-clamp', 2).length).toBe(2);
    } finally {
      service.close();
    }
  });

  maybe(
    'purgeOlderThan only deletes processed rows older than the threshold',
    async () => {
      const { service, store } = await bootstrap();
      try {
        store.enqueue({
          sessionId: 'session-ζ',
          workspaceRoot: null,
          kind: 'tool-use',
        });
        store.enqueue({
          sessionId: 'session-ζ',
          workspaceRoot: null,
          kind: 'tool-use',
        });
        const drained = store.drainForSession('session-ζ');
        store.markProcessed([drained[0].id]);
        const purged = store.purgeOlderThan(Date.now() + 60_000);
        expect(purged).toBe(1);
        expect(store.countUnprocessed('session-ζ')).toBe(1);
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'onCapture fires for every successful insert and dispose detaches',
    async () => {
      const { service, store } = await bootstrap();
      try {
        const events: Array<{
          sessionId: string;
          workspaceRoot: string | null;
          kind: string;
          timestamp: number;
        }> = [];
        const sub = store.onCapture((evt) => {
          events.push({
            sessionId: evt.sessionId,
            workspaceRoot: evt.workspaceRoot,
            kind: evt.kind,
            timestamp: evt.timestamp,
          });
        });
        const before = Date.now();
        store.enqueue({
          sessionId: 'session-η',
          workspaceRoot: '/ws/H',
          kind: 'file-read',
          toolName: 'Read',
        });
        store.enqueue({
          sessionId: 'session-η',
          workspaceRoot: '/ws/H',
          kind: 'tool-use',
          toolName: 'Bash',
        });
        // Capture events are published from `flush`, after the batch commits —
        // the event's contract is "this row is in the table".
        expect(events.length).toBe(0);
        store.flush();
        expect(events.length).toBe(2);
        expect(events[0]).toMatchObject({
          sessionId: 'session-η',
          workspaceRoot: '/ws/H',
          kind: 'file-read',
        });
        expect(events[1].kind).toBe('tool-use');
        expect(events[0].timestamp).toBeGreaterThanOrEqual(before);
        sub.dispose();
        store.enqueue({
          sessionId: 'session-η',
          workspaceRoot: '/ws/H',
          kind: 'user-prompt',
        });
        store.flush();
        expect(events.length).toBe(2);
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'onCapture listener errors are isolated; other listeners still fire',
    async () => {
      const { service, store } = await bootstrap();
      try {
        const seen: string[] = [];
        store.onCapture(() => {
          throw new Error('listener-fail');
        });
        store.onCapture((evt) => {
          seen.push(evt.kind);
        });
        store.enqueue({
          sessionId: 'session-θ',
          workspaceRoot: null,
          kind: 'commit',
        });
        store.flush();
        expect(seen).toEqual(['commit']);
      } finally {
        service.close();
      }
    },
  );

  /**
   * TASK_2026_295 — a row with an empty session id is refused, not written.
   *
   * Such a row is un-drainable and un-reapable by construction: every read
   * filters `WHERE session_id = ?` and nothing queries `''`, so it is never
   * drained, never marked processed, and `purgeOlderThan` only deletes rows
   * that WERE processed. It would sit in the table forever while
   * `countUnprocessed('')` kept counting it.
   */
  maybe(
    'refuses a row with an empty sessionId — nothing reaches the table',
    async () => {
      const { service, store } = await bootstrap();
      try {
        const captured: string[] = [];
        store.onCapture((evt) => captured.push(evt.kind));

        store.enqueue({
          sessionId: '',
          workspaceRoot: '/ws/A',
          kind: 'tool-use',
          toolName: 'Read',
        });
        store.enqueue({
          sessionId: '   ',
          workspaceRoot: '/ws/A',
          kind: 'assistant-turn',
        });

        const total = service.db
          .prepare(`SELECT COUNT(*) AS n FROM observation_queue`)
          .get() as { n: number };
        expect(total.n).toBe(0);
        expect(store.countUnprocessed('')).toBe(0);
        expect(store.drainForSession('')).toEqual([]);
        expect(store.peekForSession('')).toEqual([]);
        // No capture event either — a refused row is not an observation.
        expect(captured).toEqual([]);
      } finally {
        service.close();
      }
    },
  );

  maybe('still writes a row for a real sessionId (control)', async () => {
    const { service, store } = await bootstrap();
    try {
      store.enqueue({
        sessionId: 'session-ι',
        workspaceRoot: '/ws/A',
        kind: 'tool-use',
        toolName: 'Read',
      });
      expect(store.countUnprocessed('session-ι')).toBe(1);
    } finally {
      service.close();
    }
  });
});

/**
 * TASK_2026_295 — the same refusal, pinned WITHOUT the native binary.
 *
 * The round-trip block above is gated on `better-sqlite3` loading, which it
 * does not do under every runner. The guard is the one thing here that must
 * never regress unobserved, so it is also asserted against a statement stub:
 * an empty session id means no statement is ever run and no capture event is
 * published.
 */
describe('ObservationQueueStore — empty sessionId is refused (TASK_2026_295)', () => {
  function makeStubbedStore(): {
    store: ObservationQueueStore;
    runMock: jest.Mock;
    captured: string[];
  } {
    const runMock = jest.fn();
    const connection = {
      db: {
        prepare: jest.fn(() => ({ run: runMock, all: jest.fn(() => []) })),
        transaction: (fn: () => unknown) => fn,
      },
    } as unknown as SqliteConnectionService;
    const store = new ObservationQueueStore(makeLogger(), connection);
    const captured: string[] = [];
    store.onCapture((evt) => captured.push(evt.kind));
    return { store, runMock, captured };
  }

  it('runs no statement and emits no capture event for an empty sessionId', () => {
    const { store, runMock, captured } = makeStubbedStore();
    store.enqueue({
      sessionId: '',
      workspaceRoot: '/ws/A',
      kind: 'tool-use',
      toolName: 'Read',
    });
    store.flush();
    expect(runMock).not.toHaveBeenCalled();
    expect(captured).toEqual([]);
  });

  it('runs no statement for a whitespace-only sessionId', () => {
    const { store, runMock, captured } = makeStubbedStore();
    store.enqueue({
      sessionId: '  ',
      workspaceRoot: null,
      kind: 'assistant-turn',
    });
    store.flush();
    expect(runMock).not.toHaveBeenCalled();
    expect(captured).toEqual([]);
  });

  it('writes and publishes for a real sessionId (control)', () => {
    const { store, runMock, captured } = makeStubbedStore();
    store.enqueue({
      sessionId: '8f1c7d2e-2a5b-4b6e-9d3f-0c1a2b3c4d5e',
      workspaceRoot: '/ws/A',
      kind: 'commit',
    });
    store.flush();
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(captured).toEqual(['commit']);
  });
});

/**
 * TASK_2026_323 blocker B2 — the write path is batched, the read path is
 * bounded, and the prepared statements are cached.
 *
 * All three exist because better-sqlite3 runs on the calling thread, which in
 * Electron is the thread that owns every `BrowserWindow`. What is asserted here
 * is not throughput; it is that the batching cannot be OBSERVED by a reader,
 * because the moment it can, the curator silently curates a transcript missing
 * the observations that justified running it.
 */
describe('ObservationQueueStore — batching, budget and statement cache', () => {
  /**
   * Driver-agnostic, unlike the round-trip block above.
   *
   * That block gates on better-sqlite3, which does not load on a Node whose
   * ABI the installed native binary was not built for — and skipping is exactly
   * the wrong answer for the invariants below, which are the ones a regression
   * would make invisible. `node:sqlite`'s `DatabaseSync` is the fallback; it
   * lacks `transaction()`, which {@link asSqliteDatabase} supplies. Migration
   * `0016` is the whole schema for `observation_queue` (`0039` only deletes
   * orphaned rows), so applying it alone is sufficient and skips the
   * sqlite-vec migrations the fallback driver cannot load.
   */
  const opener = resolveOpener();
  const maybe = opener ? it : it.skip;
  const sql0016 = MIGRATIONS.find((m) => m.version === 16)?.sql ?? '';

  const openStore = (
    dbPath: string,
    logger = makeLogger(),
  ): {
    raw: RawDb;
    connection: SqliteConnectionService;
    store: ObservationQueueStore;
  } => {
    const raw = (opener as (file: string) => RawDb)(dbPath);
    raw.exec(sql0016);
    const connection = {
      db: asSqliteDatabase(raw),
    } as unknown as SqliteConnectionService;
    return {
      raw,
      connection,
      store: new ObservationQueueStore(logger, connection),
    };
  };

  function bootstrap(): {
    service: { db: { prepare(sql: string): RawStatement }; close(): void };
    store: ObservationQueueStore;
    dbPath: string;
  } {
    const dbPath = makeTempDbPath();
    const { raw, store } = openStore(dbPath);
    return {
      service: {
        db: { prepare: (sql: string) => raw.prepare(sql) },
        close: () => raw.close(),
      },
      store,
      dbPath,
    };
  }

  maybe('enqueue does not write; the row lands on flush', async () => {
    const { service, store } = await bootstrap();
    try {
      store.enqueue({
        sessionId: 'batch-a',
        workspaceRoot: null,
        kind: 'tool-use',
      });
      expect(store.pendingCount).toBe(1);

      const raw = service.db
        .prepare(`SELECT COUNT(*) AS n FROM observation_queue`)
        .get() as { n: number };
      expect(raw.n).toBe(0);

      store.flush();
      expect(store.pendingCount).toBe(0);
      expect(
        (
          service.db
            .prepare(`SELECT COUNT(*) AS n FROM observation_queue`)
            .get() as { n: number }
        ).n,
      ).toBe(1);
    } finally {
      service.close();
    }
  });

  /**
   * The invariant the whole design rests on. `MemoryTriggerService.invokeCurate`
   * drains immediately after a Stop hook enqueued the turn's observations; if
   * the drain could miss them the curator would run on an empty transcript and
   * then mark nothing processed.
   */
  maybe('every read flushes first — no timer wait needed', async () => {
    const { service, store } = await bootstrap();
    try {
      store.enqueue({
        sessionId: 'batch-b',
        workspaceRoot: null,
        kind: 'assistant-turn',
        assistantMessage: 'hello',
      });
      expect(store.drainForSession('batch-b').length).toBe(1);

      store.enqueue({
        sessionId: 'batch-b',
        workspaceRoot: null,
        kind: 'user-prompt',
      });
      expect(store.countUnprocessed('batch-b')).toBe(2);

      store.enqueue({
        sessionId: 'batch-b',
        workspaceRoot: null,
        kind: 'commit',
      });
      expect(store.peekForSession('batch-b').length).toBe(3);
      expect(store.pendingCount).toBe(0);
    } finally {
      service.close();
    }
  });

  maybe('a full batch flushes without waiting for the timer', async () => {
    const { service, store } = await bootstrap();
    try {
      for (let i = 0; i < 64; i++) {
        store.enqueue({
          sessionId: 'batch-c',
          workspaceRoot: null,
          kind: 'tool-use',
        });
      }
      // Threshold reached — written synchronously, nothing left pending.
      expect(store.pendingCount).toBe(0);
      expect(
        (
          service.db
            .prepare(
              `SELECT COUNT(*) AS n FROM observation_queue WHERE session_id = 'batch-c'`,
            )
            .get() as { n: number }
        ).n,
      ).toBe(64);
    } finally {
      service.close();
    }
  });

  maybe('dispose writes the pending batch rather than losing it', async () => {
    const { service, store } = await bootstrap();
    try {
      store.enqueue({
        sessionId: 'batch-d',
        workspaceRoot: null,
        kind: 'tool-use',
      });
      store.dispose();
      expect(
        (
          service.db
            .prepare(
              `SELECT COUNT(*) AS n FROM observation_queue WHERE session_id = 'batch-d'`,
            )
            .get() as { n: number }
        ).n,
      ).toBe(1);
    } finally {
      service.close();
    }
  });

  maybe(
    'drainForSession stops at the byte budget, and the rest survive for the next pass',
    async () => {
      const { service, store } = await bootstrap();
      try {
        // 4 rows × 8 KB of response text.
        const text = 'y'.repeat(8 * 1024);
        for (let i = 0; i < 4; i++) {
          store.enqueue({
            sessionId: 'budget-a',
            workspaceRoot: null,
            kind: 'tool-use',
            toolName: 'Bash',
            toolResponseText: text,
          });
        }

        // A 12 KB budget admits row 1 (8 KB, under) and row 2 (16 KB, the row
        // that crosses) — an observation is whole or absent, never half-read.
        const bounded = store.drainForSession('budget-a', 500, 12 * 1024);
        expect(bounded.length).toBe(2);

        // Nothing was marked processed, so the untouched rows are still there.
        expect(store.countUnprocessed('budget-a')).toBe(4);
        expect(store.drainForSession('budget-a').length).toBe(4);
      } finally {
        service.close();
      }
    },
  );

  maybe(
    'drainForSession projects only the columns the curator reads',
    async () => {
      const { service, store } = await bootstrap();
      try {
        store.enqueue({
          sessionId: 'projection-a',
          workspaceRoot: '/ws/P',
          kind: 'tool-use',
          toolName: 'Read',
          toolInputJson: '{"file_path":"/a.ts"}',
          toolResponseText: 'contents',
        });
        const [row] = store.drainForSession('projection-a');
        expect(row).toEqual({
          id: expect.any(Number),
          kind: 'tool-use',
          toolName: 'Read',
          toolInputJson: '{"file_path":"/a.ts"}',
          toolResponseText: 'contents',
          assistantMessage: null,
          userPrompt: null,
          filePath: null,
        });
      } finally {
        service.close();
      }
    },
  );

  maybe('caps tool_input_json at enqueue time', async () => {
    const { service, store } = await bootstrap();
    try {
      store.enqueue({
        sessionId: 'cap-a',
        workspaceRoot: null,
        kind: 'tool-use',
        toolName: 'Write',
        toolInputJson: 'z'.repeat(OBSERVATION_TOOL_INPUT_MAX_BYTES + 4096),
      });
      const [row] = store.drainForSession('cap-a');
      const bytes = Buffer.byteLength(row.toolInputJson ?? '', 'utf8');
      expect(bytes).toBeGreaterThan(0);
      expect(bytes).toBeLessThanOrEqual(OBSERVATION_TOOL_INPUT_MAX_BYTES);
    } finally {
      service.close();
    }
  });

  /**
   * The statement cache is invalidated by DATABASE IDENTITY.
   * `openAndMigrate` builds a NEW handle on every open, so a statement prepared
   * against the closed one must not be reused — running it would throw
   * "database connection is not open" on the very first observation after a
   * database reset.
   */
  maybe('re-prepares its statements after the connection reopens', () => {
    const dbPath = makeTempDbPath();
    const logger = makeLogger();
    const first = (opener as (file: string) => RawDb)(dbPath);
    first.exec(sql0016);
    const connection = {
      db: asSqliteDatabase(first),
    } as { db: unknown };
    const store = new ObservationQueueStore(
      logger,
      connection as unknown as SqliteConnectionService,
    );

    store.enqueue({
      sessionId: 'reopen-a',
      workspaceRoot: null,
      kind: 'tool-use',
    });
    expect(store.countUnprocessed('reopen-a')).toBe(1);

    first.close();
    // Same store instance, brand-new handle on the same file — every statement
    // it cached is now bound to a closed database.
    const second = (opener as (file: string) => RawDb)(dbPath);
    connection.db = asSqliteDatabase(second);

    store.enqueue({
      sessionId: 'reopen-a',
      workspaceRoot: null,
      kind: 'assistant-turn',
    });
    expect(store.countUnprocessed('reopen-a')).toBe(2);
    expect(logger.warn).not.toHaveBeenCalled();
    second.close();
  });

  it('drops the batch and warns when persistence is unavailable', () => {
    const logger = makeLogger();
    const connection = {
      get db(): never {
        throw new Error('Persistence is offline');
      },
    } as unknown as SqliteConnectionService;
    const store = new ObservationQueueStore(logger, connection);

    store.enqueue({
      sessionId: 'offline-a',
      workspaceRoot: null,
      kind: 'tool-use',
    });
    expect(() => store.flush()).not.toThrow();
    expect(store.pendingCount).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('persistence unavailable'),
      expect.objectContaining({ dropped: 1 }),
    );
  });
});
