/**
 * Unit spec for {@link SessionLifecycleNotifier}.
 *
 * Asserts the Phase 1 + Phase 2 wire-crossing contract:
 *   - constructor subscribes to {@link SdkAdapterEvents.onCompactionComplete},
 *     {@link SdkAdapterEvents.onTurnEnded}, and
 *     {@link SdkAdapterEvents.onTurnFailed};
 *   - a bus emit fans out to `webviewManager.broadcastMessage(...)` keyed by
 *     the matching `MESSAGE_TYPES.SESSION_*` constant with the Zod-validated
 *     payload;
 *   - malformed payloads are dropped (defence in depth — bus producers are
 *     trusted but the boundary still validates) and the warn message includes
 *     structural payload context;
 *   - the message-type constants exist on the canonical wire constant
 *     (registration regression — memory `project_rpc_registration_pattern`).
 */

import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  MESSAGE_TYPES,
  type SdkCompactionCompletePayload,
  type SdkTurnEndedPayload,
  type SdkTurnFailedPayload,
} from '@ptah-extension/shared';
import type {
  SdkAdapterCompactionCompleteEvent,
  SdkAdapterTurnEndedEvent,
  SdkAdapterTurnFailedEvent,
} from '@ptah-extension/agent-sdk';
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

function makeTurnEndedEvent(
  overrides: Partial<SdkAdapterTurnEndedEvent> = {},
): SdkAdapterTurnEndedEvent {
  return {
    sessionId: 'sess-turn',
    cwd: '/repo',
    lastAssistantMessage: 'done',
    backgroundTasks: [],
    sessionCrons: [],
    terminalReason: 'completed',
    timestamp: 1800,
    ...overrides,
  };
}

