/**
 * StreamTransformer specs _FOLLOWUP coverage.
 *
 * Targets the per-turn context-fill bookkeeping that drives the frontend's
 * `liveModelStats.contextPercent`. The earlier compaction bug shipped 1118%
 * fills because `lastTurnContextByModel` was leaking across compact_boundary;
 * these tests pin the fix in place.
 *
 * Coverage:
 *   1. compact_boundary clears `lastTurnContextByModel` — a result event
 *      arriving after the boundary (without a fresh message_start) emits
 *      `lastTurnContextTokens: undefined`.
 *   2. cache_creation_input_tokens is included in the lastTurnContextTokens
 *      sum (first-cache-write turns must not under-report).
 *   3. Two consecutive message_starts for the same model — the second
 *      overwrites the first (no leak / no accumulation).
 *
 * Mocking posture:
 *   - Direct `new StreamTransformer(...)` with hand-rolled typed mocks.
 *   - SdkMessageTransformer.transform is stubbed to [] — we don't care about
 *     downstream events, only the `onResultStats` callback payload.
 *   - The async iterable is built from a plain array of SDK messages.
 */

import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type { AuthEnv, ModelPricing, SessionId } from '@ptah-extension/shared';
import { findModelPricing } from '@ptah-extension/shared';
import type { SdkMessageTransformer } from '../sdk-message-transformer';
import type { IModelResolver } from '../auth-env.port';
import type {
  SessionMcpStatusCallbackRegistry,
  SessionMcpStatusEvent,
} from './session-mcp-status-callback-registry';
import type { IPricingProvider } from '../pricing.port';
import type { SDKMessage } from '../types/sdk-types/claude-sdk.types';

import { StreamTransformer, ResultModelUsage } from './stream-transformer';
import type { NoActivityWatchdog } from './no-activity-watchdog';

interface FakeWatchdog {
  start: jest.Mock;
  observe: jest.Mock;
  stop: jest.Mock;
}

function makeFakeWatchdog(): FakeWatchdog {
  return { start: jest.fn(), observe: jest.fn(), stop: jest.fn() };
}

// ---------------------------------------------------------------------------
// Typed mock helpers
// ---------------------------------------------------------------------------

function makeLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

/**
 * The DI singleton's stand-in. `createIsolated` returns the same object here so
 * the assertions in this file can keep reading one `transform` mock; the
 * isolation contract itself is pinned separately, with distinct isolates, in
 * the "per-stream isolation" block at the bottom.
 */
function makeMessageTransformer(): jest.Mocked<
  Pick<SdkMessageTransformer, 'transform' | 'createIsolated'>
> {
  const mock = {
    transform: jest.fn().mockReturnValue([]),
    createIsolated: jest.fn(),
  } as unknown as jest.Mocked<
    Pick<SdkMessageTransformer, 'transform' | 'createIsolated'>
  >;
  mock.createIsolated.mockReturnValue(mock as unknown as SdkMessageTransformer);
  return mock;
}

function makeModelResolver(): jest.Mocked<
  Pick<
    IModelResolver,
    'resolveForPricing' | 'resolveForCost' | 'isSubscriptionCovered'
  >
> {
  return {
    resolveForPricing: jest.fn((m: string) => m || 'unknown'),
    isSubscriptionCovered: jest.fn(() => false),
    resolveForCost: jest.fn((m: string) => ({
      modelId: m || 'unknown',
      pricing: findModelPricing(m || 'unknown'),
      subscriptionCovered: false,
    })),
  };
}

function makePricingProvider(): jest.Mocked<IPricingProvider> {
  return {
    getPricing: jest.fn().mockResolvedValue(null),
    ensureHydrated: jest.fn().mockResolvedValue(true),
  };
}

const MODEL = 'claude-sonnet-4-20250514';

function makeAuthEnv(overrides: Partial<AuthEnv> = {}): AuthEnv {
  return overrides as AuthEnv;
}

function asAsyncIterable(messages: SDKMessage[]): AsyncIterable<SDKMessage> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const m of messages) yield m;
    },
  };
}

interface Harness {
  transformer: StreamTransformer;
  messageTransformer: ReturnType<typeof makeMessageTransformer>;
  pricingProvider: jest.Mocked<IPricingProvider>;
  logger: jest.Mocked<Logger>;
  /** Every event the transformer published on the MCP-status fan-out. */
  mcpEvents: SessionMcpStatusEvent[];
}

function makeHarness(authEnv: AuthEnv = makeAuthEnv()): Harness {
  const logger = makeLogger();
  const messageTransformer = makeMessageTransformer();
  const modelResolver = makeModelResolver();
  const pricingProvider = makePricingProvider();
  const mcpEvents: SessionMcpStatusEvent[] = [];
  const mcpStatus = {
    notifyAll: (event: SessionMcpStatusEvent) => {
      mcpEvents.push(event);
    },
  } as unknown as SessionMcpStatusCallbackRegistry;
  const transformer = new StreamTransformer(
    logger,
    messageTransformer as unknown as SdkMessageTransformer,
    authEnv,
    modelResolver as unknown as IModelResolver,
    pricingProvider,
    mcpStatus,
  );
  return {
    transformer,
    messageTransformer,
    pricingProvider,
    logger,
    mcpEvents,
  };
}

// ---------------------------------------------------------------------------
// SDK message factories — minimal shapes that satisfy the type guards.
// We cast through `unknown` to keep the test fixtures tight; the runtime
// guards only inspect a handful of fields.
// ---------------------------------------------------------------------------

function messageStart(
  model: string,
  usage: {
    input_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  },
): SDKMessage {
  return {
    type: 'stream_event',
    event: {
      type: 'message_start',
      message: {
        id: 'msg_x',
        type: 'message',
        role: 'assistant',
        content: [],
        model,
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: usage.input_tokens,
          output_tokens: 0,
          cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
          cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
        },
      },
    },
  } as unknown as SDKMessage;
}

