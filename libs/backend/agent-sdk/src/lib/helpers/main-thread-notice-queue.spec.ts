import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import {
  MAX_NOTICE_CHARS,
  MAX_PENDING_NOTICES_PER_SESSION,
  MainThreadNoticeQueue,
} from './main-thread-notice-queue';

function makeLogger(): jest.Mocked<Logger> {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as jest.Mocked<Logger>;
}

describe('MainThreadNoticeQueue', () => {
  it('returns undefined when nothing is pending', () => {
    const queue = new MainThreadNoticeQueue(makeLogger());
    expect(queue.take('sess-1')).toBeUndefined();
  });

  it('take returns pending notices joined oldest first, exactly once', () => {
    const queue = new MainThreadNoticeQueue(makeLogger());
    queue.post('sess-1', 'first');
    queue.post('sess-1', 'second');

    expect(queue.take('sess-1')).toBe('first\n\nsecond');
    expect(queue.take('sess-1')).toBeUndefined();
  });

  it('keeps sessions apart', () => {
    const queue = new MainThreadNoticeQueue(makeLogger());
    queue.post('sess-1', 'for one');
    queue.post('sess-2', 'for two');

    expect(queue.take('sess-2')).toBe('for two');
    expect(queue.take('sess-1')).toBe('for one');
  });

  it('drops the oldest notice past the per-session bound, with one debug line per drop', () => {
    const logger = makeLogger();
    const queue = new MainThreadNoticeQueue(logger);
    for (let i = 1; i <= MAX_PENDING_NOTICES_PER_SESSION + 1; i++) {
      queue.post('sess-1', `n${i}`);
    }

    expect(logger.debug).toHaveBeenCalledTimes(1);
    expect(queue.take('sess-1')).toBe('n2\n\nn3\n\nn4\n\nn5');
  });

  it('withdraw removes one pending notice and reports whether it was pending', () => {
    const queue = new MainThreadNoticeQueue(makeLogger());
    queue.post('sess-1', 'keep');
    queue.post('sess-1', 'handoff');

    expect(queue.withdraw('sess-1', 'handoff')).toBe(true);
    expect(queue.withdraw('sess-1', 'handoff')).toBe(false);
    expect(queue.withdraw('sess-2', 'keep')).toBe(false);
    expect(queue.take('sess-1')).toBe('keep');
  });

  it('withdraw matches a capped notice by its full text and frees the session entry', () => {
    const queue = new MainThreadNoticeQueue(makeLogger());
    const long = 'x'.repeat(MAX_NOTICE_CHARS + 10);
    queue.post('sess-1', long);

    expect(queue.withdraw('sess-1', long)).toBe(true);
    expect(queue.take('sess-1')).toBeUndefined();
  });

  it('caps each notice at the character limit', () => {
    const queue = new MainThreadNoticeQueue(makeLogger());
    queue.post('sess-1', 'x'.repeat(MAX_NOTICE_CHARS + 500));

    expect(queue.take('sess-1')).toHaveLength(MAX_NOTICE_CHARS);
  });

  it('never ends a capped notice on half of a surrogate pair', () => {
    const queue = new MainThreadNoticeQueue(makeLogger());
    // The emoji starts at the last allowed code unit, so a plain slice would
    // keep only its high surrogate.
    queue.post('sess-1', 'a'.repeat(MAX_NOTICE_CHARS - 1) + '\u{1F600}tail');

    const taken = queue.take('sess-1') ?? '';
    expect(taken).toBe('a'.repeat(MAX_NOTICE_CHARS - 1));
  });

  it('ignores a blank session id or blank text', () => {
    const queue = new MainThreadNoticeQueue(makeLogger());
    queue.post('', 'text');
    queue.post('sess-1', '   ');

    expect(queue.take('')).toBeUndefined();
    expect(queue.take('sess-1')).toBeUndefined();
  });

  it('clear drops pending notices for that session only', () => {
    const queue = new MainThreadNoticeQueue(makeLogger());
    queue.post('sess-1', 'gone');
    queue.post('sess-2', 'kept');

    queue.clear('sess-1');
    queue.clear('never-posted');

    expect(queue.take('sess-1')).toBeUndefined();
    expect(queue.take('sess-2')).toBe('kept');
  });

  it('a session can receive notices again after take or clear', () => {
    const queue = new MainThreadNoticeQueue(makeLogger());
    queue.post('sess-1', 'one');
    queue.take('sess-1');
    queue.post('sess-1', 'two');
    expect(queue.take('sess-1')).toBe('two');

    queue.post('sess-1', 'three');
    queue.clear('sess-1');
    queue.post('sess-1', 'four');
    expect(queue.take('sess-1')).toBe('four');
  });
});
