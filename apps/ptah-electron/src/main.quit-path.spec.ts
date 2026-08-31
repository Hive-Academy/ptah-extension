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
import {
  BOOT_DRAIN_BUDGET_MS,
  GATEWAY_STOP_BUDGET_MS,
  handleWillQuit,
  requiresDeferredDisposal,
} from './activation/shutdown';

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
 * The disposal order, as a list of ref field names. Written out here so a
 * reorder fails loudly and by name.
 *
 * One position moved since TASK_2026_331: `chatBridge` and `messagingGateway`
 * now come BEFORE `sqliteConnection`. They used to start during
 * `registerPostWindow`, i.e. before SQLite was open, so LIFO put their stop
 * behind the close. They now start behind the persistence gate — after SQLite
 * is open and migrated — so LIFO puts their stop in front of it, and
 * `GatewayService.stop()` (which drains outbound delivery and settles turn
 * state through `gateway_messages`) no longer writes into a closed connection
 * (TASK_2026_347).
 *
 * The position alone is not the guarantee — the chain AWAITS the stop before it
 * closes, and {@link drainingGatewayStop} is written so that this list can only
 * come out in this order if it really did. See the "gateway drain gates the
 * SQLite close" group below.
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
  'chatBridge',
  'messagingGateway',
  'sqliteConnection',
  'disposeVoiceWorker',
  'agentProcessManager',
  'cliRegistry',
  'diagnostics',
];

/**
 * A `GatewayService.stop()` stand-in that behaves like the real one.
 *
 * The real stop is `cancelAllReconnects()` -> `await outbound.drainAll()` ->
 * `StreamCoalescer.drainAll()` -> `await lifecycle.stopAdapters()`: it settles
 * several microtask turns later, and the buffered flush it performs on the way
 * out WRITES to `gateway_messages`. So the recorded name is pushed AFTER the
 * awaits, not as the first statement.
 *
 * That detail is the whole point of this mock. A stop recorded on entry pins
 * only the invocation order and passes just as happily against a fire-and-forget
 * `void gateway.stop()` followed by a same-tick `SQLite close` — which is the
 * defect this spec exists to catch (TASK_2026_347 round 2).
 */
async function drainingGatewayStop(order: string[]): Promise<void> {
  await Promise.resolve(); // outbound.drainAll()
  await Promise.resolve(); // StreamCoalescer.drainAll()
  await Promise.resolve(); // lifecycle.stopAdapters()
  order.push('messagingGateway'); // the persistence write, last
}

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
    stop: () => drainingGatewayStop(order),
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

/** Let every already-queued microtask run. Deterministic; no timers involved. */
async function flushMicrotasks(turns = 30): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    await Promise.resolve();
  }
}

/** The parts of `QuitSequenceDeps` no ordering test cares about. */
function inertDeps(order: string[]) {
  return {
    abortBoot: jest.fn(),
    isBootRunning: () => false,
    awaitBootCompletion: async () => undefined,
    flushWorkspacePersistence: jest.fn(),
    flushSessionMetadataStores: jest.fn(),
    clearTimers: () => order.push('clearTimers'),
    disposeVoiceWorker: () => order.push('disposeVoiceWorker'),
  };
}

