/**
 * SessionList -- Interactive session list with keyboard navigation.
 *
 * Renders sessions via the shared `ListItem` molecule and delegates arrow /
 * Enter handling to the `useKeyboardNav` hook. Also handles the N/D
 * shortcuts for create/delete inline.
 */

import React, { useCallback, useState } from 'react';
import { Box, Text, useInput } from 'ink';

import type { Session } from '../../hooks/use-sessions.js';
import { useTheme } from '../../hooks/use-theme.js';
import { useKeyboardNav } from '../../hooks/use-keyboard-nav.js';
import { Spinner } from '../atoms/Spinner.js';
import { ListItem } from '../molecules/index.js';

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
  const theme = useTheme();
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );

  const handleSelect = useCallback(
    (index: number) => {
      const session = sessions[index];
      if (session) {
        onSelect(session.id);
      }
    },
    [sessions, onSelect],
  );

  const { activeIndex } = useKeyboardNav({
    itemCount: sessions.length,
    isActive: isFocused && confirmingDeleteId === null,
    onSelect: handleSelect,
  });

  // Inline handlers for N/D and delete confirm — the nav hook owns arrow/enter,
  // these only cover the remaining shortcuts.
  useInput(
    (input, key) => {
      if (confirmingDeleteId !== null) {
        if (input.toLowerCase() === 'y') {
          onDelete(confirmingDeleteId);
          setConfirmingDeleteId(null);
        } else if (input.toLowerCase() === 'n' || key.escape) {
          setConfirmingDeleteId(null);
        }
        return;
      }

      if (key.ctrl || key.meta) return;

      if (input.toLowerCase() === 'n') {
        onCreate();
        return;
      }

      if (input.toLowerCase() === 'd' && sessions.length > 0) {
        const session = sessions[activeIndex];
        if (session) {
          setConfirmingDeleteId(session.id);
        }
      }
    },
    { isActive: isFocused },
  );

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
        <Text color={theme.ui.dimmed}>No sessions yet</Text>
        <Text dimColor italic>
          Press N to create
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      {sessions.map((session, index) => {
        const isSelected = index === activeIndex;
        const isCurrent = session.id === activeSessionId;
        const isConfirmingDelete = session.id === confirmingDeleteId;

        if (isConfirmingDelete) {
          return (
            <Box key={session.id} gap={1}>
              <Text color={theme.status.error} bold>
                Delete?
              </Text>
              <Text color={theme.status.warning} bold>
                Y
              </Text>
              <Text color={theme.ui.dimmed}>/</Text>
              <Text color={theme.ui.accent} bold>
                N
              </Text>
            </Box>
          );
        }

        return (
          <ListItem
            key={session.id}
            label={session.name}
            isSelected={isSelected}
            isCurrent={isCurrent}
          />
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
