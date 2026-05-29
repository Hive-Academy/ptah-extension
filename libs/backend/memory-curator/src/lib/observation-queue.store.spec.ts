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
});
