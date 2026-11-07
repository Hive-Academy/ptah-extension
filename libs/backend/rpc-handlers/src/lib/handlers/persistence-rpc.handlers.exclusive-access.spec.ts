/**
 * `db:reset` and the WAL checkpoint worker (main-loop-sync-blocks review-11
 * finding 1): the reset takes the exclusive-access pause before it closes the
 * connection and renames the file, and releases it only after the reopen and
 * migrations, or on any early exit. With the real scheduler, a checkpoint in
 * flight is finished or its worker killed before the rename, and no
 * checkpoint starts during the pause.
 *
 * Dependencies are registered in a child container, so the handler is built
 * exactly as the hosts build it, with no casts.
 */
import 'reflect-metadata';
import { container as rootContainer, type DependencyContainer } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import {
  PERSISTENCE_TOKENS,
  WalCheckpointScheduler,
  type ISqliteExclusiveAccess,
  type IWalCheckpointWorkerProcess,
  type IWalCheckpointWorkerProcessFactory,
  type SqliteExclusiveAccessLease,
  type WalAutoCheckpointOutcome,
} from '@ptah-extension/persistence-sqlite';
import {
  PersistenceRpcHandlers,
  mintResetChallengeToken,
} from './persistence-rpc.handlers';
import type { DbResetResult } from './persistence-rpc.handlers';

const mockRenameSync = jest.fn();
const mockExistsSync = jest.fn();
jest.mock('node:fs', () => ({
  ...jest.requireActual('node:fs'),
  renameSync: (...args: unknown[]) => mockRenameSync(...args),
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}));

type Registered = (params: unknown) => Promise<unknown>;

interface Harness {
  container: DependencyContainer;
  order: string[];
  connection: ReturnType<typeof makeConnection>;
  call: (name: string, params: unknown) => Promise<unknown>;
}

