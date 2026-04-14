import React from 'react';
import { Box, Text } from 'ink';
import type { BoxProps } from 'ink';

import { useTheme } from '../../hooks/use-theme.js';

export interface PanelProps {
  title?: string;
  isActive?: boolean;
  variant?: 'default' | 'subtle' | 'ghost';
  padding?: BoxProps['paddingX'];
  marginBottom?: BoxProps['marginBottom'];
  flexGrow?: BoxProps['flexGrow'];
  width?: BoxProps['width'];
  minWidth?: BoxProps['minWidth'];
  height?: BoxProps['height'];
  children: React.ReactNode;
}

export function Panel({
  title,
  isActive = false,
  variant = 'default',
  padding = 1,
  marginBottom = 0,
  flexGrow,
  width,
  minWidth,
  height,
  children,
}: PanelProps): React.JSX.Element {
  const theme = useTheme();

  const borderColor = isActive
    ? theme.ui.borderActive
    : variant === 'subtle'
      ? theme.ui.borderSubtle
      : theme.ui.border;

  return (
    <Box
      flexDirection="column"
      borderStyle={variant === 'ghost' ? undefined : 'round'}
      borderColor={borderColor}
      paddingX={padding}
      marginBottom={marginBottom}
      flexGrow={flexGrow}
      width={width}
      minWidth={minWidth}
      height={height}
    >
      {title && (
        <Box marginBottom={1}>
          <Text bold color={isActive ? theme.ui.accent : undefined}>
            {isActive ? '> ' : '  '}
            {title}
          </Text>
        </Box>
      )}
      {children}
    </Box>
  );
}

export default Panel;