function makeTurnFailedEvent(
  overrides: Partial<SdkAdapterTurnFailedEvent> = {},
): SdkAdapterTurnFailedEvent {
  return {
    sessionId: 'sess-fail',
    cwd: '/repo',
    lastAssistantMessage: null,
    error: 'rate_limit',
    errorDetails: 'too many requests',
    terminalReason: 'model_error',
    timestamp: 1900,
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

  it('dispose() detaches every bus subscription', () => {
    const notifier = new SessionLifecycleNotifier(
      asLogger(logger),
      bus,
      broadcaster,
    );
    expect(bus.listenerCount('compactionComplete')).toBe(1);
    expect(bus.listenerCount('turnEnded')).toBe(1);
    expect(bus.listenerCount('turnFailed')).toBe(1);

    notifier.dispose();

    expect(bus.listenerCount('compactionComplete')).toBe(0);
    expect(bus.listenerCount('turnEnded')).toBe(0);
    expect(bus.listenerCount('turnFailed')).toBe(0);

    bus.emitCompactionComplete(makeEvent());
    bus.emitTurnEnded(makeTurnEndedEvent());
    bus.emitTurnFailed(makeTurnFailedEvent());
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

  describe('turnEnded path', () => {
    it('subscribes to onTurnEnded in the constructor', () => {
      expect(bus.listenerCount('turnEnded')).toBe(0);

      new SessionLifecycleNotifier(asLogger(logger), bus, broadcaster);

      expect(bus.listenerCount('turnEnded')).toBe(1);
    });

    it('forwards a bus emit to the webview as session:turnEnded', () => {
      new SessionLifecycleNotifier(asLogger(logger), bus, broadcaster);
      const event = makeTurnEndedEvent({
        backgroundTasks: [
          {
            id: 'bg-1',
            type: 'shell',
            status: 'running',
            description: 'tail -f logs',
            command: 'tail -f logs',
          },
        ],
        sessionCrons: [
          {
            id: 'cron-1',
            schedule: '0 9 * * *',
            recurring: true,
            prompt: 'morning standup',
          },
        ],
        terminalReason: 'completed',
      });

      bus.emitTurnEnded(event);

      expect(calls).toHaveLength(1);
      expect(calls[0].type).toBe(MESSAGE_TYPES.SESSION_TURN_ENDED);
      const payload = calls[0].payload as SdkTurnEndedPayload;
      expect(payload).toEqual(event);
    });

    it('drops a malformed turnEnded payload and logs a warning with structural context', () => {
      new SessionLifecycleNotifier(asLogger(logger), bus, broadcaster);
      const bad = {
        sessionId: '',
        cwd: '/repo',
        lastAssistantMessage: null,
        backgroundTasks: [],
        sessionCrons: [],
        terminalReason: 'completed',
        timestamp: -1,
      } as unknown as SdkAdapterTurnEndedEvent;

      bus.emitTurnEnded(bad);

      expect(calls).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalled();
      const firstArg = logger.warn.mock.calls[0][0] as string;
      expect(firstArg).toContain('turnEnded');
      expect(firstArg).toContain('hasBackgroundTasks=false');
    });
  });

  describe('turnFailed path', () => {
    it('subscribes to onTurnFailed in the constructor', () => {
      expect(bus.listenerCount('turnFailed')).toBe(0);

      new SessionLifecycleNotifier(asLogger(logger), bus, broadcaster);

      expect(bus.listenerCount('turnFailed')).toBe(1);
    });

    it('forwards a bus emit to the webview as session:turnFailed', () => {
      new SessionLifecycleNotifier(asLogger(logger), bus, broadcaster);
      const event = makeTurnFailedEvent({
        error: 'rate_limit',
        errorDetails: 'retry after 60s',
      });

      bus.emitTurnFailed(event);

      expect(calls).toHaveLength(1);
      expect(calls[0].type).toBe(MESSAGE_TYPES.SESSION_TURN_FAILED);
      const payload = calls[0].payload as SdkTurnFailedPayload;
      expect(payload).toEqual(event);
    });

    it('drops a malformed turnFailed payload and logs a warning with structural context', () => {
      new SessionLifecycleNotifier(asLogger(logger), bus, broadcaster);
      const bad = {
        sessionId: 'sess-fail',
        cwd: '/repo',
        lastAssistantMessage: null,
        error: 'not_a_valid_error_code',
        errorDetails: null,
        terminalReason: 'model_error',
        timestamp: 1900,
      } as unknown as SdkAdapterTurnFailedEvent;

      bus.emitTurnFailed(bad);

      expect(calls).toHaveLength(0);
      expect(logger.warn).toHaveBeenCalled();
      const firstArg = logger.warn.mock.calls[0][0] as string;
      expect(firstArg).toContain('turnFailed');
      expect(firstArg).toContain('sessionId=sess-fail');
      expect(firstArg).toContain('error=not_a_valid_error_code');
    });
  });

  describe('RPC registration regression', () => {
    it('MESSAGE_TYPES.SESSION_COMPACTION_COMPLETE equals "session:compactionComplete"', () => {
      expect(MESSAGE_TYPES.SESSION_COMPACTION_COMPLETE).toBe(
        'session:compactionComplete',
      );
    });

    it('MESSAGE_TYPES.SESSION_TURN_ENDED equals "session:turnEnded"', () => {
      expect(MESSAGE_TYPES.SESSION_TURN_ENDED).toBe('session:turnEnded');
    });

    it('MESSAGE_TYPES.SESSION_TURN_FAILED equals "session:turnFailed"', () => {
      expect(MESSAGE_TYPES.SESSION_TURN_FAILED).toBe('session:turnFailed');
    });

    it('uses the registered MESSAGE_TYPES constant on the wire', () => {
      new SessionLifecycleNotifier(asLogger(logger), bus, broadcaster);

      bus.emitCompactionComplete(makeEvent());
      bus.emitTurnEnded(makeTurnEndedEvent());
      bus.emitTurnFailed(makeTurnFailedEvent());

      expect(calls[0].type).toBe(MESSAGE_TYPES.SESSION_COMPACTION_COMPLETE);
      expect(calls[1].type).toBe(MESSAGE_TYPES.SESSION_TURN_ENDED);
      expect(calls[2].type).toBe(MESSAGE_TYPES.SESSION_TURN_FAILED);
    });
  });
});
