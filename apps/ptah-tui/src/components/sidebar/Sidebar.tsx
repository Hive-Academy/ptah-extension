/**
 * Sidebar -- Session list panel on the left side (shown via ^E).
 *
 * Uses the shared SessionContext for state. Renders SessionList only.
 * The AgentMonitor has moved to AgentPanel (right sidebar).
 */

import React, { useCallback } from 'react';
import { Box } from 'ink';

import { useSessionContext } from '../../context/SessionContext.js';
import { SessionList } from './SessionList.js';
import { SectionHeader } from '../molecules/index.js';

interface SidebarProps {
  modalActive?: boolean;
}

export function Sidebar({
  modalActive = false,
}: SidebarProps): React.JSX.Element {
  const {
    sessions,
    activeSessionId,
    loading,
    createSession,
    loadSession,
    deleteSession,
  } = useSessionContext();

  const handleSelect = useCallback(
    (sessionId: string) => {
      void loadSession(sessionId);
    },
    [loadSession],
  );

  const handleCreate = useCallback(() => {
    void createSession();
  }, [createSession]);

  const handleDelete = useCallback(
    (sessionId: string) => {
      void deleteSession(sessionId);
    },
    [deleteSession],
  );

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1}>
        <SectionHeader title="Sessions" icon="◆" />
      </Box>
      <SessionList
        sessions={sessions}
        activeSessionId={activeSessionId}
        loading={loading}
        onSelect={handleSelect}
        onCreate={handleCreate}
        onDelete={handleDelete}
        isFocused={!modalActive}
      />
    </Box>
  );
}
