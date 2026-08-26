import 'reflect-metadata';

import {
  InternalQueryConcurrencyGate,
  InternalQueryService,
} from './internal-query.service';
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

  function makeGatedHarness(maxConcurrent?: number): GatedHarness {
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

    const workspace =
      maxConcurrent === undefined
        ? null
        : ({
            getConfiguration: jest.fn(
              (_section: string, _key: string, _def: unknown) => maxConcurrent,
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

  it('honours a configured limit above the default', async () => {
    const h = makeGatedHarness(2);

    await h.service.execute(makeConfig());
    await h.service.execute(makeConfig());
    const third = h.service.execute(makeConfig());

    await settle();
    expect(h.started()).toBe(2);

    void third;
  });
});

describe('InternalQueryConcurrencyGate', () => {
  it('hands slots out in FIFO order', async () => {
    const gate = new InternalQueryConcurrencyGate();
    const order: number[] = [];

    const release = await gate.acquire(1);
    const second = gate.acquire(1).then((r) => {
      order.push(2);
      return r;
    });
    const third = gate.acquire(1).then((r) => {
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
    const release = await gate.acquire(1);

    release();
    release();

    expect(gate.inFlight).toBe(0);
  });
});
