/**
 * SurfaceSubmitTurnService — the host boundary of a surface submit
 * (TASK_2026_538, Req 10.1, 10.3, 10.4, 6.5).
 *
 * `sendMessageToSession` is spied, the lifecycle manager hands out a fake
 * record, and the broadcaster answers `isStreaming` from a set. The specs pin:
 *  - one send per accepted dispatch, with `admission: 'require-idle'`;
 *  - `session-unavailable` for a missing or non-live record, `busy` for a
 *    running or queued turn, both with no send;
 *  - the pending window while the send is unresolved;
 *  - the typed admission refusal mapped to `rejected`;
 *  - every other failure classified `indeterminate` and never resent.
 */

import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import {
  SdkError,
  SessionAdmissionRefusedError,
  type SessionLifecycleManager,
} from '@ptah-extension/agent-sdk';
import type { IAgentAdapter } from '@ptah-extension/shared';

import {
  SURFACE_SUBMIT_INDETERMINATE_DETAIL,
  SurfaceSubmitTurnService,
  type SurfaceSubmitTurnOutcome,
} from './surface-submit-turn.service';
import type { ChatStreamBroadcaster } from '../streaming/chat-stream-broadcaster.service';

type RecordView = NonNullable<ReturnType<SessionLifecycleManager['find']>>;

interface FakeRecord {
  tabId: string;
  realSessionId: string | null;
  turnInFlight: boolean;
  messageQueue: unknown[];
}

