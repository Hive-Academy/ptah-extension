/**
 * Sidebar -- Session list and agent monitor panel on the left side.
 *
 * Uses the shared SessionContext for state. Renders SessionList
 * at the top and AgentMonitor below with styled section headers.
 */

import React, { useCallback } from 'react';
import { Box, Text } from 'ink';

import { useTheme } from '../../hooks/use-theme.js';

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

  const theme = useTheme();

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1} marginBottom={0}>
        <Text bold color={theme.ui.brand}>
          {'◆ '}
        </Text>
        <Text bold color={theme.ui.brand}>
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
        borderColor={theme.ui.borderSubtle}
        borderTop
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
      >
        <Box flexDirection="column" width="100%">
          <Box paddingX={1} marginBottom={0}>
            <Text bold color={theme.ui.brand}>
              {'◆ '}
            </Text>
            <Text bold color={theme.ui.brand}>
              Agents
            </Text>
          </Box>
          <AgentMonitor />
        </Box>
      </Box>
    </Box>
  );
}