// Final message_delta of an API turn. Fields left undefined here are ABSENT
// from the emitted usage object (not zero) — absence is the case the
// retain-last-known rule must distinguish from an explicit 0.
function messageDelta(usage: {
  input_tokens?: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}): SDKMessage {
  return {
    type: 'stream_event',
    event: {
      type: 'message_delta',
      delta: { stop_reason: 'end_turn', stop_sequence: null },
      usage: {
        ...(usage.input_tokens !== undefined
          ? { input_tokens: usage.input_tokens }
          : {}),
        output_tokens: usage.output_tokens,
        ...(usage.cache_read_input_tokens !== undefined
          ? { cache_read_input_tokens: usage.cache_read_input_tokens }
          : {}),
        ...(usage.cache_creation_input_tokens !== undefined
          ? { cache_creation_input_tokens: usage.cache_creation_input_tokens }
          : {}),
      },
    },
  } as unknown as SDKMessage;
}

function systemInit(mcpServers: unknown, sessionId = 'sess-1'): SDKMessage {
  return {
    type: 'system',
    subtype: 'init',
    session_id: sessionId,
    tools: ['Read', 'mcp__ptah__ptah_ast_analyze'],
    mcp_servers: mcpServers,
  } as unknown as SDKMessage;
}

function compactBoundary(): SDKMessage {
  return {
    type: 'system',
    subtype: 'compact_boundary',
    session_id: 'sess-1',
  } as unknown as SDKMessage;
}

function resultMessage(
  model: string,
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens?: number;
    cacheCreationInputTokens?: number;
  },
): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    session_id: 'sess-1',
    duration_ms: 100,
    duration_api_ms: 90,
    is_error: false,
    num_turns: 1,
    total_cost_usd: 0,
    usage: {
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cache_read_input_tokens: usage.cacheReadInputTokens ?? 0,
      cache_creation_input_tokens: usage.cacheCreationInputTokens ?? 0,
    },
    modelUsage: {
      [model]: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadInputTokens: usage.cacheReadInputTokens ?? 0,
        cacheCreationInputTokens: usage.cacheCreationInputTokens ?? 0,
        contextWindow: 200000,
        costUSD: 0,
      },
    },
  } as unknown as SDKMessage;
}

interface ResultModelUsageFixture {
  inputTokens: number;
  outputTokens: number;
  costUSD: number;
}

