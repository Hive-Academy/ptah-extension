/**
 * StreamTransformer live session-stats wiring (TASK_2026_626, Component 4).
 *
 * Drives a scripted `sdkQuery` against the REAL SessionStatsOwnerService,
 * with jest fake timers for the publisher's throttle:
 * - assistant frames (main loop and subagents, deduped per message id) feed a
 *   provisional snapshot; `task_started` / `recordAgent` publish the agent
 *   count in either order;
 * - every exit of the result branch settles a shown estimate exactly once,
 *   with a higher revision and no `context`, while `onResultStats` gets the
 *   same calls and payloads as a stream without `onLiveStats`;
 * - stream end, a stream error and the owner's release (Stop) each settle
 *   once, in either order, and leave no timer behind.
 */
import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type {
  AuthEnv,
  SessionId,
  SessionStatsEntry,
  SessionStatsLivePayload,
} from '@ptah-extension/shared';
import { findModelPricing } from '@ptah-extension/shared';
import { SessionStatsOwnerService } from '../session-stats/session-stats-owner.service';
import type { SdkMessageTransformer } from '../sdk-message-transformer';
import type { IModelResolver } from '../auth-env.port';
import type { IPricingProvider } from '../pricing.port';
import type { SessionMcpStatusCallbackRegistry } from './session-mcp-status-callback-registry';
import type { SessionPlanLimitCallbackRegistry } from './plan-limits/session-plan-limit-callback-registry';
import type { SDKMessage } from '../types/sdk-types/claude-sdk.types';
import { LIVE_STATS_INTERVAL_MS } from './live-session-stats-publisher';
import {
  StreamTransformer,
  type TransformerResultStats,
} from './stream-transformer';

const SESSION = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000626';
const TAB = 'tab-1';
const RUN = 'run-1';
const SONNET = 'claude-sonnet-4-5-20250929';

// --- Scripted SDK query --------------------------------------------------

type Step =
  | { readonly kind: 'message'; readonly message: SDKMessage }
  | { readonly kind: 'end' }
  | { readonly kind: 'throw'; readonly error: Error };

/**
 * An SDK query held open until the spec feeds it. `feed` resolves once the
 * transformer has processed every fed message and asks for the next one, so
 * each assertion sees the stream at rest.
 */
class ScriptedQuery {
  private readonly steps: Step[] = [];
  private wake: (() => void) | null = null;
  private idle: (() => void) | null = null;

  async *iterate(): AsyncGenerator<SDKMessage, void, undefined> {
    for (;;) {
      while (this.steps.length === 0) {
        const idle = this.idle;
        this.idle = null;
        idle?.();
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
      }
      const step = this.steps.shift();
      if (step === undefined) continue;
      if (step.kind === 'end') return;
      if (step.kind === 'throw') throw step.error;
      yield step.message;
    }
  }

  feed(messages: readonly SDKMessage[]): Promise<void> {
    const processed = new Promise<void>((resolve) => {
      this.idle = resolve;
    });
    this.push(messages.map((message) => ({ kind: 'message', message })));
    return processed;
  }

  /** Last step: the iterator returns or throws; await the consumer instead. */
  finish(step: Step): void {
    this.push([step]);
  }

  private push(steps: readonly Step[]): void {
    this.steps.push(...steps);
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }
}

// --- Harness ---------------------------------------------------------------

function makeLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

interface Harness {
  readonly owner: SessionStatsOwnerService;
  readonly live: SessionStatsLivePayload[];
  readonly results: TransformerResultStats[];
  readonly onStreamEnd: jest.Mock;
  /** `null` on a clean end, otherwise what the stream threw. */
  readonly done: Promise<unknown>;
  feed(...messages: SDKMessage[]): Promise<void>;
  end(): Promise<unknown>;
  fail(error: Error): Promise<unknown>;
}

