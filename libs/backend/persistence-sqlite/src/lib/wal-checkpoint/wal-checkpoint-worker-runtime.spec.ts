import {
  runWalCheckpoint,
  type CheckpointDatabase,
} from './wal-checkpoint-worker-runtime';

class RecordingDatabase implements CheckpointDatabase {
  readonly pragmas: string[] = [];
  closed = false;
  constructor(private readonly checkpointRows: unknown) {}
  pragma(source: string): unknown {
    this.pragmas.push(source);
    if (source === 'wal_checkpoint(PASSIVE)') {
      if (this.checkpointRows instanceof Error) throw this.checkpointRows;
      return this.checkpointRows;
    }
    return [];
  }
  close(): void {
    this.closed = true;
  }
}

const request = { type: 'checkpoint', requestId: 7, dbPath: '/db/ptah.sqlite' };

describe('runWalCheckpoint', () => {
  it('runs a PASSIVE checkpoint on a fresh connection and closes it', () => {
    const db = new RecordingDatabase([{ busy: 0, log: 120, checkpointed: 120 }]);
    const opened: string[] = [];
    let clock = 100;

    const reply = runWalCheckpoint(
      request,
      (dbPath) => {
        opened.push(dbPath);
        return db;
      },
      () => (clock += 25),
    );

    expect(opened).toEqual(['/db/ptah.sqlite']);
    expect(db.pragmas).toEqual(['busy_timeout = 1000', 'wal_checkpoint(PASSIVE)']);
    expect(db.closed).toBe(true);
    expect(reply).toEqual({
      type: 'checkpoint-result',
      requestId: 7,
      busy: false,
      walFrames: 120,
      checkpointedFrames: 120,
      durationMs: 25,
    });
  });

  it('reports busy and a partial checkpoint as SQLite returned them', () => {
    const db = new RecordingDatabase([{ busy: 1, log: 300, checkpointed: 40 }]);
    const reply = runWalCheckpoint(request, () => db);
    expect(reply).toEqual(
      expect.objectContaining({ busy: true, walFrames: 300, checkpointedFrames: 40 }),
    );
  });

  it('answers a checkpoint error with the message and still closes', () => {
    const db = new RecordingDatabase(new Error('SQLITE_IOERR'));
    const reply = runWalCheckpoint(request, () => db);
    expect(reply).toEqual({
      type: 'checkpoint-error',
      requestId: 7,
      message: 'SQLITE_IOERR',
    });
    expect(db.closed).toBe(true);
  });

  it('answers an open failure without a connection to close', () => {
    const reply = runWalCheckpoint(request, () => {
      throw new Error('SQLITE_CANTOPEN');
    });
    expect(reply).toEqual({
      type: 'checkpoint-error',
      requestId: 7,
      message: 'SQLITE_CANTOPEN',
    });
  });

  it('rejects an unexpected pragma result shape', () => {
    const db = new RecordingDatabase([{ busy: 'no' }]);
    const reply = runWalCheckpoint(request, () => db);
    expect(reply.type).toBe('checkpoint-error');
    expect(db.closed).toBe(true);
  });

  it('answers an invalid request with requestId -1 and opens nothing', () => {
    const open = jest.fn();
    const reply = runWalCheckpoint({ type: 'checkpoint', dbPath: '' }, open);
    expect(reply).toEqual(
      expect.objectContaining({ type: 'checkpoint-error', requestId: -1 }),
    );
    expect(open).not.toHaveBeenCalled();
  });
});
