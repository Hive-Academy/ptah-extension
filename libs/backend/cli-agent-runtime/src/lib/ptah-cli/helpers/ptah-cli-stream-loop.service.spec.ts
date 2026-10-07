/**
 * PtahCliStreamLoop — effectiveSessionId handling spec.
 *
 * Behavior under test (per identity-audit §3.2 / §4 fix):
 *   - `effectiveSessionId` starts as `null` rather than the empty-string
 *     sentinel `'' as SessionId`. The old sentinel masked malformed SDK
 *     `session_id` values and let them propagate.
 *   - On system-init with a valid UUID, the field becomes that SessionId
 *     and `onSessionResolved` fires.
 *   - On system-init with no `session_id`, the field stays `null` and
 *     `onSessionResolved` is NOT invoked.
 *   - On system-init with a non-UUID `session_id`, `SessionId.from()`
 *     throws — a contract violation should fail loudly, not be swallowed.
 *
 * Notes:
 *   - We probe the private `effectiveSessionId` field via a cast in tests.
 *     This is intentional: the field is the load-bearing invariant of this
 *     fix and there is no public getter.
 *   - The transformer dependency is stubbed; we never iterate a real SDK
 *     query, only the system-init branch of `run()`.
 */

import 'reflect-metadata';
import { SessionId } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  SdkMessageTransformer,
  SDKMessage,
} from '@ptah-extension/agent-sdk';
import { PtahCliStreamLoop } from './ptah-cli-stream-loop.service';

const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';

function createLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function createTransformerStub(): SdkMessageTransformer {
  const stub = {
    transform: jest.fn(() => []),
    createIsolated: jest.fn(),
  };
  stub.createIsolated.mockReturnValue(stub);
  return stub as unknown as SdkMessageTransformer;
}

function makeLoop(opts?: { onSessionResolved?: (sessionId: string) => void }): {
  loop: PtahCliStreamLoop;
  onSessionResolved: jest.Mock;
} {
  const onSessionResolved = jest.fn(opts?.onSessionResolved);
  const loop = new PtahCliStreamLoop({
    logger: createLogger(),
    messageTransformer: createTransformerStub(),
    emitOutput: jest.fn(),
    emitSegment: jest.fn(),
    emitStreamEvent: jest.fn(),
    agentName: 'test-agent',
    onSessionResolved,
  });
  return { loop, onSessionResolved };
}

function getEffectiveSessionId(loop: PtahCliStreamLoop): unknown {
  return (loop as unknown as { effectiveSessionId: unknown })
    .effectiveSessionId;
}

async function* singleMessage(msg: SDKMessage): AsyncIterable<SDKMessage> {
  yield msg;
}

async function* manyMessages(msgs: SDKMessage[]): AsyncIterable<SDKMessage> {
  for (const msg of msgs) {
    yield msg;
  }
}

const successResult = {
  type: 'result',
  subtype: 'success',
  num_turns: 1,
} as unknown as SDKMessage;

const errorResult = {
  type: 'result',
  subtype: 'error_during_execution',
  errors: ['boom'],
} as unknown as SDKMessage;

// ---------------------------------------------------------------------------

describe('PtahCliStreamLoop.effectiveSessionId', () => {
  it('starts as null before any system-init message', () => {
    const { loop } = makeLoop();
    expect(getEffectiveSessionId(loop)).toBeNull();
  });

  it('receives a valid SessionId after a system-init with a UUID session_id', async () => {
    const { loop, onSessionResolved } = makeLoop();
    const initMsg = {
      type: 'system',
      subtype: 'init',
      session_id: VALID_UUID,
      model: 'claude-3-5-sonnet',
    } as unknown as SDKMessage;

    await loop.run(singleMessage(initMsg));

    expect(getEffectiveSessionId(loop)).toBe(VALID_UUID);
    expect(SessionId.validate(getEffectiveSessionId(loop) as string)).toBe(
      true,
    );
    expect(onSessionResolved).toHaveBeenCalledWith(VALID_UUID);
  });

  it('stays null when system-init has no session_id', async () => {
    const { loop, onSessionResolved } = makeLoop();
    const initMsg = {
      type: 'system',
      subtype: 'init',
      // session_id intentionally omitted
      model: 'claude-3-5-sonnet',
    } as unknown as SDKMessage;

    await loop.run(singleMessage(initMsg));

    expect(getEffectiveSessionId(loop)).toBeNull();
    expect(onSessionResolved).not.toHaveBeenCalled();
  });

  it('stays null when system-init session_id is explicitly undefined', async () => {
    const { loop, onSessionResolved } = makeLoop();
    const initMsg = {
      type: 'system',
      subtype: 'init',
      session_id: undefined,
      model: 'claude-3-5-sonnet',
    } as unknown as SDKMessage;

    await loop.run(singleMessage(initMsg));

    expect(getEffectiveSessionId(loop)).toBeNull();
    expect(onSessionResolved).not.toHaveBeenCalled();
  });

  it('hard-fails (loop reports exit 1) when system-init session_id is a non-UUID string', async () => {
    const { loop, onSessionResolved } = makeLoop();
    const initMsg = {
      type: 'system',
      subtype: 'init',
      session_id: 'tab_1778939573732_w43e75q', // the exact v0.2.32 regression class
      model: 'claude-3-5-sonnet',
    } as unknown as SDKMessage;

    // SessionId.from() throws inside the loop. The outer try-finally in run()
    // catches and returns exit code 1; that's the "fail loudly" contract —
    // the malformed id never silently becomes the empty-string sentinel.
    const exitCode = await loop.run(singleMessage(initMsg));

    expect(exitCode).toBe(1);
    expect(getEffectiveSessionId(loop)).toBeNull();
    expect(onSessionResolved).not.toHaveBeenCalled();
  });
});

