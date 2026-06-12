import { useEffect, useState } from 'react';
import type { EventEmitter } from 'node:events';

export type PushEventAdapter = Pick<EventEmitter, 'on' | 'off' | 'emit'>;

/**
 * Subscribe to a single push-event type from the backend adapter and return
 * the latest payload (replace semantics). Returns null until the first event.
 */
export function usePushEvents<T>(
  pushAdapter: PushEventAdapter,
  eventType: string,
): T | null {
  const [data, setData] = useState<T | null>(null);

  useEffect(() => {
    const handler = (payload: T): void => {
      setData(payload);
    };
    pushAdapter.on(eventType, handler);
    return () => {
      pushAdapter.off(eventType, handler);
    };
  }, [pushAdapter, eventType]);

  return data;
}

/**
 * Subscribe to a push-event type and accumulate payloads through a reducer
 * (append semantics) for panels that build a running list — gateway messages,
 * memory events, agent-monitor output.
 */
export function usePushEventList<T>(
  pushAdapter: PushEventAdapter,
  eventType: string,
  reducer: (list: readonly T[], payload: unknown) => T[],
  initial: readonly T[] = [],
): T[] {
  const [list, setList] = useState<T[]>(() => [...initial]);

  useEffect(() => {
    const handler = (payload: unknown): void => {
      setList((prev) => reducer(prev, payload));
    };
    pushAdapter.on(eventType, handler);
    return () => {
      pushAdapter.off(eventType, handler);
    };
  }, [pushAdapter, eventType, reducer]);

  return list;
}
