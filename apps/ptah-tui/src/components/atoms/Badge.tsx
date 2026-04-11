import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from '../../hooks/use-theme.js';

export type BadgeVariant =
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'ghost'
  | 'outline'
  | 'accent';

export interface BadgeProps {
  variant?: BadgeVariant;
  bold?: boolean;
  children: React.ReactNode;
}

export function Badge({
  variant = 'ghost',
  bold = false,
  children,
}: BadgeProps): React.JSX.Element {
  const theme = useTheme();

  const color = (() => {
    switch (variant) {
      case 'info':
        return theme.status.info;
      case 'success':
        return theme.status.success;
      case 'warning':
        return theme.status.warning;
      case 'error':
        return theme.status.error;
      case 'accent':
        return theme.ui.accent;
      case 'outline':
        return theme.ui.muted;
      case 'ghost':
      default:
        return theme.ui.dimmed;
    }
  })();

  return (
    <Box>
      <Text color={color}>[</Text>
      <Text color={color} bold={bold}>
        {children}
      </Text>
      <Text color={color}>]</Text>
    </Box>
  );
}

export default Badge;
