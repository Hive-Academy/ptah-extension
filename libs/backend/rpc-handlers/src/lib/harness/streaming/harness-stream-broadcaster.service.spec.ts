/**
 * Unit spec for {@link HarnessStreamBroadcaster}.
 *
 * Focus: prove the synthetic harness id threaded through `teeStreamWithFlatEvents`
 * is the `HarnessStreamId` brand (format `harness-${operationId}`), NOT a real
 * SDK UUID `SessionId`. This is the guard rail that prevents the v0.2.32-class
 * regression where structured-prefix strings were cast to `SessionId` and later
 * crashed UUID-validating consumers.
 *
 * Strategy:
 *   - Stub `SdkMessageTransformer.createIsolated()` to return a recording
 *     transformer that captures the `sessionId` arg passed to `transform()`.
 *   - Stub the webview broadcaster to record dispatched messages.
 *   - Drive `teeStreamWithFlatEvents` with a minimal async generator.
 *   - Assert the recorded sessionId matches the HarnessStreamId shape and is
 *     NOT a UUID.
 */

import 'reflect-metadata';
import { HarnessStreamId, SessionId } from '@ptah-extension/shared';
import type {
  FlatStreamEventUnion,
  MessageStartEvent,
} from '@ptah-extension/shared';
import type {
  SDKMessage,
  SdkMessageTransformer,
} from '@ptah-extension/agent-sdk';
import {
  HarnessStreamBroadcaster,
  type WebviewBroadcaster,
} from './harness-stream-broadcaster.service';

// ---------------------------------------------------------------------------
// Minimal test doubles. We avoid the full DI container because this spec
// targets a single behavior: the id type passed into transform().
// ---------------------------------------------------------------------------

interface RecordedTransform {
  sessionId: string | undefined;
}

function createRecordingTransformer(): {
  transformer: SdkMessageTransformer;
  recorded: RecordedTransform[];
} {
  const recorded: RecordedTransform[] = [];
  const stub = {
    transform: jest.fn(
      (_msg: SDKMessage, sessionId?: string): FlatStreamEventUnion[] => {
        recorded.push({ sessionId });
        // Return one event so the broadcaster broadcasts something.
        const event: MessageStartEvent = {
          id: 'evt-1',
          eventType: 'message_start',
          timestamp: 0,
          sessionId: sessionId ?? '',
          messageId: 'msg-1',
          role: 'assistant',
        };
        return [event];
      },
    ),
    // createIsolated returns the same recording stub — the spec only cares
    // about which sessionId is threaded through.
    createIsolated: jest.fn(),
  };
  stub.createIsolated.mockReturnValue(stub);
  return {
    transformer: stub as unknown as SdkMessageTransformer,
    recorded,
  };
}

function createBroadcasterStub(): WebviewBroadcaster & {
  calls: Array<{ type: string; payload: unknown }>;
} {
  const calls: Array<{ type: string; payload: unknown }> = [];
  return {
    calls,
    broadcastMessage: jest.fn(async (type: string, payload: unknown) => {
      calls.push({ type, payload });
    }),
  };
}

async function* sdkMessageStream(count: number): AsyncIterable<SDKMessage> {
  for (let i = 0; i < count; i++) {
    // Minimal SDKMessage stub — the recording transformer ignores content.
    yield { type: 'assistant', uuid: `u-${i}` } as unknown as SDKMessage;
  }
}

// ---------------------------------------------------------------------------

describe('HarnessStreamBroadcaster.teeStreamWithFlatEvents', () => {
  it('threads a HarnessStreamId (NOT a UUID) into the transformer', async () => {
    const { transformer, recorded } = createRecordingTransformer();
    const broadcaster = createBroadcasterStub();
    const sut = new HarnessStreamBroadcaster(broadcaster, transformer);

    const operationId = 'op-123';

    // Drain the tee'd stream
    for await (const _ of sut.teeStreamWithFlatEvents(
      sdkMessageStream(2),
      operationId,
    )) {
      // no-op
    }

    expect(recorded).toHaveLength(2);
    for (const entry of recorded) {
      // 1. The sessionId is the HarnessStreamId shape
      expect(entry.sessionId).toBe('harness-op-123');
      // 2. It validates as a HarnessStreamId
      expect(HarnessStreamId.validate(entry.sessionId!)).toBe(true);
      // 3. It is explicitly NOT a UUID — this is the regression guard.
      expect(SessionId.validate(entry.sessionId!)).toBe(false);
    }
  });

  it('broadcasts harness:flat-stream with the operationId, decoupled from sessionId', async () => {
    const { transformer } = createRecordingTransformer();
    const broadcaster = createBroadcasterStub();
    const sut = new HarnessStreamBroadcaster(broadcaster, transformer);

    const operationId = 'op-broadcast-test';

    for await (const _ of sut.teeStreamWithFlatEvents(
      sdkMessageStream(1),
      operationId,
    )) {
      // no-op
    }

    const flatStreamCalls = broadcaster.calls.filter(
      (c) => c.type === 'harness:flat-stream',
    );
    expect(flatStreamCalls).toHaveLength(1);
    const payload = flatStreamCalls[0].payload as {
      operationId: string;
      event: FlatStreamEventUnion;
    };
    expect(payload.operationId).toBe(operationId);
    // The carried event preserves the HarnessStreamId-shaped sessionId.
    expect(payload.event.sessionId).toBe('harness-op-broadcast-test');
    expect(SessionId.validate(payload.event.sessionId)).toBe(false);
  });
});
