/**
 * StreamTransformer specs _FOLLOWUP coverage.
 *
 * Targets the per-turn context-fill bookkeeping that drives the frontend's
 * `liveModelStats.contextPercent`. The earlier compaction bug shipped 1118%
 * fills because `lastTurnContextByModel` was leaking across compact_boundary;
 * these tests pin the fix in place.
 *
 * Coverage:
 *   1. compact_boundary clears `lastTurnContextByModel` â€” a result event
 *      arriving after the boundary (without a fresh message_start) emits
 *      `lastTurnContextTokens: undefined`.
 *   2. cache_creation_input_tokens is included in the lastTurnContextTokens
 *      sum (first-cache-write turns must not under-report).
 *   3. Two consecutive message_starts for the same model â€” the second
 *      overwrites the first (no leak / no accumulation).
 *
 * Mocking posture:
 *   - Direct `new StreamTransformer(...)` with hand-rolled typed mocks.
 *   - SdkMessageTransformer.transform is stubbed to [] â€” we don't care about
 *     downstream events, only the `onResultStats` callback payload.
 *   - The async iterable is built from a plain array of SDK messages.
 */

import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type { AuthEnv, ModelPricing, SessionId } from '@ptah-extension/shared';
import type { SdkMessageTransformer } from '../sdk-message-transformer';
import type { IModelResolver } from '../auth-env.port';
import type { IPricingProvider } from '../pricing.port';
import type { SDKMessage } from '../types/sdk-types/claude-sdk.types';

import { StreamTransformer, ResultModelUsage } from './stream-transformer';

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

function makeMessageTransformer(): jest.Mocked<
  Pick<SdkMessageTransformer, 'transform'>
> {
  return {
    transform: jest.fn().mockReturnValue([]),
  };
}

function makeModelResolver(): jest.Mocked<
  Pick<IModelResolver, 'resolveForPricing'>
> {
  return {
    resolveForPricing: jest.fn((m: string) => m || 'unknown'),
  };
}

function makePricingProvider(): jest.Mocked<IPricingProvider> {
  return {
    getPricing: jest.fn().mockResolvedValue(null),
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
}

function makeHarness(authEnv: AuthEnv = makeAuthEnv()): Harness {
  const logger = makeLogger();
  const messageTransformer = makeMessageTransformer();
  const modelResolver = makeModelResolver();
  const pricingProvider = makePricingProvider();
  const transformer = new StreamTransformer(
    logger,
    messageTransformer as unknown as SdkMessageTransformer,
    authEnv,
    modelResolver as unknown as IModelResolver,
    pricingProvider,
  );
  return { transformer, messageTransformer, pricingProvider, logger };
}

// ---------------------------------------------------------------------------
// SDK message factories â€” minimal shapes that satisfy the type guards.
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

function compactBoundary(): SDKMessage {
  return {
    type: 'system',
    subtype: 'compact_boundary',
    session_id: 'sess-1',
  } as unknown as SDKMessage;
}

function resultMessage(
  model: string,
  usage: { inputTokens: number; outputTokens: number },
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
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
    modelUsage: {
      [model]: {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
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
  // We don't care about the yielded events here â€” `onResultStats` is the
  // observable signal under test.

  for await (const _e of iter) {
    void _e;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StreamTransformer â€” lastTurnContextTokens (TASK_2026_109_FOLLOWUP)', () => {
  it('clears lastTurnContextByModel on compact_boundary â€” next result without message_start emits lastTurnContextTokens=undefined', async () => {
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

    // First turn writes a fresh cache block â€” pre-fix this read as just
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
      // Second message_start for the SAME model â€” must replace, not add.
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
