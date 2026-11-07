/**
 * The connection side of fix 11: `wal_autocheckpoint` is applied only when a
 * scheduler sets it, survives a reopen, and slow-statement lines say who
 * checkpoints the WAL.
 */
import 'reflect-metadata';
import { SqliteConnectionService } from '../sqlite-connection.service';
import { SqlitePageReclaimer } from '../sqlite-page-reclaimer';
import { FakeSqliteDatabase } from '../testing/fake-sqlite-database';
import { createMockLogger, type MockLogger } from '../testing/mock-logger';

const autoCheckpointPragmas = (fake: FakeSqliteDatabase): string[] =>
  fake.pragmas.filter((p) => p.startsWith('wal_autocheckpoint'));

async function openConnection(
  logger: MockLogger,
  fakes: FakeSqliteDatabase[],
): Promise<SqliteConnectionService> {
  const service = new SqliteConnectionService(':memory:', logger);
  service.configure({
    factory: () => {
      const fake = new FakeSqliteDatabase();
      fakes.push(fake);
      return fake;
    },
    vecPathResolver: null,
  });
  await service.openAndMigrate();
  return service;
}

describe('SqliteConnectionService — wal_autocheckpoint', () => {
  it('leaves SQLite’s default alone when nothing sets it', async () => {
    const fakes: FakeSqliteDatabase[] = [];
    const service = await openConnection(createMockLogger(), fakes);

    expect(autoCheckpointPragmas(fakes[0])).toEqual([]);
    expect(service.walCheckpointsOffMainThread).toBe(false);
  });

  it('applies 0 to the open connection and again on every reopen', async () => {
    const fakes: FakeSqliteDatabase[] = [];
    const service = await openConnection(createMockLogger(), fakes);

    service.setWalAutoCheckpoint(0);
    expect(autoCheckpointPragmas(fakes[0])).toEqual(['wal_autocheckpoint = 0']);
    expect(service.walCheckpointsOffMainThread).toBe(true);

    service.close();
    await service.openAndMigrate();
    expect(autoCheckpointPragmas(fakes[1])).toEqual(['wal_autocheckpoint = 0']);
  });

  it('restores the default threshold with null', async () => {
    const fakes: FakeSqliteDatabase[] = [];
    const service = await openConnection(createMockLogger(), fakes);
    service.setWalAutoCheckpoint(0);

    service.setWalAutoCheckpoint(null);

    expect(autoCheckpointPragmas(fakes[0])).toEqual([
      'wal_autocheckpoint = 0',
      'wal_autocheckpoint = 1000',
    ]);
    expect(service.walCheckpointsOffMainThread).toBe(false);
  });

  it('refuses a value that is not a page count, running no SQL', async () => {
    const fakes: FakeSqliteDatabase[] = [];
    const service = await openConnection(createMockLogger(), fakes);

    expect(() => service.setWalAutoCheckpoint(1.5)).toThrow(RangeError);
    expect(() => service.setWalAutoCheckpoint(-1)).toThrow(RangeError);
    expect(autoCheckpointPragmas(fakes[0])).toEqual([]);
  });

  it('stores a setting made before open and applies it at open', async () => {
    const fake = new FakeSqliteDatabase();
    const service = new SqliteConnectionService(':memory:', createMockLogger());
    service.configure({ factory: () => fake, vecPathResolver: null });

    service.setWalAutoCheckpoint(0);
    expect(autoCheckpointPragmas(fake)).toEqual([]);
    await service.openAndMigrate();

    expect(autoCheckpointPragmas(fake)).toEqual(['wal_autocheckpoint = 0']);
  });
});

describe('SqliteConnectionService — slow statement WAL context', () => {
  const ENV = 'PTAH_SQLITE_SLOW_WARN_MS';
  afterEach(() => {
    delete process.env[ENV];
  });

  /** A transaction that blocks past the 5 ms bar; returns its log line. */
  function runSlowTransaction(
    service: SqliteConnectionService,
    logger: MockLogger,
  ): unknown {
    service.db.transaction(function walContext() {
      const until = Date.now() + 20;
      while (Date.now() < until) {
        // Deliberately synchronous: the main-thread block being measured.
      }
    })();
    return logger.entries.find(
      (e) =>
        e.message === '[SQLite] slow statement' &&
        JSON.stringify(e.context).includes('<transaction walContext>'),
    )?.context;
  }

  it('adds the checkpoint mode and the last measured WAL size', async () => {
    process.env[ENV] = '5';
    const logger = createMockLogger();
    const service = await openConnection(logger, []);
    service.setWalAutoCheckpoint(0);
    service.noteWalBytes(8 * 1024 * 1024);

    expect(runSlowTransaction(service, logger)).toEqual(
      expect.objectContaining({
        walCheckpoints: 'worker',
        walBytes: 8 * 1024 * 1024,
        walMeasuredAgoMs: expect.any(Number),
      }),
    );
  });

  it('names SQLite auto-checkpoint and no size when nothing measures the WAL', async () => {
    process.env[ENV] = '5';
    const logger = createMockLogger();
    const service = await openConnection(logger, []);

    const context = runSlowTransaction(service, logger);
    expect(context).toEqual(
      expect.objectContaining({ walCheckpoints: 'sqlite-auto' }),
    );
    expect(context).not.toHaveProperty('walBytes');
  });
});

describe('SqlitePageReclaimer.checkpointPassive', () => {
  it('runs on the connection while SQLite auto-checkpoint is on', async () => {
    const fakes: FakeSqliteDatabase[] = [];
    const logger = createMockLogger();
    const service = await openConnection(logger, fakes);

    new SqlitePageReclaimer(logger, service).checkpointPassive();

    expect(fakes[0].walCheckpointCalls).toEqual(['wal_checkpoint(PASSIVE)']);
  });

  it('leaves the checkpoint to the worker once checkpoints are off the main thread', async () => {
    const fakes: FakeSqliteDatabase[] = [];
    const logger = createMockLogger();
    const service = await openConnection(logger, fakes);
    service.setWalAutoCheckpoint(0);

    new SqlitePageReclaimer(logger, service).checkpointPassive();

    expect(fakes[0].walCheckpointCalls).toEqual([]);
  });
});