describe('will-quit — LIFO disposal order', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('disposes every handle in the pre-change order', async () => {
    const order: string[] = [];
    const refs = makeFullRefs(order);
    const quit = jest.fn();

    handleWillQuit({
      ...inertDeps(order),
      refs,
      deferQuit: jest.fn(),
      quit,
    });

    await flushMicrotasks();

    expect(order).toEqual(EXPECTED_LIFO_ORDER);
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it('keeps disposing after one handle throws', async () => {
    const order: string[] = [];
    const refs = makeFullRefs(order);
    refs.sqliteConnection = {
      close: () => {
        throw new Error('close failed');
      },
    } as unknown as BootRefs['sqliteConnection'];

    handleWillQuit({
      ...inertDeps(order),
      refs,
      deferQuit: jest.fn(),
      quit: jest.fn(),
    });

    await flushMicrotasks();

    // Diagnostics is LAST, so reaching it proves nothing after the throw was
    // skipped.
    expect(order[order.length - 1]).toBe('diagnostics');
  });

  it('stays fully synchronous when there is nothing to await', () => {
    // No gateway AND no agent manager means no `await` anywhere in the chain,
    // which is the pre-change shape: one synchronous listener, no
    // `preventDefault`, no re-issued quit. This is the parity case, and it must
    // produce the same order as the deferred path minus the two entries that
    // would have forced the deferral.
    //
    // The agent manager joined the gateway here in TASK_2026_334: its
    // `disposeAll()` is now awaited, because the final metadata flush has to
    // run after the references its exits stage.
    const order: string[] = [];
    const refs = makeFullRefs(order);
    refs.messagingGateway = null;
    refs.agentProcessManager = null;
    const deferQuit = jest.fn();
    const quit = jest.fn();

    const ranSynchronously = handleWillQuit({
      ...inertDeps(order),
      refs,
      deferQuit,
      quit,
    });

    expect(ranSynchronously).toBe(true);
    expect(order).toEqual(
      EXPECTED_LIFO_ORDER.filter(
        (name) => name !== 'messagingGateway' && name !== 'agentProcessManager',
      ),
    );
    expect(deferQuit).not.toHaveBeenCalled();
    expect(quit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// The gateway drain GATES the SQLite close (TASK_2026_347, round 2).
//
// Reordering the statements was not enough: `void gateway.stop()` followed by a
// same-tick `refs.sqliteConnection.close()` still closed the database before the
// drain's awaits resolved, so the flush that persists the final streamed reply
// landed on a closed handle — the very defect this task exists to close, moved
// from startup to shutdown. The quit is therefore DEFERRED whenever a gateway
// exists, and the close waits for the stop to settle (bounded).
// ---------------------------------------------------------------------------

describe('will-quit — the gateway drain gates the SQLite close', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('defers the quit for the gateway stop even with no boot in flight', () => {
    const order: string[] = [];
    const refs = makeFullRefs(order);
    const deferQuit = jest.fn();
    const quit = jest.fn();

    const ranSynchronously = handleWillQuit({
      ...inertDeps(order),
      refs,
      deferQuit,
      quit,
    });

    // Electron tears the process down the moment a synchronous listener
    // returns, so the deferral is what buys the drain its microtasks.
    expect(ranSynchronously).toBe(false);
    expect(deferQuit).toHaveBeenCalledTimes(1);
    // The head of the chain still ran synchronously...
    expect(order).toContain('providerProxyPool');
    expect(order).toContain('chatBridge');
    // ...and nothing past the gateway has run yet.
    expect(order).not.toContain('messagingGateway');
    expect(order).not.toContain('sqliteConnection');
    expect(quit).not.toHaveBeenCalled();
  });

  it('waits for a drain that spans a real timer before closing SQLite', async () => {
    // The strongest form of the guard: the stop settles 50 ms later, so no
    // number of microtask turns can smuggle the close in front of it.
    const order: string[] = [];
    const refs = makeFullRefs(order);
    refs.messagingGateway = {
      stop: () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            order.push('messagingGateway');
            resolve();
          }, 50);
        }),
    } as unknown as BootRefs['messagingGateway'];

    handleWillQuit({
      ...inertDeps(order),
      refs,
      deferQuit: jest.fn(),
      quit: jest.fn(),
    });

    await flushMicrotasks();
    expect(order).not.toContain('sqliteConnection');

    await jest.advanceTimersByTimeAsync(50);
    await flushMicrotasks();

    expect(order.indexOf('messagingGateway')).toBeLessThan(
      order.indexOf('sqliteConnection'),
    );
    expect(order).toEqual(EXPECTED_LIFO_ORDER);
  });

  it('closes anyway once a wedged stop exceeds its budget', async () => {
    // A quit that hangs is worse than a lost final delivery: the wait is
    // bounded, and it warns rather than silently dropping the write.
    const order: string[] = [];
    const refs = makeFullRefs(order);
    refs.messagingGateway = {
      stop: () => new Promise<void>(() => undefined),
    } as unknown as BootRefs['messagingGateway'];
    const quit = jest.fn();

    handleWillQuit({
      ...inertDeps(order),
      refs,
      deferQuit: jest.fn(),
      quit,
    });

    await flushMicrotasks();
    expect(order).not.toContain('sqliteConnection');
    expect(quit).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(GATEWAY_STOP_BUDGET_MS);
    await flushMicrotasks();

    expect(order).toContain('sqliteConnection');
    expect(order[order.length - 1]).toBe('diagnostics');
    expect(quit).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('Messaging gateway stop exceeded'),
    );
  });

  it('closes anyway when the stop rejects, and does not crash the quit', async () => {
    const order: string[] = [];
    const refs = makeFullRefs(order);
    refs.messagingGateway = {
      stop: async () => {
        await Promise.resolve();
        throw new Error('adapter socket already dead');
      },
    } as unknown as BootRefs['messagingGateway'];
    const quit = jest.fn();

    handleWillQuit({
      ...inertDeps(order),
      refs,
      deferQuit: jest.fn(),
      quit,
    });

    await flushMicrotasks();

    expect(order).toContain('sqliteConnection');
    expect(order[order.length - 1]).toBe('diagnostics');
    expect(quit).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      '[Ptah Electron] Messaging gateway stop failed (non-fatal):',
      'adapter socket already dead',
    );
  });

  it('names BOTH the gateway and the agent reaper as reasons to defer', () => {
    const order: string[] = [];
    const refs = makeFullRefs(order);

    expect(requiresDeferredDisposal(refs)).toBe(true);

    // Each is sufficient on its own, because each writes after an `await`: the
    // gateway drains into SQLite, and an exiting agent stages a session
    // reference that only the final flush writes (TASK_2026_334).
    refs.messagingGateway = null;
    expect(requiresDeferredDisposal(refs)).toBe(true);

    refs.agentProcessManager = null;
    expect(requiresDeferredDisposal(refs)).toBe(false);

    refs.messagingGateway = {
      stop: async () => undefined,
    } as unknown as BootRefs['messagingGateway'];
    expect(requiresDeferredDisposal(refs)).toBe(true);
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
      ...inertDeps(order),
      refs,
      abortBoot,
      isBootRunning: () => true,
      awaitBootCompletion,
      deferQuit,
      quit,
    });

    // The abort is immediate; nothing is disposed yet.
    expect(abortBoot).toHaveBeenCalledTimes(1);
    expect(deferQuit).toHaveBeenCalledTimes(1);
    expect(awaitBootCompletion).toHaveBeenCalledWith(BOOT_DRAIN_BUDGET_MS);
    expect(order).toEqual([]);

    await jest.advanceTimersByTimeAsync(BOOT_DRAIN_BUDGET_MS);
    await flushMicrotasks();

    expect(order).toEqual(EXPECTED_LIFO_ORDER);
    // The re-issued quit is what lets Electron finish; `main.ts` short-circuits
    // the re-emitted `will-quit` with its one-shot guard.
    expect(quit).toHaveBeenCalledTimes(1);
  });

  it('aborts BEFORE anything is disposed, so no scan writes to a stopped service', async () => {
    const order: string[] = [];
    handleWillQuit({
      ...inertDeps(order),
      refs: makeFullRefs(order),
      abortBoot: () => order.push('abortBoot'),
      deferQuit: jest.fn(),
      quit: jest.fn(),
    });

    expect(order[0]).toBe('abortBoot');

    await flushMicrotasks();
  });

  it('disposes a service the boot created AFTER the quit arrived', async () => {
    // The reason `refs` is a stable object rather than fifteen copies: a
    // service that appears mid-drain is still in the object the chain reads.
    const order: string[] = [];
    const refs = makeFullRefs(order);
    refs.gitWatcher = null;

    handleWillQuit({
      ...inertDeps(order),
      refs,
      isBootRunning: () => true,
      awaitBootCompletion: (timeoutMs: number) =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, timeoutMs);
        }),
      deferQuit: jest.fn(),
      quit: jest.fn(),
    });

    // The in-flight boot finishes creating the watcher during the grace period.
    refs.gitWatcher = {
      stop: () => order.push('gitWatcher'),
      switchWorkspace: jest.fn(),
    };

    await jest.advanceTimersByTimeAsync(BOOT_DRAIN_BUDGET_MS);
    await flushMicrotasks();

    expect(order).toContain('gitWatcher');
  });
});
