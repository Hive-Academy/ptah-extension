import 'reflect-metadata';

import {
  InternalQueryConcurrencyGate,
  InternalQueryService,
  DEFAULT_MAX_CONCURRENT,
  DEFAULT_MAX_CONCURRENT_PER_LANE,
  INTERNAL_QUERY_CONCURRENCY_KEY,
  INTERNAL_QUERY_LANE_CONCURRENCY_KEY,
} from './internal-query.service';
import { InternalQueryQueueTimeoutError } from '../errors/internal-query-queue-timeout.error';
import type { InternalQueryConfig } from './internal-query.types';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type {
  SdkQueryRunner,
  OneShotRunInput,
  OneShotRunResult,
} from '../helpers/sdk-query-runner.service';
import type { SDKMessage } from '../types/sdk-types/claude-sdk.types';
import { createFakeAsyncGenerator } from '@ptah-extension/shared/testing';

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

interface RunnerHarness {
  runner: { runOneShot: jest.Mock };
  service: InternalQueryService;
  result: OneShotRunResult;
}

function makeRunnerHarness(
  resultOverrides: Partial<OneShotRunResult> = {},
): RunnerHarness {
  const stream =
    resultOverrides.stream ??
    (createFakeAsyncGenerator<SDKMessage>(
      [],
    ) as unknown as AsyncIterable<SDKMessage>);
  const result: OneShotRunResult = {
    stream,
    abort: resultOverrides.abort ?? jest.fn(),
    close: resultOverrides.close ?? jest.fn(),
  };
  const runner = {
    runOneShot: jest.fn().mockResolvedValue(result),
  };
  const service = new InternalQueryService(runner as unknown as SdkQueryRunner);
  return { runner, service, result };
}

function makeConfig(
  overrides: Partial<InternalQueryConfig> = {},
): InternalQueryConfig {
  return {
    cwd: '/fake/workspace',
    model: 'claude-sonnet-4-20250514',
    prompt: 'Analyze this workspace',
    mcpServerRunning: false,
    ...overrides,
  };
}

describe('InternalQueryService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('execute() — delegation to SdkQueryRunner', () => {
    it('delegates to runner.runOneShot exactly once', async () => {
      const h = makeRunnerHarness();

      await h.service.execute(makeConfig());

      expect(h.runner.runOneShot).toHaveBeenCalledTimes(1);
    });

    /**
     * The handle is WRAPPED, not passed through — TASK_2026_323 B6. The wrapper
     * is what releases the concurrency slot when the query finishes, so a
     * verbatim pass-through would mean the gate never re-opens.
     */
    it('forwards the runner control methods through the wrapper', async () => {
      const abort = jest.fn();
      const close = jest.fn();
      const h = makeRunnerHarness({ abort, close });

      const handle = await h.service.execute(makeConfig());
      handle.abort();
      handle.close();

      expect(abort).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
    });

    it('yields the runner stream messages unchanged', async () => {
      const messages = [
        { type: 'assistant' },
        { type: 'result' },
      ] as unknown as SDKMessage[];
      const h = makeRunnerHarness({
        stream: createFakeAsyncGenerator<SDKMessage>(
          messages,
        ) as unknown as AsyncIterable<SDKMessage>,
      });

      const handle = await h.service.execute(makeConfig());
      const seen: SDKMessage[] = [];
      for await (const msg of handle.stream) seen.push(msg);

      expect(seen).toEqual(messages);
    });

    it('forwards every InternalQueryConfig field with mode set to "oneShot"', async () => {
      const h = makeRunnerHarness();
      const abortController = new AbortController();
      const outputFormat = {
        type: 'json_schema',
        schema: { type: 'object', properties: {} },
      } as unknown as InternalQueryConfig['outputFormat'];

      const config: InternalQueryConfig = {
        cwd: '/work',
        model: 'opus',
        prompt: 'do the thing',
        systemPromptAppend: 'return JSON',
        mcpServerRunning: true,
        mcpPort: 51820,
        maxTurns: 12,
        outputFormat,
        abortController,
      };

      await h.service.execute(config);

      const [input] = h.runner.runOneShot.mock.calls[0] as [OneShotRunInput];
      expect(input).toEqual({
        mode: 'oneShot',
        cwd: '/work',
        model: 'opus',
        prompt: 'do the thing',
        systemPromptAppend: 'return JSON',
        mcpServerRunning: true,
        mcpPort: 51820,
        maxTurns: 12,
        outputFormat,
        abortController,
      });
    });

    it('forwards optional fields as undefined when omitted from the config', async () => {
      const h = makeRunnerHarness();

      await h.service.execute(makeConfig());

      const [input] = h.runner.runOneShot.mock.calls[0] as [OneShotRunInput];
      expect(input.mode).toBe('oneShot');
      expect(input.systemPromptAppend).toBeUndefined();
      expect(input.mcpPort).toBeUndefined();
      expect(input.maxTurns).toBeUndefined();
      expect(input.outputFormat).toBeUndefined();
      expect(input.abortController).toBeUndefined();
    });

    it('propagates rejections thrown by the runner', async () => {
      const h = makeRunnerHarness();
      const boom = new Error('runner boom');
      h.runner.runOneShot.mockRejectedValueOnce(boom);

      await expect(h.service.execute(makeConfig())).rejects.toBe(boom);
    });
  });
});

