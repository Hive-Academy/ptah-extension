/**
 * ModalOverlay -- Full-screen overlay for permissions, questions, and confirmations.
 *
 * TASK_2025_263 Batch 3
 *
 * Renders a centered, bordered box on top of the main content.
 * When `visible` is false, renders nothing.
 * Children will be provided by Batch 4 (permission prompts, question forms).
 */

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
