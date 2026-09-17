/**
 * `scheduleMacrotask` / `yieldToMacrotask` specs (TASK_2026_437 C15 / C18).
 *
 * jsdom has no `MessageChannel`, which is the fallback path. The macrotask
 * path is driven by a stand-in channel whose delivery the spec controls.
 */

import { scheduleMacrotask, yieldToMacrotask } from './macrotask-scheduler';

interface StubChannelState {
  created: number;
  closed: number;
  posted: Array<{ onmessage: (() => void) | null }>;
  postError: Error | null;
}

function installStubMessageChannel(): StubChannelState {
  const state: StubChannelState = {
    created: 0,
    closed: 0,
    posted: [],
    postError: null,
  };
  class StubMessageChannel {
    readonly port1 = {
      onmessage: null as (() => void) | null,
      close: () => {
        state.closed++;
      },
    };
    readonly port2 = {
      postMessage: () => {
        if (state.postError) throw state.postError;
        state.posted.push(this.port1);
      },
      close: () => {
        state.closed++;
      },
    };
    constructor() {
      state.created++;
    }
  }
  globalThis.MessageChannel =
    StubMessageChannel as unknown as typeof MessageChannel;
  return state;
}

function deliverNext(state: StubChannelState): void {
  const port1 = state.posted.shift();
  if (!port1) throw new Error('nothing posted');
  port1.onmessage?.();
}

describe('macrotask-scheduler', () => {
  const originalMessageChannel = globalThis.MessageChannel;

  afterEach(() => {
    globalThis.MessageChannel = originalMessageChannel;
  });

  describe('with MessageChannel', () => {
    let state: StubChannelState;

    beforeEach(() => {
      state = installStubMessageChannel();
    });

    it('runs the callback only when its channel message is delivered, then closes both ports', () => {
      const callback = jest.fn();

      scheduleMacrotask(callback);

      expect(callback).not.toHaveBeenCalled();
      expect(state.created).toBe(1);
      expect(state.posted).toHaveLength(1);

      deliverNext(state);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(state.closed).toBe(2);
    });

    it('uses one fresh channel per call, delivered in scheduling order', () => {
      const calls: number[] = [];
      scheduleMacrotask(() => calls.push(1));
      scheduleMacrotask(() => calls.push(2));

      expect(state.created).toBe(2);
      deliverNext(state);
      deliverNext(state);

      expect(calls).toEqual([1, 2]);
    });

    it('cancel() prevents the callback and releases the channel; cancelling twice is harmless', () => {
      const callback = jest.fn();
      const handle = scheduleMacrotask(callback);

      handle.cancel();
      handle.cancel();
      deliverNext(state);

      expect(callback).not.toHaveBeenCalled();
      expect(state.closed).toBe(2);
    });

    it('cancel() after the callback ran does nothing', () => {
      const callback = jest.fn();
      const handle = scheduleMacrotask(callback);
      deliverNext(state);

      handle.cancel();

      expect(callback).toHaveBeenCalledTimes(1);
      expect(state.closed).toBe(2);
    });

    it('rethrows a failed post after closing the channel, and never runs the callback', () => {
      const failure = new Error('post failed');
      state.postError = failure;
      const callback = jest.fn();

      expect(() => scheduleMacrotask(callback)).toThrow(failure);

      expect(state.closed).toBe(2);
      expect(callback).not.toHaveBeenCalled();
    });

    it('yieldToMacrotask resolves only after the channel message is delivered', async () => {
      let resolved = false;
      const pending = yieldToMacrotask().then(() => {
        resolved = true;
      });

      await Promise.resolve();
      await Promise.resolve();
      expect(resolved).toBe(false);

      deliverNext(state);
      await pending;

      expect(resolved).toBe(true);
    });

    it('yieldToMacrotask rejects when the post fails', async () => {
      const failure = new Error('post failed');
      state.postError = failure;

      await expect(yieldToMacrotask()).rejects.toBe(failure);
    });
  });

  describe('without MessageChannel (jsdom)', () => {
    beforeEach(() => {
      Reflect.deleteProperty(globalThis, 'MessageChannel');
    });

    it('invokes the callback synchronously and returns a no-op handle', () => {
      const callback = jest.fn();

      const handle = scheduleMacrotask(callback);

      expect(callback).toHaveBeenCalledTimes(1);
      expect(() => handle.cancel()).not.toThrow();
    });

    it('yieldToMacrotask resolves on a microtask', async () => {
      const order: string[] = [];
      const pending = yieldToMacrotask().then(() => order.push('yield'));
      order.push('sync');

      await pending;

      expect(order).toEqual(['sync', 'yield']);
    });
  });
});