function resultMessageMulti(opts: {
  totalCostUsd: number;
  modelUsage: Record<string, ResultModelUsageFixture>;
}): SDKMessage {
  const aggInput = Object.values(opts.modelUsage).reduce(
    (s, u) => s + u.inputTokens,
    0,
  );
  const aggOutput = Object.values(opts.modelUsage).reduce(
    (s, u) => s + u.outputTokens,
    0,
  );
  const modelUsage: Record<string, unknown> = {};
  for (const [model, u] of Object.entries(opts.modelUsage)) {
    modelUsage[model] = {
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      contextWindow: 200000,
      costUSD: u.costUSD,
    };
  }
  return {
    type: 'result',
    subtype: 'success',
    session_id: 'sess-1',
    duration_ms: 100,
    duration_api_ms: 90,
    is_error: false,
    num_turns: 1,
    total_cost_usd: opts.totalCostUsd,
    usage: {
      input_tokens: aggInput,
      output_tokens: aggOutput,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
    modelUsage,
  } as unknown as SDKMessage;
}

async function drain(iter: AsyncIterable<unknown>): Promise<void> {
  // Consume the iterator end-to-end so all callbacks fire.
  // We don't care about the yielded events here — `onResultStats` is the
  // observable signal under test.

  for await (const _e of iter) {
    void _e;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StreamTransformer — lastTurnContextTokens (TASK_2026_109_FOLLOWUP)', () => {
  it('clears lastTurnContextByModel on compact_boundary — next result without message_start emits lastTurnContextTokens=undefined', async () => {
    const { transformer } = makeHarness();
    const captured: ResultModelUsage[][] = [];

    const messages: SDKMessage[] = [
      messageStart(MODEL, {
        input_tokens: 5000,
        cache_read_input_tokens: 1000,
      }),
      // Compaction wipes the per-turn map.
      compactBoundary(),
      // Result arrives AFTER the boundary with no fresh message_start.
      // The cleared map MUST yield `undefined` (not the stale 6000).
      resultMessage(MODEL, { inputTokens: 10, outputTokens: 20 }),
    ];

    const iter = transformer.transform({
      sdkQuery: asAsyncIterable(messages),
      sessionId: 'sess-1' as SessionId,
      initialModel: MODEL,
      onResultStats: (stats) => {
        if (stats.modelUsage) captured.push(stats.modelUsage);
      },
    });

    await drain(iter);

    expect(captured).toHaveLength(1);
    expect(captured[0]).toHaveLength(1);
    expect(captured[0][0].lastTurnContextTokens).toBeUndefined();
  });

  it('includes cache_creation_input_tokens in lastTurnContextTokens (first-cache-write turn)', async () => {
    const { transformer } = makeHarness();
    const captured: ResultModelUsage[][] = [];

    // First turn writes a fresh cache block — pre-fix this read as just
    // input_tokens + cache_read = 200, missing the 5000 cache_creation
    // tokens that are also part of the prompt the model actually saw.
    const messages: SDKMessage[] = [
      messageStart(MODEL, {
        input_tokens: 200,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 5000,
      }),
      resultMessage(MODEL, { inputTokens: 200, outputTokens: 50 }),
    ];

    const iter = transformer.transform({
      sdkQuery: asAsyncIterable(messages),
      sessionId: 'sess-1' as SessionId,
      initialModel: MODEL,
      onResultStats: (stats) => {
        if (stats.modelUsage) captured.push(stats.modelUsage);
      },
    });

    await drain(iter);

    expect(captured).toHaveLength(1);
    expect(captured[0][0].lastTurnContextTokens).toBe(5200); // 200 + 0 + 5000
  });

  it('two consecutive message_starts: second overwrites the map (no leak / no accumulation)', async () => {
    const { transformer } = makeHarness();
    const captured: ResultModelUsage[][] = [];

    const messages: SDKMessage[] = [
      messageStart(MODEL, {
        input_tokens: 1000,
        cache_read_input_tokens: 500,
        cache_creation_input_tokens: 0,
      }),
      // Second message_start for the SAME model — must replace, not add.
      messageStart(MODEL, {
        input_tokens: 100,
        cache_read_input_tokens: 50,
        cache_creation_input_tokens: 0,
      }),
      resultMessage(MODEL, { inputTokens: 100, outputTokens: 20 }),
    ];

    const iter = transformer.transform({
      sdkQuery: asAsyncIterable(messages),
      sessionId: 'sess-1' as SessionId,
      initialModel: MODEL,
      onResultStats: (stats) => {
        if (stats.modelUsage) captured.push(stats.modelUsage);
      },
    });

    await drain(iter);

    expect(captured).toHaveLength(1);
    // Only the second message_start's tokens count: 100 + 50 = 150.
    // If the map leaked / accumulated, we'd see 1500 (1000+500) or 1650.
    expect(captured[0][0].lastTurnContextTokens).toBe(150);
  });
});

// ---------------------------------------------------------------------------
// TASK_2026_408 phase 2 — usage-to-stats integration regressions.
//
// These pin the producer side of the context gauge: whatever usage a
// provider's message_start carries must reach `onResultStats` untouched,
// and the turn's context fill (lastTurnContextTokens) must stay distinct
// from the turn's cumulative token total. The frontend's
// `deriveLiveModelStats` (pinned in its own spec) renders exactly this
// payload; the gauge cannot be more honest than what leaves this seam.
// ---------------------------------------------------------------------------

describe('StreamTransformer — usage-to-stats flow (TASK_2026_408)', () => {
  interface StatsCapture {
    cost: number | null;
    // Matches the payload's `MessageTokenUsage`: cache fields are optional
    // upstream, so the capture type must accept their absence too.
    tokens: {
      input: number;
      output: number;
      cacheRead?: number;
      cacheCreation?: number;
    };
    modelUsage?: ResultModelUsage[];
  }

  function captureStats(): {
    captured: StatsCapture[];
    onResultStats: (stats: StatsCapture) => void;
  } {
    const captured: StatsCapture[] = [];
    return {
      captured,
      onResultStats: (stats) => {
        captured.push({
          cost: stats.cost,
          tokens: stats.tokens,
          modelUsage: stats.modelUsage,
        });
      },
    };
  }

  it('carries input 30 / cacheRead 12 / output 9 through to the stats payload', async () => {
    const { transformer } = makeHarness();
    const { captured, onResultStats } = captureStats();

    const messages: SDKMessage[] = [
      // Direct-Anthropic shape: message_start already carries the real
      // prompt size. (Proxied providers send synthetic zeros here and the
      // real numbers in the final message_delta — covered by the Gap 1
      // describe below.)
      messageStart(MODEL, {
        input_tokens: 30,
        cache_read_input_tokens: 12,
      }),
      resultMessage(MODEL, {
        inputTokens: 30,
        outputTokens: 9,
        cacheReadInputTokens: 12,
      }),
    ];

    await drain(
      transformer.transform({
        sdkQuery: asAsyncIterable(messages),
        sessionId: 'sess-1' as SessionId,
        initialModel: MODEL,
        onResultStats,
      }),
    );

    expect(captured).toHaveLength(1);
    // Cumulative turn totals: 30 + 9 + 12 = 51.
    expect(captured[0].tokens).toEqual({
      input: 30,
      output: 9,
      cacheRead: 12,
      cacheCreation: 0,
    });
    const row = captured[0].modelUsage?.[0];
    expect(row).toBeDefined();
    expect(row?.cacheReadInputTokens).toBe(12);
    // Context fill of THIS turn (30 uncached + 12 cached) must stay distinct
    // from the cumulative total (51): mixing them up is what produces
    // ">100% full" headers after a few turns.
    expect(row?.lastTurnContextTokens).toBe(42);
  });

  it('treats an explicit-zero message_start as a real reading (0, not undefined)', async () => {
    const { transformer } = makeHarness();
    const { captured, onResultStats } = captureStats();

    await drain(
      transformer.transform({
        sdkQuery: asAsyncIterable([
          // input_tokens: 0 is an answer ("this prompt was fully billed as
          // cache"), not an absence. `deriveLiveModelStats` renders 0 as a
          // valid gauge reading; only undefined falls back to cumulative.
          messageStart(MODEL, { input_tokens: 0, cache_read_input_tokens: 0 }),
          resultMessage(MODEL, { inputTokens: 0, outputTokens: 5 }),
        ]),
        sessionId: 'sess-1' as SessionId,
        initialModel: MODEL,
        onResultStats,
      }),
    );

    expect(captured).toHaveLength(1);
    expect(captured[0].modelUsage?.[0].lastTurnContextTokens).toBe(0);
  });

  it('emits lastTurnContextTokens undefined when no message_start reported usage for the model', async () => {
    const { transformer } = makeHarness();
    const { captured, onResultStats } = captureStats();

    await drain(
      transformer.transform({
        sdkQuery: asAsyncIterable([
          // No message_start at all — the frontend must fall back to the
          // cumulative tokens (and suppress the fill post-compaction).
          resultMessage(MODEL, { inputTokens: 100, outputTokens: 20 }),
        ]),
        sessionId: 'sess-1' as SessionId,
        initialModel: MODEL,
        onResultStats,
      }),
    );

    expect(captured).toHaveLength(1);
    expect(
      captured[0].modelUsage?.[0].lastTurnContextTokens,
    ).toBeUndefined();
  });

  it('derives identical token stats for direct Anthropic and proxied providers (usage is provider-neutral)', async () => {
    // Same stream shape under two auth environments. Only cost sourcing is
    // allowed to differ; token and context accounting must not.
    const run = async (authEnv: AuthEnv): Promise<StatsCapture> => {
      const { transformer } = makeHarness(authEnv);
      const { captured, onResultStats } = captureStats();
      await drain(
        transformer.transform({
          sdkQuery: asAsyncIterable([
            messageStart(MODEL, {
              input_tokens: 30,
              cache_read_input_tokens: 12,
            }),
            resultMessage(MODEL, {
              inputTokens: 30,
              outputTokens: 9,
              cacheReadInputTokens: 12,
            }),
          ]),
          sessionId: 'sess-1' as SessionId,
          initialModel: MODEL,
          onResultStats,
        }),
      );
      expect(captured).toHaveLength(1);
      return captured[0];
    };

    const direct = await run(
      makeAuthEnv({ ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }),
    );
    const proxied = await run(
      makeAuthEnv({ ANTHROPIC_BASE_URL: 'https://openrouter.ai/api/v1' }),
    );

    expect(proxied.tokens).toEqual(direct.tokens);
    expect(proxied.modelUsage?.[0].inputTokens).toBe(
      direct.modelUsage?.[0].inputTokens,
    );
    expect(proxied.modelUsage?.[0].cacheReadInputTokens).toBe(
      direct.modelUsage?.[0].cacheReadInputTokens,
    );
    expect(proxied.modelUsage?.[0].lastTurnContextTokens).toBe(
      direct.modelUsage?.[0].lastTurnContextTokens,
    );
  });
});

// ---------------------------------------------------------------------------
// TASK_2026_408 Gap 1 — message_delta usage in the context tracker.
//
// Proxied providers (Codex/OpenRouter via the responses translation proxy)
// emit message_start with SYNTHETIC ZERO usage and the real input/cache
// numbers only in the FINAL message_delta. Before the fix the tracker read
// message_start alone, so the gauge stayed pinned at 0% for every proxied
// session. Direct Anthropic semantics must survive the fix: its deltas are
// output-only, and such a delta must NOT reset input/cache.
// ---------------------------------------------------------------------------

describe('StreamTransformer — message_delta context tracking (TASK_2026_408 Gap 1)', () => {
  function capture(): {
    captured: ResultModelUsage[][];
    onResultStats: (stats: { modelUsage?: ResultModelUsage[] }) => void;
  } {
    const captured: ResultModelUsage[][] = [];
    return {
      captured,
      onResultStats: (stats) => {
        if (stats.modelUsage) captured.push(stats.modelUsage);
      },
    };
  }

  async function run(messages: SDKMessage[]): Promise<ResultModelUsage[][]> {
    const cap = capture();
    const { transformer } = makeHarness();
    await drain(
      transformer.transform({
        sdkQuery: asAsyncIterable(messages),
        sessionId: 'sess-1' as SessionId,
        initialModel: MODEL,
        onResultStats: cap.onResultStats,
      }),
    );
    return cap.captured;
  }

  it('ACTUAL proxy sequence: synthetic-zero message_start, real usage in the final message_delta → 42', async () => {
    const captured = await run([
      // What the responses translation proxy actually emits: message_start
      // usage is {input_tokens: 0, output_tokens: 0} (synthetic), and the
      // real numbers arrive only in the delta. Injecting correct usage
      // directly into message_start (the phase-2 tests above) does NOT
      // reproduce this bug.
      messageStart(MODEL, { input_tokens: 0 }),
      messageDelta({
        input_tokens: 30,
        output_tokens: 9,
        cache_read_input_tokens: 12,
      }),
      resultMessage(MODEL, { inputTokens: 30, outputTokens: 9, cacheReadInputTokens: 12 }),
    ]);

    expect(captured).toHaveLength(1);
    // 30 input + 12 cache_read — the turn's real context fill. Cumulative
    // output (9) is NOT part of the context, per the tracker's contract.
    expect(captured[0][0].lastTurnContextTokens).toBe(42);
  });

  it('true translateResponsesUsage split: delta input 18 + cache_read 12 → 30 (inclusive input, cache separated)', async () => {
    const captured = await run([
      // translateResponsesUsage maps OpenAI's INCLUSIVE input 30 with 12
      // cached to Anthropic shape: input_tokens 18 + cache_read 12. The
      // context fill is the sum, 30 — the same total the inclusive input
      // described.
      messageStart(MODEL, { input_tokens: 0 }),
      messageDelta({
        input_tokens: 18,
        output_tokens: 9,
        cache_read_input_tokens: 12,
      }),
      resultMessage(MODEL, { inputTokens: 18, outputTokens: 9, cacheReadInputTokens: 12 }),
    ]);

    expect(captured[0][0].lastTurnContextTokens).toBe(30);
  });

  it('direct Anthropic output-only delta does NOT reset the message_start context', async () => {
    const captured = await run([
      messageStart(MODEL, {
        input_tokens: 5000,
        cache_read_input_tokens: 1000,
      }),
      // Direct Anthropic message_delta usage carries only the running
      // output count. Absent input/cache fields must retain the start's
      // 5000 + 1000 — zeroing them here is the regression this guards.
      messageDelta({ output_tokens: 9 }),
      resultMessage(MODEL, { inputTokens: 5000, outputTokens: 9, cacheReadInputTokens: 1000 }),
    ]);

    expect(captured[0][0].lastTurnContextTokens).toBe(6000);
  });

  it('an explicit zero in the delta REPLACES the start context (a real reading, not absence)', async () => {
    const captured = await run([
      messageStart(MODEL, {
        input_tokens: 5000,
        cache_read_input_tokens: 1000,
      }),
      // Explicit 0 fields are readings ("the prompt was fully cache-billed
      // / shrunk"), not absences — `??` semantics: only null/undefined skip.
      messageDelta({
        input_tokens: 0,
        output_tokens: 9,
        cache_read_input_tokens: 0,
      }),
      resultMessage(MODEL, { inputTokens: 0, outputTokens: 9 }),
    ]);

    expect(captured[0][0].lastTurnContextTokens).toBe(0);
  });

  it('repeated cumulative deltas REPLACE, they do not add', async () => {
    const captured = await run([
      messageStart(MODEL, { input_tokens: 0 }),
      messageDelta({
        input_tokens: 30,
        output_tokens: 5,
        cache_read_input_tokens: 12,
      }),
      // Same turn, a later cumulative frame. If the tracker ADDED, this
      // would read 42 + 44 = 86; replacing reads 44.
      messageDelta({
        input_tokens: 31,
        output_tokens: 9,
        cache_read_input_tokens: 13,
      }),
      resultMessage(MODEL, { inputTokens: 31, outputTokens: 9, cacheReadInputTokens: 13 }),
    ]);

    expect(captured[0][0].lastTurnContextTokens).toBe(44);
  });

  it('multi-turn: a later message_start REPLACES delta-carried values (no leak across turns)', async () => {
    const captured = await run([
      messageStart(MODEL, { input_tokens: 0 }),
      messageDelta({
        input_tokens: 30,
        output_tokens: 9,
        cache_read_input_tokens: 12,
      }),
      // Turn 2: a fresh API request. Its message_start carries turn 2's
      // real prompt and must fully replace turn 1's delta numbers.
      messageStart(MODEL, {
        input_tokens: 200,
        cache_read_input_tokens: 50,
      }),
      resultMessage(MODEL, { inputTokens: 200, outputTokens: 5, cacheReadInputTokens: 50 }),
    ]);

    expect(captured[0][0].lastTurnContextTokens).toBe(250);
  });

  it('a message_delta with no preceding message_start is ignored (no model to attribute it to)', async () => {
    const captured = await run([
      messageDelta({
        input_tokens: 30,
        output_tokens: 9,
        cache_read_input_tokens: 12,
      }),
      resultMessage(MODEL, { inputTokens: 30, outputTokens: 9 }),
    ]);

    expect(captured).toHaveLength(1);
    expect(captured[0][0].lastTurnContextTokens).toBeUndefined();
  });
});

describe('StreamTransformer — cost source inversion (TASK_2026_134 Batch C)', () => {
  interface StatsCapture {
    cost: number | null;
    modelUsage?: ResultModelUsage[];
  }

  function captureStats(): {
    captured: StatsCapture[];
    onResultStats: (stats: {
      cost: number | null;
      modelUsage?: ResultModelUsage[];
    }) => void;
  } {
    const captured: StatsCapture[] = [];
    return {
      captured,
      onResultStats: (stats) => {
        captured.push({ cost: stats.cost, modelUsage: stats.modelUsage });
      },
    };
  }

  it('direct Anthropic: passes SDK total_cost_usd and per-model costUSD through verbatim without invoking pricingProvider', async () => {
    const { transformer, pricingProvider } = makeHarness(
      makeAuthEnv({ ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }),
    );
    const { captured, onResultStats } = captureStats();
    const messages: SDKMessage[] = [
      resultMessageMulti({
        totalCostUsd: 0.42,
        modelUsage: {
          'claude-opus-4-7': {
            inputTokens: 1000,
            outputTokens: 500,
            costUSD: 0.3,
          },
          'claude-sonnet-4-6': {
            inputTokens: 800,
            outputTokens: 400,
            costUSD: 0.12,
          },
        },
      }),
    ];

    const iter = transformer.transform({
      sdkQuery: asAsyncIterable(messages),
      sessionId: 'sess-1' as SessionId,
      initialModel: 'claude-opus-4-7',
      onResultStats,
    });
    await drain(iter);

    expect(pricingProvider.getPricing).not.toHaveBeenCalled();
    expect(captured).toHaveLength(1);
    expect(captured[0].cost).toBe(0.42);
    const byModel = new Map(
      (captured[0].modelUsage ?? []).map((m) => [m.model, m.costUSD]),
    );
    expect(byModel.get('claude-opus-4-7')).toBe(0.3);
    expect(byModel.get('claude-sonnet-4-6')).toBe(0.12);
  });

  it('third-party + pricing hit: computes costUSD via calculateMessageCost from pricing provider data', async () => {
    const authEnv = makeAuthEnv({
      ANTHROPIC_BASE_URL: 'https://openrouter.ai/api/v1',
    });
    const { transformer, pricingProvider } = makeHarness(authEnv);
    const pricing: ModelPricing = {
      inputCostPerToken: 15e-6,
      outputCostPerToken: 75e-6,
      cacheReadCostPerToken: 0,
      cacheCreationCostPerToken: 0,
      maxTokens: 200000,
    };
    pricingProvider.getPricing.mockResolvedValue(pricing);

    const { captured, onResultStats } = captureStats();
    const inputTokens = 1000;
    const outputTokens = 500;
    const messages: SDKMessage[] = [
      resultMessageMulti({
        totalCostUsd: 999.0,
        modelUsage: {
          'anthropic/claude-opus-4-7': {
            inputTokens,
            outputTokens,
            costUSD: 0,
          },
        },
      }),
    ];

    const iter = transformer.transform({
      sdkQuery: asAsyncIterable(messages),
      sessionId: 'sess-1' as SessionId,
      initialModel: 'anthropic/claude-opus-4-7',
      onResultStats,
    });
    await drain(iter);

    expect(pricingProvider.getPricing).toHaveBeenCalledWith(
      'anthropic/claude-opus-4-7',
    );
    expect(captured).toHaveLength(1);
    const row = captured[0].modelUsage?.[0];
    expect(row).toBeDefined();
    expect(row?.costUSD).toBeGreaterThan(0);
    expect(captured[0].cost).toBe(row?.costUSD);
    expect(captured[0].cost).not.toBe(999.0);
  });

  it('third-party + pricing miss: costUSD is null per row and total cost is null', async () => {
    const authEnv = makeAuthEnv({
      ANTHROPIC_BASE_URL: 'https://openrouter.ai/api/v1',
    });
    const { transformer, pricingProvider } = makeHarness(authEnv);
    pricingProvider.getPricing.mockResolvedValue(null);

    const { captured, onResultStats } = captureStats();
    const messages: SDKMessage[] = [
      resultMessageMulti({
        totalCostUsd: 0,
        modelUsage: {
          'mystery-model-x': {
            inputTokens: 100,
            outputTokens: 50,
            costUSD: 0,
          },
        },
      }),
    ];

    const iter = transformer.transform({
      sdkQuery: asAsyncIterable(messages),
      sessionId: 'sess-1' as SessionId,
      initialModel: 'mystery-model-x',
      onResultStats,
    });
    await drain(iter);

    expect(captured).toHaveLength(1);
    expect(captured[0].cost).toBeNull();
    expect(captured[0].modelUsage?.[0].costUSD).toBeNull();
  });

  it('third-party + mixed hit/miss: hit row has numeric cost, miss row null, total is sum of hits only', async () => {
    const authEnv = makeAuthEnv({
      ANTHROPIC_BASE_URL: 'https://openrouter.ai/api/v1',
    });
    const { transformer, pricingProvider } = makeHarness(authEnv);
    const hitPricing: ModelPricing = {
      inputCostPerToken: 10e-6,
      outputCostPerToken: 50e-6,
      cacheReadCostPerToken: 0,
      cacheCreationCostPerToken: 0,
      maxTokens: 200000,
    };
    pricingProvider.getPricing.mockImplementation(async (modelId: string) =>
      modelId === 'anthropic/claude-opus-4-7' ? hitPricing : null,
    );

    const { captured, onResultStats } = captureStats();
    const messages: SDKMessage[] = [
      resultMessageMulti({
        totalCostUsd: 0,
        modelUsage: {
          'anthropic/claude-opus-4-7': {
            inputTokens: 1000,
            outputTokens: 500,
            costUSD: 0,
          },
          'mystery-model-y': {
            inputTokens: 200,
            outputTokens: 100,
            costUSD: 0,
          },
        },
      }),
    ];

    const iter = transformer.transform({
      sdkQuery: asAsyncIterable(messages),
      sessionId: 'sess-1' as SessionId,
      initialModel: 'anthropic/claude-opus-4-7',
      onResultStats,
    });
    await drain(iter);

    expect(captured).toHaveLength(1);
    const byModel = new Map(
      (captured[0].modelUsage ?? []).map((m) => [m.model, m.costUSD]),
    );
    const hitCost = byModel.get('anthropic/claude-opus-4-7');
    expect(typeof hitCost).toBe('number');
    expect(hitCost as number).toBeGreaterThan(0);
    expect(byModel.get('mystery-model-y')).toBeNull();
    expect(captured[0].cost).toBe(hitCost);
  });
});

describe('StreamTransformer — no-activity watchdog wiring (TASK_2026_190)', () => {
  it('starts the watchdog once, kicks it on EVERY SDK message, and stops it when the stream ends', async () => {
    const { transformer } = makeHarness();
    const watchdog = makeFakeWatchdog();

    // Three heterogeneous events — a message_start (partial), a second
    // message_start, and a result. Each must reset the inactivity window.
    const messages: SDKMessage[] = [
      messageStart(MODEL, { input_tokens: 100 }),
      messageStart(MODEL, { input_tokens: 100 }),
      resultMessage(MODEL, { inputTokens: 100, outputTokens: 10 }),
    ];

    const iter = transformer.transform({
      sdkQuery: asAsyncIterable(messages),
      sessionId: 'sess-1' as SessionId,
      initialModel: MODEL,
      onResultStats: jest.fn(),
      activityWatchdog: watchdog as unknown as NoActivityWatchdog,
    });

    await drain(iter);

    expect(watchdog.start).toHaveBeenCalledTimes(1);
    expect(watchdog.observe).toHaveBeenCalledTimes(messages.length);
    expect(watchdog.stop).toHaveBeenCalledTimes(1);
    // start() must precede the first kick (armed before the first event).
    expect(watchdog.start.mock.invocationCallOrder[0]).toBeLessThan(
      watchdog.observe.mock.invocationCallOrder[0],
    );
  });

  it('stops the watchdog even when the stream throws (error teardown path)', async () => {
    const { transformer } = makeHarness();
    const watchdog = makeFakeWatchdog();
    const boom = new Error('stream exploded');

    const explodingIterable: AsyncIterable<SDKMessage> = {
      async *[Symbol.asyncIterator]() {
        yield messageStart(MODEL, { input_tokens: 1 });
        throw boom;
      },
    };

    const iter = transformer.transform({
      sdkQuery: explodingIterable,
      sessionId: 'sess-1' as SessionId,
      initialModel: MODEL,
      onResultStats: jest.fn(),
      activityWatchdog: watchdog as unknown as NoActivityWatchdog,
    });

    await expect(drain(iter)).rejects.toBe(boom);

    expect(watchdog.start).toHaveBeenCalledTimes(1);
    expect(watchdog.observe).toHaveBeenCalledTimes(1); // the one yielded message
    expect(watchdog.stop).toHaveBeenCalledTimes(1); // finally cleanup on throw
  });

  it('is a no-op safe path when no watchdog is supplied', async () => {
    const { transformer } = makeHarness();
    const iter = transformer.transform({
      sdkQuery: asAsyncIterable([
        resultMessage(MODEL, { inputTokens: 1, outputTokens: 1 }),
      ]),
      sessionId: 'sess-1' as SessionId,
      initialModel: MODEL,
      onResultStats: jest.fn(),
    });
    await expect(drain(iter)).resolves.toBeUndefined();
  });
});

describe('StreamTransformer — task_* forwarding (workflow watch gate)', () => {
  function taskSystemMessage(subtype: string): SDKMessage {
    return {
      type: 'system',
      subtype,
      task_id: 'task-1',
      tool_use_id: 'toolu_1',
      session_id: 'sess-1',
      patch: {},
      usage: { total_tokens: 0, tool_uses: 0, duration_ms: 0 },
    } as unknown as SDKMessage;
  }

  it.each([
    'task_started',
    'task_progress',
    'task_updated',
    'task_notification',
  ])('forwards %s system messages to the message transformer', async (sub) => {
    const { transformer, messageTransformer } = makeHarness();

    const iter = transformer.transform({
      sdkQuery: asAsyncIterable([taskSystemMessage(sub)]),
      sessionId: 'sess-1' as SessionId,
      initialModel: MODEL,
      onResultStats: jest.fn(),
    });
    await drain(iter);

    expect(messageTransformer.transform).toHaveBeenCalledTimes(1);
    expect(messageTransformer.transform).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'system', subtype: sub }),
      'sess-1',
    );
  });
});

