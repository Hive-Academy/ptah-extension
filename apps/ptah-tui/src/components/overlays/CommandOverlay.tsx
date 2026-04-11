/**
 * CommandOverlay -- Inline command picker rendered above the MessageInput.
 *
 * Displays a filtered list of slash commands based on the current input
 * query. Renders inline within ChatPanel, not as a modal.
 */

import React, { useEffect, useMemo } from 'react';
import { Box, Text } from 'ink';

import { useTheme } from '../../hooks/use-theme.js';
import { useKeyboardNav } from '../../hooks/use-keyboard-nav.js';
import { Badge, Panel } from '../atoms/index.js';
import type { BadgeVariant } from '../atoms/index.js';
import { ListItem } from '../molecules/index.js';
import type { CommandEntry } from '../../hooks/use-commands.js';

function scopeBadge(scope: CommandEntry['scope']): {
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

/** Maximum number of commands to display in the overlay. */
const MAX_VISIBLE_COMMANDS = 10;

interface CommandOverlayProps {
  query: string;
  commands: CommandEntry[];
  onSelect: (command: CommandEntry) => void;
  onDismiss: () => void;
  isActive: boolean;
}

const SCOPE_ORDER: Record<CommandEntry['scope'], number> = {
  'tui-local': 0,
  builtin: 1,
  project: 2,
  user: 3,
  plugin: 4,
  mcp: 5,
};

function CommandOverlayInner({
  query,
  commands,
  onSelect,
  onDismiss,
  isActive,
}: CommandOverlayProps): React.JSX.Element | null {
  const theme = useTheme();

  const visible = useMemo(() => {
    const filtered = query
      ? commands.filter((cmd) =>
          cmd.name.toLowerCase().includes(query.toLowerCase()),
        )
      : commands;

    const sorted = [...filtered].sort((a, b) => {
      const scopeDiff = SCOPE_ORDER[a.scope] - SCOPE_ORDER[b.scope];
      if (scopeDiff !== 0) return scopeDiff;
      return a.name.localeCompare(b.name);
    });

    return sorted.slice(0, MAX_VISIBLE_COMMANDS);
  }, [commands, query]);

  const { activeIndex, reset } = useKeyboardNav({
    itemCount: visible.length,
    isActive,
    wrap: true,
    onSelect: (i) => {
      const selected = visible[i];
      if (selected) {
        onSelect(selected);
      }
    },
    onEscape: onDismiss,
  });

  useEffect(() => {
    reset();
  }, [query, reset]);

  if (!isActive) return null;

  return (
    <Panel isActive padding={1}>
      {visible.length === 0 ? (
        <Text color={theme.ui.dimmed}>No matching commands</Text>
      ) : (
        visible.map((cmd, index) => {
          const argHint = cmd.argumentHint ? ` ${cmd.argumentHint}` : '';
          const badge = scopeBadge(cmd.scope);
          return (
            <ListItem
              key={`${cmd.scope}:${cmd.name}`}
              label={`/${cmd.name}${argHint}`}
              description={cmd.description}
              isSelected={index === activeIndex}
              badge={<Badge variant={badge.variant}>{badge.label}</Badge>}
            />
          );
        })
      )}
      <Box marginTop={1}>
        <Text dimColor italic>
          [tui] = local TUI commands · [claude] = Claude SDK · others from
          project/user/mcp/plugin
        </Text>
      </Box>
    </Panel>
  );
}

export const CommandOverlay = React.memo(CommandOverlayInner);