/**
 * TASK_2026_323 blocker B6 — one-shot queries are serialized process-wide.
 *
 * Each one is a real `claude` subprocess. The callers' in-flight bookkeeping is
 * per session and the curator's rate limiter is per hour, so nothing counted
 * concurrent internal queries at all: three sessions crossing their turn
 * thresholds together spawned three subprocesses onto the one thread that also
 * owns every `BrowserWindow`.
 */
describe('InternalQueryService — concurrency gate (TASK_2026_323 B6)', () => {
  interface GatedHarness {
    service: InternalQueryService;
    /** Resolve the Nth query's stream, letting it release its slot. */
    finish(index: number): void;
    started(): number;
  }

  function makeGatedHarness(
    maxConcurrent?: number,
    maxConcurrentPerLane?: number,
  ): GatedHarness {
    const finishers: Array<() => void> = [];
    let started = 0;

    const runOneShot = jest.fn(async () => {
      const index = started++;
      const stream = {
        async *[Symbol.asyncIterator]() {
          await new Promise<void>((resolve) => {
            finishers[index] = resolve;
          });
          yield { type: 'result' } as unknown as SDKMessage;
        },
      } as AsyncIterable<SDKMessage>;
      return { stream, abort: jest.fn(), close: jest.fn() };
    });

    const overrides = new Map<string, number>();
    if (maxConcurrent !== undefined) {
      overrides.set(INTERNAL_QUERY_CONCURRENCY_KEY, maxConcurrent);
    }
    if (maxConcurrentPerLane !== undefined) {
      overrides.set(INTERNAL_QUERY_LANE_CONCURRENCY_KEY, maxConcurrentPerLane);
    }

    const workspace =
      overrides.size === 0
        ? null
        : ({
            // Key-aware: return a configured limit only for the key it belongs
            // to, and the caller-supplied default for every other key. A mock
            // that returned `maxConcurrent` for any key also overrode
            // `queueTimeoutMs`, so a `makeGatedHarness(2)` waiter armed a 2ms
            // ceiling and rejected unhandled into a neighbouring test.
            getConfiguration: jest.fn(
              (_section: string, key: string, def: unknown) =>
                overrides.has(key) ? overrides.get(key) : def,
            ),
          } as unknown as IWorkspaceProvider);

    const service = new InternalQueryService(
      { runOneShot } as unknown as SdkQueryRunner,
      makeLogger(),
      workspace,
    );

    return {
      service,
      finish: (index: number) => finishers[index]?.(),
      started: () => started,
    };
  }

  /** Let every already-scheduled microtask settle. */
  const settle = (): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, 0));

  it('does not start a second query until the first one settles', async () => {
    const h = makeGatedHarness();

    const first = await h.service.execute(makeConfig());
    const secondPending = h.service.execute(makeConfig());

    // Drain the first stream in the background so its slot frees on completion.
    const firstDrained = (async () => {
      for await (const _msg of first.stream) {
        /* consume */
      }
    })();

    await settle();
    expect(h.started()).toBe(1);

    h.finish(0);
    await firstDrained;

    const second = await secondPending;
    expect(h.started()).toBe(2);

    // And the second releases in turn.
    const secondDrained = (async () => {
      for await (const _msg of second.stream) {
        /* consume */
      }
    })();
    h.finish(1);
    await secondDrained;
  });

  it('releases the slot when a consumer breaks out of the stream early', async () => {
    const h = makeGatedHarness();

    const first = await h.service.execute(makeConfig());
    const secondPending = h.service.execute(makeConfig());

    const firstDrained = (async () => {
      for await (const _msg of first.stream) break;
    })();
    h.finish(0);
    await firstDrained;

    await expect(secondPending).resolves.toBeDefined();
    expect(h.started()).toBe(2);
  });

  it('releases the slot when the handle is closed without iterating', async () => {
    const h = makeGatedHarness();

    const first = await h.service.execute(makeConfig());
    const secondPending = h.service.execute(makeConfig());

    await settle();
    expect(h.started()).toBe(1);

    first.close();

    await expect(secondPending).resolves.toBeDefined();
    expect(h.started()).toBe(2);
  });

  it('releases the slot when the runner rejects', async () => {
    const h = makeGatedHarness();
    const runner = h.service as unknown as {
      runner: { runOneShot: jest.Mock };
    };
    runner.runner.runOneShot.mockRejectedValueOnce(new Error('launch failed'));

    await expect(h.service.execute(makeConfig())).rejects.toThrow(
      'launch failed',
    );

    // The gate must be open again — this resolves only if the slot was freed.
    await expect(h.service.execute(makeConfig())).resolves.toBeDefined();
  });

  it('a waiter aborted while queued rejects and leaves the queue', async () => {
    const h = makeGatedHarness();

    const first = await h.service.execute(makeConfig());
    const abortController = new AbortController();
    const queued = h.service.execute(makeConfig({ abortController }));

    await settle();
    expect(h.started()).toBe(1);

    abortController.abort();
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' });

    // Releasing the first slot must NOT hand it to the departed waiter: a third
    // caller takes it instead, which is the observable form of "left the queue".
    const firstDrained = (async () => {
      for await (const _msg of first.stream) break;
    })();
    h.finish(0);
    await firstDrained;

    await expect(h.service.execute(makeConfig())).resolves.toBeDefined();
    expect(h.started()).toBe(2);
  });

  it('rejects immediately when the caller signal is already aborted', async () => {
    const h = makeGatedHarness();
    const abortController = new AbortController();
    abortController.abort();

    await expect(
      h.service.execute(makeConfig({ abortController })),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(h.started()).toBe(0);
  });

  /**
   * TASK_2026_328 — the gate has a wait ceiling. A one-shot query queued
   * behind a long-running one cannot block indefinitely: once
   * `queueTimeoutMs` elapses without a slot, execute() rejects with the typed
   * `InternalQueryQueueTimeoutError`. The rejected waiter must leave the gate
   * consistent — removed from the queue, no slot leaked — so the next caller
   * takes the freed slot. Follows the abort-while-queued structure above.
   */
  it('rejects a queued caller with InternalQueryQueueTimeoutError after the wait ceiling', async () => {
    const h = makeGatedHarness();

    const first = await h.service.execute(makeConfig());
    const queued = h.service.execute(makeConfig({ queueTimeoutMs: 20 }));

    await settle();
    expect(h.started()).toBe(1);

    await expect(queued).rejects.toThrow(InternalQueryQueueTimeoutError);
    await expect(queued).rejects.toMatchObject({ queueTimeoutMs: 20 });

    // Releasing the first slot must NOT hand it to the departed waiter: a third
    // caller takes it instead, which is the observable form of "left the queue,
    // no slot leaked".
    const firstDrained = (async () => {
      for await (const _msg of first.stream) break;
    })();
    h.finish(0);
    await firstDrained;

    await expect(h.service.execute(makeConfig())).resolves.toBeDefined();
    expect(h.started()).toBe(2);
  });

  it('honours a configured limit above the default', async () => {
    // Both ceilings raised: the global one alone would not let a THIRD query on
    // one lane through, which is the per-lane limit doing its job.
    const h = makeGatedHarness(3, 3);

    await h.service.execute(makeConfig());
    await h.service.execute(makeConfig());
    await h.service.execute(makeConfig());
    const fourth = h.service.execute(makeConfig());

    await settle();
    expect(h.started()).toBe(3);

    void fourth;
  });

  /**
   * TASK_2026_352. The memory curator and skill-synthesis are unrelated
   * pipelines that shared one host-wide slot, so each waited on the other —
   * nine times on one boot (`tmp/logs/log.log:938 … 1424`, every line reading
   * `limit:1, inFlight:1`).
   */
  describe('lanes', () => {
    it('runs two different lanes concurrently at the defaults', async () => {
      const h = makeGatedHarness();

      await h.service.execute(makeConfig({ lane: 'memory-curator' }));
      await h.service.execute(makeConfig({ lane: 'skill-synthesis' }));

      await settle();
      expect(h.started()).toBe(2);
    });

    it('still serialises two queries on the SAME lane', async () => {
      const h = makeGatedHarness();

      await h.service.execute(makeConfig({ lane: 'skill-synthesis' }));
      const queued = h.service.execute(makeConfig({ lane: 'skill-synthesis' }));

      await settle();
      expect(h.started()).toBe(1);

      void queued;
    });

    it('holds a third lane at the global ceiling', async () => {
      const h = makeGatedHarness();

      await h.service.execute(makeConfig({ lane: 'memory-curator' }));
      await h.service.execute(makeConfig({ lane: 'skill-synthesis' }));
      const third = h.service.execute(makeConfig({ lane: 'default' }));

      await settle();
      expect(h.started()).toBe(DEFAULT_MAX_CONCURRENT);

      void third;
    });

    it('treats a lane name as case- and whitespace-insensitive', async () => {
      const h = makeGatedHarness();

      await h.service.execute(makeConfig({ lane: 'memory-curator' }));
      const queued = h.service.execute(
        makeConfig({ lane: '  Memory-Curator ' }),
      );

      // A near-miss must NOT mint a second lane with its own ceiling — that
      // would be the defect this mechanism exists to prevent, arriving as a typo.
      await settle();
      expect(h.started()).toBe(1);

      void queued;
    });

    it('charges a caller that names no lane to the shared default', async () => {
      const h = makeGatedHarness();

      await h.service.execute(makeConfig());
      const queued = h.service.execute(makeConfig({ lane: '   ' }));

      await settle();
      expect(h.started()).toBe(1);

      void queued;
    });
  });
});