interface Deferred {
  readonly promise: Promise<void>;
  resolve(): void;
  reject(error: unknown): void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets every already-queued promise continuation run. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

const TAB = 'tab-1';
const REAL = '3f1c2a8e-5b7d-4e6f-9a0b-1c2d3e4f5a6b';
const CONTENT = 'Submitted form values';

describe('SurfaceSubmitTurnService', () => {
  let record: FakeRecord;
  let records: Map<string, FakeRecord>;
  let streaming: Set<string>;
  let active: boolean;
  let sendMessageToSession: jest.Mock;
  let logger: jest.Mocked<Logger>;
  let service: SurfaceSubmitTurnService;

  beforeEach(() => {
    record = {
      tabId: TAB,
      realSessionId: REAL,
      turnInFlight: false,
      messageQueue: [],
    };
    records = new Map([
      [TAB, record],
      [REAL, record],
    ]);
    streaming = new Set([TAB]);
    active = true;
    sendMessageToSession = jest.fn().mockResolvedValue(undefined);
    logger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as jest.Mocked<Logger>;

    const adapter = {
      isSessionActive: jest.fn(() => active),
      sendMessageToSession,
    } as unknown as IAgentAdapter;
    const lifecycle = {
      find: jest.fn((id: string) => records.get(id) as RecordView | undefined),
    } as unknown as SessionLifecycleManager;
    const broadcaster = {
      isStreaming: jest.fn((id: string) => streaming.has(id)),
    } as unknown as ChatStreamBroadcaster;

    service = new SurfaceSubmitTurnService(
      logger,
      adapter,
      lifecycle,
      broadcaster,
    );
  });

  describe('accepted submit', () => {
    it('sends once with require-idle admission and reports applied', async () => {
      const outcome = await service.dispatch(TAB, CONTENT);

      expect(outcome).toEqual({ status: 'applied' });
      expect(sendMessageToSession).toHaveBeenCalledTimes(1);
      expect(sendMessageToSession).toHaveBeenCalledWith(TAB, CONTENT, {
        admission: 'require-idle',
      });
    });

    it('leaves origin unset so the turn is the default human turn', async () => {
      await service.dispatch(TAB, CONTENT);

      const options = sendMessageToSession.mock.calls[0][2];
      expect(options).not.toHaveProperty('origin');
    });

    it('sends once per call: two sequential submits send twice', async () => {
      await service.dispatch(TAB, CONTENT);
      await service.dispatch(TAB, 'second');

      expect(sendMessageToSession).toHaveBeenCalledTimes(2);
    });

    it('counts a stream keyed by the real session id as live', async () => {
      streaming = new Set([REAL]);

      await expect(service.dispatch(REAL, CONTENT)).resolves.toEqual({
        status: 'applied',
      });
    });

    it('counts a stream keyed by the tab id as live before the real id binds', async () => {
      record.realSessionId = null;

      await expect(service.dispatch(TAB, CONTENT)).resolves.toEqual({
        status: 'applied',
      });
    });
  });

  describe('session unavailable', () => {
    it('rejects when no record is registered, without sending', async () => {
      records.clear();

      const outcome = await service.dispatch(TAB, CONTENT);

      expect(outcome).toMatchObject({
        status: 'rejected',
        reason: 'session-unavailable',
      });
      expect(sendMessageToSession).not.toHaveBeenCalled();
    });

    it('rejects when the adapter reports the session inactive', async () => {
      active = false;

      const outcome = await service.dispatch(TAB, CONTENT);

      expect(outcome).toMatchObject({
        status: 'rejected',
        reason: 'session-unavailable',
      });
      expect(sendMessageToSession).not.toHaveBeenCalled();
    });

    it('rejects a registered record with no broadcast loop on either key', async () => {
      streaming.clear();

      const outcome = await service.dispatch(TAB, CONTENT);

      expect(outcome).toMatchObject({
        status: 'rejected',
        reason: 'session-unavailable',
      });
      expect(sendMessageToSession).not.toHaveBeenCalled();
    });

    it('does not probe an empty stream key while the real id is unbound', async () => {
      record.realSessionId = null;
      streaming = new Set(['']);

      const outcome = await service.dispatch(TAB, CONTENT);

      expect(outcome).toMatchObject({
        status: 'rejected',
        reason: 'session-unavailable',
      });
    });
  });

  describe('busy fast path', () => {
    it('rejects while a turn is in flight, without sending', async () => {
      record.turnInFlight = true;

      const outcome = await service.dispatch(TAB, CONTENT);

      expect(outcome).toMatchObject({ status: 'rejected', reason: 'busy' });
      expect(sendMessageToSession).not.toHaveBeenCalled();
    });

    it('rejects while a message is already queued, without sending', async () => {
      record.messageQueue.push({ type: 'user' });

      const outcome = await service.dispatch(TAB, CONTENT);

      expect(outcome).toMatchObject({ status: 'rejected', reason: 'busy' });
      expect(sendMessageToSession).not.toHaveBeenCalled();
    });
  });

  describe('pending window (Req 6.5)', () => {
    it('stays unsettled while the send is unresolved, then reports applied', async () => {
      const send = deferred();
      sendMessageToSession.mockReturnValueOnce(send.promise);

      let settled: SurfaceSubmitTurnOutcome | undefined;
      const pending = service.dispatch(TAB, CONTENT).then((outcome) => {
        settled = outcome;
        return outcome;
      });
      await flush();

      expect(sendMessageToSession).toHaveBeenCalledTimes(1);
      expect(settled).toBeUndefined();

      send.resolve();

      await expect(pending).resolves.toEqual({ status: 'applied' });
    });

    it('rejects a second submit to the same record as busy while the first is pending', async () => {
      const send = deferred();
      sendMessageToSession.mockReturnValueOnce(send.promise);

      const first = service.dispatch(TAB, CONTENT);
      await flush();
      // Routed by the other key of the same record: still the same session.
      const second = await service.dispatch(REAL, 'other values');

      expect(second).toMatchObject({ status: 'rejected', reason: 'busy' });
      expect(sendMessageToSession).toHaveBeenCalledTimes(1);

      send.resolve();
      await expect(first).resolves.toEqual({ status: 'applied' });
    });

    it('releases the pending guard once the send settles', async () => {
      const send = deferred();
      sendMessageToSession.mockReturnValueOnce(send.promise);

      const first = service.dispatch(TAB, CONTENT);
      send.reject(new SessionAdmissionRefusedError('busy', TAB));
      await first;

      await expect(service.dispatch(TAB, CONTENT)).resolves.toEqual({
        status: 'applied',
      });
      expect(sendMessageToSession).toHaveBeenCalledTimes(2);
    });
  });

  describe('typed admission refusal', () => {
    it('maps a busy refusal to rejected busy', async () => {
      sendMessageToSession.mockRejectedValueOnce(
        new SessionAdmissionRefusedError('busy', TAB),
      );

      const outcome = await service.dispatch(TAB, CONTENT);

      expect(outcome).toMatchObject({ status: 'rejected', reason: 'busy' });
      expect(sendMessageToSession).toHaveBeenCalledTimes(1);
    });

    it('maps a session-ended refusal to rejected session-unavailable', async () => {
      sendMessageToSession.mockRejectedValueOnce(
        new SessionAdmissionRefusedError('session-ended', TAB),
      );

      const outcome = await service.dispatch(TAB, CONTENT);

      expect(outcome).toMatchObject({
        status: 'rejected',
        reason: 'session-unavailable',
      });
      expect(sendMessageToSession).toHaveBeenCalledTimes(1);
    });
  });

  describe('indeterminate outcome, never resent', () => {
    // Batch 3 review carry-over. `createUserMessage` runs after the pump's
    // fail-fast admission check and before the push, so a failure there
    // rejects `sendMessageToSession` with an untyped error while nothing was
    // pushed. The service still reports `indeterminate`: an untyped error does
    // not say whether a push happened, and in general the host cannot tell,
    // so the only safe answer is "may have been sent, do not resend".
    it('classifies an untyped rejection after the admission pre-check as indeterminate and does not resend', async () => {
      sendMessageToSession.mockRejectedValueOnce(
        new Error('createUserMessage failed: attachment unreadable'),
      );

      const outcome = await service.dispatch(TAB, CONTENT);
      await flush();

      expect(outcome).toEqual({
        status: 'indeterminate',
        detail: SURFACE_SUBMIT_INDETERMINATE_DETAIL,
      });
      expect(sendMessageToSession).toHaveBeenCalledTimes(1);
    });

    it('classifies a non-admission SdkError as indeterminate', async () => {
      sendMessageToSession.mockRejectedValueOnce(
        new SdkError('Session not found: tab-1'),
      );

      const outcome = await service.dispatch(TAB, CONTENT);

      expect(outcome.status).toBe('indeterminate');
      expect(sendMessageToSession).toHaveBeenCalledTimes(1);
    });

    it('classifies a non-Error throw as indeterminate', async () => {
      sendMessageToSession.mockRejectedValueOnce('boom');

      const outcome = await service.dispatch(TAB, CONTENT);

      expect(outcome.status).toBe('indeterminate');
      expect(sendMessageToSession).toHaveBeenCalledTimes(1);
    });

    it('keeps the raw error text in the host log, not in the outcome', async () => {
      sendMessageToSession.mockRejectedValueOnce(
        new Error('secret internal path C:/users/x'),
      );

      const outcome = await service.dispatch(TAB, CONTENT);

      expect(JSON.stringify(outcome)).not.toContain('secret internal path');
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('indeterminate'),
        expect.objectContaining({
          error: 'secret internal path C:/users/x',
        }),
      );
    });
  });
});

