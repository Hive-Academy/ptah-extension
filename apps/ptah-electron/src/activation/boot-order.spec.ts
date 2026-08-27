/**
 * Boot-order regression spec (TASK_2026_331 B1.T8).
 *
 * ## What this asserts, and why it is behavioural
 *
 * The whole task is a reordering, so the thing that can regress is a SEQUENCE.
 * `wire-runtime.boot-order.spec.ts` pins the textual half — what sits where
 * inside one function body. This pins the half that text cannot reach: what
 * actually runs, in what order, when the phases are driven end to end.
 *
 * The three-phase shape it drives is the one `main.ts` runs:
 *
 *   1. PRE-WINDOW  — reserve the heavy boot for the startup root. Nothing runs.
 *   2. WINDOW      — `createMainWindow`. Recorded as a marker.
 *   3. POST-WINDOW — open the gate; the reserved boot runs.
 *
 * `boot-heavy-services.ts` is driven for real against a hand-rolled container,
 * and so is `bootThothRuntime` behind it — so `openAndMigrate` being first is
 * observed, not pattern-matched. Only `plugin-activation` is mocked, because
 * its functions walk and hash real directories.
 *
 * `wire-runtime.ts` itself is NOT imported here: it pulls in the Electron
 * application menu and the full RPC surface, so standing it up would test the
 * mock graph rather than the ordering — the reasoning already recorded in
 * `wire-runtime.boot-order.spec.ts`.
 */

import 'reflect-metadata';

const mockCallOrder: string[] = [];

jest.mock('./plugin-activation', () => ({
  initPluginLoader: jest.fn(() => {
    mockCallOrder.push('initPluginLoader');
  }),
  mirrorUserLayer: jest.fn(async () => {
    mockCallOrder.push('mirrorUserLayer');
  }),
  reconcileUserLayer: jest.fn(async () => {
    mockCallOrder.push('reconcileUserLayer');
  }),
  reconcileHarness: jest.fn(async () => {
    mockCallOrder.push('reconcileHarness');
  }),
  syncSkillRegistryCatalog: jest.fn(async () => {
    mockCallOrder.push('syncSkillRegistryCatalog');
  }),
  propagateHarness: jest.fn(async () => undefined),
}));

import type { DependencyContainer } from 'tsyringe';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';
import { MEMORY_TOKENS } from '@ptah-extension/memory-curator';
import { SKILL_SYNTHESIS_TOKENS } from '@ptah-extension/skill-synthesis';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import { AUTH_PROVIDERS_TOKENS } from '@ptah-extension/auth-providers';

import { BootCoordinator } from './boot-coordinator';
import { createHeavyServicesBooter } from './boot-heavy-services';
import {
  startAgentAdapterInitialization,
  startMembershipVerification,
} from './bootstrap';

const WORKSPACE = '/ws';

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

function record(name: string): void {
  mockCallOrder.push(name);
}

interface Stubs {
  container: DependencyContainer;
  scanAndImport: jest.Mock;
  openAndMigrate: jest.Mock;
  memoryTriggerStart: jest.Mock;
}

