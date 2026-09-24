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
import type {
  AuthEnv,
  FlatStreamEventUnion,
  ModelPricing,
  ResultStatsPayload,
  SessionId,
} from '@ptah-extension/shared';
import {
  findModelPricing,
  registerModelContextWindows,
  registerProviderPricing,
} from '@ptah-extension/shared';
import { SessionStatsOwnerService } from '../session-stats/session-stats-owner.service';
import { classifyUsageCostSource } from './session-lifecycle/session-query-executor.service';
import type { SdkMessageTransformer } from '../sdk-message-transformer';
import type { IModelResolver } from '../auth-env.port';
import type {
  SessionMcpStatusCallbackRegistry,
  SessionMcpStatusEvent,
} from './session-mcp-status-callback-registry';
import type { IPricingProvider } from '../pricing.port';
import type { SDKMessage } from '../types/sdk-types/claude-sdk.types';

import {
  StreamTransformer,
  ResultModelUsage,
  type StreamTransformConfig,
} from './stream-transformer';
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

/**
 * The run identity and cost authority are frozen per query by the adapter.
 * Specs that predate TASK_2026_533 do not care about them, so the harness
 * supplies a run token and derives the authority from the harness route —
 * the classification the executor freezes for that route. Specs about the
 * authority itself pass it explicitly.
 */
type RunAccountingFields =
  | 'runToken'
  | 'usageCostSource'
  | 'accountingAuthEnv'
  | 'statsGeneration';
type HarnessTransformConfig = Omit<StreamTransformConfig, RunAccountingFields> &
  Partial<Pick<StreamTransformConfig, RunAccountingFields>>;

