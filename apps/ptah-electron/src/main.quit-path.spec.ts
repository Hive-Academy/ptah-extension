/**
 * `window-all-closed` quit path (TASK_2026_180, B5.1.2).
 *
 * ## The parity group is the whole safety argument for shipping C5 default-off
 *
 * `skillSynthesis.trayKeepalive` ships `false`, so no tray is created and the
 * quit path must be BYTE-IDENTICAL to the pre-change code. The `parity` group
 * below encodes that pre-change code as an executable oracle and asserts the
 * new implementation agrees with it on every platform. If C5 ever starts
 * suppressing the quit by default, that group fails.
 *
 * ## Why this spec does not import `main.ts`
 *
 * `main.ts` uses `import.meta.url`, and `tsconfig.spec.json` compiles with
 * `module: commonjs` — importing it fails to compile with
 * `TS1343: The 'import.meta' meta-property is only allowed when ...`. Verified,
 * not assumed. The decision therefore lives in `handleWindowAllClosed`
 * (`services/tray/tray.service.ts`) and `main.ts` retains only a branch-free
 * delegation to it:
 *
 * ```ts
 * app.on('window-all-closed', () => {
 *   handleWindowAllClosed({
 *     platform: process.platform,
 *     quit: () => app.quit(),
 *     hasLiveTray: () => trayService?.isLive() ?? false,
 *   });
 * });
 * ```
 */

import { handleWindowAllClosed } from './services/tray/tray.service';
import { createEmptyBootRefs } from './activation/boot-coordinator';
import type { BootRefs } from './activation/boot-coordinator';
import { BOOT_DRAIN_BUDGET_MS, handleWillQuit } from './activation/shutdown';

/** Every platform Electron ships for, so the oracle is exercised on all of them. */
const PLATFORMS: readonly NodeJS.Platform[] = [
  'win32',
  'linux',
  'darwin',
  'freebsd',
];

/**
 * The pre-change handler, verbatim from `main.ts:161-165` before C5:
 *
 * ```ts
 * app.on('window-all-closed', () => {
 *   if (process.platform !== 'darwin') {
 *     app.quit();
 *   }
 * });
 * ```
 */
function preChangeHandler(platform: NodeJS.Platform, quit: () => void): void {
  if (platform !== 'darwin') {
    quit();
  }
}

describe('parity — with the shipped default (trayKeepalive false ⇒ no tray)', () => {
  it.each(PLATFORMS)(
    'on %s, matches the pre-change handler exactly',
    (platform) => {
      const expected = jest.fn();
      preChangeHandler(platform, expected);

      const actual = jest.fn();
      handleWindowAllClosed({
        platform,
        quit: actual,
        hasLiveTray: () => false,
      });

      expect(actual.mock.calls).toEqual(expected.mock.calls);
    },
  );

  it.each<[NodeJS.Platform]>([['win32'], ['linux'], ['freebsd']])(
    'quits exactly once on %s',
    (platform) => {
      const quit = jest.fn();

      handleWindowAllClosed({ platform, quit, hasLiveTray: () => false });

      expect(quit).toHaveBeenCalledTimes(1);
    },
  );

  it('does not quit on darwin', () => {
    const quit = jest.fn();

    handleWindowAllClosed({
      platform: 'darwin',
      quit,
      hasLiveTray: () => false,
    });

    expect(quit).not.toHaveBeenCalled();
  });
});

describe('keep-alive — a LIVE tray suppresses the quit', () => {
  it.each<[NodeJS.Platform]>([['win32'], ['linux'], ['freebsd']])(
    'does not quit on %s while a tray is live',
    (platform) => {
      const quit = jest.fn();

      handleWindowAllClosed({ platform, quit, hasLiveTray: () => true });

      expect(quit).not.toHaveBeenCalled();
    },
  );

  it('leaves darwin behaviour unchanged when a tray is live', () => {
    const quit = jest.fn();

    handleWindowAllClosed({
      platform: 'darwin',
      quit,
      hasLiveTray: () => true,
    });

    expect(quit).not.toHaveBeenCalled();
  });
});

