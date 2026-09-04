/**
 * `startTaskSpecsIndex` — host-activation warm-up specs (TASK_2026_179, 4.1).
 *
 * The contract under test is entirely about what must NOT happen: activation
 * must not throw, must not block on the scan, and must not be defeated by a
 * host that has no workspace root yet. All three hosts call this one helper, so
 * proving it here proves it for `ptah-extension-vscode`, `ptah-electron` and
 * `cli-engine` alike.
 */
import 'reflect-metadata';
import { container as rootContainer } from 'tsyringe';
import type { DependencyContainer } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  createEvent,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';
import type { Logger } from '@ptah-extension/vscode-core';
import { TASK_SPECS_TOKENS } from './tokens';
import { startTaskSpecsIndex } from './start-index';

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

interface Harness {
  container: DependencyContainer;
  logger: Logger;
  ensureStarted: jest.Mock;
  fireFolderChange: () => void;
  setRoot: (root: string | undefined) => void;
  /** Simulate `SqliteConnectionService.openAndMigrate()` completing. */
  fireConnectionOpen: () => void;
  /** How many `onDidOpen` subscriptions are currently live. */
  openSubscriberCount: () => number;
  /** Register the fake connection now — for the misordered-host cases. */
  registerConnection: () => void;
  /** Whoever opens the connection resolves it first; this is that resolve. */
  resolveConnection: () => void;
}

function makeHarness(options?: {
  root?: string | undefined;
  ensureStarted?: jest.Mock;
  omitIndex?: boolean;
  throwingFolderEvent?: boolean;
  /**
   * Register a fake shared SQLite connection (the Electron / CLI shape).
   * Omitted by default, which is the VS Code shape — that host never calls
   * `registerPersistenceSqliteServices`, so the token is simply absent.
   */
  connection?: 'present' | 'throwing';
}): Harness {
  const container = rootContainer.createChildContainer();
  const logger = makeLogger();
  const ensureStarted =
    options?.ensureStarted ?? jest.fn().mockResolvedValue(undefined);

  let root = 'root' in (options ?? {}) ? options?.root : 'd:/ws';
  const [onDidChangeWorkspaceFolders, fireFolderChange] = createEvent<void>();

  const workspace: Partial<IWorkspaceProvider> = {
    getWorkspaceRoot: () => root,
    getWorkspaceFolders: () => (root ? [root] : []),
    onDidChangeWorkspaceFolders: options?.throwingFolderEvent
      ? ((() => {
          throw new Error('no event plumbing on this host');
        }) as unknown as IWorkspaceProvider['onDidChangeWorkspaceFolders'])
      : onDidChangeWorkspaceFolders,
  };

  container.register(PLATFORM_TOKENS.WORKSPACE_PROVIDER, {
    useValue: workspace as IWorkspaceProvider,
  });
  if (!options?.omitIndex) {
    container.register(TASK_SPECS_TOKENS.TASK_INDEX_SERVICE, {
      useValue: { ensureStarted },
    });
  }

  const openListeners = new Set<() => void>();
  const registerConnection = (): void => {
    container.register(PERSISTENCE_TOKENS.SQLITE_CONNECTION, {
      useValue: {
        isOpen: false,
        onDidOpen:
          options?.connection === 'throwing'
            ? () => {
                throw new Error('connection is mid-teardown');
              }
            : (listener: () => void) => {
                openListeners.add(listener);
                return { dispose: () => openListeners.delete(listener) };
              },
      },
    });
  };
  if (options?.connection) registerConnection();

  return {
    registerConnection,
    resolveConnection: () => {
      container.resolve(PERSISTENCE_TOKENS.SQLITE_CONNECTION);
    },
    container,
    logger,
    ensureStarted,
    fireFolderChange: () => fireFolderChange(),
    setRoot: (next) => {
      root = next;
    },
    fireConnectionOpen: () => {
      for (const listener of [...openListeners]) listener();
    },
    openSubscriberCount: () => openListeners.size,
  };
}

const settle = (): Promise<void> => new Promise((r) => setImmediate(r));

