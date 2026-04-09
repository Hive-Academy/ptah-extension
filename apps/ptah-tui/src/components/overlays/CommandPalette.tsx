/**
 * CommandPalette -- Modal command palette (Ctrl+K).
 *
 * TASK_2025_266 Batch 5
 *
 * Full-screen modal overlay that lets users search and execute slash commands.
 * Fetches remote commands via autocomplete:commands RPC and merges with the
 * 12 local TUI command definitions.
 *
 * Pushed onto the modal stack in App.tsx and rendered inside ModalOverlay.
 *
 * Keyboard:
 *   Up/Down - Navigate results
 *   Enter   - Execute selected command
 *   Escape  - Dismiss
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

import { useTuiContext } from '../../context/TuiContext.js';
import { useTheme } from '../../hooks/use-theme.js';
import { Spinner } from '../common/Spinner.js';

/** Maximum number of commands to display in the palette. */
const MAX_VISIBLE_COMMANDS = 15;

/** Simplified command shape for the palette display. */
interface PaletteCommand {
  name: string;
  description: string;
  scope: string;
}

/** Shape of a remote command from autocomplete:commands RPC. */
interface RemoteCommandInfo {
  name: string;
  description: string;
  scope: string;
  argumentHint?: string;
}

/** Shape of the autocomplete:commands RPC response. */
interface AutocompleteCommandsResult {
  commands?: RemoteCommandInfo[];
}

/**
 * The 12 local TUI commands. These are always available regardless of
 * backend connectivity. They match the definitions in use-commands.ts.
 */
const LOCAL_TUI_COMMANDS: PaletteCommand[] = [
  {
    name: 'clear',
    description: 'Clear the chat message history',
    scope: 'tui-local',
  },
  { name: 'new', description: 'Create a new chat session', scope: 'tui-local' },
  {
    name: 'settings',
    description: 'Open the settings panel',
    scope: 'tui-local',
  },
  {
    name: 'help',
    description: 'List all available commands',
    scope: 'tui-local',
  },
  { name: 'quit', description: 'Exit the TUI application', scope: 'tui-local' },
  {
    name: 'model',
    description: 'Switch the active LLM model',
    scope: 'tui-local',
  },
  {
    name: 'mode',
    description: 'Switch between plan and build modes',
    scope: 'tui-local',
  },
  {
    name: 'theme',
    description: 'Switch the terminal color theme',
    scope: 'tui-local',
  },
  {
    name: 'compact',
    description: 'Compact the current chat context',
    scope: 'tui-local',
  },
  {
    name: 'cost',
    description: 'Show current session cost and token usage',
    scope: 'tui-local',
  },
  {
    name: 'status',
    description: 'Show current session status information',
    scope: 'tui-local',
  },
  {
    name: 'sessions',
    description: 'Toggle the session sidebar',
    scope: 'tui-local',
  },
];

interface CommandPaletteProps {
  onExecute: (commandName: string, args: string) => void;
  onDismiss: () => void;
}

export function CommandPalette({
  onExecute,
  onDismiss,
}: CommandPaletteProps): React.JSX.Element {
  const theme = useTheme();
  const { transport } = useTuiContext();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [remoteCommands, setRemoteCommands] = useState<PaletteCommand[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch remote commands on mount
  useEffect(() => {
    let cancelled = false;

    const fetchCommands = async (): Promise<void> => {
      try {
        const response = await transport.call<
          { query: string },
          AutocompleteCommandsResult
        >('autocomplete:commands', { query: '' });

        if (cancelled) return;

        if (response.success && response.data?.commands) {
          const mapped: PaletteCommand[] = response.data.commands.map(
            (cmd) => ({
              name: cmd.name,
              description: cmd.description,
              scope: cmd.scope,
            }),
          );
          setRemoteCommands(mapped);
        }
      } catch {
        // Gracefully handle -- remote commands will be empty
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void fetchCommands();

    return () => {
      cancelled = true;
    };
  }, [transport]);

  // Merge local + remote, deduplicating by name (local takes priority)
  const allCommands = useMemo((): PaletteCommand[] => {
    const localNames = new Set(LOCAL_TUI_COMMANDS.map((c) => c.name));
    const deduped = remoteCommands.filter((c) => !localNames.has(c.name));
    return [...LOCAL_TUI_COMMANDS, ...deduped];
  }, [remoteCommands]);

  // Filter by search query
  const filtered = useMemo((): PaletteCommand[] => {
    if (!searchQuery.trim()) return allCommands;
    const lower = searchQuery.toLowerCase();
    return allCommands.filter(
      (cmd) =>
        cmd.name.toLowerCase().includes(lower) ||
        cmd.description.toLowerCase().includes(lower),
    );
  }, [allCommands, searchQuery]);

  const visible = filtered.slice(0, MAX_VISIBLE_COMMANDS);

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchQuery]);

  useInput((_input, key) => {
    if (key.upArrow) {
      setSelectedIndex((prev) =>
        visible.length === 0 ? 0 : (prev - 1 + visible.length) % visible.length,
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
        onExecute(selected.name, '');
      }
    }

    if (key.escape) {
      onDismiss();
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold color={theme.ui.brand}>
        Command Palette
      </Text>

      <Box marginTop={1}>
        <Text color={theme.ui.accent} bold>
          {'> '}
        </Text>
        <TextInput
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Type to search..."
          focus={true}
        />
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {loading ? (
          <Spinner label="Loading commands..." />
        ) : visible.length === 0 ? (
          <Text color={theme.ui.dimmed}>No matching commands</Text>
        ) : (
          visible.map((cmd, index) => {
            const isSelected = index === selectedIndex;

            return (
              <Box key={cmd.name} gap={1}>
                <Text bold={isSelected} inverse={isSelected}>
                  /{cmd.name}
                </Text>
                <Text dimColor color={theme.ui.dimmed}>
                  {cmd.description}
                </Text>
                {cmd.scope !== 'tui-local' && (
                  <Text dimColor color={theme.ui.muted}>
                    [{cmd.scope}]
                  </Text>
                )}
              </Box>
            );
          })
        )}
      </Box>

      <Box marginTop={1}>
        <Text dimColor>Up/Down: navigate | Enter: execute | Escape: close</Text>
      </Box>
    </Box>
  );
}
