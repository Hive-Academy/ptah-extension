/**
 * usePushEvents -- Subscribe to backend push events via CliWebviewManagerAdapter.
 *
 * TASK_2025_263 Batch 3
 *
 * The backend pushes real-time updates (chat chunks, session stats, etc.)
 * through CliWebviewManagerAdapter.emit(). This hook subscribes to a
 * specific event type and returns the latest payload.
 *
 * Usage:
 *   const chunk = usePushEvents<ChatChunk>('chat:chunk');
 *   const stats = usePushEvents<SessionStats>('session:stats');
 */

import { useState, useEffect } from 'react';

import { useCliContext } from '../context/CliContext.js';

/**
 * Subscribe to push events from the backend via CliWebviewManagerAdapter.
 * Returns the latest event data, or null if no event received yet.
 */
export function usePushEvents<T>(eventType: string): T | null {
  const { pushAdapter } = useCliContext();
  const [data, setData] = useState<T | null>(null);

  useEffect(() => {
    const handler = (payload: T) => {
      setData(payload);
    };

    pushAdapter.on(eventType, handler);
    return () => {
      pushAdapter.off(eventType, handler);
    };
  }, [pushAdapter, eventType]);

  return data;
}
