import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from '../../hooks/use-theme.js';

export interface ProgressBarProps {
  percent: number;
  width?: number;
  color?: string;
}

export function ProgressBar({
  percent,
  width = 10,
  color,
}: ProgressBarProps): React.JSX.Element {
  const theme = useTheme();
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  const barColor = color ?? theme.ui.accent;

  return (
    <Box>
      <Text color={barColor}>{'█'.repeat(filled)}</Text>
      <Text color={theme.ui.borderSubtle}>{'░'.repeat(empty)}</Text>
    </Box>
  );
}

export default ProgressBar;