describe('StreamTransformer — onTurnEnd (TASK_2026_294)', () => {
  it('fires on the result message', async () => {
    const { transformer } = makeHarness();
    const onTurnEnd = jest.fn();

    await drain(
      transformer.transform({
        sdkQuery: asAsyncIterable([
          messageStart(MODEL, { input_tokens: 10 }),
          resultMessage(MODEL, { inputTokens: 10, outputTokens: 20 }),
        ]),
        sessionId: 'sess-1' as SessionId,
        initialModel: MODEL,
        onResultStats: jest.fn(),
        onTurnEnd,
      }),
    );

    expect(onTurnEnd).toHaveBeenCalledTimes(1);
  });

  it('fires even when validateStats rejects the payload and onResultStats is skipped', async () => {
    const { transformer } = makeHarness();
    const onTurnEnd = jest.fn();
    const onResultStats = jest.fn();

    // cost > 100 → validateStats returns null → onResultStats never runs.
    // The pump's turn claim must still be released, or the next follow-up is
    // held until the 180s no-activity watchdog instead of the turn.
    await drain(
      transformer.transform({
        sdkQuery: asAsyncIterable([
          resultMessageMulti({
            totalCostUsd: 500,
            modelUsage: {
              [MODEL]: { inputTokens: 10, outputTokens: 20, costUSD: 500 },
            },
          }),
        ]),
        sessionId: 'sess-1' as SessionId,
        initialModel: MODEL,
        onResultStats,
        onTurnEnd,
      }),
    );

    expect(onResultStats).not.toHaveBeenCalled();
    expect(onTurnEnd).toHaveBeenCalledTimes(1);
  });

  it('does not fire when no result message arrives', async () => {
    const { transformer } = makeHarness();
    const onTurnEnd = jest.fn();

    await drain(
      transformer.transform({
        sdkQuery: asAsyncIterable([messageStart(MODEL, { input_tokens: 10 })]),
        sessionId: 'sess-1' as SessionId,
        initialModel: MODEL,
        onResultStats: jest.fn(),
        onTurnEnd,
      }),
    );

    expect(onTurnEnd).not.toHaveBeenCalled();
  });
});

