/**
 * CommandOverlay -- Inline command picker rendered above the MessageInput.
 *
 * TASK_2025_266 Batch 4
 *
 * Displays a filtered list of slash commands based on the current input query.
 * Supports keyboard navigation (Up/Down to select, Enter to confirm, Escape to dismiss).
 * Uses inverse text for the selected item, matching the SettingsPanel pattern.
 *
 * This is NOT a modal -- it renders inline within ChatPanel, between
 * MessageList and MessageInput.
 */

import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';

import { useTheme } from '../../hooks/use-theme.js';
import type { CommandEntry } from '../../hooks/use-commands.js';

/** Maximum number of commands to display in the overlay. */
const MAX_VISIBLE_COMMANDS = 10;

interface CommandOverlayProps {
  query: string;
  commands: CommandEntry[];
  onSelect: (command: CommandEntry) => void;
  onDismiss: () => void;
  isActive: boolean;
}

function CommandOverlayInner({
  query,
  commands,
  onSelect,
  onDismiss,
  isActive,
}: CommandOverlayProps): React.JSX.Element | null {
  const theme = useTheme();

  // Filter commands by query substring match on name
  const filtered = query
    ? commands.filter((cmd) =>
        cmd.name.toLowerCase().includes(query.toLowerCase()),
      )
    : commands;

  const visible = filtered.slice(0, MAX_VISIBLE_COMMANDS);

  const [selectedIndex, setSelectedIndex] = useState(0);

  // Reset selection when the filtered list changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useInput(
    (_input, key) => {
      if (key.upArrow) {
        setSelectedIndex((prev) =>
          visible.length === 0
            ? 0
            : (prev - 1 + visible.length) % visible.length,
        );
      }

      if (key.downArrow) {
        setSelectedIndex((prev) =>
          visible.length === 0 ? 0 : (prev + 1) % visible.length,
        );
      }

      if (key.return) {
        const selected = visible[selectedIndex];
        if (selected) {
          onSelect(selected);
        }
      }

      if (key.escape) {
        onDismiss();
      }
    },
    { isActive },
  );

  if (!isActive) return null;

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.ui.borderActive}
      paddingX={1}
      marginX={0}
    >
      {visible.length === 0 ? (
        <Text color={theme.ui.dimmed}>No matching commands</Text>
      ) : (
        visible.map((cmd, index) => {
          const isSelected = index === selectedIndex;
          const argHint = cmd.argumentHint ? ` ${cmd.argumentHint}` : '';

          return (
            <Box key={cmd.name} gap={1}>
              <Text bold={isSelected} inverse={isSelected}>
                /{cmd.name}
                {argHint}
              </Text>
              <Text dimColor color={theme.ui.dimmed}>
                {cmd.description}
              </Text>
            </Box>
          );
        })
      )}
    </Box>
  );
}

export const CommandOverlay = React.memo(CommandOverlayInner);