function start({ live = true }: { live?: boolean } = {}): Harness {
  const logger = makeLogger();
  const messageTransformer = {
    createIsolated: () => ({ transform: jest.fn(() => []) }),
  } as unknown as SdkMessageTransformer;
  const modelResolver = {
    resolveForPricing: (m: string) => m,
    isSubscriptionCovered: () => false,
    resolveForCost: (m: string) => ({
      modelId: m,
      pricing: findModelPricing(m),
      subscriptionCovered: false,
    }),
  } as unknown as IModelResolver;
  const pricing: IPricingProvider = {
    getPricing: jest.fn().mockResolvedValue(null),
    ensureHydrated: jest.fn().mockResolvedValue(true),
  };
  const owner = new SessionStatsOwnerService();
  // As the adapter does for a new session: an owner under the tab key,
  // rebound to the SDK id from `onSessionIdResolved`.
  const { generation } = owner.startNew(TAB);
  const transformer = new StreamTransformer(
    logger,
    messageTransformer,
    {} as AuthEnv,
    modelResolver,
    pricing,
    { notifyAll: jest.fn() } as unknown as SessionMcpStatusCallbackRegistry,
    owner,
    { notifyAll: jest.fn() } as unknown as SessionPlanLimitCallbackRegistry,
  );
  const query = new ScriptedQuery();
  const livePayloads: SessionStatsLivePayload[] = [];
  const results: TransformerResultStats[] = [];
  const onStreamEnd = jest.fn();
  const iterable = transformer.transform({
    sdkQuery: query.iterate(),
    sessionId: TAB as SessionId,
    tabId: TAB,
    initialModel: SONNET,
    runToken: RUN,
    usageCostSource: 'reported',
    accountingAuthEnv: {} as AuthEnv,
    statsGeneration: generation,
    onSessionIdResolved: (_tabId, realSessionId) =>
      owner.rebind(TAB, realSessionId, generation),
    onResultStats: (stats) => {
      results.push(stats);
    },
    ...(live && {
      onLiveStats: (payload: SessionStatsLivePayload) => {
        livePayloads.push(payload);
      },
    }),
    onStreamEnd,
  });
  const done = (async () => {
    for await (const event of iterable) void event;
  })().then(
    () => null,
    (error: unknown) => error,
  );
  return {
    owner,
    live: livePayloads,
    results,
    onStreamEnd,
    done,
    feed: (...messages) => query.feed(messages),
    end: () => {
      query.finish({ kind: 'end' });
      return done;
    },
    fail: (error) => {
      query.finish({ kind: 'throw', error });
      return done;
    },
  };
}

// --- SDK message factories (only the fields the guards and branches read) --

const msg = (m: object): SDKMessage => m as unknown as SDKMessage;

const init = (): SDKMessage =>
  msg({
    type: 'system',
    subtype: 'init',
    session_id: SESSION,
    tools: [],
    mcp_servers: [],
  });

interface Usage {
  readonly input?: number;
  readonly output?: number;
  readonly cacheRead?: number;
}

/** One `assistant` frame of API message `id` (subagent when `parent` set). */
function assistant(
  id: string,
  usage: Usage,
  parent: string | null = null,
): SDKMessage {
  return msg({
    type: 'assistant',
    parent_tool_use_id: parent,
    session_id: SESSION,
    message: {
      id,
      model: SONNET,
      role: 'assistant',
      content: [],
      usage: {
        input_tokens: usage.input ?? 0,
        output_tokens: usage.output ?? 0,
        cache_read_input_tokens: usage.cacheRead ?? 0,
        cache_creation_input_tokens: 0,
      },
    },
  });
}

/** A main-loop `message_start`: what the context gauge tracks. */
function messageStart(input: number, cacheRead = 0): SDKMessage {
  return msg({
    type: 'stream_event',
    parent_tool_use_id: null,
    session_id: SESSION,
    event: {
      type: 'message_start',
      message: {
        model: SONNET,
        usage: {
          input_tokens: input,
          output_tokens: 0,
          cache_read_input_tokens: cacheRead,
          cache_creation_input_tokens: 0,
        },
      },
    },
  });
}

const compactBoundary = (): SDKMessage =>
  msg({
    type: 'system',
    subtype: 'compact_boundary',
    session_id: SESSION,
    compact_metadata: { trigger: 'auto', pre_tokens: 10 },
  });

const taskStarted = (): SDKMessage =>
  msg({
    type: 'system',
    subtype: 'task_started',
    task_id: 'task-1',
    tool_use_id: 'toolu_task',
    description: 'subagent',
    session_id: SESSION,
  });

interface ResultSpec {
  /** Cumulative per-model usage; absent: the result has no `modelUsage`. */
  readonly modelUsage?: Readonly<
    Record<string, { input: number; output: number }>
  >;
  /** Per-turn aggregate usage. */
  readonly usage?: { input: number; output: number };
  readonly durationMs?: number;
}

function result({
  modelUsage,
  usage = { input: 1, output: 1 },
  durationMs = 10,
}: ResultSpec): SDKMessage {
  return msg({
    type: 'result',
    subtype: 'success',
    is_error: false,
    session_id: SESSION,
    duration_ms: durationMs,
    total_cost_usd: 0,
    usage: { input_tokens: usage.input, output_tokens: usage.output },
    ...(modelUsage && {
      modelUsage: Object.fromEntries(
        Object.entries(modelUsage).map(([model, u]) => [
          model,
          {
            inputTokens: u.input,
            outputTokens: u.output,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            contextWindow: 200_000,
            costUSD: 0,
          },
        ]),
      ),
    }),
  });
}

