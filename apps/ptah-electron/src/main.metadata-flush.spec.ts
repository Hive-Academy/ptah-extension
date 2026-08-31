/**
 * Regression guard: `will-quit` must drain the session metadata queue.
 *
 * The store coalesces a burst of writes into one update at the end of its
 * queue drain, so a CLI agent that exits in the final seconds of a session
 * leaves its reference STAGED, not stored. Nothing used to call `flush()` on
 * the way out and the reference was simply lost (TASK_2026_324 finding 3).
 *
 * ## There are TWO flushes, and they answer different questions
 *
 * This file used to assert one flush, placed first, and argued that Electron
 * could not do what the CLI and the extension do — reap the agents, then await
 * the flush their exits produced — because `will-quit` cannot block.
 *
 * The premise was right and the conclusion was too strong. `will-quit` cannot
 * block, but it can be DEFERRED: `event.preventDefault()` plus a later
 * `app.quit()` is exactly how the messaging-gateway drain already buys itself a
 * window. The agent reap needs the same window for the same reason, so
 * `requiresDeferredDisposal` now names the agent manager too (TASK_2026_334).
 *
 * So:
 *
 *  - The EARLY flush drains what was already staged when the quit arrived. It
 *    is started and not awaited, and it is the only flush the undeferred path
 *    gets. Do not move it below the disposals — there it would be started with
 *    no window at all, which is the TASK_2026_324 regression.
 *  - The FINAL flush drains what the teardown itself produced: the session
 *    reference each agent stages as it exits. It is awaited, it runs after the
 *    reap, and without it that reference is lost and the relaunched session
 *    shows no CLI agent.
 *
 * Neither replaces the other. Asserting only the first is what let the reap
 * stay fire-and-forget.
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

function drive(order: string[], flush: () => Promise<void>): Recorded {
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

/** Records the call, then resolves — the shape of the real flush. */
function recordingFlush(order: string[]): () => Promise<void> {
  return async () => {
    order.push('flushSessionMetadataStores');
  };
}

describe('will-quit session metadata flush', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('drains the coalesced write queue once on an undeferred quit', () => {
    const order: string[] = [];
    const flush = jest.fn(async () => {
      order.push('flushSessionMetadataStores');
    });

    drive(order, flush);

    // Once, not twice: with no agents and no gateway the quit is undeferred, so
    // the final flush is never reached. The early one is all this path gets.
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('starts the flush before the disposals, so it has the teardown window', () => {
    const order: string[] = [];
    drive(order, recordingFlush(order));

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
      flushSessionMetadataStores: recordingFlush(order),
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

/**
 * TASK_2026_334 defect 1 — the reference an agent stages as it EXITS.
 *
 * `disposeAll()` ends each running agent; the agent's `done` handler then
 * stages its bulk output and its session reference into the store's coalesced
 * queue. Only a flush writes that queue. While the reap was fire-and-forget and
 * the only flush ran first, the reference was staged into a queue nothing would
 * ever drain, and the relaunched session showed no CLI agent.
 */
describe('will-quit reaps the agents before it flushes', () => {
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * An agent manager whose `disposeAll()` settles over several microtasks and
   * stages a reference on the way out — the real shape, where the staging is
   * not synchronous with the kill.
   */
  function makeRefsWithAgent(order: string[]): BootRefs {
    const refs = makeRefs(order);
    refs.agentProcessManager = {
      disposeAll: async () => {
        order.push('disposeAll:start');
        await Promise.resolve();
        await Promise.resolve();
        order.push('stageReference');
      },
    } as unknown as BootRefs['agentProcessManager'];
    refs.cliRegistry = {
      disposeAll: () => order.push('cliRegistry'),
    } as unknown as BootRefs['cliRegistry'];
    return refs;
  }

  function driveWithAgent(order: string[]): {
    refs: BootRefs;
    deferred: boolean;
  } {
    const refs = makeRefsWithAgent(order);
    const deferred = !handleWillQuit({
      refs,
      abortBoot: () => order.push('abortBoot'),
      isBootRunning: () => false,
      awaitBootCompletion: async () => undefined,
      flushWorkspacePersistence: () => order.push('flushWorkspacePersistence'),
      flushSessionMetadataStores: recordingFlush(order),
      clearTimers: () => order.push('clearTimers'),
      disposeVoiceWorker: () => order.push('disposeVoiceWorker'),
      deferQuit: () => order.push('deferQuit'),
      quit: () => order.push('quit'),
      agentReapBudgetMs: 50,
    });
    return { refs, deferred };
  }

  /** Let the deferred chain run to completion. */
  async function settle(): Promise<void> {
    for (let i = 0; i < 20; i += 1) {
      await Promise.resolve();
    }
  }

  it('defers the quit when there are agents to reap', () => {
    const order: string[] = [];
    const { deferred } = driveWithAgent(order);

    // Without the deferral there is no window for the final flush at all, so
    // this is the precondition the whole fix rests on.
    expect(deferred).toBe(true);
    expect(order).toContain('deferQuit');
  });

  it('flushes AFTER the agents staged their references', async () => {
    const order: string[] = [];
    driveWithAgent(order);
    await settle();

    const staged = order.indexOf('stageReference');
    const flushes = order.reduce<number[]>((acc, name, index) => {
      if (name === 'flushSessionMetadataStores') acc.push(index);
      return acc;
    }, []);

    expect(staged).toBeGreaterThan(-1);
    // Two flushes: the early one before the disposals, the final one after the
    // reap. The second is the one that carries the staged reference.
    expect(flushes).toHaveLength(2);
    expect(flushes[0]).toBeLessThan(staged);
    expect(flushes[1]).toBeGreaterThan(staged);
  });

  it('reaps the agents before their translation proxies (LOW finding 1)', async () => {
    const order: string[] = [];
    driveWithAgent(order);
    await settle();

    // The proxy exists to serve a live agent. Disposing it while the agent is
    // still exiting leaves that agent talking to a closed socket.
    expect(order.indexOf('stageReference')).toBeLessThan(
      order.indexOf('cliRegistry'),
    );
  });

  it('gives up on a wedged reap and still runs the final flush', async () => {
    const order: string[] = [];
    const refs = makeRefs(order);
    refs.agentProcessManager = {
      disposeAll: () => new Promise<void>(() => undefined),
    } as unknown as BootRefs['agentProcessManager'];

    handleWillQuit({
      refs,
      abortBoot: () => order.push('abortBoot'),
      isBootRunning: () => false,
      awaitBootCompletion: async () => undefined,
      flushWorkspacePersistence: () => order.push('flushWorkspacePersistence'),
      flushSessionMetadataStores: recordingFlush(order),
      clearTimers: () => order.push('clearTimers'),
      disposeVoiceWorker: () => order.push('disposeVoiceWorker'),
      deferQuit: () => order.push('deferQuit'),
      quit: () => order.push('quit'),
      agentReapBudgetMs: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    await settle();

    // An agent that never dies costs the budget, not the quit.
    expect(order).toContain('quit');
    expect(
      order.filter((name) => name === 'flushSessionMetadataStores'),
    ).toHaveLength(2);
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
