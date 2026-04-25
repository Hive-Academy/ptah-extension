import React from 'react';
import { Box } from 'ink';
import type { BoxProps } from 'ink';

export interface CardProps {
  variant?: 'default' | 'subtle';
  padding?: BoxProps['paddingX'];
  flexDirection?: BoxProps['flexDirection'];
  gap?: BoxProps['gap'];
  children: React.ReactNode;
}

export function Card({
  padding = 1,
  flexDirection = 'column',
  gap = 0,
  children,
}: CardProps): React.JSX.Element {
  return (
    <Box flexDirection={flexDirection} paddingX={padding} gap={gap}>
      {children}
    </Box>
  );
}

export default Card;
