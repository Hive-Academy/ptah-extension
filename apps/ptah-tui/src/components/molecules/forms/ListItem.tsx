import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from '../../../hooks/use-theme.js';

export interface ListItemProps {
  label: string;
  description?: string;
  icon?: string;
  isSelected?: boolean;
  isCurrent?: boolean;
  isDisabled?: boolean;
  badge?: React.ReactNode;
  trailing?: React.ReactNode;
}

export function ListItem({
  label,
  description,
  icon,
  isSelected = false,
  isCurrent = false,
  isDisabled = false,
  badge,
  trailing,
}: ListItemProps): React.JSX.Element {
  const theme = useTheme();

  const labelColor = isDisabled
    ? theme.ui.dimmed
    : isCurrent
      ? theme.ui.accent
      : undefined;

  return (
    <Box>
      <Text
        bold={isSelected || isCurrent}
        inverse={isSelected}
        color={labelColor}
        dimColor={isDisabled && !isSelected}
      >
        {isSelected ? '> ' : '  '}
        {icon ? `${icon} ` : ''}
        {label}
      </Text>
      {badge && <Box marginLeft={1}>{badge}</Box>}
      {isCurrent && <Text color={theme.status.success}> [current]</Text>}
      {description && <Text dimColor> — {description}</Text>}
      {trailing && <Box marginLeft={1}>{trailing}</Box>}
    </Box>
  );
}

export default ListItem;
