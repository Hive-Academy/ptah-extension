import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from '../../hooks/use-theme.js';

interface ModalOverlayProps {
  visible: boolean;
  children?: React.ReactNode;
}

export function ModalOverlay({
  visible,
  children,
}: ModalOverlayProps): React.JSX.Element | null {
  const theme = useTheme();

  if (!visible) return null;

  return (
    <Box
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      borderStyle="double"
      borderColor={theme.status.warning}
      padding={2}
      marginX={4}
      marginY={1}
    >
      {children ?? <Text dimColor>Modal content placeholder</Text>}
    </Box>
  );
}