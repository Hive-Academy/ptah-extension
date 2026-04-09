/**
 * SessionList -- Interactive session list with keyboard navigation.
 *
 * Displays session names with the active session highlighted.
 * Supports: Up/Down arrows, Enter to load, N to create, D to delete.
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';

import type { Session } from '../../hooks/use-sessions.js';
import { Spinner } from '../common/Spinner.js';

interface SessionListProps {
  sessions: Session[];
  activeSessionId: string | null;
  loading: boolean;
  onSelect: (sessionId: string) => void;
  onCreate: () => void;
  onDelete: (sessionId: string) => void;
  isFocused?: boolean;
}

export function SessionList({
  sessions,
  activeSessionId,
  loading,
  onSelect,
  onCreate,
  onDelete,
  isFocused = true,
}: SessionListProps): React.JSX.Element {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );

  const handleConfirmDelete = useCallback(
    (sessionId: string) => {
      onDelete(sessionId);
      setConfirmingDeleteId(null);
    },
    [onDelete],
  );

  const handleCancelDelete = useCallback(() => {
    setConfirmingDeleteId(null);
  }, []);

  useInput(
    (input, key) => {
      if (confirmingDeleteId !== null) {
        if (input.toLowerCase() === 'y') {
          handleConfirmDelete(confirmingDeleteId);
        } else if (input.toLowerCase() === 'n' || key.escape) {
          handleCancelDelete();
        }
        return;
      }

      if (key.upArrow) {
        setSelectedIndex((prev) => Math.max(0, prev - 1));
        return;
      }

      if (key.downArrow) {
        setSelectedIndex((prev) => Math.min(sessions.length - 1, prev + 1));
        return;
      }

      if (key.return && sessions.length > 0) {
        const session = sessions[selectedIndex];
        if (session) {
          onSelect(session.id);
        }
        return;
      }

      if (input.toLowerCase() === 'n' && !key.ctrl && !key.meta) {
        onCreate();
        return;
      }

      if (input.toLowerCase() === 'd' && !key.ctrl && !key.meta) {
        if (sessions.length > 0) {
          const session = sessions[selectedIndex];
          if (session) {
            setConfirmingDeleteId(session.id);
          }
        }
        return;
      }
    },
    { isActive: isFocused },
  );

  React.useEffect(() => {
    if (sessions.length > 0 && selectedIndex >= sessions.length) {
      setSelectedIndex(sessions.length - 1);
    }
  }, [sessions.length, selectedIndex]);

  if (loading && sessions.length === 0) {
    return (
      <Box paddingX={1}>
        <Spinner label="Loading..." />
      </Box>
    );
  }

  if (sessions.length === 0) {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text color="#6b7280">No sessions yet</Text>
        <Text dimColor italic>
          Press N to create
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {sessions.map((session, index) => {
        const isSelected = index === selectedIndex;
        const isActive = session.id === activeSessionId;
        const isConfirmingDelete = session.id === confirmingDeleteId;

        if (isConfirmingDelete) {
          return (
            <Box key={session.id} gap={1}>
              <Text color="#ef4444" bold>
                Delete?
              </Text>
              <Text color="#f59e0b" bold>
                Y
              </Text>
              <Text color="#6b7280">/</Text>
              <Text color="#06b6d4" bold>
                N
              </Text>
            </Box>
          );
        }

        const indicator = isActive ? '●' : isSelected ? '›' : ' ';
        const color = isActive ? '#06b6d4' : isSelected ? '#ffffff' : '#9ca3af';

        return (
          <Box key={session.id}>
            <Text
              color={isActive ? '#06b6d4' : isSelected ? '#7c3aed' : '#6b7280'}
            >
              {indicator}{' '}
            </Text>
            <Text
              color={color}
              bold={isActive || isSelected}
              inverse={isSelected && !isActive}
            >
              {session.name}
            </Text>
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text dimColor italic>
          N:new D:del Enter:load
        </Text>
      </Box>
    </Box>
  );
}
