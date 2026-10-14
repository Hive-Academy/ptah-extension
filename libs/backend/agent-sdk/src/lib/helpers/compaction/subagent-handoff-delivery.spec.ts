import 'reflect-metadata';
import { RpcUserError, type Logger } from '@ptah-extension/vscode-core';
import { MainThreadNoticeQueue } from '../main-thread-notice-queue';
import {
  PARENT_PUSH_ATTEMPTS,
  PARENT_PUSH_RETRY_DELAY_MS,
  PENDING_HANDOFF_MAX_RETRIES,
  SubagentHandoffDelivery,
  undeliveredHandoffNotice,
  type Handoff,
} from './subagent-handoff-delivery';

const SESSION = 'session-1';
const TOOL_CALL = 'toolu_1';
const TEXT = 'handoff for task-1; Its task was: SECRET-PROMPT';
const NOTES = '/ws/.ptah/subagent-handoffs/session-1/toolu_1.md';
const HANDOFF: Handoff = {
  text: TEXT,
  subject: { agentType: 'Explore', taskId: 'task-1' },
  notesPath: NOTES,
};
const UNDELIVERED = undeliveredHandoffNotice(HANDOFF);
/** Total backoff of one send that fails every attempt. */
const ALL_RETRIES_MS = PARENT_PUSH_RETRY_DELAY_MS * PARENT_PUSH_ATTEMPTS;

function makeHarness() {
  const logger = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  const notices = new MainThreadNoticeQueue(logger as unknown as Logger);
  const port = {
    pushParentMessage: jest.fn(
      async (_sessionId: string, _text: string): Promise<void> => undefined,
    ),
    postMainThreadNotice: jest.fn(
      (sessionId: string, text: string, onDropped?: () => void) =>
        notices.post(sessionId, text, onDropped),
    ),
  };
  let live: string | undefined = SESSION;
  const delivery = new SubagentHandoffDelivery(
    logger as unknown as Logger,
    port,
    () => live,
  );
  return {
    delivery,
    logger,
    port,
    notices,
    release: () => (live = undefined),
    revive: () => (live = SESSION),
  };
}

/**
 * Every push rejects: the send queues its fallback, turn end clears it and
 * the drop-triggered send rejects as well, leaving a pending record.
 */
async function keepPendingRecord(
  h: ReturnType<typeof makeHarness>,
): Promise<void> {
  h.port.pushParentMessage.mockRejectedValue(new Error('inactive'));
  const sent = h.delivery.send(SESSION, TOOL_CALL, HANDOFF);
  await jest.advanceTimersByTimeAsync(ALL_RETRIES_MS);
  await sent;
  h.notices.clear(SESSION);
  await jest.advanceTimersByTimeAsync(ALL_RETRIES_MS);
}