describe('InternalQueryConcurrencyGate', () => {
  /** One-lane acquire at the classic single-slot setting. */
  function acquire(
    gate: InternalQueryConcurrencyGate,
    opts: {
      limit?: number;
      perLaneLimit?: number;
      lane?: string;
      signal?: AbortSignal;
      queueTimeoutMs?: number;
    } = {},
  ): Promise<() => void> {
    return gate.acquire({
      limit: opts.limit ?? 1,
      perLaneLimit: opts.perLaneLimit ?? 1,
      lane: opts.lane ?? 'default',
      signal: opts.signal,
      queueTimeoutMs: opts.queueTimeoutMs,
    });
  }

  it('hands slots out in FIFO order', async () => {
    const gate = new InternalQueryConcurrencyGate();
    const order: number[] = [];

    const release = await acquire(gate);
    const second = acquire(gate).then((r) => {
      order.push(2);
      return r;
    });
    const third = acquire(gate).then((r) => {
      order.push(3);
      return r;
    });

    expect(gate.queued).toBe(2);
    release();
    (await second)();
    (await third)();

    expect(order).toEqual([2, 3]);
    expect(gate.queued).toBe(0);
    expect(gate.inFlight).toBe(0);
  });

  it('treats release as idempotent', async () => {
    const gate = new InternalQueryConcurrencyGate();
    const release = await acquire(gate);

    release();
    release();

    expect(gate.inFlight).toBe(0);
  });

  describe('per-lane ceilings', () => {
    it('admits two lanes at once but only one call per lane', async () => {
      const gate = new InternalQueryConcurrencyGate();

      await acquire(gate, { limit: 2, lane: 'a' });
      await acquire(gate, { limit: 2, lane: 'b' });
      const queued = acquire(gate, { limit: 2, lane: 'a' });

      expect(gate.inFlight).toBe(2);
      expect(gate.inFlightForLane('a')).toBe(1);
      expect(gate.inFlightForLane('b')).toBe(1);
      expect(gate.queued).toBe(1);

      void queued;
    });

    /**
     * The reason `drain` scans instead of waking the head. With a strict FIFO
     * pop, the lane-`a` waiter at the front — inadmissible, because lane `a` is
     * already at its ceiling — would block the lane-`b` waiter behind it, which
     * is the cross-pipeline coupling the lanes exist to remove.
     */
    it('a lane-blocked waiter does not block an admissible one behind it', async () => {
      const gate = new InternalQueryConcurrencyGate();
      const woken: string[] = [];

      const releaseA = await acquire(gate, { limit: 2, lane: 'a' });
      const releaseB = await acquire(gate, { limit: 2, lane: 'b' });

      const queuedA = acquire(gate, { limit: 2, lane: 'a' }).then((r) => {
        woken.push('a');
        return r;
      });
      const queuedB = acquire(gate, { limit: 2, lane: 'b' }).then((r) => {
        woken.push('b');
        return r;
      });

      // Free lane b's slot. Only the lane-b waiter is admissible.
      releaseB();
      (await queuedB)();

      expect(woken).toEqual(['b']);

      releaseA();
      (await queuedA)();
      expect(woken).toEqual(['b', 'a']);
      expect(gate.inFlight).toBe(0);
    });

    it('keeps FIFO order within one lane', async () => {
      const gate = new InternalQueryConcurrencyGate();
      const order: number[] = [];

      let release = await acquire(gate, { limit: 2, lane: 'a' });
      const first = acquire(gate, { limit: 2, lane: 'a' }).then((r) => {
        order.push(1);
        return r;
      });
      const second = acquire(gate, { limit: 2, lane: 'a' }).then((r) => {
        order.push(2);
        return r;
      });

      release();
      release = await first;
      release();
      (await second)();

      expect(order).toEqual([1, 2]);
    });

    it('forgets a lane once its last holder releases', async () => {
      const gate = new InternalQueryConcurrencyGate();
      const release = await acquire(gate, { lane: 'transient' });

      expect(gate.inFlightForLane('transient')).toBe(1);
      release();
      // The map is keyed by caller-supplied strings; an entry that outlived its
      // last holder would be an unbounded leak on a host with dynamic lanes.
      expect(gate.inFlightForLane('transient')).toBe(0);
    });

    it('falls back to the defaults for a nonsensical limit', async () => {
      const gate = new InternalQueryConcurrencyGate();

      await gate.acquire({ limit: 0, perLaneLimit: -1, lane: 'a' });
      await gate.acquire({ limit: 0, perLaneLimit: -1, lane: 'b' });
      const queued = gate.acquire({ limit: 0, perLaneLimit: -1, lane: 'c' });

      expect(gate.inFlight).toBe(DEFAULT_MAX_CONCURRENT);
      expect(gate.inFlightForLane('a')).toBe(DEFAULT_MAX_CONCURRENT_PER_LANE);
      expect(gate.queued).toBe(1);

      void queued;
    });
  });

  it('rejects a queued waiter with InternalQueryQueueTimeoutError after the ceiling', async () => {
    const gate = new InternalQueryConcurrencyGate();
    const release = await acquire(gate);
    const queued = acquire(gate, { queueTimeoutMs: 20 });

    await expect(queued).rejects.toThrow(InternalQueryQueueTimeoutError);
    await expect(queued).rejects.toMatchObject({ queueTimeoutMs: 20 });

    // The departed waiter is gone from the queue, and the slot is still held
    // by the first caller until it releases.
    expect(gate.queued).toBe(0);
    expect(gate.inFlight).toBe(1);

    release();
    expect(gate.inFlight).toBe(0);
  });
});
