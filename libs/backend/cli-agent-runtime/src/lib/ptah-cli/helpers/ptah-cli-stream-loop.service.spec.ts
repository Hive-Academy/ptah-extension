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