describe('PtahCliStreamLoop.onTurnComplete', () => {
  function makeLoopWithTurns(): {
    loop: PtahCliStreamLoop;
    onTurnComplete: jest.Mock;
  } {
    const onTurnComplete = jest.fn();
    const loop = new PtahCliStreamLoop({
      logger: createLogger(),
      messageTransformer: createTransformerStub(),
      emitOutput: jest.fn(),
      emitSegment: jest.fn(),
      emitStreamEvent: jest.fn(),
      agentName: 'test-agent',
      onTurnComplete,
    });
    return { loop, onTurnComplete };
  }

  it('fires with exit code 0 on a success result', async () => {
    const { loop, onTurnComplete } = makeLoopWithTurns();

    await loop.run(singleMessage(successResult));

    expect(onTurnComplete).toHaveBeenCalledTimes(1);
    expect(onTurnComplete).toHaveBeenCalledWith(0);
  });

  it('fires with exit code 1 on an error result', async () => {
    const { loop, onTurnComplete } = makeLoopWithTurns();

    await loop.run(singleMessage(errorResult));

    expect(onTurnComplete).toHaveBeenCalledTimes(1);
    expect(onTurnComplete).toHaveBeenCalledWith(1);
  });

  it('fires once per result across a multi-turn stream', async () => {
    const { loop, onTurnComplete } = makeLoopWithTurns();

    await loop.run(manyMessages([successResult, successResult]));

    expect(onTurnComplete).toHaveBeenCalledTimes(2);
    expect(onTurnComplete).toHaveBeenNthCalledWith(1, 0);
    expect(onTurnComplete).toHaveBeenNthCalledWith(2, 0);
  });

  it('does not fire when the stream throws mid-turn before a result', async () => {
    const { loop, onTurnComplete } = makeLoopWithTurns();

    async function* crashingStream(): AsyncIterable<SDKMessage> {
      yield {
        type: 'system',
        subtype: 'init',
        session_id: VALID_UUID,
        model: 'claude-3-5-sonnet',
      } as unknown as SDKMessage;
      throw new Error('mid-stream crash');
    }

    const exitCode = await loop.run(crashingStream());

    expect(exitCode).toBe(1);
    expect(onTurnComplete).not.toHaveBeenCalled();
  });
});

describe('PtahCliStreamLoop dedup across turns', () => {
  function assistantMessage(messageId: string): SDKMessage {
    return {
      type: 'assistant',
      message: { role: 'assistant', id: messageId, content: [] },
    } as unknown as SDKMessage;
  }

  function makeLoopWithIdTransformer(): {
    loop: PtahCliStreamLoop;
    emitStreamEvent: jest.Mock;
  } {
    const transform = jest.fn((msg: SDKMessage) => {
      const messageId =
        (msg as { message?: { id?: string } }).message?.id ?? '';
      return [{ eventType: 'message_start', messageId }];
    });
    const stub = {
      transform,
      createIsolated: jest.fn(),
    };
    stub.createIsolated.mockReturnValue(stub);

    const emitStreamEvent = jest.fn();
    const loop = new PtahCliStreamLoop({
      logger: createLogger(),
      messageTransformer: stub as unknown as SdkMessageTransformer,
      emitOutput: jest.fn(),
      emitSegment: jest.fn(),
      emitStreamEvent,
      agentName: 'test-agent',
    });
    return { loop, emitStreamEvent };
  }

  it('emits turn-2 events with distinct message ids despite accumulated dedup sets', async () => {
    const { loop, emitStreamEvent } = makeLoopWithIdTransformer();

    await loop.run(
      manyMessages([
        assistantMessage('msg-turn-1'),
        successResult,
        assistantMessage('msg-turn-2'),
        successResult,
      ]),
    );

    const emittedIds = emitStreamEvent.mock.calls.map(
      (call) => (call[0] as { messageId?: string }).messageId,
    );
    expect(emittedIds).toContain('msg-turn-1');
    expect(emittedIds).toContain('msg-turn-2');
  });
});

