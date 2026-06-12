import React, { useCallback } from 'react';
import { Box } from 'ink';

import { useSessionContext } from '../../context/SessionContext.js';
import { SessionList } from './SessionList.js';
import { SectionHeader } from '../molecules/index.js';

interface SidebarProps {
  modalActive?: boolean;
  onCreateSession?: () => void;
}

export function Sidebar({
  modalActive = false,
  onCreateSession,
}: SidebarProps): React.JSX.Element {
  const {
    sessions,
    activeSessionId,
    loading,
    loadSession,
    deleteSession,
    setActiveSession,
  } = useSessionContext();

  const handleSelect = useCallback(
    (sessionId: string) => {
      void loadSession(sessionId);
    },
    [loadSession],
  );

  const handleCreate = useCallback(() => {
    if (onCreateSession) {
      onCreateSession();
      return;
    }
    setActiveSession(null);
  }, [onCreateSession, setActiveSession]);

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
