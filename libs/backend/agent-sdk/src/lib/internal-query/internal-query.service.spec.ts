import 'reflect-metadata';

import {
  InternalQueryService,
  INTERNAL_QUERY_CONCURRENCY_KEY,
  INTERNAL_QUERY_LANE_CONCURRENCY_KEY,
} from './internal-query.service';
import { DEFAULT_MAX_CONCURRENT } from './internal-query-concurrency-gate';
import { InternalQueryQueueTimeoutError } from '../errors/internal-query-queue-timeout.error';
import type { InternalQueryConfig } from './internal-query.types';
import {
  BackgroundWorkGovernor,
  type BackgroundWorkSignal,
  type DegradationReporter,
  type Logger,
} from '@ptah-extension/vscode-core';
import { SessionTurnStateRegistry } from '../helpers/session-turn-state.registry';
import { TurnStateForegroundSource } from '../helpers/turn-state-foreground-source';
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
    logger: Logger;
    /** Resolve the Nth query's stream, letting it release its slot. */
    finish(index: number): void;
    started(): number;
  }

  function makeGatedHarness(
    maxConcurrent?: number,
    maxConcurrentPerLane?: number,
    collaborators: {
      governor?: BackgroundWorkSignal;
      degradation?: Pick<DegradationReporter, 'report'>;
    } = {},
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

    const logger = makeLogger();
    const service = new InternalQueryService(
      { runOneShot } as unknown as SdkQueryRunner,
      logger,
      workspace,
      collaborators.governor ?? null,
      (collaborators.degradation as DegradationReporter | undefined) ?? null,
    );

    return {
      service,
      logger,
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
    // Both ceilings raised: the global one alone would not let a FOURTH query on
    // one lane through, which is the per-lane limit doing its job.
    const h = makeGatedHarness(4, 4);

    await h.service.execute(makeConfig());
    await h.service.execute(makeConfig());
    await h.service.execute(makeConfig());
    await h.service.execute(makeConfig());
    const fifth = h.service.execute(makeConfig());

    await settle();
    expect(h.started()).toBe(4);

    void fifth;
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

    it('holds a fourth lane at the global ceiling', async () => {
      const h = makeGatedHarness();

      await h.service.execute(makeConfig({ lane: 'memory-curator' }));
      await h.service.execute(makeConfig({ lane: 'skill-synthesis' }));
      await h.service.execute(makeConfig({ lane: 'default' }));
      const fourth = h.service.execute(makeConfig({ lane: 'user-action' }));

      await settle();
      expect(h.started()).toBe(DEFAULT_MAX_CONCURRENT);

      void fourth;
    });

    it('admits a user-action query while both background lanes hold slots at the defaults', async () => {
      const h = makeGatedHarness();

      await h.service.execute(makeConfig({ lane: 'memory-curator' }));
      await h.service.execute(makeConfig({ lane: 'skill-synthesis' }));
      await h.service.execute(makeConfig({ lane: 'user-action' }));

      expect(h.started()).toBe(3);
    });

    it('logs blockedBy background when the background cap binds', async () => {
      const h = makeGatedHarness(3, 2);
      const abortController = new AbortController();

      await h.service.execute(makeConfig({ lane: 'memory-curator' }));
      await h.service.execute(makeConfig({ lane: 'memory-curator' }));
      const capped = h.service.execute(
        makeConfig({
          lane: 'skill-synthesis',
          abortController,
        }),
      );
      await settle();

      expect(h.logger.debug).toHaveBeenCalledWith(
        expect.stringContaining('waiting for a concurrency slot'),
        expect.objectContaining({
          blockedBy: 'background',
          backgroundInFlight: 2,
          backgroundCapped: true,
        }),
      );

      abortController.abort();
      await expect(capped).rejects.toMatchObject({ name: 'AbortError' });
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

  /**
   * TASK_2026_437 C14 / AC-9 — background lanes yield to the foreground. Driven
   * through the REAL governor and the REAL turn-state registry, joined exactly
   * as `di/register.ts` joins them, so the seam itself is under test.
   */
  describe('background-work governor (TASK_2026_437 C14)', () => {
    function makeForeground() {
      const turns = new SessionTurnStateRegistry();
      const governor = new BackgroundWorkGovernor(makeLogger());
      governor.addForegroundSource(
        new TurnStateForegroundSource(turns, makeLogger()),
      );
      return { turns, governor };
    }

    it('admits 0 background-lane queries while a turn generates, then drains on idle (AC-9)', async () => {
      const { turns, governor } = makeForeground();
      const h = makeGatedHarness(3, 1, { governor });

      turns.markGenerating('session-1');
      const curator = h.service.execute(makeConfig({ lane: 'memory-curator' }));
      const skills = h.service.execute(makeConfig({ lane: 'skill-synthesis' }));
      await settle();
      expect(h.started()).toBe(0);

      // The default lane is user-initiated and never governed.
      await h.service.execute(makeConfig());
      expect(h.started()).toBe(1);

      turns.settleTurn('session-1');
      await Promise.all([curator, skills]);
      expect(h.started()).toBe(3);
    });

    it('reports the missing governor exactly once, on the first background call', async () => {
      const degradation = { report: jest.fn() };
      const h = makeGatedHarness(3, 3, { degradation });

      await h.service.execute(makeConfig());
      expect(degradation.report).not.toHaveBeenCalled();

      await h.service.execute(makeConfig({ lane: 'memory-curator' }));
      await h.service.execute(makeConfig({ lane: 'skill-synthesis' }));

      // Always clear without a governor: nothing waited.
      expect(h.started()).toBe(3);
      expect(degradation.report).toHaveBeenCalledTimes(1);
      expect(degradation.report).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'agent',
          code: 'agent.internal-query.ungoverned',
          severity: 'degraded',
        }),
      );
    });

    it('reports nothing when a governor is present', async () => {
      const degradation = { report: jest.fn() };
      const { governor } = makeForeground();
      const h = makeGatedHarness(undefined, undefined, {
        governor,
        degradation,
      });

      await h.service.execute(makeConfig({ lane: 'memory-curator' }));

      expect(degradation.report).not.toHaveBeenCalled();
    });
  });
});
