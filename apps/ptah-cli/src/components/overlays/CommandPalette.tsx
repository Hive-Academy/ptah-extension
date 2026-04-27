/**
 * CommandPalette -- Modal command palette (Ctrl+K).
 *
 * Fetches remote commands via autocomplete:commands RPC and merges with the
 * 12 local TUI commands. Pushes a focus scope on mount so background
 * useInput handlers are suspended.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

import { useCliContext } from '../../context/CliContext.js';
import { useTheme } from '../../hooks/use-theme.js';
import { usePushFocus } from '../../hooks/use-focus-manager.js';
import { useKeyboardNav } from '../../hooks/use-keyboard-nav.js';
import { Badge, KeyHint, Panel, Spinner } from '../atoms/index.js';
import type { BadgeVariant } from '../atoms/index.js';
import { ListItem } from '../molecules/index.js';

const SCOPE_ORDER: Record<string, number> = {
  'tui-local': 0,
  builtin: 1,
  project: 2,
  user: 3,
  plugin: 4,
  mcp: 5,
};

function paletteScopeBadge(scope: string): {
  label: string;
  variant: BadgeVariant;
} {
  switch (scope) {
    case 'tui-local':
      return { label: 'tui', variant: 'accent' };
    case 'builtin':
      return { label: 'claude', variant: 'info' };
    case 'project':
      return { label: 'project', variant: 'success' };
    case 'user':
      return { label: 'user', variant: 'warning' };
    case 'mcp':
      return { label: 'mcp', variant: 'outline' };
    case 'plugin':
      return { label: 'plugin', variant: 'ghost' };
    default:
      return { label: scope, variant: 'ghost' };
  }
}

/** Maximum number of commands to display in the palette. */
const MAX_VISIBLE_COMMANDS = 15;

interface PaletteCommand {
  name: string;
  description: string;
  scope: string;
}

interface RemoteCommandInfo {
  name: string;
  description: string;
  scope: string;
  argumentHint?: string;
}

interface AutocompleteCommandsResult {
  commands?: RemoteCommandInfo[];
}

// Must stay in sync with use-commands.ts. Anything the Claude SDK owns
// (compact, cost, context, memory, review) is fetched via the remote list
// below and must NOT appear here.
const LOCAL_TUI_COMMANDS: PaletteCommand[] = [
  {
    name: 'clear',
    description: 'Clear the chat message history (TUI view + SDK state)',
    scope: 'tui-local',
  },
  { name: 'new', description: 'Create a new chat session', scope: 'tui-local' },
  {
    name: 'settings',
    description: 'Open the settings panel',
    scope: 'tui-local',
  },
  {
    name: 'sessions',
    description: 'Toggle the session sidebar',
    scope: 'tui-local',
  },
  {
    name: 'theme',
    description: 'Switch the terminal color theme',
    scope: 'tui-local',
  },
  {
    name: 'mode',
    description: 'Switch between plan and build modes',
    scope: 'tui-local',
  },
  {
    name: 'model',
    description: 'Switch the active LLM model',
    scope: 'tui-local',
  },
  {
    name: 'status',
    description: 'Show current TUI session status information',
    scope: 'tui-local',
  },
  {
    name: 'help',
    description: 'List all available commands',
    scope: 'tui-local',
  },
  { name: 'quit', description: 'Exit the CLI application', scope: 'tui-local' },
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
  const { transport } = useCliContext();
  const isActive = usePushFocus('command-palette');

  const [searchQuery, setSearchQuery] = useState('');
  const [remoteCommands, setRemoteCommands] = useState<PaletteCommand[]>([]);
  const [loading, setLoading] = useState(true);

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

  const allCommands = useMemo((): PaletteCommand[] => {
    const localNames = new Set(LOCAL_TUI_COMMANDS.map((c) => c.name));
    const deduped = remoteCommands.filter((c) => !localNames.has(c.name));
    return [...LOCAL_TUI_COMMANDS, ...deduped];
  }, [remoteCommands]);

  const filtered = useMemo((): PaletteCommand[] => {
    const base = !searchQuery.trim()
      ? allCommands
      : allCommands.filter((cmd) => {
          const lower = searchQuery.toLowerCase();
          return (
            cmd.name.toLowerCase().includes(lower) ||
            cmd.description.toLowerCase().includes(lower)
          );
        });
    return [...base].sort((a, b) => {
      const orderA = SCOPE_ORDER[a.scope] ?? 99;
      const orderB = SCOPE_ORDER[b.scope] ?? 99;
      if (orderA !== orderB) return orderA - orderB;
      return a.name.localeCompare(b.name);
    });
  }, [allCommands, searchQuery]);

  const visible = filtered.slice(0, MAX_VISIBLE_COMMANDS);

  const { activeIndex, reset } = useKeyboardNav({
    itemCount: visible.length,
    isActive,
    wrap: true,
    onSelect: (i) => {
      const selected = visible[i];
      if (selected) {
        onExecute(selected.name, '');
      }
    },
    onEscape: onDismiss,
  });

  useEffect(() => {
    reset();
  }, [searchQuery, reset]);

  return (
    <Panel title="Command Palette" isActive padding={1}>
      <Box flexDirection="column">
        <Box>
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
              const badge = paletteScopeBadge(cmd.scope);
              return (
                <ListItem
                  key={`${cmd.scope}:${cmd.name}`}
                  label={`/${cmd.name}`}
                  description={cmd.description}
                  isSelected={index === activeIndex}
                  badge={<Badge variant={badge.variant}>{badge.label}</Badge>}
                />
              );
            })
          )}
        </Box>

        <Box marginTop={1} gap={2}>
          <KeyHint keys="↑↓" label="navigate" />
          <KeyHint keys="Enter" label="execute" />
          <KeyHint keys="Esc" label="close" />
        </Box>
      </Box>
    </Panel>
  );
}