describe('SubagentHandoffDelivery', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('send: a push that rejects once is retried after the backoff and sent once', async () => {
    const h = makeHarness();
    h.port.pushParentMessage.mockRejectedValueOnce(new Error('inactive'));

    const sent = h.delivery.send(SESSION, TOOL_CALL, HANDOFF);
    expect(h.port.pushParentMessage).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(PARENT_PUSH_RETRY_DELAY_MS - 1);
    expect(h.port.pushParentMessage).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    await sent;

    expect(h.port.pushParentMessage).toHaveBeenCalledTimes(2);
    expect(h.port.postMainThreadNotice).not.toHaveBeenCalled();
    expect(h.logger.warn).not.toHaveBeenCalled();
  });

  it('send: every push rejects, so the handoff waits in the notice queue; one warn without its text', async () => {
    const h = makeHarness();
    h.port.pushParentMessage.mockRejectedValue(new Error('inactive'));

    const sent = h.delivery.send(SESSION, TOOL_CALL, HANDOFF);
    await jest.advanceTimersByTimeAsync(ALL_RETRIES_MS);
    await sent;

    expect(h.port.pushParentMessage).toHaveBeenCalledTimes(
      PARENT_PUSH_ATTEMPTS,
    );
    expect(h.logger.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(h.logger.warn.mock.calls[0])).not.toContain(TEXT);
    expect(h.notices.take(SESSION)).toBe(TEXT);
  });

  it('send: a fallback notice the queue drops (turn end) gets one last send, then no more', async () => {
    const h = makeHarness();
    h.port.pushParentMessage.mockRejectedValue(new Error('inactive'));
    const sent = h.delivery.send(SESSION, TOOL_CALL, HANDOFF);
    await jest.advanceTimersByTimeAsync(ALL_RETRIES_MS);
    await sent;
    h.port.pushParentMessage.mockClear();
    h.port.pushParentMessage.mockResolvedValue(undefined);

    h.notices.clear(SESSION);
    await jest.advanceTimersByTimeAsync(ALL_RETRIES_MS);

    expect(h.port.pushParentMessage).toHaveBeenCalledTimes(1);
    expect(h.port.pushParentMessage).toHaveBeenCalledWith(SESSION, TEXT);
    expect(h.port.postMainThreadNotice).toHaveBeenCalledTimes(1);
  });

  it('send: 3 rejects, fallback cleared at turn end, 3 rejects: kept pending, then delivered once on the next opportunity', async () => {
    const h = makeHarness();
    await keepPendingRecord(h);

    expect(h.port.pushParentMessage).toHaveBeenCalledTimes(
      PARENT_PUSH_ATTEMPTS * 2,
    );
    expect(h.port.postMainThreadNotice).toHaveBeenCalledTimes(1);
    expect(h.logger.warn).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(h.logger.warn.mock.calls)).not.toContain(TEXT);
    expect(h.notices.take(SESSION)).toBeUndefined();

    h.port.pushParentMessage.mockReset();
    h.port.pushParentMessage.mockResolvedValue(undefined);
    await h.delivery.retryPending(SESSION);
    await h.delivery.retryPending(SESSION);

    expect(h.port.pushParentMessage).toHaveBeenCalledTimes(1);
    expect(h.port.pushParentMessage).toHaveBeenCalledWith(SESSION, TEXT);
  });

  it('retryPending: concurrent opportunities push a pending record once', async () => {
    const h = makeHarness();
    await keepPendingRecord(h);
    h.port.pushParentMessage.mockReset();
    let finish: () => void = () => undefined;
    h.port.pushParentMessage.mockImplementation(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );

    const first = h.delivery.retryPending(SESSION);
    await h.delivery.retryPending(SESSION);
    finish();
    await first;
    await h.delivery.retryPending(SESSION);

    expect(h.port.pushParentMessage).toHaveBeenCalledTimes(1);
  });

  it('release: session end drops the pending record', async () => {
    const h = makeHarness();
    await keepPendingRecord(h);
    h.port.pushParentMessage.mockReset();

    h.release();
    h.delivery.release();
    h.revive();
    await h.delivery.retryPending(SESSION);

    expect(h.port.pushParentMessage).not.toHaveBeenCalled();
  });

  it('retryPending: a message during the drop-triggered send backoff is remembered and used right after it fails', async () => {
    const h = makeHarness();
    const inactive = new Error('inactive');
    for (let i = 0; i < PARENT_PUSH_ATTEMPTS * 2; i += 1) {
      h.port.pushParentMessage.mockRejectedValueOnce(inactive);
    }
    const sent = h.delivery.send(SESSION, TOOL_CALL, HANDOFF);
    await jest.advanceTimersByTimeAsync(ALL_RETRIES_MS);
    await sent;
    h.notices.clear(SESSION);
    await jest.advanceTimersByTimeAsync(0);
    expect(h.port.pushParentMessage).toHaveBeenCalledTimes(
      PARENT_PUSH_ATTEMPTS + 1,
    );

    // The parent's next message arrives inside the drop-triggered backoff.
    await h.delivery.retryPending(SESSION);
    expect(h.port.pushParentMessage).toHaveBeenCalledTimes(
      PARENT_PUSH_ATTEMPTS + 1,
    );
    await jest.advanceTimersByTimeAsync(ALL_RETRIES_MS);

    expect(h.port.pushParentMessage).toHaveBeenCalledTimes(
      PARENT_PUSH_ATTEMPTS * 2 + 1,
    );
    expect(h.port.pushParentMessage).toHaveBeenLastCalledWith(SESSION, TEXT);
    await h.delivery.retryPending(SESSION);
    expect(h.port.pushParentMessage).toHaveBeenCalledTimes(
      PARENT_PUSH_ATTEMPTS * 2 + 1,
    );
    expect(h.notices.take(SESSION)).toBeUndefined();
  });

  it('retryPending: a remembered retry that fails too keeps the record for a later message', async () => {
    const h = makeHarness();
    h.port.pushParentMessage.mockRejectedValue(new Error('inactive'));
    const sent = h.delivery.send(SESSION, TOOL_CALL, HANDOFF);
    await jest.advanceTimersByTimeAsync(ALL_RETRIES_MS);
    await sent;
    h.notices.clear(SESSION);
    await jest.advanceTimersByTimeAsync(0);
    await h.delivery.retryPending(SESSION);
    await jest.advanceTimersByTimeAsync(ALL_RETRIES_MS);
    expect(h.port.pushParentMessage).toHaveBeenCalledTimes(
      PARENT_PUSH_ATTEMPTS * 2 + 1,
    );

    h.port.pushParentMessage.mockReset();
    h.port.pushParentMessage.mockResolvedValue(undefined);
    await h.delivery.retryPending(SESSION);
    await h.delivery.retryPending(SESSION);

    expect(h.port.pushParentMessage).toHaveBeenCalledTimes(1);
    expect(h.port.pushParentMessage).toHaveBeenCalledWith(SESSION, TEXT);
  });

  it('retryPending: at the retry cap the undelivered notice is queued once and the record dropped', async () => {
    const h = makeHarness();
    await keepPendingRecord(h);
    h.port.pushParentMessage.mockClear();
    h.port.postMainThreadNotice.mockClear();
    h.logger.warn.mockClear();

    for (let i = 0; i < PENDING_HANDOFF_MAX_RETRIES; i += 1) {
      await h.delivery.retryPending(SESSION);
    }
    expect(h.port.pushParentMessage).toHaveBeenCalledTimes(
      PENDING_HANDOFF_MAX_RETRIES,
    );
    expect(h.port.postMainThreadNotice).toHaveBeenCalledTimes(1);
    expect(h.logger.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(h.logger.warn.mock.calls[0])).not.toContain(TEXT);

    // Later opportunities neither push nor post the notice again.
    await h.delivery.retryPending(SESSION);
    await h.delivery.retryPending(SESSION);
    expect(h.port.pushParentMessage).toHaveBeenCalledTimes(
      PENDING_HANDOFF_MAX_RETRIES,
    );
    expect(h.port.postMainThreadNotice).toHaveBeenCalledTimes(1);
    expect(h.notices.take(SESSION)).toBe(UNDELIVERED);
    expect(h.logger.warn).toHaveBeenCalledTimes(1);
  });

  it('retryPending: an undelivered notice the queue drops comes back on the next message, never pushed', async () => {
    const h = makeHarness();
    await keepPendingRecord(h);
    for (let i = 0; i < PENDING_HANDOFF_MAX_RETRIES; i += 1) {
      await h.delivery.retryPending(SESSION);
    }
    h.port.pushParentMessage.mockClear();
    h.port.postMainThreadNotice.mockClear();

    h.notices.clear(SESSION);
    expect(h.port.postMainThreadNotice).not.toHaveBeenCalled();
    await h.delivery.retryPending(SESSION);
    await h.delivery.retryPending(SESSION);

    expect(h.port.pushParentMessage).not.toHaveBeenCalled();
    expect(h.port.postMainThreadNotice).toHaveBeenCalledTimes(1);
    expect(h.notices.take(SESSION)).toBe(UNDELIVERED);
    expect(JSON.stringify(h.logger.warn.mock.calls)).not.toContain(TEXT);
  });

  it('release: an undelivered notice dropped at session end is not kept', async () => {
    const h = makeHarness();
    await keepPendingRecord(h);
    for (let i = 0; i < PENDING_HANDOFF_MAX_RETRIES; i += 1) {
      await h.delivery.retryPending(SESSION);
    }
    h.port.postMainThreadNotice.mockClear();

    h.release();
    h.notices.clear(SESSION);
    h.delivery.release();
    h.revive();
    await h.delivery.retryPending(SESSION);

    expect(h.port.postMainThreadNotice).not.toHaveBeenCalled();
  });

  it('undeliveredHandoffNotice: names the notes and output file, never the task text', () => {
    expect(UNDELIVERED).toContain('could not be delivered');
    expect(UNDELIVERED).toContain(NOTES);
    expect(UNDELIVERED).toContain('task notification for task task-1');
    expect(UNDELIVERED).not.toContain('SECRET-PROMPT');
    const withOutput = undeliveredHandoffNotice({
      ...HANDOFF,
      subject: {
        ...HANDOFF.subject,
        teammateName: 'scout',
        outputFile: '/tmp/task-1.output',
      },
      notesPath: undefined,
    });
    expect(withOutput).toContain("`Explore` ('scout')");
    expect(withOutput).toContain('/tmp/task-1.output (task task-1)');
    expect(withOutput).toContain('unavailable (workspace unknown)');
  });

  it('send: a timed-out push counts as delivered: not retried, queued or kept pending', async () => {
    const h = makeHarness();
    h.port.pushParentMessage.mockRejectedValueOnce(
      new RpcUserError('not read in 10s', 'SEND_TIMEOUT'),
    );

    const sent = h.delivery.send(SESSION, TOOL_CALL, HANDOFF);
    await jest.advanceTimersByTimeAsync(ALL_RETRIES_MS);
    await sent;
    await h.delivery.retryPending(SESSION);

    expect(h.port.pushParentMessage).toHaveBeenCalledTimes(1);
    expect(h.port.postMainThreadNotice).not.toHaveBeenCalled();
    expect(h.logger.warn).toHaveBeenCalledTimes(1);
  });

  it('retryPending: a timed-out retry counts as delivered and drops the record', async () => {
    const h = makeHarness();
    await keepPendingRecord(h);
    h.port.pushParentMessage.mockReset();
    h.port.pushParentMessage.mockRejectedValueOnce(
      new RpcUserError('not read in 10s', 'SEND_TIMEOUT'),
    );

    await h.delivery.retryPending(SESSION);
    await h.delivery.retryPending(SESSION);

    expect(h.port.pushParentMessage).toHaveBeenCalledTimes(1);
  });

  it('send: a session released between attempts gets no further push or notice', async () => {
    const h = makeHarness();
    h.port.pushParentMessage.mockRejectedValue(new Error('inactive'));

    const sent = h.delivery.send(SESSION, TOOL_CALL, HANDOFF);
    h.release();
    await jest.advanceTimersByTimeAsync(ALL_RETRIES_MS);
    await sent;

    expect(h.port.pushParentMessage).toHaveBeenCalledTimes(1);
    expect(h.port.postMainThreadNotice).not.toHaveBeenCalled();
  });

  it('post: a notice drained by take is never sent again', async () => {
    const h = makeHarness();
    h.delivery.post(SESSION, TOOL_CALL, HANDOFF);

    expect(h.notices.take(SESSION)).toBe(TEXT);
    h.notices.clear(SESSION);
    await jest.advanceTimersByTimeAsync(ALL_RETRIES_MS);

    expect(h.port.pushParentMessage).not.toHaveBeenCalled();
  });

  it('post: a notice evicted past the queue bound is sent as a user turn', async () => {
    const h = makeHarness();
    h.delivery.post(SESSION, TOOL_CALL, HANDOFF);
    for (let i = 0; i < 4; i += 1) {
      h.notices.post(SESSION, `other ${i}`);
    }
    await jest.advanceTimersByTimeAsync(0);

    expect(h.port.pushParentMessage).toHaveBeenCalledTimes(1);
    expect(h.port.pushParentMessage).toHaveBeenCalledWith(SESSION, TEXT);
    expect(h.notices.take(SESSION)).not.toContain(TEXT);
  });
});