describe('StreamTransformer - result turn_state ordering (TASK_2026_360)', () => {
  it('forwards the result to the transformer AFTER onTurnEnd, and yields its turn_state after the preceding message_complete', async () => {
    const { transformer, messageTransformer } = makeHarness();
    const calls: string[] = [];
    const onTurnEnd = jest.fn(() => {
      calls.push('onTurnEnd');
    });
    messageTransformer.transform.mockImplementation((msg: SDKMessage) => {
      calls.push(`transform:${msg.type}`);
      if (msg.type === 'result') {
        return [{ eventType: 'turn_state', phase: 'idle' } as never];
      }
      return [{ eventType: 'message_complete' } as never];
    });

    const yielded: string[] = [];
    for await (const event of transformer.transform({
      sdkQuery: asAsyncIterable([
        messageStart(MODEL, { input_tokens: 10 }),
        resultMessage(MODEL, { inputTokens: 10, outputTokens: 20 }),
      ]),
      sessionId: 'sess-1' as SessionId,
      initialModel: MODEL,
      onResultStats: jest.fn(),
      onTurnEnd,
    })) {
      yielded.push((event as { eventType: string }).eventType);
    }

    expect(messageTransformer.transform).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'result' }),
      'sess-1',
    );
    expect(calls).toEqual([
      'transform:stream_event',
      'onTurnEnd',
      'transform:result',
    ]);
    expect(yielded).toEqual(['message_complete', 'turn_state']);
  });
});

