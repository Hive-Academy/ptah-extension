/**
 * Unit spec for {@link SessionLifecycleNotifier}.
 *
 * Asserts the Phase 1 wire-crossing contract:
 *   - constructor subscribes to {@link SdkAdapterEvents.onCompactionComplete};
 *   - a bus emit fans out to `webviewManager.broadcastMessage(...)` keyed by
 *     `MESSAGE_TYPES.SESSION_COMPACTION_COMPLETE` with the Zod-validated
 *     payload;
 *   - malformed payloads are dropped (defence in depth — bus producers are
 *     trusted but the boundary still validates);
 *   - the message-type constant exists on the canonical wire constant
 *     (registration regression — memory `project_rpc_registration_pattern`).
 */

import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  MESSAGE_TYPES,
  type SdkCompactionCompletePayload,
} from '@ptah-extension/shared';
import type { SdkAdapterCompactionCompleteEvent } from '@ptah-extension/agent-sdk';
import { SdkAdapterEvents } from '@ptah-extension/agent-sdk';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import {
  SessionLifecycleNotifier,
  type WebviewBroadcaster,
} from './session-lifecycle-notifier';

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

function createBroadcasterStub(): {
  broadcaster: WebviewBroadcaster;
  calls: Array<{ type: string; payload: unknown }>;
  rejection?: Error;
} {
  const calls: Array<{ type: string; payload: unknown }> = [];
  const broadcaster: WebviewBroadcaster = {
    broadcastMessage: jest.fn(async (type: string, payload: unknown) => {
      calls.push({ type, payload });
    }),
  };
  return { broadcaster, calls };
}

function makeEvent(
  overrides: Partial<SdkAdapterCompactionCompleteEvent> = {},
): SdkAdapterCompactionCompleteEvent {
  return {
    sessionId: 'sess-xyz',
    cwd: '/repo',
    trigger: 'manual',
    compactSummary: 'summary text',
    timestamp: 1700,
    ...overrides,
  };
}

describe('SessionLifecycleNotifier', () => {
  let logger: MockLogger;
  let bus: SdkAdapterEvents;
  let broadcaster: WebviewBroadcaster;
  let calls: Array<{ type: string; payload: unknown }>;

  beforeEach(() => {
    logger = createMockLogger();
    bus = new SdkAdapterEvents(asLogger(logger));
    const stub = createBroadcasterStub();
    broadcaster = stub.broadcaster;
    calls = stub.calls;
  });

  it('subscribes to onCompactionComplete in the constructor', () => {
    expect(bus.listenerCount('compactionComplete')).toBe(0);

    new SessionLifecycleNotifier(asLogger(logger), bus, broadcaster);

    expect(bus.listenerCount('compactionComplete')).toBe(1);
  });

  it('forwards a bus emit to the webview as session:compactionComplete', () => {
    new SessionLifecycleNotifier(asLogger(logger), bus, broadcaster);
    const event = makeEvent({ trigger: 'auto', timestamp: 4242 });

    bus.emitCompactionComplete(event);

    expect(calls).toHaveLength(1);
    expect(calls[0].type).toBe(MESSAGE_TYPES.SESSION_COMPACTION_COMPLETE);
    const payload = calls[0].payload as SdkCompactionCompletePayload;
    expect(payload).toEqual(event);
  });

  it('drops a malformed payload (Zod validation) and logs a warning', () => {
    new SessionLifecycleNotifier(asLogger(logger), bus, broadcaster);
    const bad = {
      sessionId: '',
      cwd: '/repo',
      trigger: 'sideways',
      compactSummary: 'x',
      timestamp: -1,
    } as unknown as SdkAdapterCompactionCompleteEvent;

    bus.emitCompactionComplete(bad);

    expect(calls).toHaveLength(0);
    expect(logger.warn).toHaveBeenCalled();
  });

  it('dispose() detaches the bus subscription', () => {
    const notifier = new SessionLifecycleNotifier(
      asLogger(logger),
      bus,
      broadcaster,
    );
    expect(bus.listenerCount('compactionComplete')).toBe(1);

    notifier.dispose();

    expect(bus.listenerCount('compactionComplete')).toBe(0);
    bus.emitCompactionComplete(makeEvent());
    expect(calls).toHaveLength(0);
  });

  it('survives a rejected broadcast without throwing', async () => {
    const failing: WebviewBroadcaster = {
      broadcastMessage: jest.fn().mockRejectedValue(new Error('ipc-fail')),
    };
    new SessionLifecycleNotifier(asLogger(logger), bus, failing);

    expect(() => bus.emitCompactionComplete(makeEvent())).not.toThrow();

    await Promise.resolve();
    await Promise.resolve();

    expect(logger.warn).toHaveBeenCalled();
  });

  describe('RPC registration regression', () => {
    it('MESSAGE_TYPES.SESSION_COMPACTION_COMPLETE equals "session:compactionComplete"', () => {
      expect(MESSAGE_TYPES.SESSION_COMPACTION_COMPLETE).toBe(
        'session:compactionComplete',
      );
    });

    it('uses the registered MESSAGE_TYPES constant on the wire', () => {
      new SessionLifecycleNotifier(asLogger(logger), bus, broadcaster);

      bus.emitCompactionComplete(makeEvent());

      expect(calls[0].type).toBe(MESSAGE_TYPES.SESSION_COMPACTION_COMPLETE);
    });
  });
});
