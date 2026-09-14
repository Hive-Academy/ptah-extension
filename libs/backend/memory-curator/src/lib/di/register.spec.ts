/**
 * DI reach for memory retention (TASK_2026_440, reachability item 3).
 *
 * Both hosts call `registerPersistenceSqliteServices` and then
 * `registerMemoryCuratorServices` (Electron `phase-2-libraries.ts`, CLI
 * `register-thoth-libraries.ts`). This spec runs that same pair in a child
 * container and proves the retention tokens are registered AND that the graph
 * resolves into a working singleton against a real SQLite file — a registered
 * token whose dependencies do not resolve would only fail at the first cron
 * tick in production.
 *
 * The SQLite connection is a real temp-file database (better-sqlite3 or
 * `node:sqlite`); the spec FAILS, never skips, when neither binding loads.
 */
import 'reflect-metadata';
import * as os from 'node:os';
import * as path from 'node:path';
import { container } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  PERSISTENCE_TOKENS,
  registerPersistenceSqliteServices,
} from '@ptah-extension/persistence-sqlite';
import { MEMORY_TOKENS } from './tokens';
import { registerMemoryCuratorServices } from './register';
import { MemoryRetentionService } from '../retention/memory-retention.service';
import { ObservationRetentionStore } from '../retention/observation-retention.store';
import { MEMORY_RETENTION_LIMITS } from '../retention/memory-retention-config';
import {
  openRetentionTestDb,
  removeRetentionTempDirs,
  seedObservations,
  type RetentionTestDb,
} from '../retention/retention-sqlite.test-support';

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

describe('registerMemoryCuratorServices — memory retention reach', () => {
  let t: RetentionTestDb;

  beforeEach(() => {
    t = openRetentionTestDb();
  });
  afterEach(() => t.close());
  afterAll(() => removeRetentionTempDirs());

  function buildContainer() {
    const child = container.createChildContainer();
    const logger = makeLogger();
    child.register(TOKENS.LOGGER, { useValue: logger });
    child.register(PERSISTENCE_TOKENS.SQLITE_DB_PATH, {
      // Never opened: the real connection below replaces it.
      useValue: path.join(os.tmpdir(), 'ptah-register-spec-never-opened.db'),
    });
    child.register(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {
      useValue: {
        getConfiguration: (_s: string, _k: string, def?: unknown) => def,
      } as unknown as IWorkspaceProvider,
    });
    registerPersistenceSqliteServices(child, logger);
    // The host opens the registered connection; here a real temp-file database
    // stands in for it so the resolved graph talks to actual SQLite.
    child.register(PERSISTENCE_TOKENS.SQLITE_CONNECTION, {
      useValue: t.connection,
    });
    registerMemoryCuratorServices(child, logger);
    return child;
  }

  it('registers the retention service, its store and its limits', () => {
    const child = buildContainer();
    expect(child.isRegistered(MEMORY_TOKENS.MEMORY_RETENTION_SERVICE)).toBe(
      true,
    );
    expect(child.isRegistered(MEMORY_TOKENS.OBSERVATION_RETENTION_STORE)).toBe(
      true,
    );
    expect(child.isRegistered(MEMORY_TOKENS.MEMORY_RETENTION_LIMITS)).toBe(
      true,
    );
    expect(child.isRegistered(PERSISTENCE_TOKENS.SQLITE_PAGE_RECLAIMER)).toBe(
      true,
    );
    expect(child.resolve(MEMORY_TOKENS.MEMORY_RETENTION_LIMITS)).toBe(
      MEMORY_RETENTION_LIMITS,
    );
  });

  it('resolves one singleton service whose graph reads the real database', async () => {
    const child = buildContainer();
    const service = child.resolve<MemoryRetentionService>(
      MEMORY_TOKENS.MEMORY_RETENTION_SERVICE,
    );
    expect(service).toBeInstanceOf(MemoryRetentionService);
    expect(child.resolve(MEMORY_TOKENS.MEMORY_RETENTION_SERVICE)).toBe(service);
    expect(
      child.resolve(MEMORY_TOKENS.OBSERVATION_RETENTION_STORE),
    ).toBeInstanceOf(ObservationRetentionStore);

    seedObservations(t.raw, [
      {
        sessionId: 'a',
        kind: 'tool-use',
        capturedAt: Date.now(),
        processedAt: null,
      },
      {
        sessionId: 'a',
        kind: 'tool-use',
        capturedAt: Date.now(),
        processedAt: null,
      },
    ]);
    const health = service.storageHealth();
    expect(health.observations.pendingRows).toBe(2);
    expect(health.autoVacuumIncremental).toBe(true);
    expect(health.dbBytes).toBeGreaterThan(0);
    expect(health.readErrors).toBeUndefined();

    // A freshly resolved service is inside its boot deferral: the first cron
    // tick after start does no row work.
    await expect(
      service.run({
        signal: new AbortController().signal,
        isOnBattery: () => false,
        msSinceForegroundActivity: () => Number.POSITIVE_INFINITY,
      }),
    ).resolves.toEqual({ status: 'skipped', reason: 'boot-deferred' });
    expect(service.storageHealth().retention.lastSkipReason).toBe(
      'boot-deferred',
    );
  });
});
