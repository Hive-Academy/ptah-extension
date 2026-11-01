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
import { PTAH_API_RATE_LIMIT_SEGMENT } from '../../cli-agents/limits/lane-rate-limit-classifier';

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
describe('PtahCliStreamLoop tool-call segments', () => {
  function makeToolLoop() {
    const emitSegment = jest.fn();
    const emitOutput = jest.fn();
    const loop = new PtahCliStreamLoop({
      logger: createLogger(),
      messageTransformer: createTransformerStub(),
      emitOutput,
      emitSegment,
      emitStreamEvent: jest.fn(),
      agentName: 'test-agent',
    });
    return { loop, emitSegment, emitOutput };
  }

  function streamEvent(
    event: Record<string, unknown>,
    parentToolUseId: string | null = null,
  ): SDKMessage {
    return {
      type: 'stream_event',
      event,
      parent_tool_use_id: parentToolUseId,
    } as unknown as SDKMessage;
  }

  function toolStart(
    index: number,
    id: string,
    input = {},
    parentToolUseId: string | null = null,
  ): SDKMessage {
    return streamEvent(
      {
        type: 'content_block_start',
        index,
        content_block: { type: 'tool_use', id, name: 'Grep', input },
      },
      parentToolUseId,
    );
  }

  function toolDelta(
    index: number,
    partial_json: string,
    parentToolUseId: string | null = null,
  ): SDKMessage {
    return streamEvent(
      {
        type: 'content_block_delta',
        index,
        delta: { type: 'input_json_delta', partial_json },
      },
      parentToolUseId,
    );
  }

  function toolStop(index: number, parentToolUseId: string | null = null): SDKMessage {
    return streamEvent(
      { type: 'content_block_stop', index },
      parentToolUseId,
    );
  }

  function toolCalls(emitSegment: jest.Mock) {
    return emitSegment.mock.calls
      .map(([segment]) => segment)
      .filter((segment) => segment.type === 'tool-call');
  }

  it('emits one streamed call with completed JSON input and its id', async () => {
    const { loop, emitSegment, emitOutput } = makeToolLoop();
    await loop.run(manyMessages([
      toolStart(0, 'grep-1'),
      toolDelta(0, '{"pattern":"first'),
      toolDelta(0, ' search"}'),
      toolStop(0),
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'grep-1', name: 'Grep', input: { pattern: 'first search' } }],
        },
      } as unknown as SDKMessage,
    ]));

    expect(toolCalls(emitSegment)).toEqual([{
      type: 'tool-call',
      content: '',
      toolName: 'Grep',
      toolCallId: 'grep-1',
      toolInput: { pattern: 'first search' },
      toolArgs: 'first search',
    }]);
    expect(emitOutput).toHaveBeenCalledWith('\n**Tool:** `Grep` first search\n');
  });

  it('keeps different inputs for two streamed calls to the same tool', async () => {
    const { loop, emitSegment } = makeToolLoop();
    await loop.run(manyMessages([
      toolStart(0, 'grep-1'), toolDelta(0, '{"pattern":"one"}'), toolStop(0),
      toolStart(1, 'grep-2'), toolDelta(1, '{"pattern":"two"}'), toolStop(1),
    ]));

    expect(toolCalls(emitSegment)).toEqual([
      expect.objectContaining({ toolCallId: 'grep-1', toolInput: { pattern: 'one' } }),
      expect.objectContaining({ toolCallId: 'grep-2', toolInput: { pattern: 'two' } }),
    ]);
  });

  it('keeps interleaved parent calls at index zero separate', async () => {
    const { loop, emitSegment } = makeToolLoop();
    await loop.run(manyMessages([
      toolStart(0, 'grep-a', {}, 'parent-a'),
      toolStart(0, 'grep-b', {}, 'parent-b'),
      toolDelta(0, '{"pattern":"alpha', 'parent-a'),
      toolDelta(0, '{"pattern":"beta', 'parent-b'),
      toolDelta(0, ' search"}', 'parent-a'),
      toolDelta(0, ' search"}', 'parent-b'),
      toolStop(0, 'parent-a'),
      toolStop(0, 'parent-b'),
    ]));

    expect(toolCalls(emitSegment)).toEqual([
      expect.objectContaining({ toolName: 'Grep', toolCallId: 'grep-a', toolInput: { pattern: 'alpha search' } }),
      expect.objectContaining({ toolName: 'Grep', toolCallId: 'grep-b', toolInput: { pattern: 'beta search' } }),
    ]);
  });

  it('flushes only the matching parent call on an assistant message', async () => {
    const { loop, emitSegment } = makeToolLoop();
    await loop.run(manyMessages([
      toolStart(0, 'grep-a', {}, 'parent-a'),
      toolStart(0, 'grep-b', {}, 'parent-b'),
      toolDelta(0, '{"pattern":"alpha"}', 'parent-a'),
      toolDelta(0, '{"pattern":"beta', 'parent-b'),
      {
        type: 'assistant',
        parent_tool_use_id: 'parent-a',
        message: { content: [{ type: 'tool_use', id: 'grep-a', name: 'Grep', input: { pattern: 'alpha' } }] },
      } as SDKMessage,
      toolDelta(0, ' search"}', 'parent-b'),
      toolStop(0, 'parent-b'),
    ]));

    expect(toolCalls(emitSegment)).toEqual([
      expect.objectContaining({ toolCallId: 'grep-a', toolInput: { pattern: 'alpha' } }),
      expect.objectContaining({ toolCallId: 'grep-b', toolInput: { pattern: 'beta search' } }),
    ]);
  });

  it('flushes every remaining parent call at stream end', async () => {
    const { loop, emitSegment } = makeToolLoop();
    await loop.run(manyMessages([
      toolStart(0, 'grep-a', {}, 'parent-a'),
      toolStart(0, 'grep-b', {}, 'parent-b'),
      toolDelta(0, '{"pattern":"alpha"}', 'parent-a'),
      toolDelta(0, '{"pattern":"beta"}', 'parent-b'),
    ]));

    expect(toolCalls(emitSegment)).toEqual([
      expect.objectContaining({ toolCallId: 'grep-a', toolInput: { pattern: 'alpha' } }),
      expect.objectContaining({ toolCallId: 'grep-b', toolInput: { pattern: 'beta' } }),
    ]);
  });

  it('retains invalid partial JSON as distinguishable bounded input', async () => {
    const { loop, emitSegment } = makeToolLoop();
    await expect(loop.run(manyMessages([
      toolStart(0, 'grep-1', { pattern: 'fallback' }),
      toolDelta(0, '{"pattern":'),
      toolStop(0),
    ]))).resolves.toBe(0);

    expect(toolCalls(emitSegment)).toEqual([
      expect.objectContaining({
        toolCallId: 'grep-1',
        toolInput: { __unparsed: '{"pattern":' },
        toolArgs: expect.any(String),
      }),
    ]);
  });

  it('flushes a partial call before a stream error', async () => {
    const { loop, emitSegment } = makeToolLoop();
    async function* failingStream(): AsyncIterable<SDKMessage> {
      yield toolStart(0, 'grep-1');
      yield toolDelta(0, '{"pattern":"unfinished"');
      throw new Error('stream failed');
    }

    await expect(loop.run(failingStream())).resolves.toBe(1);
    expect(emitSegment.mock.calls.map(([segment]) => segment.type)).toEqual([
      'tool-call', 'error',
    ]);
    expect(toolCalls(emitSegment)).toEqual([
      expect.objectContaining({
        toolCallId: 'grep-1',
        toolInput: { __unparsed: '{"pattern":"unfinished"' },
      }),
    ]);
  });

  it('skips an unstopped call with no known input', async () => {
    const { loop, emitSegment } = makeToolLoop();
    await loop.run(singleMessage(toolStart(0, 'grep-1')));
    expect(toolCalls(emitSegment)).toEqual([]);
  });

  it('emits both calls when a second start reuses a pending index', async () => {
    const { loop, emitSegment } = makeToolLoop();
    await loop.run(manyMessages([
      toolStart(0, 'grep-1'), toolDelta(0, '{"pattern":"first"}'),
      toolStart(0, 'grep-2'), toolDelta(0, '{"pattern":"second"}'),
      toolStop(0),
    ]));

    expect(toolCalls(emitSegment)).toEqual([
      expect.objectContaining({ toolCallId: 'grep-1', toolInput: { pattern: 'first' } }),
      expect.objectContaining({ toolCallId: 'grep-2', toolInput: { pattern: 'second' } }),
    ]);
  });

  it('clears emitted ids between turns while suppressing each turn assistant echo', async () => {
    const { loop, emitSegment } = makeToolLoop();
    const assistantCall = {
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'grep-1', name: 'Grep', input: { pattern: 'echo' } }],
      },
    } as unknown as SDKMessage;
    await loop.run(manyMessages([
      toolStart(0, 'grep-1'), toolDelta(0, '{"pattern":"turn-1"}'),
      toolStop(0), assistantCall, successResult,
      toolStart(0, 'grep-1'), toolDelta(0, '{"pattern":"turn-2"}'),
      toolStop(0), assistantCall, successResult,
    ]));

    expect(toolCalls(emitSegment)).toEqual([
      expect.objectContaining({ toolCallId: 'grep-1', toolInput: { pattern: 'turn-1' } }),
      expect.objectContaining({ toolCallId: 'grep-1', toolInput: { pattern: 'turn-2' } }),
    ]);
  });

  it('tags successful and failed tool results with the call id', async () => {
    const { loop, emitSegment } = makeToolLoop();
    await loop.run(singleMessage({
      type: 'user',
      message: { content: [
        { type: 'tool_result', tool_use_id: 'grep-1', content: 'found' },
        { type: 'tool_result', tool_use_id: 'grep-2', content: 'failed', is_error: true },
      ] },
    } as unknown as SDKMessage));

    expect(emitSegment.mock.calls.map(([segment]) => segment)).toEqual([
      expect.objectContaining({ type: 'tool-result', toolCallId: 'grep-1' }),
      expect.objectContaining({ type: 'tool-result-error', toolCallId: 'grep-2' }),
    ]);
  });

  it('flushes an unstopped block once at stream end', async () => {
    const { loop, emitSegment } = makeToolLoop();
    await loop.run(manyMessages([
      toolStart(0, 'grep-1'), toolDelta(0, '{"pattern":"late"}'),
    ]));

    expect(toolCalls(emitSegment)).toEqual([
      expect.objectContaining({ toolCallId: 'grep-1', toolInput: { pattern: 'late' } }),
    ]);
  });

  it('uses full input and id for a non-streamed assistant call', async () => {
    const { loop, emitSegment } = makeToolLoop();
    await loop.run(singleMessage({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'grep-1', name: 'Grep', input: { pattern: 'plain' } }],
      },
    } as unknown as SDKMessage));

    expect(toolCalls(emitSegment)).toEqual([
      expect.objectContaining({ toolCallId: 'grep-1', toolInput: { pattern: 'plain' } }),
    ]);
  });
});

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
    modelUsage: {
      'claude-sonnet-4-6': {
        inputTokens: 1200,
        outputTokens: 80,
        cacheReadInputTokens: 900,
        cacheCreationInputTokens: 300,
      },
    },
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

  it('emits modelUsage deltas so the token totals match the cumulative cost scope', async () => {
    const { loop, emitSegment } = makeSignalLoop();
    const nextResult = {
      ...usageResult,
      modelUsage: {
        'claude-sonnet-4-6': {
          inputTokens: 1500,
          outputTokens: 120,
          cacheReadInputTokens: 1050,
          cacheCreationInputTokens: 350,
        },
        'claude-haiku-4-5': {
          inputTokens: 200,
          outputTokens: 40,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      },
      total_cost_usd: 0.02,
    } as unknown as SDKMessage;

    await loop.run(
      manyMessages([messageStart('claude-sonnet-4-6'), usageResult, nextResult]),
    );

    expect(emitSegment.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        usage: expect.objectContaining({
          inputTokens: 500,
          outputTokens: 80,
          cacheReadTokens: 150,
          cacheWriteTokens: 50,
          costUsd: 0.02,
        }),
      }),
    );
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

// TASK_2026_857 B10c (Req 1): an `is_error` 429 success result still ends the
// turn with exit 0, so the loop leaves one fixed error segment for the exit
// path to read. The provider's text is never copied into it.
describe('PtahCliStreamLoop API rate-limit marker', () => {
  function makeMarkerLoop(): {
    loop: PtahCliStreamLoop;
    emitSegment: jest.Mock;
    onTurnComplete: jest.Mock;
  } {
    const emitSegment = jest.fn();
    const onTurnComplete = jest.fn();
    const loop = new PtahCliStreamLoop({
      logger: createLogger(),
      messageTransformer: createTransformerStub(),
      emitOutput: jest.fn(),
      emitSegment,
      emitStreamEvent: jest.fn(),
      agentName: 'test-agent',
      onTurnComplete,
    });
    return { loop, emitSegment, onTurnComplete };
  }

  function errorSegments(emitSegment: jest.Mock): unknown[] {
    return emitSegment.mock.calls
      .map(([segment]) => segment as { type: string; content: string })
      .filter((segment) => segment.type === 'error');
  }

  function result(fields: Record<string, unknown>): SDKMessage {
    return { ...(successResult as object), ...fields } as SDKMessage;
  }

  it('emits one marker segment for an is_error result with status 429', async () => {
    const { loop, emitSegment, onTurnComplete } = makeMarkerLoop();

    const exitCode = await loop.run(
      singleMessage(
        result({
          is_error: true,
          api_error_status: 429,
          result: 'provider says: slow down, account abc-123',
        }),
      ),
    );

    expect(errorSegments(emitSegment)).toEqual([
      { type: 'error', content: PTAH_API_RATE_LIMIT_SEGMENT },
    ]);
    expect(exitCode).toBe(0);
    expect(onTurnComplete).toHaveBeenCalledWith(0);
    expect(JSON.stringify(emitSegment.mock.calls)).not.toContain('abc-123');
  });

  it('emits the marker for an is_error result with a 429 wording', async () => {
    const { loop, emitSegment, onTurnComplete } = makeMarkerLoop();

    await loop.run(
      singleMessage(
        result({
          is_error: true,
          result: 'API Error: Request rejected (429) for key sk-secret',
        }),
      ),
    );

    expect(errorSegments(emitSegment)).toEqual([
      { type: 'error', content: PTAH_API_RATE_LIMIT_SEGMENT },
    ]);
    expect(onTurnComplete).toHaveBeenCalledWith(0);
    expect(JSON.stringify(emitSegment.mock.calls)).not.toContain('sk-secret');
  });

  it('emits no marker for an is_error result with status 500', async () => {
    const { loop, emitSegment } = makeMarkerLoop();

    await loop.run(
      singleMessage(
        result({
          is_error: true,
          api_error_status: 500,
          result: 'API Error: internal server error',
        }),
      ),
    );

    expect(errorSegments(emitSegment)).toEqual([]);
  });

  it('emits no marker for a clean success, even one discussing 429s', async () => {
    const { loop, emitSegment } = makeMarkerLoop();

    await loop.run(
      singleMessage(
        result({ is_error: false, result: 'Fixed the API Error: 429 path' }),
      ),
    );

    expect(errorSegments(emitSegment)).toEqual([]);
  });
});