describe('startTaskSpecsIndex', () => {
  it('warms the index for the active workspace root', async () => {
    const h = makeHarness();
    startTaskSpecsIndex(h.container, h.logger);
    await settle();
    expect(h.ensureStarted).toHaveBeenCalledWith('d:/ws');
  });

  it('does not block activation on the scan', async () => {
    // A scan that never settles must not stop the helper from returning.
    const ensureStarted = jest.fn(() => new Promise<void>(() => undefined));
    const h = makeHarness({ ensureStarted });
    const before = Date.now();
    startTaskSpecsIndex(h.container, h.logger);
    expect(Date.now() - before).toBeLessThan(200);
    await settle();
  });

  it('does not throw when ensureStarted REJECTS', async () => {
    const ensureStarted = jest
      .fn()
      .mockRejectedValue(new Error('specs dir unreadable'));
    const h = makeHarness({ ensureStarted });

    expect(() => startTaskSpecsIndex(h.container, h.logger)).not.toThrow();
    await settle();

    expect(h.logger.warn).toHaveBeenCalledWith(
      '[task-specs] index warm-up failed (non-fatal)',
      expect.objectContaining({ error: 'specs dir unreadable' }),
    );
  });

  it('does not throw when ensureStarted throws SYNCHRONOUSLY', async () => {
    const ensureStarted = jest.fn(() => {
      throw new Error('boom before the first await');
    });
    const h = makeHarness({ ensureStarted });

    expect(() => startTaskSpecsIndex(h.container, h.logger)).not.toThrow();
    await settle();

    expect(h.logger.warn).toHaveBeenCalledWith(
      '[task-specs] index warm-up failed (non-fatal)',
      expect.objectContaining({ error: 'boom before the first await' }),
    );
  });

  it('does not throw when the index service cannot be resolved', async () => {
    const h = makeHarness({ omitIndex: true });

    expect(() => startTaskSpecsIndex(h.container, h.logger)).not.toThrow();
    await settle();

    expect(h.logger.warn).toHaveBeenCalledWith(
      '[task-specs] index warm-up skipped (services unavailable)',
      expect.any(Object),
    );
    expect(h.ensureStarted).not.toHaveBeenCalled();
  });

  it('is a quiet no-op while no workspace is open', async () => {
    const h = makeHarness({ root: undefined });
    startTaskSpecsIndex(h.container, h.logger);
    await settle();
    expect(h.ensureStarted).not.toHaveBeenCalled();
  });

  it('re-attempts once the workspace root appears (Electron/CLI boot order)', async () => {
    const h = makeHarness({ root: undefined });
    startTaskSpecsIndex(h.container, h.logger);
    await settle();
    expect(h.ensureStarted).not.toHaveBeenCalled();

    h.setRoot('d:/restored-ws');
    h.fireFolderChange();
    await settle();

    expect(h.ensureStarted).toHaveBeenCalledWith('d:/restored-ws');
  });

  it('survives a host whose folder event cannot be subscribed to', async () => {
    const h = makeHarness({ throwingFolderEvent: true });

    const disposable = startTaskSpecsIndex(h.container, h.logger);
    await settle();

    // The warm-up still happened; only the re-attempt hook was lost.
    expect(h.ensureStarted).toHaveBeenCalledWith('d:/ws');
    expect(() => disposable.dispose()).not.toThrow();
  });

  /**
   * TASK_2026_306 defect E. Electron and the CLI register the SQLite connection
   * in the same DI pass as this helper but open it hundreds of log lines later,
   * so the activation warm-up's index write landed on an offline store and was
   * lost for the rest of the session.
   */
  describe('re-warms when persistence comes online (TASK_2026_306 defect E)', () => {
    it('warms again once the connection opens', async () => {
      const h = makeHarness({ connection: 'present' });
      startTaskSpecsIndex(h.container, h.logger);
      await settle();
      expect(h.ensureStarted).toHaveBeenCalledTimes(1);

      h.fireConnectionOpen();
      await settle();

      expect(h.ensureStarted).toHaveBeenCalledTimes(2);
      expect(h.ensureStarted).toHaveBeenNthCalledWith(2, 'd:/ws');
    });

    it('warms again on a REOPEN, not only the first open', async () => {
      // The database-reset RPC closes and re-opens the shared connection; the
      // derived index has to be rebuilt against the new file too.
      const h = makeHarness({ connection: 'present' });
      startTaskSpecsIndex(h.container, h.logger);
      await settle();

      h.fireConnectionOpen();
      h.fireConnectionOpen();
      await settle();

      expect(h.ensureStarted).toHaveBeenCalledTimes(3);
    });

    it('is a no-op on a host that registers no connection (VS Code)', async () => {
      const h = makeHarness();
      startTaskSpecsIndex(h.container, h.logger);
      await settle();

      // One warm-up, no second trigger, and no warning about a missing token —
      // an absent connection is the normal VS Code shape, not a degradation.
      expect(h.ensureStarted).toHaveBeenCalledTimes(1);
      expect(h.logger.warn).not.toHaveBeenCalled();
    });

    it('survives a connection that refuses the subscription', async () => {
      const h = makeHarness({ connection: 'throwing' });

      let disposable!: ReturnType<typeof startTaskSpecsIndex>;
      expect(() => {
        disposable = startTaskSpecsIndex(h.container, h.logger);
      }).not.toThrow();
      await settle();

      expect(h.ensureStarted).toHaveBeenCalledWith('d:/ws');
      expect(h.logger.warn).toHaveBeenCalledWith(
        '[task-specs] persistence-open subscription unavailable',
        expect.objectContaining({ error: 'connection is mid-teardown' }),
      );
      expect(() => disposable.dispose()).not.toThrow();
    });

    it('unsubscribes from the connection when disposed', async () => {
      const h = makeHarness({ connection: 'present' });
      const disposable = startTaskSpecsIndex(h.container, h.logger);
      await settle();
      expect(h.openSubscriberCount()).toBe(1);

      disposable.dispose();
      expect(h.openSubscriberCount()).toBe(0);

      h.fireConnectionOpen();
      await settle();
      expect(h.ensureStarted).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * TASK_2026_314. The defect-E fix above held only while every host registered
   * the SQLite connection BEFORE calling this helper. All three did; nothing
   * made them. A host that called in the other order got a silent no-op — no
   * warning, no retry — and its Tasks board went merely STALE, which is exactly
   * the regression that survives manual QA.
   *
   * These cases run the hosts in the WRONG order on purpose. Before the fix,
   * every one of them passed while proving nothing.
   */
  describe('registration order does not matter (TASK_2026_314)', () => {
    it('still upgrades when the connection is registered AFTER this helper', async () => {
      const h = makeHarness();
      startTaskSpecsIndex(h.container, h.logger);
      await settle();
      expect(h.ensureStarted).toHaveBeenCalledTimes(1);

      // The misordered host: phase 2 registers persistence later, then whoever
      // owns `openAndMigrate` resolves it.
      h.registerConnection();
      h.resolveConnection();
      h.fireConnectionOpen();
      await settle();

      expect(h.ensureStarted).toHaveBeenCalledTimes(2);
      expect(h.ensureStarted).toHaveBeenNthCalledWith(2, 'd:/ws');
    });

    it('arms before the connection can open, so no first open is missed', async () => {
      const h = makeHarness();
      startTaskSpecsIndex(h.container, h.logger);
      await settle();

      h.registerConnection();
      // Resolution is what arms the subscription, and whoever opens the
      // connection must resolve it first — so a subscriber is live before
      // `openAndMigrate` could possibly emit.
      h.resolveConnection();
      expect(h.openSubscriberCount()).toBe(1);
    });

    it('still re-warms on a REOPEN after a late registration', async () => {
      const h = makeHarness();
      startTaskSpecsIndex(h.container, h.logger);
      await settle();

      h.registerConnection();
      h.resolveConnection();
      h.fireConnectionOpen();
      h.fireConnectionOpen();
      await settle();

      expect(h.ensureStarted).toHaveBeenCalledTimes(3);
    });

    it('does not subscribe when the helper was disposed before the connection appeared', async () => {
      const h = makeHarness();
      const disposable = startTaskSpecsIndex(h.container, h.logger);
      await settle();
      disposable.dispose();

      h.registerConnection();
      h.resolveConnection();
      h.fireConnectionOpen();
      await settle();

      expect(h.openSubscriberCount()).toBe(0);
      expect(h.ensureStarted).toHaveBeenCalledTimes(1);
    });

    it('stays quiet on VS Code, which registers no connection at all', async () => {
      const h = makeHarness();
      startTaskSpecsIndex(h.container, h.logger);
      await settle();

      // The armed interceptor never fires. An absent connection is the normal
      // VS Code shape, so it must not produce a warning — a WARN here is why
      // this was not the chosen fix.
      expect(h.ensureStarted).toHaveBeenCalledTimes(1);
      expect(h.logger.warn).not.toHaveBeenCalled();
    });
  });
});
