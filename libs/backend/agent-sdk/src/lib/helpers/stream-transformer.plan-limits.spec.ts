/**
 * StreamTransformer plan-limit signals (TASK_2026_596, Component 4).
 *
 * Pins the one early branch and the per-turn S1 state:
 * - a `rate_limit_event` produces one registry notification and no forwarded
 *   flat event; a rate-limited assistant message is still forwarded;
 * - `turn-start` fires at the first turn-opening message of each turn;
 * - S1 success scope is this turn's main-loop models only (F75) and billing
 *   is reset per turn (F76); F62 signal side;
 * - a mapper failure is logged at debug without the payload and the stream
 *   continues.
 */
import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type { AuthEnv, SessionId } from '@ptah-extension/shared';
import { findModelPricing } from '@ptah-extension/shared';
import { SessionStatsOwnerService } from '../session-stats/session-stats-owner.service';
import type { SdkMessageTransformer } from '../sdk-message-transformer';
import type { IModelResolver } from '../auth-env.port';
import type { IPricingProvider } from '../pricing.port';
import type { SessionMcpStatusCallbackRegistry } from './session-mcp-status-callback-registry';
import type { SDKMessage } from '../types/sdk-types/claude-sdk.types';
import type {
  SessionPlanLimitCallbackRegistry,
  SessionPlanLimitEvent,
} from './plan-limits/session-plan-limit-callback-registry';
import { StreamTransformer } from './stream-transformer';

const SESSION = 'sess-real';
const OPUS = 'claude-opus-4-5-20251101';
const SONNET = 'claude-sonnet-4-5-20250929';

function makeLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

interface Harness {
  run(messages: SDKMessage[]): Promise<void>;
  events: SessionPlanLimitEvent[];
  forwarded: SDKMessage[];
  logger: jest.Mocked<Logger>;
}

