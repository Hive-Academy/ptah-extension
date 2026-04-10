/**
 * Spinner -- Animated loading indicator for the TUI.
 *
 * TASK_2025_263 Batch 3
 *
 * Wraps ink-spinner with an optional text label.
 * Used during RPC calls, streaming initialization, and other async operations.
 *
 * Usage:
 *   <Spinner label="Loading sessions..." />
 *   <Spinner />
 */

import React from 'react';
import { Box, Text } from 'ink';
import InkSpinner from 'ink-spinner';

interface SpinnerProps {
  label?: string;
}

export function Spinner({ label }: SpinnerProps): React.JSX.Element {
  return (
    <Box gap={1}>
      <InkSpinner type="dots" />
      {label && <Text dimColor>{label}</Text>}
    </Box>
  );
}