// ---------------------------------------------------------------------------
// TASK_2026_375 B4.2 — session MCP status published from the `init` message.
// Before this the CLI's own `needs-auth` verdict was logged at debug level and
// nothing else, so the UI showed a dead server as installed and working.
// ---------------------------------------------------------------------------

describe('StreamTransformer — session MCP status (TASK_2026_375)', () => {
  const MODEL = 'claude-sonnet-4-20250514';

  async function drain(iterable: AsyncIterable<unknown>): Promise<void> {
    for await (const _ of iterable) {
      // Consuming the stream is the point; the events are asserted elsewhere.
    }
  }

  it('publishes the servers the init message reported, under the REAL session id', async () => {
    const { transformer, mcpEvents } = makeHarness();
    await drain(
      transformer.transform({
        sdkQuery: asAsyncIterable([
          systemInit(
            [
              { name: 'smithery', status: 'needs-auth' },
              { name: 'oauth-mcp.sentry.dev-mcp', status: 'connected' },
            ],
            'real-uuid',
          ),
        ]),
        // The transformer starts under the tabId; the init message is what
        // resolves the real id, and the fan-out must use the resolved one.
        sessionId: 'tab-1' as SessionId,
        initialModel: MODEL,
        onResultStats: jest.fn(),
      }),
    );

    expect(mcpEvents).toEqual([
      {
        kind: 'servers',
        sessionId: 'real-uuid',
        servers: [
          { name: 'smithery', status: 'needs-auth' },
          { name: 'oauth-mcp.sentry.dev-mcp', status: 'connected' },
        ],
      },
    ]);
  });

  it('publishes an EMPTY list when the session has no MCP servers', async () => {
    const { transformer, mcpEvents } = makeHarness();
    await drain(
      transformer.transform({
        sdkQuery: asAsyncIterable([systemInit([])]),
        sessionId: 'sess-1' as SessionId,
        initialModel: MODEL,
        onResultStats: jest.fn(),
      }),
    );

    // An empty list is a real answer — "this session has no MCP servers" — and
    // is what lets the chip hide itself instead of showing a stale count.
    expect(mcpEvents).toEqual([
      { kind: 'servers', sessionId: 'sess-1', servers: [] },
    ]);
  });

  it('publishes NOTHING when the init message carries no mcp_servers array', async () => {
    const { transformer, mcpEvents } = makeHarness();
    await drain(
      transformer.transform({
        sdkQuery: asAsyncIterable([systemInit(undefined)]),
        sessionId: 'sess-1' as SessionId,
        initialModel: MODEL,
        onResultStats: jest.fn(),
      }),
    );

    expect(mcpEvents).toEqual([]);
  });

  it('keeps an unknown status verbatim — the value set belongs to the CLI', async () => {
    const { transformer, mcpEvents } = makeHarness();
    await drain(
      transformer.transform({
        sdkQuery: asAsyncIterable([
          systemInit([{ name: 'x', status: 'reconnecting' }]),
        ]),
        sessionId: 'sess-1' as SessionId,
        initialModel: MODEL,
        onResultStats: jest.fn(),
      }),
    );

    expect(mcpEvents[0]).toMatchObject({
      servers: [{ name: 'x', status: 'reconnecting' }],
    });
  });

  it('publishes once per init message, not once per turn', async () => {
    const { transformer, mcpEvents } = makeHarness();
    await drain(
      transformer.transform({
        sdkQuery: asAsyncIterable([
          systemInit([{ name: 'a', status: 'connected' }]),
          messageStart(MODEL, { input_tokens: 10 }),
          resultMessage(MODEL, { inputTokens: 10, outputTokens: 20 }),
        ]),
        sessionId: 'sess-1' as SessionId,
        initialModel: MODEL,
        onResultStats: jest.fn(),
      }),
    );

    expect(mcpEvents).toHaveLength(1);
  });
});