function makeHarness(): Harness {
  const logger = makeLogger();
  const forwarded: SDKMessage[] = [];
  const isolated = {
    transform: jest.fn((message: SDKMessage) => {
      forwarded.push(message);
      return [];
    }),
  };
  const messageTransformer = {
    createIsolated: () => isolated,
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
  const events: SessionPlanLimitEvent[] = [];
  const planLimits = {
    notifyAll: (event: SessionPlanLimitEvent) => events.push(event),
  } as unknown as SessionPlanLimitCallbackRegistry;
  const transformer = new StreamTransformer(
    logger,
    messageTransformer,
    {} as AuthEnv,
    modelResolver,
    pricing,
    { notifyAll: jest.fn() } as unknown as SessionMcpStatusCallbackRegistry,
    new SessionStatsOwnerService(),
    planLimits,
  );
  return {
    events,
    forwarded,
    logger,
    async run(messages) {
      const iterable = transformer.transform({
        sdkQuery: (async function* () {
          for (const m of messages) yield m;
        })(),
        sessionId: 'tab-1' as SessionId,
        initialModel: SONNET,
        runToken: 'run-1',
        usageCostSource: 'reported',
        accountingAuthEnv: {} as AuthEnv,
        statsGeneration: null,
        onResultStats: jest.fn(),
      });
      for await (const event of iterable) void event;
    },
  };
}

// --- SDK message factories (only the fields the guards and branch read) ---

const msg = (m: object): SDKMessage => m as unknown as SDKMessage;

const init = (): SDKMessage =>
  msg({
    type: 'system',
    subtype: 'init',
    session_id: SESSION,
    tools: [],
    mcp_servers: [],
  });

function messageStart(model: string, parentToolUseId: string | null = null) {
  return msg({
    type: 'stream_event',
    parent_tool_use_id: parentToolUseId,
    event: {
      type: 'message_start',
      message: { model, usage: { input_tokens: 1, output_tokens: 0 } },
    },
  });
}

function rateLimit(info: object): SDKMessage {
  return msg({
    type: 'rate_limit_event',
    rate_limit_info: info,
    session_id: SESSION,
  });
}

/** A success whose cumulative `modelUsage` lists every model of the query. */
function success(models: readonly string[]): SDKMessage {
  return msg({
    type: 'result',
    subtype: 'success',
    is_error: false,
    session_id: SESSION,
    duration_ms: 10,
    total_cost_usd: 0,
    usage: { input_tokens: 1, output_tokens: 1 },
    modelUsage: Object.fromEntries(
      models.map((model) => [
        model,
        {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          contextWindow: 200_000,
          costUSD: 0,
        },
      ]),
    ),
  });
}

const signals = (h: Harness, kind: string) =>
  h.events.filter((e) => e.signal.kind === kind).map((e) => e.signal);

describe('StreamTransformer — plan-limit signals', () => {
  it('a rate_limit_event yields one registry notification and no forwarded flat event', async () => {
    const h = makeHarness();
    const event = rateLimit({
      status: 'rejected',
      rateLimitType: 'five_hour',
      utilization: 0.97,
    });
    await h.run([init(), event]);

    const evidence = signals(h, 'evidence');
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toEqual({
      kind: 'evidence',
      evidence: expect.objectContaining({
        kind: 'window',
        windowKey: 'five_hour',
        exhausted: true,
      }),
    });
    expect(JSON.stringify(evidence)).not.toContain('0.97');
    expect(h.forwarded).not.toContain(event);
    expect(h.events.every((e) => e.sessionId === SESSION)).toBe(true);
  });

  it('a rate-limited assistant message is evidence AND still forwarded', async () => {
    const h = makeHarness();
    const assistant = msg({
      type: 'assistant',
      error: 'rate_limit',
      parent_tool_use_id: null,
      message: { content: [] },
    });
    await h.run([init(), assistant]);

    expect(signals(h, 'evidence')).toEqual([
      {
        kind: 'evidence',
        evidence: expect.objectContaining({ cause: 'assistant-rate-limit' }),
      },
    ]);
    expect(h.forwarded).toContain(assistant);
  });

  it('a 429 api_retry is owner evidence with a cooldown; a 500 retry is nothing', async () => {
    const h = makeHarness();
    await h.run([
      init(),
      msg({
        type: 'system',
        subtype: 'api_retry',
        error: 'server_error',
        error_status: 429,
        retry_delay_ms: 5_000,
      }),
      msg({
        type: 'system',
        subtype: 'api_retry',
        error: 'server_error',
        error_status: 500,
        retry_delay_ms: 5_000,
      }),
    ]);
    const evidence = signals(h, 'evidence');
    expect(evidence).toHaveLength(1);
    expect(evidence[0]).toMatchObject({
      evidence: { kind: 'owner', cause: 'api-retry', cooldown: {} },
    });
    expect(evidence[0]).not.toHaveProperty('evidence.resetsAt');
  });

  it('turn-start fires once per turn, at the first turn-opening message after a result', async () => {
    const h = makeHarness();
    await h.run([
      init(),
      messageStart(SONNET),
      success([SONNET]),
      // Documented trailers of the ended turn: no turn-start.
      msg({ type: 'prompt_suggestion', suggestion: 'x' }),
      msg({ type: 'system', subtype: 'session_state_changed', state: 'idle' }),
      messageStart(SONNET),
      messageStart(SONNET),
      success([SONNET]),
    ]);

    const kinds = h.events.map((e) => e.signal.kind);
    expect(kinds).toEqual(['turn-start', 'success', 'turn-start', 'success']);
    expect(h.events[0].sessionId).toBe(SESSION);
  });

  it('F62 (signal side): a Sonnet turn with a no-overage event succeeds as plan, scope sonnet', async () => {
    const h = makeHarness();
    await h.run([
      init(),
      messageStart(SONNET),
      rateLimit({ status: 'allowed', rateLimitType: 'five_hour' }),
      success([SONNET]),
    ]);
    expect(signals(h, 'success')).toEqual([
      expect.objectContaining({ turnScopes: ['sonnet'], billing: 'plan' }),
    ]);
  });

  it('F75: Opus-then-Sonnet — turn 2 scope is sonnet only, despite cumulative modelUsage and an Opus subagent', async () => {
    const h = makeHarness();
    await h.run([
      init(),
      // Turn 1 on Opus hits the Opus weekly window.
      messageStart(OPUS),
      rateLimit({ status: 'rejected', rateLimitType: 'seven_day_opus' }),
      success([OPUS]),
      // Turn 2: main loop on Sonnet, a subagent partial on Opus.
      messageStart(SONNET),
      messageStart(OPUS, 'toolu_sub'),
      rateLimit({ status: 'allowed', rateLimitType: 'five_hour' }),
      success([OPUS, SONNET]),
    ]);

    expect(signals(h, 'evidence')[0]).toMatchObject({
      evidence: { windowKey: 'weekly_model:opus', exhausted: true },
    });
    const [turn1, turn2] = signals(h, 'success');
    expect(turn1).toMatchObject({ turnScopes: ['opus'], billing: 'unknown' });
    expect(turn2).toMatchObject({ turnScopes: ['sonnet'], billing: 'plan' });
  });

  it('F76: overage state resets per turn — overage, then unknown, then plan', async () => {
    const h = makeHarness();
    await h.run([
      init(),
      messageStart(SONNET),
      rateLimit({ status: 'allowed', isUsingOverage: true }),
      success([SONNET]),
      messageStart(SONNET),
      success([SONNET]),
      messageStart(SONNET),
      rateLimit({ status: 'allowed', isUsingOverage: false }),
      success([SONNET]),
    ]);
    expect(
      signals(h, 'success').map((s) => (s.kind === 'success' ? s.billing : '')),
    ).toEqual(['overage', 'unknown', 'plan']);
  });

  it('within a turn the latest rate_limit_event decides billing', async () => {
    const h = makeHarness();
    await h.run([
      init(),
      rateLimit({ status: 'allowed' }),
      rateLimit({ status: 'allowed', overageInUse: true }),
      success([SONNET]),
    ]);
    expect(signals(h, 'success')[0]).toMatchObject({ billing: 'overage' });
  });

  it('an error result emits no success signal but still resets the turn', async () => {
    const h = makeHarness();
    await h.run([
      init(),
      messageStart(OPUS),
      rateLimit({ status: 'allowed', isUsingOverage: true }),
      msg({
        type: 'result',
        subtype: 'error_during_execution',
        is_error: true,
        duration_ms: 1,
        total_cost_usd: 0,
        usage: { input_tokens: 0, output_tokens: 0 },
      }),
      messageStart(SONNET),
      success([OPUS, SONNET]),
    ]);
    expect(signals(h, 'success')).toEqual([
      expect.objectContaining({ turnScopes: ['sonnet'], billing: 'unknown' }),
    ]);
    expect(signals(h, 'turn-start')).toHaveLength(2);
  });

  it('a mapper failure is logged at debug without the payload, and the stream continues', async () => {
    const h = makeHarness();
    const broken = msg({ type: 'rate_limit_event', secret: 'acct-payload' });
    const after = messageStart(SONNET);
    await h.run([init(), broken, after, success([SONNET])]);

    const mappingLogs = h.logger.debug.mock.calls.filter(([text]) =>
      String(text).includes('Plan-limit signal mapping failed'),
    );
    expect(mappingLogs).toHaveLength(1);
    expect(JSON.stringify(mappingLogs)).not.toContain('acct-payload');
    expect(h.forwarded).toContain(after);
    expect(signals(h, 'success')).toHaveLength(1);
  });
});
