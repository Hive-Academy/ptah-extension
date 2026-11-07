/**
 * `copyFromSnapshot` with a scripted source (main-loop-sync-blocks fix-12).
 * The real-binary half — no restart under a concurrent writer — is in
 * `integrity-worker-backup.integration.spec.ts`.
 */
import {
  copyFromSnapshot,
  MAX_PACING_SLEEP_MS,
  PACED_STEP_BYTES,
  WHOLE_DATABASE_STEP_PAGES,
  type BackupStepProgress,
  type SnapshotBackupSource,
  type SnapshotCopyIo,
} from './snapshot-backup-copy';

const PAGE_SIZE = 4096;
const MIB = 1024 * 1024;

interface ScriptedSource extends SnapshotBackupSource {
  readonly calls: string[];
  readonly returned: number[];
}

/**
 * A source whose `backup` replays `progress` to the callback, the way
 * `better-sqlite3`'s `runBackup` does, recording every return value.
 */
function scriptedSource(
  progress: readonly BackupStepProgress[],
  pageSize: unknown = PAGE_SIZE,
): ScriptedSource {
  const calls: string[] = [];
  const returned: number[] = [];
  return {
    calls,
    returned,
    exec: (sql: string) => {
      calls.push(sql);
    },
    pragma: () => pageSize,
    backup: async (destination, options) => {
      calls.push(`backup:${destination}`);
      for (const step of progress) {
        const pages = options?.progress?.(step);
        if (pages !== undefined) returned.push(pages);
      }
    },
  };
}

function fakeIo(clock: { now: number }) {
  const flush = jest.fn();
  const close = jest.fn();
  const sleeps: number[] = [];
  const io: SnapshotCopyIo = {
    now: () => clock.now,
    sleep: (ms) => {
      sleeps.push(ms);
      clock.now += ms;
    },
    openFlushHandle: jest.fn(() => ({ flush, close })),
  };
  return { io, flush, close, sleeps };
}

/** Pages left after copying `bytes` of a `totalBytes` database. */
function step(totalBytes: number, copiedBytes: number): BackupStepProgress {
  return {
    totalPages: totalBytes / PAGE_SIZE,
    remainingPages: (totalBytes - copiedBytes) / PAGE_SIZE,
  };
}

describe('copyFromSnapshot', () => {
  it('copies inside ONE read transaction: BEGIN and a read before the copy, COMMIT after', async () => {
    const source = scriptedSource([step(8 * MIB, 0)]);
    const { io } = fakeIo({ now: 0 });

    await copyFromSnapshot(source, '/tmp/x.tmp', null, io);

    expect(source.calls).toEqual([
      'BEGIN',
      'SELECT count(*) FROM sqlite_schema',
      'backup:/tmp/x.tmp',
      'COMMIT',
    ]);
  });

  it('unpaced: asks for every remaining page in one slice and never sleeps or flushes', async () => {
    const source = scriptedSource([step(8 * MIB, 0), step(8 * MIB, 0)]);
    const { io, sleeps } = fakeIo({ now: 0 });

    const stats = await copyFromSnapshot(source, '/tmp/x.tmp', null, io);

    expect(source.returned).toEqual([
      WHOLE_DATABASE_STEP_PAGES,
      WHOLE_DATABASE_STEP_PAGES,
    ]);
    expect(sleeps).toEqual([]);
    expect(io.openFlushHandle).not.toHaveBeenCalled();
    expect(stats).toEqual({ steps: 2, restarts: 0, flushes: 0, pausedMs: 0 });
  });

  it('paced: fixed-size slices, a flush every flushEveryBytes, and sleeps that hold the average rate', async () => {
    const total = 64 * MIB;
    const progress = [0, 4, 8, 12, 16, 20, 24, 28, 32].map((mib) =>
      step(total, mib * MIB),
    );
    const source = scriptedSource(progress);
    const clock = { now: 0 };
    const { io, flush, close, sleeps } = fakeIo(clock);

    const stats = await copyFromSnapshot(
      source,
      '/tmp/x.tmp',
      { maxBytesPerSecond: 16 * MIB, flushEveryBytes: 8 * MIB },
      io,
    );

    expect(source.returned.every((pages) => pages === PACED_STEP_BYTES / PAGE_SIZE)).toBe(true);
    expect(io.openFlushHandle).toHaveBeenCalledWith('/tmp/x.tmp');
    expect(flush).toHaveBeenCalledTimes(4); // at 8, 16, 24 and 32 MiB
    expect(close).toHaveBeenCalledTimes(1);
    // The fake copy itself takes no time, so every slice past the first is
    // "ahead": 4 MiB at 16 MiB/s is 250 ms per slice, and the clock ends at
    // exactly the 2 s that 32 MiB at that rate is due.
    expect(sleeps).toEqual(Array(8).fill(250));
    expect(clock.now).toBe(2_000);
    expect(stats).toEqual({ steps: 9, restarts: 0, flushes: 4, pausedMs: 2_000 });
  });

  it('caps one pause at MAX_PACING_SLEEP_MS', async () => {
    const source = scriptedSource([step(64 * MIB, 0), step(64 * MIB, 64 * MIB - PAGE_SIZE)]);
    const { io, sleeps } = fakeIo({ now: 0 });

    await copyFromSnapshot(
      source,
      '/tmp/x.tmp',
      { maxBytesPerSecond: 1 * MIB, flushEveryBytes: 1024 * MIB },
      io,
    );

    expect(sleeps).toEqual([MAX_PACING_SLEEP_MS]);
  });

  it('counts a restart when the remaining pages grow again', async () => {
    const total = 16 * MIB;
    const source = scriptedSource([
      step(total, 0),
      step(total, 8 * MIB),
      step(total, 0),
      step(total, 4 * MIB),
    ]);
    const { io } = fakeIo({ now: 0 });

    const stats = await copyFromSnapshot(source, '/tmp/x.tmp', null, io);

    expect(stats.restarts).toBe(1);
  });

  it('rejects an unusable page size before the copy starts', async () => {
    const source = scriptedSource([step(8 * MIB, 0)], 'wal');
    const { io } = fakeIo({ now: 0 });

    await expect(copyFromSnapshot(source, '/tmp/x.tmp', null, io)).rejects.toThrow(
      'unexpected page_size',
    );
    expect(source.calls).not.toContain('backup:/tmp/x.tmp');
  });

  it('closes the flush handle and leaves the transaction to the caller when the copy throws', async () => {
    const calls: string[] = [];
    const source: SnapshotBackupSource = {
      exec: (sql: string) => {
        calls.push(sql);
      },
      pragma: () => PAGE_SIZE,
      backup: async () => {
        throw new Error('disk full');
      },
    };
    const { io, close } = fakeIo({ now: 0 });

    await expect(
      copyFromSnapshot(
        source,
        '/tmp/x.tmp',
        { maxBytesPerSecond: MIB, flushEveryBytes: MIB },
        io,
      ),
    ).rejects.toThrow('disk full');
    expect(close).toHaveBeenCalledTimes(1);
    expect(calls).not.toContain('COMMIT');
  });

  it('refuses a source without backup()', async () => {
    const { io } = fakeIo({ now: 0 });
    await expect(
      copyFromSnapshot({ exec: jest.fn(), pragma: () => PAGE_SIZE }, '/tmp/x.tmp', null, io),
    ).rejects.toThrow('db.backup() is unavailable');
  });
});
