/**
 * ErrorBoundary -- Catches unhandled React rendering errors in the TUI.
 *
 * TASK_2025_263 Batch 5
 *
 * React error boundaries must be class components (no hook equivalent).
 * When a child component throws during render, this boundary catches the
 * error and displays a friendly crash screen instead of letting Ink die
 * with an unhandled exception.
 */

import React from 'react';
import { Box, Text } from 'ink';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  override render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <Box flexDirection="column" padding={1}>
          <Box borderStyle="double" borderColor="red" paddingX={2} paddingY={1}>
            <Text bold color="red">
              Something went wrong
            </Text>
          </Box>
          <Box marginTop={1} paddingX={1}>
            <Text color="red">
              {this.state.error?.message ?? 'Unknown error'}
            </Text>
          </Box>
          <Box marginTop={1} paddingX={1}>
            <Text dimColor>Press Ctrl+C to exit and restart</Text>
          </Box>
        </Box>
      );
    }
    return this.props.children;
  }
}
