import 'reflect-metadata';

import {
  MAX_SUBAGENT_NOTICE_CHARS,
  SubagentNoticeQueue,
} from './subagent-notice-queue';

describe('SubagentNoticeQueue', () => {
  it('returns a notice once, only for its own agent id', () => {
    const queue = new SubagentNoticeQueue();
    queue.post('agent-7', 'write your notes');

    expect(queue.take('agent-8')).toBeUndefined();
    expect(queue.take('agent-7')).toBe('write your notes');
    expect(queue.take('agent-7')).toBeUndefined();
  });

  it('keeps one pending notice per subagent, capped in length', () => {
    const queue = new SubagentNoticeQueue();
    queue.post('agent-7', 'first');
    queue.post('agent-7', 'x'.repeat(MAX_SUBAGENT_NOTICE_CHARS + 10));

    expect(queue.take('agent-7')).toBe('x'.repeat(MAX_SUBAGENT_NOTICE_CHARS));
  });

  it('ignores blank input and drops a withdrawn notice', () => {
    const queue = new SubagentNoticeQueue();
    queue.post('', 'no agent');
    queue.post('agent-7', '   ');
    expect(queue.take('')).toBeUndefined();
    expect(queue.take('agent-7')).toBeUndefined();

    queue.post('agent-7', 'moot');
    queue.withdraw('agent-7');
    expect(queue.take('agent-7')).toBeUndefined();
  });
});
