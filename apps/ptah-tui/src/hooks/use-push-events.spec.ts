import { EventEmitter } from 'node:events';
import type { PushEventAdapter } from './use-push-events.js';

/**
 * The hooks themselves are thin `useState`/`useEffect` wrappers over the
 * adapter; without a React renderer in this workspace we exercise the same
 * subscribe → reduce → unsubscribe contract directly against a bare
 * EventEmitter, which is exactly how the hook drives the adapter.
 */
function driveList<T>(
  adapter: PushEventAdapter,
  type: string,
  reducer: (list: readonly T[], payload: unknown) => T[],
): { current: T[]; stop: () => void } {
  const state: { current: T[] } = { current: [] };
  const handler = (payload: unknown): void => {
    state.current = reducer(state.current, payload);
  };
  adapter.on(type, handler);
  return {
    get current() {
      return state.current;
    },
    stop: () => adapter.off(type, handler),
  };
}

describe('usePushEventList reducer contract', () => {
  it('accumulates payloads through the reducer (append, not replace)', () => {
    const adapter = new EventEmitter();
    const reducer = (list: readonly string[], payload: unknown): string[] => [
      ...list,
      (payload as { text: string }).text,
    ];
    const sub = driveList(adapter, 'gateway:message', reducer);

    adapter.emit('gateway:message', { text: 'a' });
    adapter.emit('gateway:message', { text: 'b' });

    expect(sub.current).toEqual(['a', 'b']);
    sub.stop();
    expect(adapter.listenerCount('gateway:message')).toBe(0);
  });

  it('stops accumulating after unsubscribe', () => {
    const adapter = new EventEmitter();
    const reducer = (list: readonly number[], payload: unknown): number[] => [
      ...list,
      payload as number,
    ];
    const sub = driveList(adapter, 'memory:extracted', reducer);
    adapter.emit('memory:extracted', 1);
    sub.stop();
    adapter.emit('memory:extracted', 2);
    expect(sub.current).toEqual([1]);
  });
});