/**
 * TASK_2026_370 — per-stream isolation of the message transformer.
 *
 * `SdkMessageTransformer` is a DI singleton whose streaming bookkeeping is keyed
 * by `parent_tool_use_id || ''` with NO session dimension, so every root
 * assistant turn of every session wrote the same slot. `StreamTransformer` was
 * the one caller that used the injected instance directly instead of taking a
 * `createIsolated()` copy per stream, and it is the caller that serves every
 * interactive chat session — the only place where two streams are live at once.
 */
describe('StreamTransformer — per-stream isolation (TASK_2026_370)', () => {
  async function drainAll(iterable: AsyncIterable<unknown>): Promise<void> {
    for await (const _ of iterable) {
      // Consuming the stream is the point.
    }
  }

  it('takes a fresh isolated transformer per stream and never uses the shared instance', async () => {
    const { transformer, messageTransformer } = makeHarness();
    const isolates: Array<jest.Mock> = [];
    messageTransformer.createIsolated.mockImplementation(() => {
      const isolate = { transform: jest.fn().mockReturnValue([]) };
      isolates.push(isolate.transform);
      return isolate as unknown as SdkMessageTransformer;
    });

    await drainAll(
      transformer.transform({
        sdkQuery: asAsyncIterable([messageStart(MODEL, { input_tokens: 1 })]),
        sessionId: 'sess-a' as SessionId,
        initialModel: MODEL,
        onResultStats: jest.fn(),
      }),
    );
    await drainAll(
      transformer.transform({
        sdkQuery: asAsyncIterable([messageStart(MODEL, { input_tokens: 2 })]),
        sessionId: 'sess-b' as SessionId,
        initialModel: MODEL,
        onResultStats: jest.fn(),
      }),
    );

    expect(messageTransformer.createIsolated).toHaveBeenCalledTimes(2);
    // Two streams, two instances — not one shared root-message slot.
    expect(isolates).toHaveLength(2);
    expect(isolates[0]).not.toBe(isolates[1]);
    // Each stream's messages went to ITS OWN isolate...
    expect(isolates[0]).toHaveBeenCalledTimes(1);
    expect(isolates[0]).toHaveBeenCalledWith(expect.anything(), 'sess-a');
    expect(isolates[1]).toHaveBeenCalledTimes(1);
    expect(isolates[1]).toHaveBeenCalledWith(expect.anything(), 'sess-b');
    // ...and the DI singleton transformed nothing at all.
    expect(messageTransformer.transform).not.toHaveBeenCalled();
  });

  it('isolates the stream before the first message, so two concurrent streams never share one', async () => {
    const { transformer, messageTransformer } = makeHarness();

    // Both iterables are created before either is consumed, which is the real
    // shape: `ChatSessionService` starts a stream per session and the broadcast
    // loops interleave.
    const first = transformer.transform({
      sdkQuery: asAsyncIterable([messageStart(MODEL, { input_tokens: 1 })]),
      sessionId: 'sess-a' as SessionId,
      initialModel: MODEL,
      onResultStats: jest.fn(),
    });
    const second = transformer.transform({
      sdkQuery: asAsyncIterable([messageStart(MODEL, { input_tokens: 2 })]),
      sessionId: 'sess-b' as SessionId,
      initialModel: MODEL,
      onResultStats: jest.fn(),
    });

    expect(messageTransformer.createIsolated).toHaveBeenCalledTimes(2);

    await drainAll(first);
    await drainAll(second);
  });
});
