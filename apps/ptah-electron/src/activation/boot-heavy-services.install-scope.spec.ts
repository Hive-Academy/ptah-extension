/**
 * Install-scope migration trigger in the Electron heavy boot
 * (TASK_2026_853 Phase D, D-6 wiring, D-D5).
 *
 * Pins three things about `boot-heavy-services.ts`:
 *
 *   1. ORDER — the migration's `run()` is started after the window exists and
 *      before `refreshUserLayer`.
 *   2. NOT AWAITED — a `run()` that never settles neither holds the boot nor
 *      the user-layer pass after it.
 *   3. NON-FATAL — a rejected `run()` is logged through the Logger and a
 *      migration that cannot even be resolved is logged to the console; in
 *      both cases the boot continues to the reconcile.
 *
 * The booter is driven for real against a hand-rolled container in the
 * three-phase shape `main.ts` runs (reserve, window, open the gate), like
 * `boot-order.spec.ts`. The Thoth runtime and `plugin-activation` are mocked:
 * that spec already pins their own ordering, and here they are only markers.
 */

import 'reflect-metadata';

const mockCallOrder: string[] = [];

jest.mock('./plugin-activation', () => ({
  initPluginLoader: jest.fn(() => {
    mockCallOrder.push('initPluginLoader');
  }),
  refreshUserLayer: jest.fn(async () => {
    mockCallOrder.push('refreshUserLayer');
  }),
  reconcileHarness: jest.fn(async () => {
    mockCallOrder.push('reconcileHarness');
  }),
  propagateHarness: jest.fn(async () => undefined),
}));

jest.mock('@ptah-extension/thoth-runtime', () => ({
  bootThothRuntime: jest.fn(async () => {
    mockCallOrder.push('bootThothRuntime');
    return {
      sqliteConnection: { isOpen: true },
      memoryCurator: null,
      memoryTrigger: null,
      symbolWatcher: null,
      statusBridgeDisposables: [],
      cronScheduler: null,
    };
  }),
  startThothCron: jest.fn(async () => undefined),
  createActivityEmitter: jest.fn(() => jest.fn()),
}));

// Only the class token is needed; the real barrel pulls the whole RPC graph.
jest.mock('@ptah-extension/rpc-handlers', () => ({
  InstallScopeMigrationService: class InstallScopeMigrationService {},
}));

import type { DependencyContainer } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import { InstallScopeMigrationService } from '@ptah-extension/rpc-handlers';

import { BootCoordinator } from './boot-coordinator';
import { createHeavyServicesBooter } from './boot-heavy-services';
import { refreshUserLayer } from './plugin-activation';

function makeContainer(
  entries: Array<[unknown, unknown]>,
): DependencyContainer {
  const map = new Map<unknown, unknown>(entries);
  return {
    isRegistered: (token: unknown) => map.has(token),
    resolve: (token: unknown) => {
      if (!map.has(token)) throw new Error(`not registered: ${String(token)}`);
      return map.get(token);
    },
  } as unknown as DependencyContainer;
}

interface Harness {
  container: DependencyContainer;
  run: jest.Mock;
  logger: { error: jest.Mock; warn: jest.Mock; info: jest.Mock };
}

/**
 * `run` is the migration's `run()`. Pass `null` to leave the service
 * unregistered, so resolving it throws.
 */
function makeHarness(run: jest.Mock | null): Harness {
  const logger = { error: jest.fn(), warn: jest.fn(), info: jest.fn() };
  const entries: Array<[unknown, unknown]> = [
    [TOKENS.LOGGER, logger],
    [
      PLATFORM_TOKENS.CONTENT_DOWNLOAD,
      {
        getPluginsPath: jest.fn(() => '/plugins'),
        // Never settles: keeps the post-download pass out of the order.
        ensureContent: jest.fn(() => new Promise(() => undefined)),
      },
    ],
  ];
  if (run !== null) entries.push([InstallScopeMigrationService, { run }]);
  return {
    container: makeContainer(entries),
    run: run ?? jest.fn(),
    logger,
  };
}

/** Reserve pre-window, create the window, open the gate, await the boot. */
async function driveBoot(
  container: DependencyContainer,
  roots: readonly string[] = ['/ws'],
): Promise<void> {
  const booter = createHeavyServicesBooter({
    container,
    coordinator: new BootCoordinator(),
  });
  const reserved = roots.map((root) => booter.startOrJoin(root));
  // Several turns: the reservation must not start anything before the window.
  await Promise.resolve();
  await Promise.resolve();
  mockCallOrder.push('createMainWindow');
  booter.openWindowGate();
  await Promise.all(reserved);
}

beforeEach(() => {
  mockCallOrder.length = 0;
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Electron heavy boot — install-scope migration trigger', () => {
  it('starts the migration after the window and before refreshUserLayer', async () => {
    const run = jest.fn(async () => {
      mockCallOrder.push('migration.run');
    });
    const { container } = makeHarness(run);

    await driveBoot(container);

    expect(run).toHaveBeenCalledTimes(1);
    const at = (name: string) => mockCallOrder.indexOf(name);
    expect(at('createMainWindow')).toBeGreaterThanOrEqual(0);
    expect(at('migration.run')).toBeGreaterThan(at('createMainWindow'));
    expect(at('migration.run')).toBeGreaterThan(at('initPluginLoader'));
    expect(at('migration.run')).toBeLessThan(at('refreshUserLayer'));
    expect(at('refreshUserLayer')).toBeLessThan(at('reconcileHarness'));
  });

  it('does not await the migration: a run that never settles leaves the boot complete', async () => {
    let settled = false;
    const run = jest.fn(() => {
      mockCallOrder.push('migration.run');
      return new Promise<void>(() => undefined).finally(() => {
        settled = true;
      });
    });
    const { container } = makeHarness(run);

    // Resolves although `run()` is still pending.
    await driveBoot(container);

    expect(settled).toBe(false);
    expect(refreshUserLayer).toHaveBeenCalledWith(
      container,
      '/ws',
      'activation',
    );
    expect(mockCallOrder).toContain('reconcileHarness');
  });

  it('logs a rejected run through the Logger and still finishes the boot', async () => {
    const failure = new Error('ledger unreadable');
    const run = jest.fn(async () => {
      throw failure;
    });
    const { container, logger } = makeHarness(run);

    await driveBoot(container);
    // Let the detached rejection handler run.
    await new Promise((resolve) => setImmediate(resolve));

    expect(logger.error).toHaveBeenCalledWith(
      '[Ptah Electron] Install-scope migration failed (non-fatal)',
      failure,
    );
    expect(mockCallOrder).toEqual(
      expect.arrayContaining(['refreshUserLayer', 'reconcileHarness']),
    );
  });

  it('logs a migration that cannot be resolved and still finishes the boot', async () => {
    const { container } = makeHarness(null);

    await driveBoot(container);

    expect(console.error).toHaveBeenCalledWith(
      '[Ptah Electron] Install-scope migration could not start (non-fatal):',
      expect.stringContaining('not registered'),
    );
    expect(mockCallOrder).toEqual(
      expect.arrayContaining(['refreshUserLayer', 'reconcileHarness']),
    );
  });

  it('starts the migration once per process, not once per workspace boot', async () => {
    const run = jest.fn(async () => undefined);
    const { container } = makeHarness(run);

    await driveBoot(container, ['/ws-a', '/ws-b']);

    expect(refreshUserLayer).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
