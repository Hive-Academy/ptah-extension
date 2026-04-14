import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from '../../hooks/use-theme.js';

export interface SuggestionOptionProps {
  label: string;
  description?: string;
  icon?: string;
  isActive: boolean;
  badge?: string;
}

export function SuggestionOption({
  label,
  description,
  icon,
  isActive,
  badge,
}: SuggestionOptionProps): React.JSX.Element {
  const theme = useTheme();

  return (
    <Box>
      <Text
        color={isActive ? theme.ui.accent : undefined}
        inverse={isActive}
        bold={isActive}
      >
        {isActive ? '> ' : '  '}
        {icon ? `${icon} ` : ''}
        {label}
      </Text>
      {badge && <Text color={theme.ui.dimmed}> [{badge}]</Text>}
      {description && <Text dimColor> — {description}</Text>}
    </Box>
  );
}

export default SuggestionOption;