function makeStubs(): Stubs {
  const openAndMigrate = jest.fn(async () => {
    // A real `openAndMigrate` yields; asserting order across an await is the
    // point, so this one does too.
    await Promise.resolve();
    record('openAndMigrate');
  });
  const memoryTriggerStart = jest.fn(() => record('memoryTrigger.start'));
  const scanAndImport = jest.fn(async () => {
    record('scanAndImport');
    return 3;
  });

  const container = makeContainer([
    [
      PERSISTENCE_TOKENS.SQLITE_CONNECTION,
      {
        isOpen: true,
        db: { pragma: jest.fn() },
        openAndMigrate,
        close: jest.fn(),
        vecLoadDiagnostic: {
          ok: true,
          reason: 'loaded',
          electronVersion: '40.0.0',
          processArch: 'x64',
          processPlatform: 'win32',
          errorChain: [],
        },
      },
    ],
    [
      TOKENS.WEBVIEW_MANAGER,
      { broadcastMessage: jest.fn().mockResolvedValue(undefined) },
    ],
    [
      MEMORY_TOKENS.MEMORY_CURATOR,
      {
        start: jest.fn(() => record('memoryCurator.start')),
        onEvent: jest.fn(),
      },
    ],
    [MEMORY_TOKENS.MEMORY_TRIGGER_SERVICE, { start: memoryTriggerStart }],
    [
      SKILL_SYNTHESIS_TOKENS.SKILL_SYNTHESIS_SERVICE,
      {
        start: jest.fn(async () => {
          record('skillSynthesis.start');
        }),
      },
    ],
    [
      PLATFORM_TOKENS.CONTENT_DOWNLOAD,
      {
        getPluginsPath: jest.fn(() => '/plugins'),
        ensureContent: jest.fn(async () => ({
          success: true,
          fromCache: true,
        })),
      },
    ],
    [
      AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_MODELS,
      { prefetchPricing: jest.fn(async () => 0) },
    ],
    [
      TOKENS.CLI_DETECTION_SERVICE,
      { detectAll: jest.fn(async () => []), refreshCliTokens: jest.fn() },
    ],
    [SDK_TOKENS.SDK_SESSION_IMPORTER, { scanAndImport }],
    // GIT_INFO_SERVICE is deliberately absent: the git-watcher block is
    // non-fatal and this keeps a real chokidar watcher off the test's disk.
  ]);

  return { container, scanAndImport, openAndMigrate, memoryTriggerStart };
}

/**
 * Drive the three phases in the order `main.ts` runs them and return the
 * recorded call sequence.
 */
