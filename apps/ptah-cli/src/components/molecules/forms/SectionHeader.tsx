import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from '../../../hooks/use-theme.js';

export interface SectionHeaderProps {
  title: string;
  subtitle?: string;
  icon?: string;
}

export function SectionHeader({
  title,
  subtitle,
  icon,
}: SectionHeaderProps): React.JSX.Element {
  const theme = useTheme();

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        {icon && <Text color={theme.ui.accent}>{icon} </Text>}
        <Text bold color={theme.ui.accent}>
          {title}
        </Text>
      </Box>
      {subtitle && (
        <Text dimColor italic>
          {subtitle}
        </Text>
      )}
    </Box>
  );
}

export default SectionHeader;