/**
 * Revision 1 (Batch 5 logic review, findings 1-2): `dispatch` resolves an
 * outcome on every path. A collaborator or diagnostic that throws can neither
 * reject the promise nor change an outcome that is already decided.
 */
describe('SurfaceSubmitTurnService — outcome boundary', () => {
  interface Harness {
    readonly service: SurfaceSubmitTurnService;
    readonly send: jest.Mock;
    readonly logger: jest.Mocked<Logger>;
  }

  function build(
    overrides: {
      find?: (id: string) => unknown;
      isSessionActive?: () => boolean;
      isStreaming?: (id: string) => boolean;
      logger?: jest.Mocked<Logger>;
    } = {},
  ): Harness {
    const liveRecord: FakeRecord = {
      tabId: TAB,
      realSessionId: REAL,
      turnInFlight: false,
      messageQueue: [],
    };
    const send = jest.fn().mockResolvedValue(undefined);
    const logger =
      overrides.logger ??
      ({
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      } as unknown as jest.Mocked<Logger>);
    const adapter = {
      isSessionActive: jest.fn(overrides.isSessionActive ?? (() => true)),
      sendMessageToSession: send,
    } as unknown as IAgentAdapter;
    const lifecycle = {
      find: jest.fn(overrides.find ?? (() => liveRecord)),
    } as unknown as SessionLifecycleManager;
    const broadcaster = {
      isStreaming: jest.fn(overrides.isStreaming ?? ((id) => id === TAB)),
    } as unknown as ChatStreamBroadcaster;
    return {
      service: new SurfaceSubmitTurnService(
        logger,
        adapter,
        lifecycle,
        broadcaster,
      ),
      send,
      logger,
    };
  }

  function throwingLogger(): jest.Mocked<Logger> {
    const fail = jest.fn(() => {
      throw new Error('logger down');
    });
    return {
      debug: fail,
      info: fail,
      warn: fail,
      error: fail,
    } as unknown as jest.Mocked<Logger>;
  }

  // Nothing is sent before the preflight passes, so a preflight throw has a
  // KNOWN outcome: no turn. It is `session-unavailable` (the host could not
  // establish a live session to send to), never `indeterminate`.
  const PREFLIGHT_FAILED = {
    status: 'rejected',
    reason: 'session-unavailable',
    detail: 'The chat session for this surface could not be checked.',
  };

  it('resolves session-unavailable with no send when lifecycle.find throws', async () => {
    const { service, send } = build({
      find: () => {
        throw new Error('registry corrupted');
      },
    });

    await expect(service.dispatch(TAB, CONTENT)).resolves.toEqual(
      PREFLIGHT_FAILED,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('resolves session-unavailable with no send when isSessionActive throws', async () => {
    const { service, send } = build({
      isSessionActive: () => {
        throw new Error('adapter not initialized');
      },
    });

    await expect(service.dispatch(TAB, CONTENT)).resolves.toEqual(
      PREFLIGHT_FAILED,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('resolves session-unavailable with no send when isStreaming throws', async () => {
    const { service, send } = build({
      isStreaming: () => {
        throw new Error('broadcaster disposed');
      },
    });

    await expect(service.dispatch(TAB, CONTENT)).resolves.toEqual(
      PREFLIGHT_FAILED,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('does not leak the preflight error text into the outcome', async () => {
    const { service, logger } = build({
      find: () => {
        throw new Error('secret registry detail');
      },
    });

    const outcome = await service.dispatch(TAB, CONTENT);

    expect(JSON.stringify(outcome)).not.toContain('secret registry detail');
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('preflight'),
      expect.objectContaining({ error: 'secret registry detail' }),
    );
  });

  it('still resolves the fixed outcome when the preflight throws and the logger throws too', async () => {
    const { service, send } = build({
      find: () => {
        throw new Error('registry corrupted');
      },
      logger: throwingLogger(),
    });

    await expect(service.dispatch(TAB, CONTENT)).resolves.toEqual(
      PREFLIGHT_FAILED,
    );
    expect(send).not.toHaveBeenCalled();
  });

  it('keeps applied when the logger throws after a successful send', async () => {
    const { service, send } = build({ logger: throwingLogger() });

    await expect(service.dispatch(TAB, CONTENT)).resolves.toEqual({
      status: 'applied',
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('keeps a typed refusal when the logger throws', async () => {
    const { service, send } = build({ logger: throwingLogger() });
    send.mockRejectedValueOnce(new SessionAdmissionRefusedError('busy', TAB));

    await expect(service.dispatch(TAB, CONTENT)).resolves.toMatchObject({
      status: 'rejected',
      reason: 'busy',
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('classifies a null-prototype rejection as the exact fixed indeterminate outcome, sent once', async () => {
    const { service, send, logger } = build();
    send.mockRejectedValueOnce(Object.create(null));

    await expect(service.dispatch(TAB, CONTENT)).resolves.toEqual({
      status: 'indeterminate',
      detail: SURFACE_SUBMIT_INDETERMINATE_DETAIL,
    });
    expect(send).toHaveBeenCalledTimes(1);
    // The host log falls back to a constant rather than throwing.
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('indeterminate'),
      expect.objectContaining({ error: '<unprintable thrown value>' }),
    );
  });

  it('classifies a rejection whose conversion throws as indeterminate, sent once', async () => {
    const { service, send } = build();
    send.mockRejectedValueOnce({
      toString() {
        throw new Error('no string for you');
      },
    });

    await expect(service.dispatch(TAB, CONTENT)).resolves.toEqual({
      status: 'indeterminate',
      detail: SURFACE_SUBMIT_INDETERMINATE_DETAIL,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('classifies a rejection whose instanceof check throws as indeterminate', async () => {
    const { service, send } = build();
    const hostile = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('prototype trap');
        },
      },
    );
    send.mockRejectedValueOnce(hostile);

    await expect(service.dispatch(TAB, CONTENT)).resolves.toEqual({
      status: 'indeterminate',
      detail: SURFACE_SUBMIT_INDETERMINATE_DETAIL,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('does not clear a pending call guard when a later call is rejected by the preflight', async () => {
    let findThrows = false;
    const liveRecord: FakeRecord = {
      tabId: TAB,
      realSessionId: REAL,
      turnInFlight: false,
      messageQueue: [],
    };
    const { service, send } = build({
      find: () => {
        if (findThrows) {
          throw new Error('registry corrupted');
        }
        return liveRecord;
      },
    });
    const pendingSend = deferred();
    send.mockReturnValueOnce(pendingSend.promise);

    const first = service.dispatch(TAB, CONTENT);
    await flush();
    findThrows = true;
    await expect(service.dispatch(TAB, CONTENT)).resolves.toEqual(
      PREFLIGHT_FAILED,
    );
    findThrows = false;

    // The first call's guard still holds: a third submit is busy.
    await expect(service.dispatch(TAB, CONTENT)).resolves.toMatchObject({
      status: 'rejected',
      reason: 'busy',
    });
    expect(send).toHaveBeenCalledTimes(1);

    pendingSend.resolve();
    await expect(first).resolves.toEqual({ status: 'applied' });
  });
});