async function driveActivation(stubs: Stubs): Promise<string[]> {
  const coordinator = new BootCoordinator();
  const booter = createHeavyServicesBooter({
    container: stubs.container,
    coordinator,
  });

  // 1. PRE-WINDOW — reservation only.
  const reserved = booter.startOrJoin(WORKSPACE);
  record('reserved');

  // Give the reservation several turns to prove it really has not started.
  await Promise.resolve();
  await Promise.resolve();

  // 2. WINDOW.
  record('createMainWindow');

  // 3. POST-WINDOW.
  booter.openWindowGate();
  await reserved;

  return mockCallOrder;
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

describe('activation order — the window comes first', () => {
  it('creates the window before the session import, the harness reconcile and the memory trigger', async () => {
    const order = await driveActivation(makeStubs());
    const window = order.indexOf('createMainWindow');

    expect(window).toBeGreaterThanOrEqual(0);
    expect(window).toBeLessThan(order.indexOf('scanAndImport'));
    expect(window).toBeLessThan(order.indexOf('reconcileHarness'));
    expect(window).toBeLessThan(order.indexOf('memoryTrigger.start'));
    expect(window).toBeLessThan(order.indexOf('mirrorUserLayer'));
    expect(window).toBeLessThan(order.indexOf('skillSynthesis.start'));
  });

  it('runs NOTHING of the heavy boot before the gate opens', async () => {
    const order = await driveActivation(makeStubs());
    const window = order.indexOf('createMainWindow');

    // Only the reservation marker precedes the window. If anything else does,
    // some step escaped the gate.
    expect(order.slice(0, window)).toEqual(['reserved']);
  });

  it('opens SQLite as the FIRST call of the post-window phase', async () => {
    // Until the readiness contract lands, this ordering is the only thing that
    // bounds the window in which a renderer RPC can arrive before SQLite is
    // open. Nothing may be hoisted in front of it.
    const order = await driveActivation(makeStubs());
    const afterWindow = order.slice(order.indexOf('createMainWindow') + 1);

    expect(afterWindow[0]).toBe('openAndMigrate');
  });

  it('keeps the deliberate double reconcile after the window', async () => {
    const order = await driveActivation(makeStubs());

    expect(order.filter((c) => c === 'reconcileHarness')).toHaveLength(2);
    expect(order.filter((c) => c === 'mirrorUserLayer')).toHaveLength(2);
    expect(order.filter((c) => c === 'reconcileUserLayer')).toHaveLength(2);
  });
});

describe('activation order — the one-shot latch', () => {
  it('joins the same root instead of booting twice', async () => {
    const stubs = makeStubs();
    const coordinator = new BootCoordinator();
    const booter = createHeavyServicesBooter({
      container: stubs.container,
      coordinator,
    });

    const first = booter.startOrJoin(WORKSPACE);
    const second = booter.startOrJoin(WORKSPACE);
    expect(second).toBe(first);

    booter.openWindowGate();
    await first;

    expect(stubs.openAndMigrate).toHaveBeenCalledTimes(1);
    expect(stubs.scanAndImport).toHaveBeenCalledTimes(1);
  });

  it('normalizes separators and case, so one directory is one boot', async () => {
    const stubs = makeStubs();
    const coordinator = new BootCoordinator();
    const booter = createHeavyServicesBooter({
      container: stubs.container,
      coordinator,
    });

    const a = booter.startOrJoin('C:\\Repos\\Ptah\\');
    const b = booter.startOrJoin('c:/repos/ptah');
    expect(b).toBe(a);

    booter.openWindowGate();
    await a;
    expect(stubs.openAndMigrate).toHaveBeenCalledTimes(1);
  });

  it('does not let a folder-change event in the same tick steal the startup root', async () => {
    // The reservation is synchronous, so the startup root's entry exists before
    // any listener callback can run. A different root gets its OWN entry; it
    // does not replace the startup one.
    const stubs = makeStubs();
    const coordinator = new BootCoordinator();
    const booter = createHeavyServicesBooter({
      container: stubs.container,
      coordinator,
    });

    const startup = booter.startOrJoin(WORKSPACE);
    const other = booter.startOrJoin('/other-ws');

    expect(other).not.toBe(startup);
    expect(booter.startOrJoin(WORKSPACE)).toBe(startup);

    booter.openWindowGate();
    await Promise.all([startup, other]);

    expect(stubs.scanAndImport).toHaveBeenCalledTimes(2);
    expect(stubs.scanAndImport.mock.calls[0][0]).toBe(WORKSPACE);
  });

  it('stops the boot when the coordinator is aborted before the gate opens', async () => {
    const stubs = makeStubs();
    const coordinator = new BootCoordinator();
    const booter = createHeavyServicesBooter({
      container: stubs.container,
      coordinator,
    });

    const reserved = booter.startOrJoin(WORKSPACE);
    coordinator.abort();
    booter.openWindowGate();
    await reserved;

    expect(stubs.openAndMigrate).not.toHaveBeenCalled();
    expect(stubs.scanAndImport).not.toHaveBeenCalled();
  });
});

describe('activation order — the network never gates the window', () => {
  it('leaves verifyLicense and agentAdapter.initialize pending across window creation', async () => {
    // Both are started with `void` in `bootstrapElectron`. Modelling that here
    // with hanging stubs shows the window marker is reached while neither has
    // resolved — which is precisely what awaiting them used to prevent.
    let settledLicense = false;
    let settledAdapter = false;

    const container = makeContainer([
      [
        TOKENS.LICENSE_SERVICE,
        { verifyLicense: jest.fn(() => new Promise(() => undefined)) },
      ],
      [
        TOKENS.AGENT_ADAPTER,
        {
          initialize: jest.fn(() => new Promise(() => undefined)),
          preloadSdk: jest.fn(),
        },
      ],
    ]);

    void startMembershipVerification(container).then(() => {
      settledLicense = true;
    });
    void startAgentAdapterInitialization(container).then(() => {
      settledAdapter = true;
    });

    await Promise.resolve();
    await Promise.resolve();
    record('createMainWindow');

    expect(mockCallOrder).toContain('createMainWindow');
    expect(settledLicense).toBe(false);
    expect(settledAdapter).toBe(false);
  });
});
