/**
 * SessionContext -- Provides a single useSessions() instance to the entire
 * component tree, preventing duplicate RPC calls and state divergence.
 *
 * TASK_2025_263 CRITICAL-1 fix
 *
 * Problem: Both Sidebar and StatusBar independently called useSessions(),
 * creating two separate React state instances. activeSessionId set in
 * Sidebar's hook was invisible to StatusBar's instance.
 *
 * Solution: Lift useSessions() into a React context provider so all
 * consumers share one state instance and one set of RPC subscriptions.
 */

import React, { createContext, useContext } from 'react';

import { useSessions, type UseSessionsResult } from '../hooks/use-sessions.js';

const SessionContext = createContext<UseSessionsResult | null>(null);

export function SessionProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const sessions = useSessions();
  return (
    <SessionContext.Provider value={sessions}>
      {children}
    </SessionContext.Provider>
  );
}

/**
 * Access the shared session state. Must be called within a SessionProvider.
 * Replaces direct useSessions() calls in individual components.
 */
export function useSessionContext(): UseSessionsResult {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error(
      'useSessionContext must be used within a SessionProvider. ' +
        'Ensure the App component wraps its children with <SessionProvider>.',
    );
  }
  return ctx;
}
