import 'reflect-metadata';
import { Logger } from '@ptah-extension/vscode-core';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { CodexChatAdapterError } from './codex-chat-adapter-error';
import { CodexChatPeerQueue } from './codex-chat-peer-queue';
import { SessionAdmissionRefusedError } from '../errors/session-admission-refused.error';

function setup() {
  const logger: Logger = Object.assign(Object.create(Logger.prototype), createMockLogger());
  const session = { busy: false, blocked: false, abort: new AbortController() };
  return { queue: new CodexChatPeerQueue(logger), session };
}

describe('CodexChatPeerQueue', () => {
  it('refuses a reserved require-idle peer when the session ends before admission', async () => {
    const { queue, session } = setup();
    const run = jest.fn(async () => undefined);
    const send = queue.send(session, run, 'session-1');
    session.abort.abort();
    queue.rejectPending(session);
    await expect(send).rejects.toBeInstanceOf(SessionAdmissionRefusedError);
    await expect(send).rejects.toMatchObject({ reason: 'session-ended' });
    await Promise.resolve();
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses a require-idle peer when another turn wins the start race', async () => {
    const { queue, session } = setup();
    const send = queue.send(session, async () => {
      throw new CodexChatAdapterError('busy', 'turn');
    }, 'session-1');
    session.busy = true;
    await expect(send).rejects.toBeInstanceOf(SessionAdmissionRefusedError);
    await expect(send).rejects.toMatchObject({ reason: 'busy' });
    expect(queue.hasPending(session)).toBe(true);
    session.busy = false;
    queue.onIdle(session);
    expect(queue.hasPending(session)).toBe(false);
  });

  it('keeps a peer at the head when another turn wins the start race', async () => {
    const { queue, session } = setup();
    const started: string[] = [];
    let headAttempts = 0;
    const head = queue.send(session, async () => {
      started.push('head');
      headAttempts++;
      if (session.busy) throw new CodexChatAdapterError('busy', 'turn');
      session.busy = true;
    });
    const tail = queue.send(session, async () => {
      started.push('tail');
      session.busy = true;
    });

    session.busy = true; // A non-queue turn claims the latch before head.run().
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(started).toEqual(['head']);
    expect(queue.hasPending(session)).toBe(true);

    session.busy = false;
    queue.onIdle(session);
    await head;
    expect(started).toEqual(['head', 'head']);
    expect(headAttempts).toBe(2);
    expect(session.busy).toBe(true);

    session.busy = false;
    queue.onIdle(session);
    await tail;
    expect(started).toEqual(['head', 'head', 'tail']);
    session.busy = false;
    queue.onIdle(session);
    expect(queue.hasPending(session)).toBe(false);
  });

  it('does not advance the next peer from a stale idle notification after a retry', async () => {
    const { queue, session } = setup();
    let attempts = 0;
    const started: string[] = [];
    const head = queue.send(session, async () => {
      attempts++;
      started.push('head');
      if (attempts === 1) {
        session.busy = false;
        queue.onIdle(session); // The competing turn releases before busy is reported.
        throw new CodexChatAdapterError('busy', 'turn');
      }
      session.busy = true;
    });
    const tail = queue.send(session, async () => {
      started.push('tail');
      session.busy = true;
    });
    session.busy = true;

    await head;
    expect(started).toEqual(['head', 'head']);
    expect(session.busy).toBe(true);
    session.busy = false;
    queue.onIdle(session);
    await tail;
    expect(started).toEqual(['head', 'head', 'tail']);
    session.busy = false;
    queue.onIdle(session);
  });

  it('preserves peers queued before and during a recoverable Stop', async () => {
    const { queue, session } = setup();
    const started: string[] = [];
    session.busy = true;
    const beforeStop = queue.send(session, async () => {
      started.push('before');
      session.busy = true;
    });
    session.blocked = true;
    const duringStop = queue.send(session, async () => {
      started.push('during');
      session.busy = true;
    });
    expect(started).toEqual([]);

    session.busy = false;
    session.blocked = false;
    queue.onIdle(session);
    await beforeStop;
    expect(started).toEqual(['before']);
    session.busy = false;
    queue.onIdle(session);
    await duringStop;
    expect(started).toEqual(['before', 'during']);
    session.busy = false;
    queue.onIdle(session);
    expect(queue.hasPending(session)).toBe(false);
  });
});
