import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from '../../hooks/use-theme.js';

export interface ExpandableProps {
  label: string;
  isExpanded: boolean;
  lineCount?: number;
  charCount?: number;
  children: React.ReactNode;
}

export function Expandable({
  label,
  isExpanded,
  lineCount,
  charCount,
  children,
}: ExpandableProps): React.JSX.Element {
  const theme = useTheme();
  const chevron = isExpanded ? '▼' : '▶';

  const meta = (() => {
    const parts: string[] = [];
    if (lineCount !== undefined) parts.push(`${lineCount} lines`);
    if (charCount !== undefined) parts.push(`${charCount} chars`);
    return parts.length > 0 ? ` (${parts.join(', ')})` : '';
  })();

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={theme.ui.muted}>{chevron} </Text>
        <Text color={theme.ui.muted}>
          {isExpanded ? `Hide ${label}` : `Show ${label}`}
        </Text>
        <Text dimColor>{meta}</Text>
      </Box>
      {isExpanded && <Box marginLeft={2}>{children}</Box>}
    </Box>
  );
}

export default Expandable;
