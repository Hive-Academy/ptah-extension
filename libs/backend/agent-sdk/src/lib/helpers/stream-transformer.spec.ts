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
import type { AuthEnv, SessionId } from '@ptah-extension/shared';
import type { SdkMessageTransformer } from '../sdk-message-transformer';
import type { ModelResolver } from '../auth/model-resolver';
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
  Pick<ModelResolver, 'resolveForPricing'>
> {
  return {
    resolveForPricing: jest.fn((m: string) => m || 'unknown'),
  };
}

const MODEL = 'claude-sonnet-4-20250514';

function makeAuthEnv(): AuthEnv {
  return {} as AuthEnv;
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
  logger: jest.Mocked<Logger>;
}

function makeHarness(): Harness {
  const logger = makeLogger();
  const messageTransformer = makeMessageTransformer();
  const modelResolver = makeModelResolver();
  const authEnv = makeAuthEnv();
  const transformer = new StreamTransformer(
    logger,
    messageTransformer as unknown as SdkMessageTransformer,
    authEnv,
    modelResolver as unknown as ModelResolver,
  );
  return { transformer, messageTransformer, logger };
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
