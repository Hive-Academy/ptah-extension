/**
 * LiveSessionStatsPublisher (TASK_2026_626) against the REAL
 * SessionStatsOwnerService and a fake clock: throttled live estimates, one
 * authoritative payload per shown estimate whichever boundary settles it
 * (result, release, stream end), and nothing after release or dispose.
 */

import 'reflect-metadata';

import type {
  AuthEnv,
  ModelPricing,
  SessionId,
  SessionStatsLivePayload,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IModelResolver } from '../auth-env.port';
import { SessionStatsOwnerService } from '../session-stats/session-stats-owner.service';
import type { SDKMessage } from '../types/sdk-types/claude-sdk.types';
import {
  LIVE_STATS_INTERVAL_MS,
  LiveSessionStatsPublisher,
  type LiveStatsClock,
  type MainContextReading,
} from './live-session-stats-publisher';

const SESSION = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000626' as SessionId;
const RUN = 'run-1';
const MODEL = 'zz-live-model';
const OTHER_MODEL = 'zz-live-other';
const UNPRICED_MODEL = 'zz-live-unpriced';
const RATE: ModelPricing = { inputCostPerToken: 0.001, outputCostPerToken: 0.002 };

/** Timers fire only when the spec advances time. */
class FakeClock implements LiveStatsClock {
  private time = 0;
  private nextId = 1;
  private readonly timers = new Map<number, { at: number; run: () => void }>();

  now(): number {
    return this.time;
  }

  setTimeout(callback: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + ms, run: callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.timers.delete(handle as number);
  }

  get pending(): number {
    return this.timers.size;
  }

  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      let next: [number, { at: number; run: () => void }] | undefined;
      for (const entry of this.timers) {
        if (entry[1].at <= target && (!next || entry[1].at < next[1].at)) {
          next = entry;
        }
      }
      if (!next) break;
      this.timers.delete(next[0]);
      this.time = next[1].at;
      next[1].run();
    }
    this.time = target;
  }
}

interface Usage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheCreation?: number;
}

function assistant(
  id: string | undefined,
  usage: Usage,
  options: { model?: string; parent?: string } = {},
): SDKMessage {
  return {
    type: 'assistant',
    uuid: `uuid-${id ?? 'none'}`,
    session_id: SESSION,
    parent_tool_use_id: options.parent ?? null,
    message: {
      ...(id !== undefined && { id }),
      model: options.model ?? MODEL,
      role: 'assistant',
      content: [],
      usage: {
        ...(usage.input !== undefined && { input_tokens: usage.input }),
        ...(usage.output !== undefined && { output_tokens: usage.output }),
        ...(usage.cacheRead !== undefined && {
          cache_read_input_tokens: usage.cacheRead,
        }),
        ...(usage.cacheCreation !== undefined && {
          cache_creation_input_tokens: usage.cacheCreation,
        }),
      },
    },
  } as unknown as SDKMessage;
}

function taskStarted(): SDKMessage {
  return {
    type: 'system',
    subtype: 'task_started',
    task_id: 'task-1',
    tool_use_id: 'toolu_1',
    description: 'subagent',
    uuid: 'uuid-task',
    session_id: SESSION,
  } as unknown as SDKMessage;
}

function setup(
  options: {
    callback?: ((payload: SessionStatsLivePayload) => unknown) | null;
    context?: MainContextReading | null;
    statsGeneration?: number | null;
  } = {},
) {
  const owner = new SessionStatsOwnerService();
  const lease = owner.startNew(SESSION);
  owner.beginRun(SESSION, lease.generation, RUN, null);
  const clock = new FakeClock();
  const payloads: SessionStatsLivePayload[] = [];
  // Returns the spec callback's result, so an async (rejecting) one reaches
  // the publisher as a promise.
  const onLiveStats = jest.fn((payload: SessionStatsLivePayload): unknown => {
    payloads.push(payload);
    return options.callback?.(payload);
  });
  const logger = {
    warn: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn(),
  };
  const modelResolver: Pick<IModelResolver, 'resolveForCost'> = {
    resolveForCost: jest.fn((model: string) => ({
      modelId: `priced-${model}`,
      pricing: model === UNPRICED_MODEL ? null : RATE,
      subscriptionCovered: false,
    })),
  };
  const context = options.context === undefined ? null : options.context;
  const publisher = new LiveSessionStatsPublisher({
    statsOwner: owner,
    modelResolver,
    accountingAuthEnv: {} as AuthEnv,
    statsGeneration:
      options.statsGeneration === undefined
        ? lease.generation
        : options.statsGeneration,
    runToken: RUN,
    ...(options.callback !== null && { onLiveStats }),
    logger: logger as unknown as Logger,
    readMainContext: () => context,
    clock,
  });
  return { owner, lease, clock, payloads, onLiveStats, logger, publisher };
}