function makeLogger() {
  return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

function makeConnection(order: string[]) {
  const connection = {
    isOpen: true,
    dbPath: '/home/user/.ptah/state/ptah.sqlite',
    walCheckpointsOffMainThread: false,
    db: { inTransaction: false },
    close: jest.fn(() => {
      order.push('close');
      connection.isOpen = false;
    }),
    openAndMigrate: jest.fn(async () => {
      order.push('reopen');
      connection.isOpen = true;
    }),
    noteWalBytes: jest.fn(),
    setWalAutoCheckpoint: jest.fn(
      (pages: number | null): WalAutoCheckpointOutcome => {
        connection.walCheckpointsOffMainThread = pages === 0;
        return { status: 'applied', pages: pages ?? 1000 };
      },
    ),
  };
  return connection;
}

function makeHarness(exclusiveAccess: ISqliteExclusiveAccess | null): Harness {
  const order: string[] = [];
  const container = rootContainer.createChildContainer();
  const registered = new Map<string, Registered>();
  const connection = makeConnection(order);
  container.register(TOKENS.LOGGER, { useValue: makeLogger() });
  container.register(TOKENS.RPC_HANDLER, {
    useValue: {
      registerMethod: (name: string, handler: Registered) => {
        registered.set(name, handler);
      },
    },
  });
  container.register(PERSISTENCE_TOKENS.SQLITE_CONNECTION, { useValue: connection });
  container.register(PERSISTENCE_TOKENS.BACKUP_SERVICE, {
    useValue: {
      backup: jest.fn(async () => null),
      rotate: jest.fn(async () => undefined),
    },
  });
  container.register(PERSISTENCE_TOKENS.VEC_STATUS, { useValue: {} });
  container.register(PLATFORM_TOKENS.USER_INTERACTION, { useValue: {} });
  if (exclusiveAccess) {
    container.register(PERSISTENCE_TOKENS.SQLITE_EXCLUSIVE_ACCESS, {
      useValue: exclusiveAccess,
    });
  }
  mockRenameSync.mockImplementation(() => order.push('rename'));
  mockExistsSync.mockReturnValue(false);
  container.resolve(PersistenceRpcHandlers).register();
  return {
    container,
    order,
    connection,
    call: (name, params) => {
      const handler = registered.get(name);
      if (!handler) throw new Error(`no handler for ${name}`);
      return handler(params);
    },
  };
}

function reset(harness: Harness): Promise<unknown> {
  return harness.call('db:reset', { confirm: mintResetChallengeToken() });
}

function isResetResult(value: unknown): value is DbResetResult {
  return typeof value === 'object' && value !== null && 'success' in value;
}

/** Records pause/release; the pause settles only when the test says so. */
function makeRecordingAccess(order: string[]) {
  let settle: (() => void) | null = null;
  const access: ISqliteExclusiveAccess = {
    pauseForExclusiveAccess: () =>
      new Promise<SqliteExclusiveAccessLease>((resolve) => {
        order.push('pause');
        settle = () => resolve({ release: () => order.push('release') });
      }),
  };
  return {
    access,
    settle: () => {
      const run: unknown = settle;
      if (typeof run !== 'function') throw new Error('pause not requested');
      run();
    },
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('db:reset — exclusive access to the database file', () => {
  beforeEach(() => {
    mockRenameSync.mockReset();
    mockExistsSync.mockReset();
  });

  it('closes only after the pause resolves, and releases after the reopen', async () => {
    const order: string[] = [];
    const recording = makeRecordingAccess(order);
    const harness = makeHarness(recording.access);

    const pending = reset(harness);
    await flush();
    expect([...order, ...harness.order]).toEqual(['pause']);

    recording.settle();
    const result = await pending;

    expect(isResetResult(result) && result.success).toBe(true);
    expect(harness.order).toEqual(['close', 'rename', 'reopen']);
    expect(order).toEqual(['pause', 'release']);
  });

  it('releases the pause when the rename fails', async () => {
    const order: string[] = [];
    const recording = makeRecordingAccess(order);
    const harness = makeHarness(recording.access);
    mockRenameSync.mockImplementation(() => {
      throw new Error('EBUSY: resource busy');
    });

    const pending = reset(harness);
    await flush();
    recording.settle();
    const result = await pending;

    expect(isResetResult(result) && result.success).toBe(false);
    expect(order).toEqual(['pause', 'release']);
  });

  it('releases the pause when the reopen fails', async () => {
    const order: string[] = [];
    const recording = makeRecordingAccess(order);
    const harness = makeHarness(recording.access);
    harness.connection.openAndMigrate.mockRejectedValueOnce(new Error('migration failed'));

    const pending = reset(harness);
    await flush();
    recording.settle();
    const result = await pending;

    expect(isResetResult(result) && result.success).toBe(false);
    expect(order).toEqual(['pause', 'release']);
  });

  it('resets as before on a host without the port', async () => {
    const harness = makeHarness(null);
    const result = await reset(harness);
    expect(isResetResult(result) && result.success).toBe(true);
    expect(harness.order).toEqual(['close', 'rename', 'reopen']);
  });
});

describe('db:reset — with the real WAL checkpoint scheduler', () => {
  class SilentWorker implements IWalCheckpointWorkerProcess {
    constructor(private readonly order: string[]) {}
    postMessage(): void {
      this.order.push('checkpoint');
    }
    on(): void {
      // Never replies and never exits on its own: a checkpoint stuck on a lock.
    }
    kill(): void {
      this.order.push('kill');
    }
  }

  beforeEach(() => {
    mockRenameSync.mockReset();
    mockExistsSync.mockReset();
  });

  it('kills an in-flight checkpoint before the rename and starts none during the reset', async () => {
    const harness = makeHarness(null);
    const factory: IWalCheckpointWorkerProcessFactory = {
      spawn: () => new SilentWorker(harness.order),
    };
    harness.container.register(PERSISTENCE_TOKENS.WAL_CHECKPOINT_WORKER_FACTORY, {
      useValue: factory,
    });
    harness.container.registerSingleton(
      PERSISTENCE_TOKENS.WAL_CHECKPOINT_SCHEDULER,
      WalCheckpointScheduler,
    );
    harness.container.register(PERSISTENCE_TOKENS.SQLITE_EXCLUSIVE_ACCESS, {
      useToken: PERSISTENCE_TOKENS.WAL_CHECKPOINT_SCHEDULER,
    });
    // Re-resolve so this handler gets the scheduler as its exclusive access.
    const registered = new Map<string, Registered>();
    harness.container.register(TOKENS.RPC_HANDLER, {
      useValue: {
        registerMethod: (name: string, handler: Registered) => {
          registered.set(name, handler);
        },
      },
    });
    harness.container.resolve(PersistenceRpcHandlers).register();
    const viaToken = harness.container.resolve<WalCheckpointScheduler>(
      PERSISTENCE_TOKENS.WAL_CHECKPOINT_SCHEDULER,
    );
    expect(viaToken).toBeInstanceOf(WalCheckpointScheduler);

    viaToken.start({
      pollMs: 60 * 60 * 1000,
      pauseWaitMs: 20,
      requestTimeoutMs: 60_000,
      statWal: async () => ({ bytes: 4096, mtimeMs: Date.now() }),
    });
    const tick = viaToken.tick();
    await flush();
    expect(harness.order).toEqual(['checkpoint']);

    const handler = registered.get('db:reset');
    if (!handler) throw new Error('db:reset not registered');
    const pending = handler({ confirm: mintResetChallengeToken() });
    // A poll during the reset must not start a second checkpoint.
    await flush();
    void viaToken.tick();
    const result = await pending;
    await tick;

    expect(isResetResult(result) && result.success).toBe(true);
    expect(harness.order).toEqual(['checkpoint', 'kill', 'close', 'rename', 'reopen']);
    viaToken.dispose();
  });
});