// --- Assertion helpers -----------------------------------------------------

const revisionOf = (payload: SessionStatsLivePayload): number =>
  payload.sessionStats.revision ?? Number.NaN;

function last<T>(items: readonly T[]): T {
  const item = items[items.length - 1];
  if (item === undefined) throw new Error('expected at least one item');
  return item;
}

/** The latest provisional payload; fails when none was published. */
function lastEstimate(h: Harness): SessionStatsLivePayload {
  const estimates = h.live.filter((p) => p.sessionStats.provisional === true);
  return last(estimates);
}

/** Asserts an authoritative settle payload above revision `floor`. */
function expectSettle(
  payload: SessionStatsLivePayload,
  floor: number,
): SessionStatsEntry {
  expect(payload.sessionId).toBe(SESSION);
  expect(payload.sessionStats).not.toHaveProperty('provisional');
  expect(payload).not.toHaveProperty('context');
  expect(revisionOf(payload)).toBeGreaterThan(floor);
  return payload.sessionStats;
}

/**
 * `onResultStats` payloads with the snapshot revision removed: estimates
 * advance the owner's revision counter, nothing else in the payload.
 */
function withoutRevision(
  results: readonly TransformerResultStats[],
): unknown[] {
  return results.map((stats) =>
    stats.sessionStats
      ? {
          ...stats,
          sessionStats: { ...stats.sessionStats, revision: undefined },
        }
      : stats,
  );
}

const tick = (): void => {
  jest.advanceTimersByTime(LIVE_STATS_INTERVAL_MS);
};

