import type { SDKUserMessage } from '../types/sdk-types/claude-sdk.types';
import { createNamedAccountPromptGate } from './named-account-prompt-gate';

function message(content: string): SDKUserMessage {
  return {
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
  };
}

const done = { done: true, value: undefined };

describe('createNamedAccountPromptGate', () => {
  it('starts empty and yields no held input before explicit commit', async () => {
    const gate = createNamedAccountPromptGate();
    const reader = gate.prompt[Symbol.asyncIterator]();
    const settled = jest.fn();
    const pending = reader.next().then(settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    const input = message('initial');
    expect(gate.push(input)).toBe(true);
    await Promise.resolve();
    expect(gate.state).toBe('held');
    expect(settled).not.toHaveBeenCalled();
    expect(gate.commit()).toBe(true);
    expect(gate.state).toBe('committed');
    await pending;
    expect(settled).toHaveBeenCalledTimes(1);
    expect(settled).toHaveBeenCalledWith({ done: false, value: input });
    gate.close();
    await expect(reader.next()).resolves.toEqual(done);
    expect(gate.state).toBe('closed');
  });

  it('releases pre-commit input in FIFO order exactly once across readers', async () => {
    const gate = createNamedAccountPromptGate();
    const first = message('first');
    const second = message('second');
    gate.push(first);
    gate.push(second);
    const reader = gate.prompt[Symbol.asyncIterator]();
    const reads = [reader.next(), reader.next(), reader.next()];
    gate.commit();
    await expect(Promise.all(reads.slice(0, 2))).resolves.toEqual([
      { done: false, value: first },
      { done: false, value: second },
    ]);
    gate.close();
    await expect(reads[2]).resolves.toEqual(done);
  });

  it('an empty commit keeps readers waiting and cannot preapprove later input', async () => {
    const gate = createNamedAccountPromptGate();
    const settled = jest.fn();
    const pending = gate.prompt[Symbol.asyncIterator]().next().then(settled);
    expect(gate.commit()).toBe(true);
    expect(gate.commit()).toBe(false);
    expect(gate.push(message('later'))).toBe(true);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    gate.commit();
    await pending;
    expect(settled).toHaveBeenCalledWith({ done: false, value: message('later') });
    gate.close();
  });

  it.each(['close', 'reject', 'abort'] as const)(
    '%s before reading drops held input and refuses late commit',
    async (action) => {
      const controller = new AbortController();
      const gate = createNamedAccountPromptGate(controller.signal);
      gate.push(message('held'));
      if (action === 'abort') controller.abort();
      else gate[action]();
      expect(gate.state).toBe('closed');
      expect(gate.commit()).toBe(false);
      expect(gate.push(message('late'))).toBe(false);
      await expect(gate.prompt[Symbol.asyncIterator]().next()).resolves.toEqual(done);
    },
  );

  it.each(['close', 'reject', 'abort'] as const)(
    '%s wakes every waiting reader exactly once without draining input',
    async (action) => {
      const controller = new AbortController();
      const gate = createNamedAccountPromptGate(controller.signal);
      gate.push(message('held'));
      const reader = gate.prompt[Symbol.asyncIterator]();
      const settled = jest.fn();
      const pending = [reader.next().then(settled), reader.next().then(settled)];
      await Promise.resolve();
      expect(settled).not.toHaveBeenCalled();
      if (action === 'abort') controller.abort();
      else gate[action]();
      gate.close();
      gate.reject();
      controller.abort();
      expect(gate.commit()).toBe(false);
      await Promise.all(pending);
      expect(settled).toHaveBeenCalledTimes(2);
      expect(settled).toHaveBeenNthCalledWith(1, done);
      expect(settled).toHaveBeenNthCalledWith(2, done);
      await expect(reader.next()).resolves.toEqual(done);
    },
  );

  it('starts closed when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const gate = createNamedAccountPromptGate(controller.signal);
    expect(gate.push(message('held'))).toBe(false);
    expect(gate.commit()).toBe(false);
    await expect(gate.prompt[Symbol.asyncIterator]().next()).resolves.toEqual(done);
  });

  it.each(['close', 'reject', 'abort'] as const)(
    '%s after commit drops all remaining queued content',
    async (action) => {
      const controller = new AbortController();
      const gate = createNamedAccountPromptGate(controller.signal);
      gate.push(message('delivered'));
      gate.push(message('discarded'));
      gate.commit();
      const reader = gate.prompt[Symbol.asyncIterator]();
      await expect(reader.next()).resolves.toEqual({
        done: false, value: message('delivered'),
      });
      if (action === 'abort') controller.abort();
      else gate[action]();
      await expect(reader.next()).resolves.toEqual(done);
      expect(gate.commit()).toBe(false);
    },
  );

  it('close wins over a commit whose waiting readers have not resumed', async () => {
    const gate = createNamedAccountPromptGate();
    gate.push(message('held'));
    const pending = gate.prompt[Symbol.asyncIterator]().next();
    gate.commit();
    gate.close();
    await expect(pending).resolves.toEqual(done);
  });

  it('keeps one iterator open and requires a fresh commit for each turn', async () => {
    const gate = createNamedAccountPromptGate();
    const reader = gate.prompt[Symbol.asyncIterator]();
    gate.push(message('initial'));
    gate.commit();
    await expect(reader.next()).resolves.toEqual({ done: false, value: message('initial') });
    const settled = jest.fn();
    const pending = reader.next().then(settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    expect(gate.push(message('follow-up'))).toBe(true);
    expect(gate.state).toBe('held');
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    expect(gate.commit()).toBe(true);
    await pending;
    expect(settled).toHaveBeenCalledWith({ done: false, value: message('follow-up') });
    const end = reader.next();
    gate.close();
    await expect(end).resolves.toEqual(done);
  });

  it('does not mix later held input into an undrained committed batch', async () => {
    const gate = createNamedAccountPromptGate();
    const reader = gate.prompt[Symbol.asyncIterator]();
    gate.push(message('initial'));
    gate.commit();
    gate.push(message('unapproved'));
    await expect(reader.next()).resolves.toEqual({ done: false, value: message('initial') });
    const settled = jest.fn();
    const pending = reader.next().then(settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    gate.close();
    await pending;
    expect(settled).toHaveBeenCalledWith(done);
    await expect(reader.next()).resolves.toEqual(done);
  });

  it('abort during the wait after a committed turn ends without another yield', async () => {
    const controller = new AbortController();
    const gate = createNamedAccountPromptGate(controller.signal);
    const reader = gate.prompt[Symbol.asyncIterator]();
    gate.push(message('initial'));
    gate.commit();
    await reader.next();
    const pending = reader.next();
    gate.push(message('unapproved'));
    controller.abort();
    await expect(pending).resolves.toEqual(done);
    expect(gate.commit()).toBe(false);
  });

  it('iterator return wakes pending readers and removes the abort listener', async () => {
    const controller = new AbortController();
    const remove = jest.spyOn(controller.signal, 'removeEventListener');
    const gate = createNamedAccountPromptGate(controller.signal);
    const reader = gate.prompt[Symbol.asyncIterator]();
    gate.push(message('held'));
    const pending = reader.next();
    expect(reader.return).toBeDefined();
    await expect(reader.return?.()).resolves.toEqual(done);
    await expect(pending).resolves.toEqual(done);
    gate.close();
    controller.abort();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(gate.commit()).toBe(false);
    remove.mockRestore();
  });

  it('waiting after commit retains the abort listener until close', async () => {
    const controller = new AbortController();
    const remove = jest.spyOn(controller.signal, 'removeEventListener');
    const gate = createNamedAccountPromptGate(controller.signal);
    gate.commit();
    const pending = gate.prompt[Symbol.asyncIterator]().next();
    expect(remove).not.toHaveBeenCalled();
    gate.close();
    await expect(pending).resolves.toEqual(done);
    expect(remove).toHaveBeenCalledTimes(1);
    remove.mockRestore();
  });
});
