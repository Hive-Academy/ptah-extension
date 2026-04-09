/**
 * Sidebar -- Session list and agent monitor panel on the left side.
 *
 * Uses the shared SessionContext for state. Renders SessionList
 * at the top and AgentMonitor below with styled section headers.
 */

import React, { useCallback } from 'react';
import { Box, Text } from 'ink';

import { useSessionContext } from '../../context/SessionContext.js';
import { SessionList } from './SessionList.js';
import { AgentMonitor } from './AgentMonitor.js';

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
      <Box paddingX={1} marginBottom={0}>
        <Text bold color="#7c3aed">
          {'◆ '}
        </Text>
        <Text bold color="#7c3aed">
          Sessions
        </Text>
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

      <Box
        marginTop={1}
        borderStyle="single"
        borderColor="#1f2937"
        borderTop
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
      >
        <Box flexDirection="column" width="100%">
          <Box paddingX={1} marginBottom={0}>
            <Text bold color="#7c3aed">
              {'◆ '}
            </Text>
            <Text bold color="#7c3aed">
              Agents
            </Text>
          </Box>
          <AgentMonitor />
        </Box>
      </Box>
    </Box>
  );
}