// TASK_2026_596 (Component 10; Decision 8; Decision 4 S2; F63).
describe('PtahCliStreamLoop plan-limit signals and usage', () => {
  const RESETS_AT_SECONDS = 1_791_200_000;

  function makeSignalLoop(opts?: { planBilledSuccess?: boolean }): {
    loop: PtahCliStreamLoop;
    emitSegment: jest.Mock;
    emitOutput: jest.Mock;
    onPlanLimitSignal: jest.Mock;
  } {
    const emitSegment = jest.fn();
    const emitOutput = jest.fn();
    const onPlanLimitSignal = jest.fn();
    const loop = new PtahCliStreamLoop({
      logger: createLogger(),
      messageTransformer: createTransformerStub(),
      emitOutput,
      emitSegment,
      emitStreamEvent: jest.fn(),
      agentName: 'test-agent',
      onPlanLimitSignal,
      planBilledSuccess: opts?.planBilledSuccess,
    });
    return { loop, emitSegment, emitOutput, onPlanLimitSignal };
  }

  function messageStart(model: string, parentToolUseId?: string): SDKMessage {
    return {
      type: 'stream_event',
      parent_tool_use_id: parentToolUseId ?? null,
      event: { type: 'message_start', message: { model } },
    } as unknown as SDKMessage;
  }

  function rateLimitEvent(info: Record<string, unknown>): SDKMessage {
    return {
      type: 'rate_limit_event',
      rate_limit_info: info,
    } as unknown as SDKMessage;
  }

  const usageResult = {
    type: 'result',
    subtype: 'success',
    num_turns: 2,
    usage: {
      input_tokens: 1200,
      output_tokens: 80,
      cache_read_input_tokens: 900,
      cache_creation_input_tokens: 300,
    },
    total_cost_usd: 0.0123,
    duration_ms: 1500,
  } as unknown as SDKMessage;

  const successSignals = (signal: jest.Mock): unknown[] =>
    signal.mock.calls
      .map((call) => call[0] as { kind: string })
      .filter((s) => s.kind === 'success');

  it('attaches the turn usage to the existing completion info line', async () => {
    const { loop, emitSegment, emitOutput } = makeSignalLoop();

    await loop.run(
      manyMessages([messageStart('claude-sonnet-4-6'), usageResult]),
    );

    const line = 'Completed: 1200 input, 80 output, $0.0123, 1.5s, 2 turns';
    expect(emitOutput).toHaveBeenCalledWith(`\n[${line}]\n`);
    expect(emitSegment).toHaveBeenCalledWith({
      type: 'info',
      content: line,
      usage: {
        model: 'claude-sonnet-4-6',
        inputTokens: 1200,
        outputTokens: 80,
        cacheReadTokens: 900,
        cacheWriteTokens: 300,
        costUsd: 0.0123,
      },
    });
  });

  it('falls back to the init model and leaves unreported values out', async () => {
    const { loop, emitSegment } = makeSignalLoop();

    await loop.run(
      manyMessages([
        {
          type: 'system',
          subtype: 'init',
          session_id: VALID_UUID,
          model: 'glm-5.2',
        } as unknown as SDKMessage,
        successResult,
      ]),
    );

    expect(emitSegment).toHaveBeenCalledWith({
      type: 'info',
      content: 'Completed: 1 turns',
      usage: { model: 'glm-5.2' },
    });
  });

  it('emits the info line without usage when the result reported none', async () => {
    const { loop, emitSegment } = makeSignalLoop();

    await loop.run(singleMessage(successResult));

    expect(emitSegment).toHaveBeenCalledWith({
      type: 'info',
      content: 'Completed: 1 turns',
    });
  });

  it('forwards a rate_limit_event as window evidence', async () => {
    const { loop, onPlanLimitSignal } = makeSignalLoop();

    await loop.run(
      singleMessage(
        rateLimitEvent({
          status: 'rejected',
          rateLimitType: 'five_hour',
          resetsAt: RESETS_AT_SECONDS,
        }),
      ),
    );

    expect(onPlanLimitSignal).toHaveBeenCalledWith({
      kind: 'evidence',
      evidence: expect.objectContaining({
        kind: 'window',
        windowKey: 'five_hour',
        exhausted: true,
        source: 'stream-event',
        resetsAt: RESETS_AT_SECONDS * 1000,
      }),
    });
  });

  it('forwards a rate-limit api_retry as owner evidence with a cooldown', async () => {
    const { loop, onPlanLimitSignal } = makeSignalLoop();

    await loop.run(
      singleMessage({
        type: 'system',
        subtype: 'api_retry',
        error: 'rate_limit',
        error_status: 429,
        retry_delay_ms: 2000,
      } as unknown as SDKMessage),
    );

    expect(onPlanLimitSignal).toHaveBeenCalledWith({
      kind: 'evidence',
      evidence: expect.objectContaining({
        kind: 'owner',
        cause: 'api-retry',
        cooldown: expect.objectContaining({ until: expect.any(Number) }),
      }),
    });
  });

  it('reports a success billed to the plan with the main-loop scopes only', async () => {
    const { loop, onPlanLimitSignal } = makeSignalLoop();

    await loop.run(
      manyMessages([
        messageStart('claude-opus-4-8'),
        messageStart('claude-haiku-4-5', 'toolu_subagent'),
        rateLimitEvent({ status: 'allowed', rateLimitType: 'five_hour' }),
        successResult,
      ]),
    );

    expect(successSignals(onPlanLimitSignal)).toEqual([
      {
        kind: 'success',
        turnScopes: ['opus'],
        billing: 'plan',
        observedAt: expect.any(Number),
      },
    ]);
  });

  it('F63 — a success while isUsingOverage is billed as overage', async () => {
    const { loop, onPlanLimitSignal } = makeSignalLoop();

    await loop.run(
      manyMessages([
        messageStart('claude-sonnet-4-6'),
        rateLimitEvent({
          status: 'allowed_warning',
          rateLimitType: 'five_hour',
          isUsingOverage: true,
        }),
        successResult,
      ]),
    );

    expect(successSignals(onPlanLimitSignal)).toEqual([
      expect.objectContaining({ billing: 'overage', turnScopes: ['sonnet'] }),
    ]);
  });

  it('resets scopes and billing at every result (per-turn rule)', async () => {
    const { loop, onPlanLimitSignal } = makeSignalLoop();

    await loop.run(
      manyMessages([
        messageStart('claude-opus-4-8'),
        rateLimitEvent({ status: 'allowed', isUsingOverage: true }),
        successResult,
        messageStart('claude-sonnet-4-6'),
        successResult,
      ]),
    );

    expect(successSignals(onPlanLimitSignal)).toEqual([
      expect.objectContaining({ turnScopes: ['opus'], billing: 'overage' }),
      expect.objectContaining({ turnScopes: ['sonnet'], billing: 'unknown' }),
    ]);
  });

  it('bills every success to the plan on a plan-billed (Ollama Cloud) lane', async () => {
    const { loop, onPlanLimitSignal } = makeSignalLoop({
      planBilledSuccess: true,
    });

    await loop.run(manyMessages([messageStart('glm-5.2'), successResult]));

    expect(successSignals(onPlanLimitSignal)).toEqual([
      expect.objectContaining({ turnScopes: [], billing: 'plan' }),
    ]);
  });

  it('reports no success for an error result or an is_error success', async () => {
    const { loop, onPlanLimitSignal } = makeSignalLoop();

    await loop.run(
      manyMessages([
        errorResult,
        { ...(successResult as object), is_error: true } as SDKMessage,
      ]),
    );

    expect(successSignals(onPlanLimitSignal)).toEqual([]);
  });

  it('keeps the stream running when the signal callback throws', async () => {
    const onTurnComplete = jest.fn();
    const logger = createLogger();
    const loop = new PtahCliStreamLoop({
      logger,
      messageTransformer: createTransformerStub(),
      emitOutput: jest.fn(),
      emitSegment: jest.fn(),
      emitStreamEvent: jest.fn(),
      agentName: 'test-agent',
      onTurnComplete,
      onPlanLimitSignal: () => {
        throw new Error('ledger down');
      },
    });

    const exitCode = await loop.run(
      manyMessages([
        rateLimitEvent({ status: 'rejected', rateLimitType: 'weekly' }),
        successResult,
      ]),
    );

    expect(exitCode).toBe(0);
    expect(onTurnComplete).toHaveBeenCalledWith(0);
    expect(logger.debug).toHaveBeenCalledTimes(2);
  });
});