interface Harness {
  transformer: {
    transform(config: HarnessTransformConfig): AsyncIterable<FlatStreamEventUnion>;
  };
  messageTransformer: ReturnType<typeof makeMessageTransformer>;
  pricingProvider: jest.Mocked<IPricingProvider>;
  logger: jest.Mocked<Logger>;
  /** Every event the transformer published on the MCP-status fan-out. */
  mcpEvents: SessionMcpStatusEvent[];
  /** The real backend owner the transformer publishes accepted runs to. */
  statsOwner: SessionStatsOwnerService;
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
  const statsOwner = new SessionStatsOwnerService();
  const real = new StreamTransformer(
    logger,
    messageTransformer as unknown as SdkMessageTransformer,
    authEnv,
    modelResolver as unknown as IModelResolver,
    pricingProvider,
    mcpStatus,
    statsOwner,
  );
  const routeAuthority = classifyUsageCostSource(authEnv);
  return {
    transformer: {
      // The owner generation is read when the stream starts, as the adapter
      // captures it when the run is prepared; no owner → nothing published.
      transform: (config) =>
        real.transform({
          runToken: 'run-1',
          usageCostSource: routeAuthority,
          accountingAuthEnv: authEnv,
          statsGeneration:
            statsOwner.leaseOf(config.sessionId)?.generation ?? null,
          ...config,
        }),
    },
    messageTransformer,
    pricingProvider,
    logger,
    mcpEvents,
    statsOwner,
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
  durationMs?: number;
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
    duration_ms: opts.durationMs ?? 100,
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

function rawResultMessage(opts: {
  totalCostUsd: number;
  durationMs: number;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadInputTokens: number;
    cacheCreationInputTokens: number;
  };
  modelUsage?: Record<string, ResultModelUsageFixture>;
}): SDKMessage {
  const modelUsage = opts.modelUsage
    ? Object.fromEntries(
        Object.entries(opts.modelUsage).map(([model, usage]) => [
          model,
          {
            ...usage,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
            contextWindow: 200000,
          },
        ]),
      )
    : undefined;

  return {
    type: 'result',
    subtype: 'success',
    session_id: 'sess-1',
    duration_ms: opts.durationMs,
    duration_api_ms: opts.durationMs,
    is_error: false,
    num_turns: 1,
    total_cost_usd: opts.totalCostUsd,
    usage: {
      input_tokens: opts.usage.inputTokens,
      output_tokens: opts.usage.outputTokens,
      cache_read_input_tokens: opts.usage.cacheReadInputTokens,
      cache_creation_input_tokens: opts.usage.cacheCreationInputTokens,
    },
    ...(modelUsage ? { modelUsage } : {}),
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

describe('StreamTransformer — discovered context windows on proxies (TASK_2026_414)', () => {
  async function runResult(
    authEnv: AuthEnv,
    model: string,
  ): Promise<ResultModelUsage[] | undefined> {
    const { transformer } = makeHarness(authEnv);
    let modelUsage: ResultModelUsage[] | undefined;
    await drain(
      transformer.transform({
        sdkQuery: asAsyncIterable([
          resultMessage(model, { inputTokens: 1000, outputTokens: 100 }),
        ]),
        sessionId: 'sess-1' as SessionId,
        initialModel: model,
        onResultStats: (stats) => {
          modelUsage = stats.modelUsage;
        },
      }),
    );
    return modelUsage;
  }

  it('proxied result modelUsage contextWindow 200000 is replaced by the registered 400000', async () => {
    const model = 'gpt-ctx-stream-proxy-414';
    registerModelContextWindows([{ id: model, contextLength: 400_000 }]);

    const usage = await runResult(
      makeAuthEnv({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:43123' }),
      model,
    );

    expect(usage?.[0]).toMatchObject({ model, contextWindow: 400_000 });
  });

  it('direct Anthropic keeps the SDK-reported window', async () => {
    const model = 'claude-ctx-stream-direct-414';
    registerModelContextWindows([{ id: model, contextLength: 1_000_000 }]);

    const usage = await runResult(
      makeAuthEnv({ ANTHROPIC_BASE_URL: 'https://api.anthropic.com' }),
      model,
    );

    expect(usage?.[0]).toMatchObject({ model, contextWindow: 200_000 });
  });

  it('proxied model with no known window keeps the SDK-reported window', async () => {
    const usage = await runResult(
      makeAuthEnv({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:43123' }),
      'mystery-ctx-stream-414',
    );

    expect(usage?.[0]?.contextWindow).toBe(200_000);
  });

  it('a proxied model that only FUZZY-matches the bundled table keeps the SDK window', async () => {
    // PR #493 review C: the override used getModelContextWindow(), whose
    // pricing-table fallback matches partially — `gpt-4o-ultra-414` resolved
    // to the bundled `gpt-4o` entry's 128000 and replaced the SDK value for a
    // model provider discovery never registered. Only an EXACT discovered
    // window may override the SDK.
    const usage = await runResult(
      makeAuthEnv({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:43123' }),
      'gpt-4o-ultra-414',
    );

    expect(usage?.[0]?.contextWindow).toBe(200_000);
  });
});

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
// Key-space mismatch and subagent partials.
//
// `modelUsage` is keyed by the raw model string the CLI ran — the 1M variant
// arrives as `claude-opus-5-5[1m]` — while `message_start.message.model` is
// what the API echoed for the request the CLI sent with the tag stripped. An
// exact-key lookup therefore missed every turn of a 1M session, and the
// frontend suppressed the context gauge after compaction.
// ---------------------------------------------------------------------------

describe('StreamTransformer — last-turn context key matching and subagent partials', () => {
  function asSubagent(
    message: SDKMessage,
    parentToolUseId: string,
  ): SDKMessage {
    return { ...message, parent_tool_use_id: parentToolUseId } as SDKMessage;
  }

  async function run(
    messages: SDKMessage[],
    harness: Harness = makeHarness(),
  ): Promise<ResultModelUsage[][]> {
    const captured: ResultModelUsage[][] = [];
    await drain(
      harness.transformer.transform({
        sdkQuery: asAsyncIterable(messages),
        sessionId: 'sess-1' as SessionId,
        initialModel: 'claude-opus-5-5[1m]',
        onResultStats: (stats) => {
          if (stats.modelUsage) captured.push(stats.modelUsage);
        },
      }),
    );
    return captured;
  }

  it('matches a `[1m]` modelUsage key to the bare id message_start reported', async () => {
    const captured = await run([
      messageStart('claude-opus-5-5', {
        input_tokens: 1000,
        cache_read_input_tokens: 200_000,
        cache_creation_input_tokens: 500,
      }),
      resultMessage('claude-opus-5-5[1m]', {
        inputTokens: 1_500_000,
        outputTokens: 9000,
      }),
    ]);

    expect(captured).toHaveLength(1);
    expect(captured[0][0].model).toBe('claude-opus-5-5[1m]');
    expect(captured[0][0].lastTurnContextTokens).toBe(201_500);
  });

  it('matches across a date snapshot suffix', async () => {
    const captured = await run([
      messageStart('claude-sonnet-5-20260801', { input_tokens: 4200 }),
      resultMessage('claude-sonnet-5', { inputTokens: 4200, outputTokens: 10 }),
    ]);

    expect(captured[0][0].lastTurnContextTokens).toBe(4200);
  });

  it('an exact key wins, and the tracked fill is never handed to a second row', async () => {
    const captured = await run([
      messageStart('claude-opus-5-5', { input_tokens: 7000 }),
      resultMessageMulti({
        totalCostUsd: 0,
        modelUsage: {
          'claude-opus-5-5[1m]': {
            inputTokens: 100,
            outputTokens: 50,
            costUSD: 0,
          },
          'claude-opus-5-5': { inputTokens: 90, outputTokens: 40, costUSD: 0 },
        },
      }),
    ]);

    const byModel = new Map(captured[0].map((row) => [row.model, row]));
    expect(byModel.get('claude-opus-5-5')?.lastTurnContextTokens).toBe(7000);
    expect(
      byModel.get('claude-opus-5-5[1m]')?.lastTurnContextTokens,
    ).toBeUndefined();
  });

  it('leaves both rows undefined when two keys normalize to the one tracked id', async () => {
    const captured = await run([
      messageStart('claude-opus-5-5', { input_tokens: 7000 }),
      resultMessageMulti({
        totalCostUsd: 0,
        modelUsage: {
          'claude-opus-5-5[1m]': {
            inputTokens: 100,
            outputTokens: 50,
            costUSD: 0,
          },
          'anthropic/claude-opus-5-5': {
            inputTokens: 90,
            outputTokens: 40,
            costUSD: 0,
          },
        },
      }),
    ]);

    for (const row of captured[0]) {
      expect(row.lastTurnContextTokens).toBeUndefined();
    }
  });

  it('a subagent message_start / message_delta does not overwrite the main loop value', async () => {
    const captured = await run([
      messageStart('claude-opus-5-5', {
        input_tokens: 3000,
        cache_read_input_tokens: 150_000,
      }),
      // Same model, different conversation: a subagent's much smaller prompt.
      asSubagent(
        messageStart('claude-opus-5-5', { input_tokens: 40 }),
        'toolu_sub_1',
      ),
      asSubagent(
        messageDelta({ input_tokens: 60, output_tokens: 5 }),
        'toolu_sub_1',
      ),
      resultMessage('claude-opus-5-5[1m]', {
        inputTokens: 3100,
        outputTokens: 700,
      }),
    ]);

    expect(captured[0][0].lastTurnContextTokens).toBe(153_000);
  });

  it('logs the modelUsage and tracked keys at debug level when a value is still missing', async () => {
    const harness = makeHarness();
    const captured = await run(
      [
        messageStart('claude-opus-5-5', { input_tokens: 100 }),
        resultMessageMulti({
          totalCostUsd: 0,
          modelUsage: {
            'claude-opus-5-5[1m]': {
              inputTokens: 100,
              outputTokens: 50,
              costUSD: 0,
            },
            'claude-sonnet-5': { inputTokens: 10, outputTokens: 5, costUSD: 0 },
          },
        }),
      ],
      harness,
    );

    const sonnet = captured[0].find((row) => row.model === 'claude-sonnet-5');
    // No main-loop message streamed for it: no number is invented.
    expect(sonnet?.lastTurnContextTokens).toBeUndefined();
    expect(harness.logger.debug).toHaveBeenCalledWith(
      expect.stringContaining('No last-turn context tracked'),
      expect.objectContaining({
        untrackedModels: ['claude-sonnet-5'],
        modelUsageKeys: ['claude-opus-5-5[1m]', 'claude-sonnet-5'],
        trackedKeys: ['claude-opus-5-5'],
      }),
    );
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
    expect(captured[0].modelUsage?.[0].lastTurnContextTokens).toBeUndefined();
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
      resultMessage(MODEL, {
        inputTokens: 30,
        outputTokens: 9,
        cacheReadInputTokens: 12,
      }),
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
      resultMessage(MODEL, {
        inputTokens: 18,
        outputTokens: 9,
        cacheReadInputTokens: 12,
      }),
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
      resultMessage(MODEL, {
        inputTokens: 5000,
        outputTokens: 9,
        cacheReadInputTokens: 1000,
      }),
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
      resultMessage(MODEL, {
        inputTokens: 31,
        outputTokens: 9,
        cacheReadInputTokens: 13,
      }),
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
      resultMessage(MODEL, {
        inputTokens: 200,
        outputTokens: 5,
        cacheReadInputTokens: 50,
      }),
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

  it('third-party + mixed hit/miss: one unknown row makes the total unknown', async () => {
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
    expect(captured[0].cost).toBeNull();
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

describe('StreamTransformer — result stats validation', () => {
  async function transformResult(message: SDKMessage): Promise<{
    onResultStats: jest.Mock;
    logger: jest.Mocked<Logger>;
  }> {
    const { transformer, logger } = makeHarness();
    const onResultStats = jest.fn();

    await drain(
      transformer.transform({
        sdkQuery: asAsyncIterable([message]),
        sessionId: 'sess-1' as SessionId,
        initialModel: MODEL,
        onResultStats,
      }),
    );

    return { onResultStats, logger };
  }

  it('accepts the measured cumulative cost 101.12 unchanged', async () => {
    const { onResultStats } = await transformResult(
      resultMessageMulti({
        totalCostUsd: 101.12,
        modelUsage: {
          [MODEL]: { inputTokens: 10, outputTokens: 20, costUSD: 101.12 },
        },
      }),
    );

    expect(onResultStats).toHaveBeenCalledWith(
      expect.objectContaining({ cost: 101.12 }),
    );
  });

  it('accepts a cumulative cost of 356 unchanged', async () => {
    const { onResultStats } = await transformResult(
      resultMessageMulti({
        totalCostUsd: 356,
        modelUsage: {
          [MODEL]: { inputTokens: 10, outputTokens: 20, costUSD: 356 },
        },
      }),
    );

    expect(onResultStats).toHaveBeenCalledWith(
      expect.objectContaining({ cost: 356 }),
    );
  });

  it('accepts cumulative input and output token counts above 1000000', async () => {
    const { onResultStats } = await transformResult(
      resultMessageMulti({
        totalCostUsd: 1,
        modelUsage: {
          [MODEL]: {
            inputTokens: 1_000_001,
            outputTokens: 1_000_002,
            costUSD: 1,
          },
        },
      }),
    );

    expect(onResultStats).toHaveBeenCalledWith(
      expect.objectContaining({
        tokens: expect.objectContaining({
          input: 1_000_001,
          output: 1_000_002,
        }),
      }),
    );
  });

  it('accepts a duration above 3600000 unchanged', async () => {
    const { onResultStats } = await transformResult(
      resultMessageMulti({
        totalCostUsd: 1,
        durationMs: 3_600_001,
        modelUsage: {
          [MODEL]: { inputTokens: 10, outputTokens: 20, costUSD: 1 },
        },
      }),
    );

    expect(onResultStats).toHaveBeenCalledWith(
      expect.objectContaining({ duration: 3_600_001 }),
    );
  });

  it.each([
    ['negative', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('rejects a %s cost', async (_label, invalidCost) => {
    const { onResultStats, logger } = await transformResult(
      resultMessageMulti({
        totalCostUsd: invalidCost,
        modelUsage: {
          [MODEL]: { inputTokens: 10, outputTokens: 20, costUSD: invalidCost },
        },
      }),
    );

    expect(onResultStats).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      '[StreamTransformer] Invalid cost value from SDK:',
      expect.objectContaining({ cost: invalidCost }),
    );
  });

  it.each([
    ['input', 'negative', -1],
    ['input', 'NaN', Number.NaN],
    ['input', 'Infinity', Number.POSITIVE_INFINITY],
    ['output', 'negative', -1],
    ['output', 'NaN', Number.NaN],
    ['output', 'Infinity', Number.POSITIVE_INFINITY],
  ] as const)(
    'rejects a %s token count that is %s',
    async (field, _label, invalidTokens) => {
      const inputTokens = field === 'input' ? invalidTokens : 10;
      const outputTokens = field === 'output' ? invalidTokens : 20;
      const { onResultStats, logger } = await transformResult(
        resultMessageMulti({
          totalCostUsd: 1,
          modelUsage: {
            [MODEL]: { inputTokens, outputTokens, costUSD: 1 },
          },
        }),
      );

      expect(onResultStats).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(
        '[StreamTransformer] Invalid token values from SDK:',
        expect.objectContaining({
          tokens: expect.objectContaining({
            input: inputTokens,
            output: outputTokens,
          }),
        }),
      );
    },
  );

  it.each([
    ['negative', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ])('rejects a %s duration', async (_label, invalidDuration) => {
    const { onResultStats, logger } = await transformResult(
      resultMessageMulti({
        totalCostUsd: 1,
        durationMs: invalidDuration,
        modelUsage: {
          [MODEL]: { inputTokens: 10, outputTokens: 20, costUSD: 1 },
        },
      }),
    );

    expect(onResultStats).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      '[StreamTransformer] Invalid duration value from SDK:',
      expect.objectContaining({ duration: invalidDuration }),
    );
  });
});

describe('StreamTransformer — usage-less result stats', () => {
  const noUsageResult = (): SDKMessage =>
    rawResultMessage({
      totalCostUsd: 0,
      durationMs: 63,
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
      },
    });

  it('does not replace populated header stats with a result that has no usage or modelUsage', async () => {
    const { transformer } = makeHarness();
    const populatedHeader = {
      cost: 1.1098535,
      tokens: { input: 18, output: 7611 },
    };
    let header: unknown = populatedHeader;

    await drain(
      transformer.transform({
        sdkQuery: asAsyncIterable([noUsageResult()]),
        sessionId: 'sess-1' as SessionId,
        initialModel: MODEL,
        onResultStats: (stats) => {
          header = stats;
        },
      }),
    );

    expect(header).toBe(populatedHeader);
  });

  it('keeps the populated stats from the real resume sequence after skipping the zero result', async () => {
    const { transformer } = makeHarness();
    const onResultStats = jest.fn();
    const populatedResult = rawResultMessage({
      totalCostUsd: 1.1098535,
      durationMs: 95_000,
      usage: {
        inputTokens: 18,
        outputTokens: 7611,
        cacheReadInputTokens: 1_276_637,
        cacheCreationInputTokens: 28_117,
      },
      modelUsage: {
        'claude-opus-5[1m]': {
          inputTokens: 1_304_772,
          outputTokens: 7611,
          costUSD: 1.1098535,
        },
      },
    });

    await drain(
      transformer.transform({
        sdkQuery: asAsyncIterable([noUsageResult(), populatedResult]),
        sessionId: 'sess-1' as SessionId,
        initialModel: 'claude-opus-5[1m]',
        onResultStats,
      }),
    );

    expect(onResultStats).toHaveBeenCalledTimes(1);
    expect(onResultStats).toHaveBeenCalledWith(
      expect.objectContaining({
        cost: 1.1098535,
        tokens: {
          input: 18,
          output: 7611,
          cacheRead: 1_276_637,
          cacheCreation: 28_117,
        },
      }),
    );
  });

  it('releases the turn claim even when the no-usage stats emission is skipped', async () => {
    const { transformer } = makeHarness();
    const onResultStats = jest.fn();
    const releaseTurnClaim = jest.fn();

    await drain(
      transformer.transform({
        sdkQuery: asAsyncIterable([noUsageResult()]),
        sessionId: 'sess-1' as SessionId,
        initialModel: MODEL,
        onResultStats,
        onTurnEnd: releaseTurnClaim,
      }),
    );

    expect(releaseTurnClaim).toHaveBeenCalledTimes(1);
    expect(onResultStats).not.toHaveBeenCalled();
  });

  it('leaves a new session header empty when its result has no usage', async () => {
    const { transformer } = makeHarness();
    let header: unknown;

    await drain(
      transformer.transform({
        sdkQuery: asAsyncIterable([noUsageResult()]),
        sessionId: 'sess-1' as SessionId,
        initialModel: MODEL,
        onResultStats: (stats) => {
          header = stats;
        },
      }),
    );

    expect(header).toBeUndefined();
  });

  it('emits aggregate zero-token deltas with real cost and modelUsage unchanged', async () => {
    const { transformer } = makeHarness();
    const onResultStats = jest.fn();

    await drain(
      transformer.transform({
        sdkQuery: asAsyncIterable([
          rawResultMessage({
            totalCostUsd: 1.77963875,
            durationMs: 103_763,
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              cacheReadInputTokens: 0,
              cacheCreationInputTokens: 0,
            },
            modelUsage: {
              'claude-opus-5[1m]': {
                inputTokens: 273_539,
                outputTokens: 8847,
                costUSD: 1.77963875,
              },
            },
          }),
        ]),
        sessionId: 'sess-1' as SessionId,
        initialModel: 'claude-opus-5[1m]',
        onResultStats,
      }),
    );

    expect(onResultStats).toHaveBeenCalledWith(
      expect.objectContaining({
        cost: 1.77963875,
        tokens: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheCreation: 0,
        },
        modelUsage: [
          expect.objectContaining({
            model: 'claude-opus-5[1m]',
            inputTokens: 273_539,
            outputTokens: 8847,
            costUSD: 1.77963875,
          }),
        ],
      }),
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

  it('fires and passes through a cumulative cost above the former ceiling', async () => {
    const { transformer } = makeHarness();
    const onTurnEnd = jest.fn();
    const onResultStats = jest.fn();

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

    expect(onResultStats).toHaveBeenCalledWith(
      expect.objectContaining({ cost: 500 }),
    );
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

/**
 * TASK_2026_533 — the backend is the single authority for session stats.
 *
 * The cost authority is frozen per query (`usageCostSource`), never re-derived
 * from the route per result, and every accepted result publishes the owner's
 * lifetime snapshot on the SAME payload whose footer fields stay unchanged.
 */
describe('StreamTransformer — session stats authority (TASK_2026_533)', () => {
  const SESSION = 'sess-1' as SessionId;
  const FOUR_CLASS_MODEL = 'zz-four-class-533';

  beforeAll(() => {
    registerProviderPricing({
      [FOUR_CLASS_MODEL]: {
        inputCostPerToken: 0.001,
        outputCostPerToken: 0.002,
        cacheReadCostPerToken: 0.0001,
        cacheCreationCostPerToken: 0.0005,
      },
    });
  });

  function cumulativeResult(opts: {
    model: string;
    totalCostUsd: number;
    costUSD: number;
    input: number;
    output: number;
    cacheRead: number;
    cacheCreation: number;
  }): SDKMessage {
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
        input_tokens: 1,
        output_tokens: 2,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 4,
      },
      modelUsage: {
        [opts.model]: {
          inputTokens: opts.input,
          outputTokens: opts.output,
          cacheReadInputTokens: opts.cacheRead,
          cacheCreationInputTokens: opts.cacheCreation,
          contextWindow: 200000,
          costUSD: opts.costUSD,
        },
      },
    } as unknown as SDKMessage;
  }

  async function collect(
    harness: Harness,
    messages: SDKMessage[],
    config: Partial<HarnessTransformConfig> = {},
  ): Promise<ResultStatsPayload[]> {
    const payloads: ResultStatsPayload[] = [];
    await drain(
      harness.transformer.transform({
        sdkQuery: asAsyncIterable(messages),
        sessionId: SESSION,
        initialModel: MODEL,
        onResultStats: (stats) => payloads.push(stats),
        ...config,
      }),
    );
    return payloads;
  }

  it('uses frozen cost authority and attaches snapshot without changing footer fields', async () => {
    // Reported authority: the provider's own dollars, including a known zero.
    const reported = makeHarness(
      makeAuthEnv({ ANTHROPIC_BASE_URL: 'http://127.0.0.1:43123' }),
    );
    reported.statsOwner.startNew(SESSION);
    const [zero] = await collect(
      reported,
      [
        cumulativeResult({
          model: MODEL,
          totalCostUsd: 0,
          costUSD: 0,
          input: 10,
          output: 20,
          cacheRead: 30,
          cacheCreation: 40,
        }),
      ],
      { usageCostSource: 'reported' },
    );
    expect(zero.cost).toBe(0);
    expect(zero.tokens).toEqual({
      input: 1,
      output: 2,
      cacheRead: 3,
      cacheCreation: 4,
    });
    expect(zero.sessionStats).toMatchObject({
      sessionId: SESSION,
      totalCost: 0,
      pricingCoverage: 'full',
      tokenCount: 100,
      scope: 'session',
    });

    // Unreported authority on a DIRECT route: the frozen flag wins over the
    // route, and all four classes are priced by the model's own id.
    const unreported = makeHarness(makeAuthEnv());
    unreported.statsOwner.startNew(SESSION);
    const [priced] = await collect(
      unreported,
      [
        cumulativeResult({
          model: FOUR_CLASS_MODEL,
          totalCostUsd: 999,
          costUSD: 999,
          input: 1000,
          output: 100,
          cacheRead: 10000,
          cacheCreation: 200,
        }),
      ],
      { usageCostSource: 'unreported' },
    );
    const expected = 1000 * 0.001 + 100 * 0.002 + 10000 * 0.0001 + 200 * 0.0005;
    expect(priced.cost).toBeCloseTo(expected, 6);
    expect(priced.sessionStats?.totalCost).toBeCloseTo(expected, 6);
    expect(priced.sessionStats?.modelUsageList).toEqual([
      {
        model: FOUR_CLASS_MODEL,
        inputTokens: 1000,
        outputTokens: 100,
        cacheRead: 10000,
        cacheCreation: 200,
        costUSD: expect.closeTo(expected, 6),
      },
    ]);
  });

  it('replaces the latest cumulative result of a run instead of adding it', async () => {
    const harness = makeHarness();
    harness.statsOwner.startNew(SESSION);
    const row = {
      model: MODEL,
      cacheRead: 0,
      cacheCreation: 0,
    };
    const payloads = await collect(
      harness,
      [
        cumulativeResult({
          ...row,
          totalCostUsd: 10,
          costUSD: 10,
          input: 100,
          output: 10,
        }),
        cumulativeResult({
          ...row,
          totalCostUsd: 15,
          costUSD: 15,
          input: 150,
          output: 15,
        }),
      ],
      { usageCostSource: 'reported', runToken: 'run-A' },
    );

    expect(payloads.map((p) => p.cost)).toEqual([10, 15]);
    expect(payloads.map((p) => p.sessionStats?.totalCost)).toEqual([10, 15]);
    expect(payloads[1].sessionStats?.tokens.input).toBe(150);
    // Each result's `duration_ms` (100) is one turn: accepted turns add up.
    expect(payloads.map((p) => p.sessionStats?.durationMs)).toEqual([
      100, 200,
    ]);
  });

  it('preserves the accepted snapshot on an empty result and still ends the turn', async () => {
    const harness = makeHarness();
    harness.statsOwner.startNew(SESSION);
    const onTurnEnd = jest.fn();
    const payloads = await collect(
      harness,
      [
        cumulativeResult({
          model: MODEL,
          totalCostUsd: 4,
          costUSD: 4,
          input: 40,
          output: 4,
          cacheRead: 0,
          cacheCreation: 0,
        }),
        rawResultMessage({
          totalCostUsd: 0,
          durationMs: 1,
          usage: {
            inputTokens: 0,
            outputTokens: 0,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
          },
        }),
      ],
      { usageCostSource: 'reported', onTurnEnd },
    );

    expect(onTurnEnd).toHaveBeenCalledTimes(2);
    expect(payloads).toHaveLength(1);
    expect(harness.statsOwner.snapshot(SESSION)?.totalCost).toBe(4);
  });

  it('records the run even when no stats callback is registered', async () => {
    const harness = makeHarness();
    harness.statsOwner.startNew(SESSION);
    await drain(
      harness.transformer.transform({
        sdkQuery: asAsyncIterable([
          cumulativeResult({
            model: MODEL,
            totalCostUsd: 7,
            costUSD: 7,
            input: 70,
            output: 7,
            cacheRead: 0,
            cacheCreation: 0,
          }),
        ]),
        sessionId: SESSION,
        initialModel: MODEL,
        usageCostSource: 'reported',
      }),
    );
    expect(harness.statsOwner.snapshot(SESSION)?.totalCost).toBe(7);
  });

  // Review F4: alias resolution for pricing uses the query's FROZEN effective
  // env, never the mutable process-global one.
  describe('frozen pricing context (review F4)', () => {
    const CHEAP: ModelPricing = { inputCostPerToken: 0.01, outputCostPerToken: 0 };
    const DEAR: ModelPricing = { inputCostPerToken: 1, outputCostPerToken: 0 };
    const TIER_KEY = 'ANTHROPIC_DEFAULT_SONNET_MODEL';

    function tierPricedTransformer(globalEnv: AuthEnv) {
      // A tier override in the env maps the Claude alias to a dearer model.
      const resolver = {
        resolveForPricing: (m: string) => m,
        isSubscriptionCovered: () => false,
        resolveForCost: (m: string, env?: AuthEnv) => ({
          modelId: m,
          pricing: (env ?? globalEnv)[TIER_KEY] ? DEAR : CHEAP,
          subscriptionCovered: false,
        }),
      } as unknown as IModelResolver;
      const owner = new SessionStatsOwnerService();
      const transformer = new StreamTransformer(
        makeLogger(),
        makeMessageTransformer() as unknown as SdkMessageTransformer,
        globalEnv,
        resolver,
        makePricingProvider(),
        { notifyAll: jest.fn() } as unknown as SessionMcpStatusCallbackRegistry,
        owner,
      );
      return { transformer, owner };
    }

    function result(input: number): SDKMessage {
      return cumulativeResult({
        model: 'claude-sonnet-4-5',
        totalCostUsd: 0,
        costUSD: 0,
        input,
        output: 0,
        cacheRead: 0,
        cacheCreation: 0,
      });
    }

    it('a global tier change mid-query does not re-price the running query', async () => {
      const globalEnv = { ANTHROPIC_BASE_URL: 'http://127.0.0.1:1' } as AuthEnv;
      const { transformer, owner } = tierPricedTransformer(globalEnv);
      const { generation } = owner.startNew(SESSION);
      const costs: Array<number | null> = [];
      const sdkQuery = (async function* () {
        yield result(100);
        (globalEnv as Record<string, string>)[TIER_KEY] = 'model-x';
        yield result(200);
      })();

      await drain(
        transformer.transform({
          sdkQuery,
          sessionId: SESSION,
          initialModel: MODEL,
          runToken: 'run-1',
          usageCostSource: 'unreported',
          accountingAuthEnv: Object.freeze({ ...globalEnv }),
          statsGeneration: generation,
          onResultStats: (stats) => costs.push(stats.cost),
        }),
      );

      expect(costs).toEqual([1, 2]);
      expect(owner.snapshot(SESSION)?.totalCost).toBe(2);
    });

    it('an override query prices with its own frozen mapping', async () => {
      const globalEnv = { ANTHROPIC_BASE_URL: 'http://127.0.0.1:1' } as AuthEnv;
      const { transformer, owner } = tierPricedTransformer(globalEnv);
      const { generation } = owner.startNew(SESSION);
      const costs: Array<number | null> = [];

      await drain(
        transformer.transform({
          sdkQuery: asAsyncIterable([result(100)]),
          sessionId: SESSION,
          initialModel: MODEL,
          runToken: 'run-1',
          usageCostSource: 'unreported',
          accountingAuthEnv: Object.freeze({
            ...globalEnv,
            [TIER_KEY]: 'override-model',
          }) as AuthEnv,
          statsGeneration: generation,
          onResultStats: (stats) => costs.push(stats.cost),
        }),
      );

      expect(costs).toEqual([100]);
    });
  });

  // Review F5: a result for a released owner generation is dropped and can
  // never recreate the owner.
  it('drops a late result for a released owner without recreating it', async () => {
    const harness = makeHarness();
    const { generation } = harness.statsOwner.startNew(SESSION);
    const lease = harness.statsOwner.leaseOf(SESSION);
    if (lease) harness.statsOwner.release(lease);

    const payloads = await collect(
      harness,
      [
        cumulativeResult({
          model: MODEL,
          totalCostUsd: 7,
          costUSD: 7,
          input: 70,
          output: 7,
          cacheRead: 0,
          cacheCreation: 0,
        }),
      ],
      { usageCostSource: 'reported', statsGeneration: generation },
    );

    expect(payloads).toHaveLength(1);
    expect(payloads[0].sessionStats).toBeUndefined();
    expect(harness.statsOwner.snapshot(SESSION)).toBeNull();
  });

  it('never treats per-turn usage without model attribution as cumulative', async () => {
    const harness = makeHarness();
    harness.statsOwner.startNew(SESSION);
    const payloads = await collect(
      harness,
      [
        rawResultMessage({
          totalCostUsd: 3,
          durationMs: 1,
          usage: {
            inputTokens: 50,
            outputTokens: 5,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
          },
        }),
      ],
      { usageCostSource: 'reported' },
    );

    // The footer still receives the per-turn figures...
    expect(payloads).toHaveLength(1);
    expect(payloads[0].tokens.input).toBe(50);
    // ...but the lifetime snapshot does not count them as a run total.
    expect(payloads[0].sessionStats?.tokenCount).toBe(0);
    expect(payloads[0].sessionStats?.coverage).toBe('partial');
  });
});
