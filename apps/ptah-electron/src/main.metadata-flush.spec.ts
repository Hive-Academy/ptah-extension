/**
 * Regression guard: `will-quit` must drain the session metadata queue.
 *
 * The store coalesces a burst of writes into one update at the end of its
 * queue drain, so a CLI agent that exits in the final seconds of a session
 * leaves its reference STAGED, not stored. Nothing used to call `flush()` on
 * the way out and the reference was simply lost (TASK_2026_324 finding 3).
 *
 * ## Why the flush is FIRST here, and awaited in the other two hosts
 *
 * `will-quit` cannot block: Electron proceeds to tear the process down
 * regardless of what the listener returns. So this host cannot do what the CLI
 * and the extension do — reap the agents, then await the flush that their exits
 * produced. It does the only other useful thing: start the flush at the top of
 * the teardown so the staged snapshot gets the whole window to reach storage.
 * That is a smaller guarantee, and it is deliberate. Do not "fix" it by moving
 * the call below the disposals — there it would be started with no window left
 * at all.
 *
 * ## Why this is now a behavioural spec
 *
 * It used to read `main.ts` as text, because `main.ts` uses `import.meta.url`
 * and `tsconfig.spec.json` compiles with `module: commonjs` (TS1343). The quit
 * sequence moved into `activation/shutdown.ts` for exactly that reason
 * (TASK_2026_331 B1.T6), so the ordering can now be OBSERVED instead of
 * pattern-matched. The one thing still asserted textually is that `main.ts`
 * delegates rather than keeping a second copy of the sequence.
 *
 * Source-under-test: apps/ptah-electron/src/activation/shutdown.ts
 */

import * as fs from 'fs';
import * as path from 'path';

import type { BootRefs } from './activation/boot-coordinator';
import { createEmptyBootRefs } from './activation/boot-coordinator';
import { handleWillQuit } from './activation/shutdown';

const MAIN_TS_PATH = path.resolve(__dirname, 'main.ts');

interface Recorded {
  order: string[];
  refs: BootRefs;
}

function makeRefs(order: string[]): BootRefs {
  const refs = createEmptyBootRefs();
  refs.providerProxyPool = {
    disposeAll: async () => {
      order.push('providerProxyPool');
    },
  };
  return refs;
}

function drive(order: string[], flush: () => void): Recorded {
  const refs = makeRefs(order);
  handleWillQuit({
    refs,
    abortBoot: () => order.push('abortBoot'),
    isBootRunning: () => false,
    awaitBootCompletion: async () => undefined,
    flushWorkspacePersistence: () => order.push('flushWorkspacePersistence'),
    flushSessionMetadataStores: flush,
    clearTimers: () => order.push('clearTimers'),
    disposeVoiceWorker: () => order.push('disposeVoiceWorker'),
    deferQuit: () => order.push('deferQuit'),
    quit: () => order.push('quit'),
  });
  return { order, refs };
}

describe('will-quit session metadata flush', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('drains the coalesced write queue exactly once', () => {
    const order: string[] = [];
    const flush = jest.fn(() => order.push('flushSessionMetadataStores'));

    drive(order, flush);

    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('starts the flush before the disposals, so it has the teardown window', () => {
    const order: string[] = [];
    drive(order, () => order.push('flushSessionMetadataStores'));

    expect(order.indexOf('flushSessionMetadataStores')).toBeLessThan(
      order.indexOf('providerProxyPool'),
    );
  });

  it('guards the flush — a quit must not be turned into a crash', () => {
    const order: string[] = [];
    const throwing = () => {
      throw new Error('metadata store exploded');
    };

    expect(() => drive(order, throwing)).not.toThrow();
    // ...and the rest of the teardown still ran.
    expect(order).toContain('providerProxyPool');
    expect(order).toContain('clearTimers');
  });

  it('still starts the flush first when the quit is DEFERRED for an in-flight boot', async () => {
    const order: string[] = [];
    const refs = makeRefs(order);
    let releaseDrain!: () => void;

    handleWillQuit({
      refs,
      abortBoot: () => order.push('abortBoot'),
      isBootRunning: () => true,
      awaitBootCompletion: () =>
        new Promise<void>((resolve) => {
          releaseDrain = resolve;
        }),
      flushWorkspacePersistence: () => order.push('flushWorkspacePersistence'),
      flushSessionMetadataStores: () =>
        order.push('flushSessionMetadataStores'),
      clearTimers: () => order.push('clearTimers'),
      disposeVoiceWorker: () => order.push('disposeVoiceWorker'),
      deferQuit: () => order.push('deferQuit'),
      quit: () => order.push('quit'),
    });

    // The flush is started immediately, NOT after the drain — the whole point
    // of putting it first is that it gets the entire teardown window.
    expect(order).toEqual([
      'flushWorkspacePersistence',
      'flushSessionMetadataStores',
      'abortBoot',
      'deferQuit',
    ]);

    releaseDrain();
    await Promise.resolve();
    await Promise.resolve();
    expect(order).toContain('providerProxyPool');
  });
});

describe('main.ts delegates the quit sequence', () => {
  let willQuitBody: string;

  beforeAll(() => {
    const source = fs.readFileSync(MAIN_TS_PATH, 'utf-8');
    const start = source.indexOf(`app.on('will-quit'`);
    expect(start).toBeGreaterThan(-1);
    willQuitBody = source.slice(start);
  });

  it('calls handleWillQuit and keeps no second copy of the chain', () => {
    expect(willQuitBody).toContain('handleWillQuit({');
    expect(willQuitBody).not.toContain('providerProxyPool?.disposeAll()');
    expect(willQuitBody).not.toContain('diagnostics?.dispose()');
  });

  it('passes the session metadata flush through', () => {
    expect(willQuitBody).toContain('flushSessionMetadataStores()');
  });
});
