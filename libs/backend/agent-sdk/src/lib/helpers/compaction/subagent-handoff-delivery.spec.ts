import 'reflect-metadata';
import { RpcUserError, type Logger } from '@ptah-extension/vscode-core';
import { MainThreadNoticeQueue } from '../main-thread-notice-queue';
import {
  PARENT_PUSH_ATTEMPTS,
  PARENT_PUSH_RETRY_DELAY_MS,
  SubagentHandoffDelivery,
  type Handoff,
} from './subagent-handoff-delivery';

const SESSION = 'session-1';
const TOOL_CALL = 'toolu_1';
const TEXT = 'handoff for task-1; Its task was: SECRET-PROMPT';
const RECORD = '/ws/.ptah/subagent-handoffs/record.handoff.md';
const HANDOFF: Handoff = {
  text: TEXT,
  subject: { agentType: 'Explore', taskId: 'task-1' },
  recordPath: RECORD,
};
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
  };
}

describe('SubagentHandoffDelivery', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('send: a push that succeeds is sent once, with no notice', async () => {
    const h = makeHarness();

    await h.delivery.send(SESSION, TOOL_CALL, HANDOFF);

    expect(h.port.pushParentMessage).toHaveBeenCalledTimes(1);
    expect(h.port.pushParentMessage).toHaveBeenCalledWith(SESSION, TEXT);
    expect(h.port.postMainThreadNotice).not.toHaveBeenCalled();
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

  it('send: a fallback notice the queue drops is not sent again (the record stays pending)', async () => {
    const h = makeHarness();
    h.port.pushParentMessage.mockRejectedValue(new Error('inactive'));
    const sent = h.delivery.send(SESSION, TOOL_CALL, HANDOFF);
    await jest.advanceTimersByTimeAsync(ALL_RETRIES_MS);
    await sent;
    h.port.pushParentMessage.mockClear();

    h.notices.clear(SESSION);
    await jest.advanceTimersByTimeAsync(ALL_RETRIES_MS);

    expect(h.port.pushParentMessage).not.toHaveBeenCalled();
    expect(h.port.postMainThreadNotice).toHaveBeenCalledTimes(1);
    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('the record stays pending'),
      expect.objectContaining({ toolCallId: TOOL_CALL, errorType: 'Error' }),
    );
  });

  it('send: without a record the warn says there is no durable record', async () => {
    const h = makeHarness();
    h.port.pushParentMessage.mockRejectedValue(new Error('inactive'));
    const sent = h.delivery.send(SESSION, TOOL_CALL, {
      text: TEXT,
      subject: HANDOFF.subject,
    });
    await jest.advanceTimersByTimeAsync(ALL_RETRIES_MS);
    await sent;

    expect(h.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('no durable record'),
      expect.anything(),
    );
  });

  it('send: a timed-out push counts as delivered: not retried or queued', async () => {
    const h = makeHarness();
    h.port.pushParentMessage.mockRejectedValueOnce(
      new RpcUserError('not read in 10s', 'SEND_TIMEOUT'),
    );

    const sent = h.delivery.send(SESSION, TOOL_CALL, HANDOFF);
    await jest.advanceTimersByTimeAsync(ALL_RETRIES_MS);
    await sent;

    expect(h.port.pushParentMessage).toHaveBeenCalledTimes(1);
    expect(h.port.postMainThreadNotice).not.toHaveBeenCalled();
    expect(h.logger.warn).toHaveBeenCalledTimes(1);
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
