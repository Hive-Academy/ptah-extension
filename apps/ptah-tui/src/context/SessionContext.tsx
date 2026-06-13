import React, { createContext, useContext } from 'react';
import {
  useSessions,
  type SessionTransport,
  type SessionPushAdapter,
  type UseSessionsResult,
} from '../hooks/use-sessions.js';

const SessionContext = createContext<UseSessionsResult | null>(null);

export interface SessionProviderProps {
  transport: SessionTransport;
  pushAdapter: SessionPushAdapter;
  workspacePath: string;
  children: React.ReactNode;
}

export function SessionProvider({
  transport,
  pushAdapter,
  workspacePath,
  children,
}: SessionProviderProps): React.JSX.Element {
  const sessions = useSessions(transport, pushAdapter, workspacePath);
  return (
    <SessionContext.Provider value={sessions}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSessionContext(): UseSessionsResult {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSessionContext must be used within a SessionProvider.');
  }
  return ctx;
}
