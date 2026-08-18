import 'reflect-metadata';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Logger } from '@ptah-extension/vscode-core';
import { SqliteConnectionService } from '@ptah-extension/persistence-sqlite';
import {
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
        store.insert(baseRow);
        store.insert({ ...baseRow, kind: 'assistant-turn', toolName: null });
        store.insert({ ...baseRow, kind: 'user-prompt', toolName: null });

        const drained = store.drainForSession('session-α');
        expect(drained.length).toBe(3);
        expect(drained[0].kind).toBe('tool-use');
        expect(drained[1].kind).toBe('assistant-turn');
        expect(drained[2].kind).toBe('user-prompt');
        for (const row of drained) {
          expect(row.processedAt).toBeNull();
          expect(row.sessionId).toBe('session-α');
        }
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
          store.insert({
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
        store.insert({
          sessionId: 'session-γ',
          workspaceRoot: '/ws/B',
          kind: 'tool-use',
        });
        store.insert({
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
      store.insert({
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
        store.insert({
          sessionId: 'session-ε',
          workspaceRoot: null,
          kind: 'tool-use',
        });
        store.insert({
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
        store.insert({
          sessionId: 'session-peek',
          workspaceRoot: '/ws',
          kind: 'tool-use',
          toolName: 'Read',
        });
        store.insert({
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
        store.insert({
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
        store.insert({
          sessionId: 'session-ζ',
          workspaceRoot: null,
          kind: 'tool-use',
        });
        store.insert({
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
        store.insert({
          sessionId: 'session-η',
          workspaceRoot: '/ws/H',
          kind: 'file-read',
          toolName: 'Read',
        });
        store.insert({
          sessionId: 'session-η',
          workspaceRoot: '/ws/H',
          kind: 'tool-use',
          toolName: 'Bash',
        });
        expect(events.length).toBe(2);
        expect(events[0]).toMatchObject({
          sessionId: 'session-η',
          workspaceRoot: '/ws/H',
          kind: 'file-read',
        });
        expect(events[1].kind).toBe('tool-use');
        expect(events[0].timestamp).toBeGreaterThanOrEqual(before);
        sub.dispose();
        store.insert({
          sessionId: 'session-η',
          workspaceRoot: '/ws/H',
          kind: 'user-prompt',
        });
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
        store.insert({
          sessionId: 'session-θ',
          workspaceRoot: null,
          kind: 'commit',
        });
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

        store.insert({
          sessionId: '',
          workspaceRoot: '/ws/A',
          kind: 'tool-use',
          toolName: 'Read',
        });
        store.insert({
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
      store.insert({
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
      },
    } as unknown as SqliteConnectionService;
    const store = new ObservationQueueStore(makeLogger(), connection);
    const captured: string[] = [];
    store.onCapture((evt) => captured.push(evt.kind));
    return { store, runMock, captured };
  }

  it('runs no statement and emits no capture event for an empty sessionId', () => {
    const { store, runMock, captured } = makeStubbedStore();
    store.insert({
      sessionId: '',
      workspaceRoot: '/ws/A',
      kind: 'tool-use',
      toolName: 'Read',
    });
    expect(runMock).not.toHaveBeenCalled();
    expect(captured).toEqual([]);
  });

  it('runs no statement for a whitespace-only sessionId', () => {
    const { store, runMock, captured } = makeStubbedStore();
    store.insert({
      sessionId: '  ',
      workspaceRoot: null,
      kind: 'assistant-turn',
    });
    expect(runMock).not.toHaveBeenCalled();
    expect(captured).toEqual([]);
  });

  it('writes and publishes for a real sessionId (control)', () => {
    const { store, runMock, captured } = makeStubbedStore();
    store.insert({
      sessionId: '8f1c7d2e-2a5b-4b6e-9d3f-0c1a2b3c4d5e',
      workspaceRoot: '/ws/A',
      kind: 'commit',
    });
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(captured).toEqual(['commit']);
  });
});