describe('StreamTransformer — live session stats', () => {
  beforeEach(() => {
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('publishes a provisional snapshot that sums main-loop and subagent frames, deduped per message id', async () => {
    const h = start();
    await h.feed(init());
    const base = h.owner.snapshot(SESSION)?.tokenCount ?? 0;

    // A stream_event is not an estimate source: only `assistant` frames are.
    await h.feed(
      messageStart(5_000),
      assistant('m1', { input: 100, output: 10 }),
    );
    const first = lastEstimate(h);
    expect(first.sessionId).toBe(SESSION);
    expect(first.sessionStats.tokenCount).toBe(base + 110);

    // Within the interval: coalesced into one trailing flush.
    await h.feed(assistant('s1', { input: 40, output: 5 }, 'toolu_sub'));
    expect(lastEstimate(h)).toBe(first);
    tick();
    expect(lastEstimate(h).sessionStats.tokenCount).toBe(base + 155);

    // A later frame of message m1 replaces its usage, never adds to it.
    await h.feed(assistant('m1', { input: 100, output: 30 }));
    tick();
    expect(lastEstimate(h).sessionStats.tokenCount).toBe(base + 175);

    await h.end();
  });

  it.each([
    ['task_started before the SubagentStart hook records the agent', true],
    ['the hook records the agent before task_started', false],
  ])(
    'publishes the incremented agent count within one interval when %s',
    async (_label, taskFirst) => {
      const h = start();
      await h.feed(init());
      if (taskFirst) {
        await h.feed(taskStarted());
        h.owner.recordAgent(SESSION, 'agent-a1');
      } else {
        h.owner.recordAgent(SESSION, 'agent-a1');
        await h.feed(taskStarted());
      }
      tick();

      expect(last(h.live).sessionStats.agentSessionCount).toBe(1);
      expect(h.results).toHaveLength(0);
      await h.end();
    },
  );

  it('at a result: the authoritative revision supersedes the estimate, and only one settle payload follows', async () => {
    const h = start();
    await h.feed(init(), assistant('m1', { input: 100, output: 50 }));
    const estimate = revisionOf(lastEstimate(h));
    const before = h.live.length;

    await h.feed(
      result({
        modelUsage: { [SONNET]: { input: 100, output: 50 } },
        usage: { input: 100, output: 50 },
      }),
    );
    expect(h.results).toHaveLength(1);
    expect(
      last(h.results).sessionStats?.revision ?? Number.NaN,
    ).toBeGreaterThan(estimate);
    expect(h.live).toHaveLength(before + 1);

    jest.advanceTimersByTime(LIVE_STATS_INTERVAL_MS * 5);
    expect(h.live).toHaveLength(before + 1);
    expect(jest.getTimerCount()).toBe(0);
    await h.end();
  });

  const accepted = result({
    modelUsage: { [SONNET]: { input: 100, output: 50 } },
    usage: { input: 100, output: 50 },
  });

  /**
   * Every exit of the result branch. `before` runs first (fed after init),
   * then an estimate is shown, then `last` is the result under test.
   * `resultCalls` is what `onResultStats` receives for `last` (unchanged).
   */
  const exits: ReadonlyArray<{
    readonly name: string;
    readonly before: readonly SDKMessage[];
    readonly last: SDKMessage;
    readonly resultCalls: number;
  }> = [
    { name: 'accepted', before: [], last: accepted, resultCalls: 1 },
    { name: 'duplicate', before: [accepted], last: accepted, resultCalls: 0 },
    {
      name: 'rejected-non-monotonic',
      before: [accepted],
      last: result({
        modelUsage: { [SONNET]: { input: 50, output: 50 } },
        usage: { input: 50, output: 50 },
      }),
      resultCalls: 1,
    },
    {
      name: 'rejected-invalid',
      before: [],
      last: result({ modelUsage: { [SONNET]: { input: -1, output: 5 } } }),
      resultCalls: 1,
    },
    {
      name: 'empty usage (no aggregate, no per-model rows)',
      before: [],
      last: result({ usage: { input: 0, output: 0 } }),
      resultCalls: 0,
    },
    {
      name: 'aggregate usage without per-model rows (markRunIncomplete)',
      before: [],
      last: result({ usage: { input: 20, output: 10 } }),
      resultCalls: 1,
    },
    {
      name: 'validateStats rejection',
      before: [],
      last: result({
        modelUsage: { [SONNET]: { input: 100, output: 50 } },
        durationMs: -1,
      }),
      resultCalls: 0,
    },
  ];

  it.each(exits)(
    'settles a shown estimate exactly once on the $name exit, leaving onResultStats unchanged',
    async ({ before, last: resultMessage, resultCalls }) => {
      const run = async (live: boolean) => {
        const h = start({ live });
        await h.feed(init(), ...before);
        tick();
        await h.feed(assistant('m-est', { input: 7, output: 3 }));
        const resultsBefore = h.results.length;
        const liveBefore = h.live.length;
        const floor = live ? revisionOf(lastEstimate(h)) : Number.NaN;
        await h.feed(resultMessage);
        return { h, resultsBefore, liveBefore, floor };
      };

      const withLive = await run(true);
      const baseline = await run(false);
      const { h, resultsBefore, liveBefore, floor } = withLive;

      expect(h.results.length - resultsBefore).toBe(resultCalls);
      expect(withoutRevision(h.results)).toEqual(
        withoutRevision(baseline.h.results),
      );
      expect(h.live).toHaveLength(liveBefore + 1);
      const settled = expectSettle(last(h.live), floor);
      if (resultCalls === 1) {
        expect(settled).toEqual(last(h.results).sessionStats);
      }

      expect(baseline.h.live).toHaveLength(0);
      await h.end();
      await baseline.h.end();
      expect(h.live).toHaveLength(liveBefore + 1);
    },
  );

  it('publishes no settle payload for a turn that showed no estimate', async () => {
    const h = start();
    await h.feed(init(), accepted);

    expect(h.results).toHaveLength(1);
    expect(h.live).toHaveLength(0);
    await h.end();
    expect(h.live).toHaveLength(0);
  });

  it('settles once from dispose when the stream ends after an estimate without a result', async () => {
    const h = start();
    await h.feed(init(), assistant('m1', { input: 100, output: 50 }));
    await h.feed(assistant('m2', { input: 10, output: 5 }));
    const floor = revisionOf(lastEstimate(h));
    const before = h.live.length;

    await expect(h.end()).resolves.toBeNull();
    expect(h.live).toHaveLength(before + 1);
    expectSettle(last(h.live), floor);
    expect(h.onStreamEnd).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('settles once from dispose when the stream throws after an estimate, and the error still propagates', async () => {
    const h = start();
    await h.feed(init(), assistant('m1', { input: 100, output: 50 }));
    const floor = revisionOf(lastEstimate(h));
    const before = h.live.length;
    const failure = new Error('connection reset');

    await expect(h.fail(failure)).resolves.toBe(failure);
    expect(h.live).toHaveLength(before + 1);
    expectSettle(last(h.live), floor);
    expect(h.onStreamEnd).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('second turn: the live total is the first result plus the new estimate, never the first turn again', async () => {
    const h = start();
    await h.feed(init(), assistant('m1', { input: 100, output: 50 }));
    await h.feed(accepted);
    const authoritative = last(h.live).sessionStats.tokenCount ?? Number.NaN;
    expect(authoritative).toBe(last(h.results).sessionStats?.tokenCount);

    tick();
    await h.feed(assistant('m2', { input: 200, output: 20 }));
    expect(lastEstimate(h).sessionStats.tokenCount).toBe(authoritative + 220);
    await h.end();
  });

  it('carries the main-loop context on provisional payloads only: absent after compact_boundary and on the settle payload', async () => {
    const h = start();
    await h.feed(
      init(),
      messageStart(1_000, 500),
      assistant('m1', { input: 1_000, output: 10, cacheRead: 500 }),
    );
    expect(lastEstimate(h).context).toEqual({
      model: SONNET,
      contextTokens: 1_500,
    });

    tick();
    await h.feed(compactBoundary(), assistant('m2', { input: 30, output: 5 }));
    const afterCompact = lastEstimate(h);
    expect(afterCompact).not.toBe(h.live[0]);
    expect(afterCompact).not.toHaveProperty('context');

    tick();
    await h.feed(
      messageStart(2_000),
      assistant('m3', { input: 2_000, output: 5 }),
    );
    expect(lastEstimate(h).context).toEqual({
      model: SONNET,
      contextTokens: 2_000,
    });
    const floor = revisionOf(lastEstimate(h));

    // The result's `modelUsage` context differs from the last partial reading.
    await h.feed(
      result({
        modelUsage: { [SONNET]: { input: 3_030, output: 20 } },
        usage: { input: 2_000, output: 5 },
      }),
    );
    expectSettle(last(h.live), floor);
    await h.end();
  });

  it('Stop: release while the stream is open settles once; the stream end afterwards emits nothing and leaves no timer', async () => {
    const h = start();
    await h.feed(init(), assistant('m1', { input: 100, output: 50 }));
    const floor = revisionOf(lastEstimate(h));
    // A trailing flush is armed when Stop arrives.
    await h.feed(assistant('m2', { input: 10, output: 5 }));
    expect(jest.getTimerCount()).toBe(1);
    const before = h.live.length;

    // The exact call `interruptSession` makes after its teardown await.
    const lease = h.owner.leaseOf(SESSION);
    expect(lease).not.toBeNull();
    if (lease === null) return;
    expect(h.owner.release(lease)).toBe(true);

    expect(h.live).toHaveLength(before + 1);
    expectSettle(last(h.live), floor);
    expect(jest.getTimerCount()).toBe(0);

    // The aborted query's iterator returns.
    await expect(h.end()).resolves.toBeNull();
    expect(h.live).toHaveLength(before + 1);
    expect(h.onStreamEnd).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('Stop, mirror order: the stream ends first and settles once; the later release emits nothing', async () => {
    const h = start();
    await h.feed(init(), assistant('m1', { input: 100, output: 50 }));
    const floor = revisionOf(lastEstimate(h));
    const before = h.live.length;

    await expect(h.end()).resolves.toBeNull();
    expect(h.live).toHaveLength(before + 1);
    expectSettle(last(h.live), floor);

    const lease = h.owner.leaseOf(SESSION);
    expect(lease).not.toBeNull();
    if (lease === null) return;
    expect(h.owner.release(lease)).toBe(true);
    expect(h.live).toHaveLength(before + 1);
    expect(h.onStreamEnd).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('without onLiveStats: no timer, no owner watcher work, and onResultStats is what a live stream gets', async () => {
    const script = [
      init(),
      assistant('m1', { input: 100, output: 50 }),
      assistant('s1', { input: 40, output: 5 }, 'toolu_sub'),
      taskStarted(),
      accepted,
    ];
    const silent = start({ live: false });
    await silent.feed(...script.slice(0, 4));
    silent.owner.recordAgent(SESSION, 'agent-a1');
    expect(jest.getTimerCount()).toBe(0);
    await silent.feed(...script.slice(4));
    await silent.end();

    const live = start();
    await live.feed(...script.slice(0, 4));
    live.owner.recordAgent(SESSION, 'agent-a1');
    await live.feed(...script.slice(4));
    await live.end();

    expect(silent.live).toHaveLength(0);
    expect(silent.results).toHaveLength(1);
    expect(last(silent.results).sessionStats).not.toHaveProperty('provisional');
    expect(withoutRevision(silent.results)).toEqual(
      withoutRevision(live.results),
    );
    expect(silent.onStreamEnd).toHaveBeenCalledTimes(1);
  });
});