function last(payloads: readonly SessionStatsLivePayload[]): SessionStatsLivePayload {
  const payload = payloads[payloads.length - 1];
  if (!payload) throw new Error('no payload');
  return payload;
}

function rowOf(payload: SessionStatsLivePayload, model: string) {
  return payload.sessionStats.modelUsageList?.find((m) => m.model === model);
}

/** A bound publisher that already showed one estimate. */
function withShownEstimate(context: MainContextReading | null = null) {
  const harness = setup({ context });
  harness.publisher.setSessionKey(SESSION);
  harness.publisher.observe(assistant('m1', { input: 10, output: 5 }));
  expect(harness.payloads).toHaveLength(1);
  expect(harness.payloads[0]?.sessionStats.provisional).toBe(true);
  return {
    ...harness,
    estimateRevision: harness.payloads[0]?.sessionStats.revision ?? Infinity,
  };
}

describe('LiveSessionStatsPublisher', () => {
  describe('estimate', () => {
    it('counts one message id once, with its latest counts', () => {
      const { publisher, payloads, clock } = setup();
      publisher.setSessionKey(SESSION);

      publisher.observe(assistant('m1', { input: 10, output: 1 }));
      publisher.observe(assistant('m1', { input: 10, output: 50 }));
      // A late partial frame never shrinks the count.
      publisher.observe(assistant('m1', { input: 10, output: 20 }));
      clock.advance(LIVE_STATS_INTERVAL_MS);

      expect(payloads).toHaveLength(2);
      const stats = last(payloads).sessionStats;
      expect(stats.tokens.input).toBe(10);
      expect(stats.tokens.output).toBe(50);
      expect(stats.totalCost).toBeCloseTo(10 * 0.001 + 50 * 0.002, 6);
    });

    it('counts main-loop and subagent frames, summing ids per model', () => {
      const { publisher, payloads, clock } = setup();
      publisher.setSessionKey(SESSION);

      publisher.observe(assistant('m1', { input: 10 }));
      publisher.observe(assistant('m2', { input: 20 }, { parent: 'toolu_1' }));
      publisher.observe(assistant('m3', { input: 5 }, { model: OTHER_MODEL }));
      clock.advance(LIVE_STATS_INTERVAL_MS);

      const payload = last(payloads);
      expect(rowOf(payload, MODEL)?.inputTokens).toBe(30);
      expect(rowOf(payload, OTHER_MODEL)?.inputTokens).toBe(5);
      expect(payload.sessionStats.tokens.input).toBe(35);
    });

    it('ignores zero-usage, id-less and synthetic-model frames', () => {
      const { publisher, onLiveStats, clock } = setup();
      publisher.setSessionKey(SESSION);

      publisher.observe(assistant('m0', { input: 0, output: 0 }));
      publisher.observe(assistant(undefined, { input: 10 }));
      publisher.observe(assistant('m9', { input: 10 }, { model: '<synthetic>' }));
      publisher.observe(assistant('m8', {}));
      clock.advance(10 * LIVE_STATS_INTERVAL_MS);

      expect(onLiveStats).not.toHaveBeenCalled();
      expect(clock.pending).toBe(0);
    });

    it('leaves an unpriced model with an unknown cost', () => {
      const { publisher, payloads } = setup();
      publisher.setSessionKey(SESSION);

      publisher.observe(assistant('m1', { input: 10 }, { model: UNPRICED_MODEL }));

      const payload = last(payloads);
      expect(rowOf(payload, UNPRICED_MODEL)?.costUSD).toBeNull();
      expect(payload.sessionStats.totalCost).toBeNull();
    });
  });

  describe('throttle', () => {
    it('publishes nothing before setSessionKey, then the first change at once', () => {
      const { publisher, onLiveStats, clock } = setup();

      publisher.observe(assistant('m1', { input: 10 }));
      clock.advance(10 * LIVE_STATS_INTERVAL_MS);
      expect(onLiveStats).not.toHaveBeenCalled();

      publisher.setSessionKey(SESSION);
      expect(onLiveStats).toHaveBeenCalledTimes(1);
      expect(onLiveStats.mock.calls[0]?.[0].sessionStats.tokens.input).toBe(10);
    });

    it('coalesces changes inside the window into one trailing publish', () => {
      const { publisher, payloads, clock } = setup();
      publisher.setSessionKey(SESSION);

      publisher.observe(assistant('m1', { input: 10 }));
      expect(payloads).toHaveLength(1);
      clock.advance(100);
      publisher.observe(assistant('m1', { input: 20 }));
      clock.advance(100);
      publisher.observe(assistant('m2', { input: 5 }));
      publisher.observe(taskStarted());
      expect(payloads).toHaveLength(1);
      expect(clock.pending).toBe(1);

      clock.advance(LIVE_STATS_INTERVAL_MS - 200);
      expect(payloads).toHaveLength(2);
      expect(last(payloads).sessionStats.tokens.input).toBe(25);
      expect(clock.pending).toBe(0);
    });

    it('stays silent when no current owner is keyed under the session', () => {
      const { publisher, onLiveStats, clock } = setup();

      publisher.setSessionKey('bbbbbbbb-0000-4000-8000-000000000000' as SessionId);
      publisher.observe(assistant('m1', { input: 10 }));
      publisher.observe(taskStarted());
      clock.advance(10 * LIVE_STATS_INTERVAL_MS);

      expect(onLiveStats).not.toHaveBeenCalled();
    });
  });

  describe('result boundary', () => {
    it('onResult cancels the pending flush and clears the run estimate', () => {
      const { publisher, owner, onLiveStats, clock } = setup();
      const clear = jest.spyOn(owner, 'clearProvisional');
      publisher.setSessionKey(SESSION);
      publisher.observe(assistant('m1', { input: 10 }));
      publisher.observe(assistant('m1', { input: 20 }));
      expect(clock.pending).toBe(1);

      publisher.onResult();

      expect(clock.pending).toBe(0);
      expect(clear).toHaveBeenCalledWith(SESSION, expect.any(Number), RUN);
      clock.advance(10 * LIVE_STATS_INTERVAL_MS);
      expect(onLiveStats).toHaveBeenCalledTimes(1);
    });

    it('ignores frames and watcher signals between onResult and settle', () => {
      const { publisher, owner, onLiveStats, clock } = withShownEstimate();
      clock.advance(2 * LIVE_STATS_INTERVAL_MS);

      publisher.onResult();
      publisher.observe(assistant('m2', { input: 30 }));
      publisher.observe(taskStarted());
      owner.recordAgent(SESSION, 'a1');
      clock.advance(10 * LIVE_STATS_INTERVAL_MS);

      expect(onLiveStats).toHaveBeenCalledTimes(1);
      expect(clock.pending).toBe(0);
    });

    it('settle after a shown estimate emits one authoritative payload above the estimate', () => {
      const { publisher, payloads, owner, estimateRevision } = withShownEstimate();

      publisher.onResult();
      publisher.settle();

      expect(payloads).toHaveLength(2);
      const settled = last(payloads);
      expect(settled.sessionStats).not.toHaveProperty('provisional');
      expect(settled.sessionStats.revision).toBeGreaterThan(estimateRevision);
      expect(settled.sessionStats).toBe(owner.snapshot(SESSION));

      publisher.settle();
      expect(payloads).toHaveLength(2);
    });

    it('settle emits nothing when no estimate was shown', () => {
      const { publisher, onLiveStats } = setup();
      publisher.setSessionKey(SESSION);

      publisher.onResult();
      publisher.settle();

      expect(onLiveStats).not.toHaveBeenCalled();
    });

    it('publishes the next turn after settle', () => {
      const { publisher, payloads, clock } = withShownEstimate();
      publisher.onResult();
      publisher.settle();
      clock.advance(LIVE_STATS_INTERVAL_MS);

      publisher.observe(assistant('m2', { input: 7 }));

      expect(payloads).toHaveLength(3);
      expect(last(payloads).sessionStats.provisional).toBe(true);
    });
  });

  describe('context', () => {
    const READING: MainContextReading = { model: MODEL, contextTokens: 1234 };

    it('rides on provisional payloads only, labelled by the pricing id', () => {
      const { publisher, payloads } = withShownEstimate(READING);
      expect(payloads[0]?.context).toEqual({
        model: `priced-${MODEL}`,
        contextTokens: 1234,
      });

      publisher.onResult();
      publisher.settle();
      expect(last(payloads)).not.toHaveProperty('context');
    });

    it('is absent from the release payload', () => {
      const { owner, payloads, lease } = withShownEstimate(READING);

      expect(owner.release(owner.leaseOf(SESSION) ?? lease)).toBe(true);

      expect(payloads).toHaveLength(2);
      expect(last(payloads)).not.toHaveProperty('context');
    });

    it('is absent from the dispose payload', () => {
      const { publisher, payloads } = withShownEstimate(READING);

      publisher.dispose();

      expect(payloads).toHaveLength(2);
      expect(last(payloads)).not.toHaveProperty('context');
    });

    it('is absent from an authoritative agent-count payload', () => {
      const { publisher, owner, payloads, clock } = setup({ context: READING });
      publisher.setSessionKey(SESSION);

      owner.recordAgent(SESSION, 'a1');
      clock.advance(0);

      expect(payloads).toHaveLength(1);
      expect(payloads[0]?.sessionStats).not.toHaveProperty('provisional');
      expect(payloads[0]).not.toHaveProperty('context');
    });
  });

  describe('owner release', () => {
    it('settles synchronously once, then nothing reaches the callback', () => {
      const { publisher, owner, payloads, clock, estimateRevision } =
        withShownEstimate();
      publisher.observe(assistant('m1', { input: 40 }));
      expect(clock.pending).toBe(1);

      const lease = owner.leaseOf(SESSION);
      expect(lease && owner.release(lease)).toBe(true);

      expect(payloads).toHaveLength(2);
      const settled = last(payloads).sessionStats;
      expect(settled).not.toHaveProperty('provisional');
      expect(settled.revision).toBeGreaterThan(estimateRevision);
      expect(clock.pending).toBe(0);

      publisher.settle();
      publisher.observe(assistant('m2', { input: 5 }));
      publisher.observe(taskStarted());
      owner.recordAgent(SESSION, 'a1');
      clock.advance(10 * LIVE_STATS_INTERVAL_MS);
      publisher.dispose();
      expect(payloads).toHaveLength(2);
    });

    it('still settles once when released mid result branch', () => {
      const { publisher, owner, payloads, estimateRevision } = withShownEstimate();
      publisher.onResult();

      const lease = owner.leaseOf(SESSION);
      expect(lease && owner.release(lease)).toBe(true);

      expect(payloads).toHaveLength(2);
      expect(last(payloads).sessionStats.revision).toBeGreaterThan(
        estimateRevision,
      );
      publisher.settle();
      publisher.dispose();
      expect(payloads).toHaveLength(2);
    });

    it('emits nothing when no estimate was shown', () => {
      const { publisher, owner, onLiveStats } = setup();
      publisher.setSessionKey(SESSION);

      const lease = owner.leaseOf(SESSION);
      expect(lease && owner.release(lease)).toBe(true);
      publisher.dispose();

      expect(onLiveStats).not.toHaveBeenCalled();
    });

    it('dispose first, then release: one payload, from dispose', () => {
      const { publisher, owner, payloads } = withShownEstimate();

      publisher.dispose();
      expect(payloads).toHaveLength(2);
      expect(last(payloads).sessionStats).not.toHaveProperty('provisional');

      const lease = owner.leaseOf(SESSION);
      expect(lease && owner.release(lease)).toBe(true);
      expect(payloads).toHaveLength(2);
    });

    it('a throwing callback inside the release is logged once and release still succeeds', () => {
      const { publisher, owner, logger, onLiveStats } = setup({
        callback: () => {
          throw new Error('render failed');
        },
      });
      publisher.setSessionKey(SESSION);
      publisher.observe(assistant('m1', { input: 10 }));

      const lease = owner.leaseOf(SESSION);
      expect(lease && owner.release(lease)).toBe(true);

      expect(onLiveStats).toHaveBeenCalledTimes(2);
      expect(owner.snapshot(SESSION)).toBeNull();
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn.mock.calls[0]?.[1]).toEqual({
        sessionId: SESSION,
        error: 'Error',
      });
    });
  });

  describe('agent ordering', () => {
    it('recordAgent before task_started: one payload with the new count', () => {
      const { publisher, owner, payloads, clock } = setup();
      publisher.setSessionKey(SESSION);

      owner.recordAgent(SESSION, 'a1');
      // Never synchronous inside recordAgent.
      expect(payloads).toHaveLength(0);
      publisher.observe(taskStarted());
      clock.advance(0);

      expect(payloads).toHaveLength(1);
      expect(payloads[0]?.sessionStats.agentSessionCount).toBe(1);
      clock.advance(10 * LIVE_STATS_INTERVAL_MS);
      expect(payloads).toHaveLength(1);
    });

    it('task_started before recordAgent: a second payload within one interval, and no third', () => {
      const { publisher, owner, payloads, clock } = setup();
      publisher.setSessionKey(SESSION);

      publisher.observe(taskStarted());
      expect(payloads).toHaveLength(1);
      expect(payloads[0]?.sessionStats.agentSessionCount).toBe(0);

      owner.recordAgent(SESSION, 'a1');
      expect(payloads).toHaveLength(1);
      clock.advance(LIVE_STATS_INTERVAL_MS);

      expect(payloads).toHaveLength(2);
      expect(payloads[1]?.sessionStats.agentSessionCount).toBe(1);
      clock.advance(10 * LIVE_STATS_INTERVAL_MS);
      expect(payloads).toHaveLength(2);
    });

    it('a live estimate keeps its figures across an agent-count update', () => {
      const { owner, payloads, clock } = withShownEstimate();
      clock.advance(LIVE_STATS_INTERVAL_MS);

      owner.recordAgent(SESSION, 'a1');
      clock.advance(0);

      expect(payloads).toHaveLength(2);
      const stats = last(payloads).sessionStats;
      expect(stats.provisional).toBe(true);
      expect(stats.tokens.input).toBe(10);
      expect(stats.agentSessionCount).toBe(1);
    });
  });

  describe('dispose', () => {
    it('settles a shown estimate and detaches the watcher', () => {
      const { publisher, owner, payloads, clock, estimateRevision } =
        withShownEstimate();

      publisher.dispose();

      expect(payloads).toHaveLength(2);
      expect(last(payloads).sessionStats.revision).toBeGreaterThan(
        estimateRevision,
      );
      expect(owner.snapshot(SESSION)).toBe(last(payloads).sessionStats);

      owner.recordAgent(SESSION, 'a1');
      clock.advance(10 * LIVE_STATS_INTERVAL_MS);
      expect(payloads).toHaveLength(2);
    });

    it('is idempotent and leaves no timer', () => {
      const { publisher, payloads, clock } = withShownEstimate();
      publisher.observe(assistant('m1', { input: 20 }));
      expect(clock.pending).toBe(1);

      publisher.dispose();
      expect(clock.pending).toBe(0);
      expect(() => publisher.dispose()).not.toThrow();

      clock.advance(10 * LIVE_STATS_INTERVAL_MS);
      expect(payloads).toHaveLength(2);
    });

    it('clears the estimate on the owner even when none was shown', () => {
      const { publisher, owner, lease } = setup();
      owner.publishLive(SESSION, lease.generation, RUN, [
        {
          model: MODEL,
          inputTokens: 1,
          outputTokens: 1,
          cacheRead: 0,
          cacheCreation: 0,
          costUSD: 1,
        },
      ]);
      publisher.setSessionKey(SESSION);

      publisher.dispose();

      expect(
        owner.publishLive(SESSION, lease.generation, RUN, null),
      ).not.toHaveProperty('provisional');
    });
  });

  describe('failures and inert modes', () => {
    it('a throwing callback does not stop the next publish', () => {
      let calls = 0;
      const { publisher, onLiveStats, clock, logger } = setup({
        callback: () => {
          calls++;
          if (calls === 1) throw new Error('first');
        },
      });
      publisher.setSessionKey(SESSION);

      publisher.observe(assistant('m1', { input: 10 }));
      clock.advance(LIVE_STATS_INTERVAL_MS);
      publisher.observe(assistant('m1', { input: 20 }));

      expect(onLiveStats).toHaveBeenCalledTimes(2);
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('logs a rejected async callback', async () => {
      const { publisher, logger } = setup({
        callback: () => Promise.reject(new TypeError('async')),
      });
      publisher.setSessionKey(SESSION);

      publisher.observe(assistant('m1', { input: 10 }));
      await Promise.resolve();
      await Promise.resolve();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('onLiveStats callback failed'),
        { sessionId: SESSION, error: 'TypeError' },
      );
    });

    it('is inert without a callback', () => {
      const { publisher, owner, clock } = setup({ callback: null });
      const watch = jest.spyOn(owner, 'watch');
      const publishLive = jest.spyOn(owner, 'publishLive');

      publisher.setSessionKey(SESSION);
      publisher.observe(assistant('m1', { input: 10 }));
      publisher.observe(taskStarted());
      publisher.onResult();
      publisher.settle();
      publisher.dispose();

      expect(watch).not.toHaveBeenCalled();
      expect(publishLive).not.toHaveBeenCalled();
      expect(clock.pending).toBe(0);
    });

    it('is inert without a stats owner generation', () => {
      const { publisher, owner, onLiveStats, clock } = setup({
        statsGeneration: null,
      });
      const watch = jest.spyOn(owner, 'watch');

      publisher.setSessionKey(SESSION);
      publisher.observe(assistant('m1', { input: 10 }));
      clock.advance(10 * LIVE_STATS_INTERVAL_MS);
      publisher.dispose();

      expect(watch).not.toHaveBeenCalled();
      expect(onLiveStats).not.toHaveBeenCalled();
    });
  });
});