describe('R10 fail-safe — liveness, not the setting, gates the suppression', () => {
  it('quits when the tray failed to construct, even though keep-alive was requested', () => {
    // `PtahTrayService.create` returned null (missing icon, no tray host, ...),
    // so `main.ts` passes `hasLiveTray: () => false`. Gating on the
    // `trayKeepalive` setting instead would strand an unkillable process here.
    const quit = jest.fn();

    handleWindowAllClosed({
      platform: 'win32',
      quit,
      hasLiveTray: () => false,
    });

    expect(quit).toHaveBeenCalledTimes(1);
  });

  it('consults tray liveness at close time, not at startup', () => {
    const quit = jest.fn();
    let live = true;
    const deps = {
      platform: 'win32' as NodeJS.Platform,
      quit,
      hasLiveTray: () => live,
    };

    handleWindowAllClosed(deps);
    expect(quit).not.toHaveBeenCalled();

    // The tray was destroyed after startup; the app must become quittable again.
    live = false;
    handleWindowAllClosed(deps);
    expect(quit).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// `will-quit` — LIFO disposal and quit-during-boot (TASK_2026_331 B1.T6).
//
// The heavy boot now runs BEHIND the window, so a quit can land while services
// are still being created. Two properties have to hold:
//
//   1. The disposal chain still runs in the exact LIFO order it always did.
//   2. A quit during boot aborts it, waits a BOUNDED 2 s, and then disposes
//      whatever the boot managed to create — reading the coordinator's stable
//      refs object rather than a snapshot taken before those services existed.
// ---------------------------------------------------------------------------

/**
 * The disposal order, as a list of ref field names, exactly as `main.ts` ran it
 * before this task. Written out here so a reorder fails loudly and by name.
 */
const EXPECTED_LIFO_ORDER: readonly string[] = [
  'providerProxyPool',
  'clearTimers',
  'updateManager',
  'gitWatcher',
  'symbolWatcher',
  'statusBridgeDisposables',
  'skillTrigger',
  'skillSynthesis',
  'cronScheduler',
  'memoryTrigger',
  'memoryCurator',
  'sqliteConnection',
  'chatBridge',
  'messagingGateway',
  'disposeVoiceWorker',
  'agentProcessManager',
  'cliRegistry',
  'diagnostics',
];

/** A fully-populated refs object whose every handle records its own name. */
function makeFullRefs(order: string[]): BootRefs {
  const record = (name: string) => () => {
    order.push(name);
  };
  const refs = createEmptyBootRefs();
  refs.providerProxyPool = {
    disposeAll: async () => {
      order.push('providerProxyPool');
    },
  };
  refs.updateManager = {
    dispose: record('updateManager'),
  } as unknown as BootRefs['updateManager'];
  refs.gitWatcher = {
    stop: record('gitWatcher'),
    switchWorkspace: jest.fn(),
  };
  refs.symbolWatcher = {
    close: record('symbolWatcher'),
  } as unknown as BootRefs['symbolWatcher'];
  refs.statusBridgeDisposables = [
    { dispose: record('statusBridgeDisposables') },
  ];
  refs.skillTrigger = {
    stop: record('skillTrigger'),
  } as unknown as BootRefs['skillTrigger'];
  refs.skillSynthesis = {
    stop: record('skillSynthesis'),
  } as unknown as BootRefs['skillSynthesis'];
  refs.cronScheduler = {
    stop: record('cronScheduler'),
  } as unknown as BootRefs['cronScheduler'];
  refs.memoryTrigger = {
    stop: record('memoryTrigger'),
  } as unknown as BootRefs['memoryTrigger'];
  refs.memoryCurator = {
    stop: record('memoryCurator'),
  } as unknown as BootRefs['memoryCurator'];
  refs.sqliteConnection = {
    close: record('sqliteConnection'),
  } as unknown as BootRefs['sqliteConnection'];
  refs.chatBridge = {
    stop: record('chatBridge'),
  } as unknown as BootRefs['chatBridge'];
  refs.messagingGateway = {
    stop: async () => {
      order.push('messagingGateway');
    },
  } as unknown as BootRefs['messagingGateway'];
  refs.agentProcessManager = {
    disposeAll: async () => {
      order.push('agentProcessManager');
    },
  };
  refs.cliRegistry = { disposeAll: record('cliRegistry') };
  refs.diagnostics = {
    dispose: record('diagnostics'),
  } as unknown as BootRefs['diagnostics'];
  return refs;
}

describe('will-quit — LIFO disposal order', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('disposes every handle in the pre-change order', () => {
    const order: string[] = [];
    const refs = makeFullRefs(order);

    handleWillQuit({
      refs,
      abortBoot: jest.fn(),
      isBootRunning: () => false,
      awaitBootCompletion: async () => undefined,
      flushWorkspacePersistence: jest.fn(),
      flushSessionMetadataStores: jest.fn(),
      clearTimers: () => order.push('clearTimers'),
      disposeVoiceWorker: () => order.push('disposeVoiceWorker'),
      deferQuit: jest.fn(),
      quit: jest.fn(),
    });

    expect(order).toEqual(EXPECTED_LIFO_ORDER);
  });

  it('keeps disposing after one handle throws', () => {
    const order: string[] = [];
    const refs = makeFullRefs(order);
    refs.sqliteConnection = {
      close: () => {
        throw new Error('close failed');
      },
    } as unknown as BootRefs['sqliteConnection'];

    handleWillQuit({
      refs,
      abortBoot: jest.fn(),
      isBootRunning: () => false,
      awaitBootCompletion: async () => undefined,
      flushWorkspacePersistence: jest.fn(),
      flushSessionMetadataStores: jest.fn(),
      clearTimers: () => order.push('clearTimers'),
      disposeVoiceWorker: () => order.push('disposeVoiceWorker'),
      deferQuit: jest.fn(),
      quit: jest.fn(),
    });

    // Diagnostics is LAST, so reaching it proves nothing after the throw was
    // skipped.
    expect(order[order.length - 1]).toBe('diagnostics');
  });

  it('does not defer the quit when no boot is in flight', () => {
    const order: string[] = [];
    const deferQuit = jest.fn();
    const quit = jest.fn();

    handleWillQuit({
      refs: makeFullRefs(order),
      abortBoot: jest.fn(),
      isBootRunning: () => false,
      awaitBootCompletion: async () => undefined,
      flushWorkspacePersistence: jest.fn(),
      flushSessionMetadataStores: jest.fn(),
      clearTimers: jest.fn(),
      disposeVoiceWorker: jest.fn(),
      deferQuit,
      quit,
    });

    expect(deferQuit).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
  });
});

describe('will-quit — quit during the post-window boot', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('aborts the boot, waits the 2 s budget, then disposes in LIFO order', async () => {
    const order: string[] = [];
    const refs = makeFullRefs(order);
    const abortBoot = jest.fn();
    const deferQuit = jest.fn();
    const quit = jest.fn();

    // A boot that never settles: the budget is the only thing that ends the
    // wait, which is exactly the failure mode this guards.
    const awaitBootCompletion = jest.fn(
      (timeoutMs: number) =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, timeoutMs);
        }),
    );

    handleWillQuit({
      refs,
      abortBoot,
      isBootRunning: () => true,
      awaitBootCompletion,
      flushWorkspacePersistence: jest.fn(),
      flushSessionMetadataStores: jest.fn(),
      clearTimers: () => order.push('clearTimers'),
      disposeVoiceWorker: () => order.push('disposeVoiceWorker'),
      deferQuit,
      quit,
    });

    // The abort is immediate; nothing is disposed yet.
    expect(abortBoot).toHaveBeenCalledTimes(1);
    expect(deferQuit).toHaveBeenCalledTimes(1);
    expect(awaitBootCompletion).toHaveBeenCalledWith(BOOT_DRAIN_BUDGET_MS);
    expect(order).toEqual([]);

    jest.advanceTimersByTime(BOOT_DRAIN_BUDGET_MS);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(order).toEqual(EXPECTED_LIFO_ORDER);
    // The re-issued quit is what lets Electron finish; `main.ts` short-circuits
    // the re-emitted `will-quit` with its one-shot guard.
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it('aborts BEFORE anything is disposed, so no scan writes to a stopped service', () => {
    const order: string[] = [];
    handleWillQuit({
      refs: makeFullRefs(order),
      abortBoot: () => order.push('abortBoot'),
      isBootRunning: () => false,
      awaitBootCompletion: async () => undefined,
      flushWorkspacePersistence: jest.fn(),
      flushSessionMetadataStores: jest.fn(),
      clearTimers: () => order.push('clearTimers'),
      disposeVoiceWorker: () => order.push('disposeVoiceWorker'),
      deferQuit: jest.fn(),
      quit: jest.fn(),
    });

    expect(order[0]).toBe('abortBoot');
  });

  it('disposes a service the boot created AFTER the quit arrived', async () => {
    // The reason `refs` is a stable object rather than fifteen copies: a
    // service that appears mid-drain is still in the object the chain reads.
    const order: string[] = [];
    const refs = makeFullRefs(order);
    refs.gitWatcher = null;

    handleWillQuit({
      refs,
      abortBoot: jest.fn(),
      isBootRunning: () => true,
      awaitBootCompletion: (timeoutMs: number) =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, timeoutMs);
        }),
      flushWorkspacePersistence: jest.fn(),
      flushSessionMetadataStores: jest.fn(),
      clearTimers: () => order.push('clearTimers'),
      disposeVoiceWorker: () => order.push('disposeVoiceWorker'),
      deferQuit: jest.fn(),
      quit: jest.fn(),
    });

    // The in-flight boot finishes creating the watcher during the grace period.
    refs.gitWatcher = {
      stop: () => order.push('gitWatcher'),
      switchWorkspace: jest.fn(),
    };

    jest.advanceTimersByTime(BOOT_DRAIN_BUDGET_MS);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(order).toContain('gitWatcher');
  });
});
