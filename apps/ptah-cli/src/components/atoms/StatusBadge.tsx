import React from 'react';
import { Box, Text } from 'ink';
import InkSpinner from 'ink-spinner';

import { useTheme } from '../../hooks/use-theme.js';

export type ExecutionStatus =
  | 'pending'
  | 'streaming'
  | 'complete'
  | 'interrupted'
  | 'resumed'
  | 'error';

export interface StatusBadgeProps {
  status: ExecutionStatus;
}

interface StatusConfig {
  label: string;
  color: string;
  glyph?: string;
  spinner?: boolean;
}

export function StatusBadge({ status }: StatusBadgeProps): React.JSX.Element {
  const theme = useTheme();

  const config: StatusConfig = (() => {
    switch (status) {
      case 'pending':
        return { label: 'pending', color: theme.ui.dimmed, glyph: '○' };
      case 'streaming':
        return {
          label: 'streaming',
          color: theme.status.info,
          spinner: true,
        };
      case 'complete':
        return { label: 'complete', color: theme.status.success, glyph: '✓' };
      case 'interrupted':
        return {
          label: 'interrupted',
          color: theme.status.warning,
          glyph: '⏸',
        };
      case 'resumed':
        return { label: 'resumed', color: theme.status.info, glyph: '↻' };
      case 'error':
        return { label: 'error', color: theme.status.error, glyph: '✗' };
    }
  })();

  return (
    <Box>
      <Text color={config.color}>[</Text>
      {config.spinner ? (
        <Box marginRight={1}>
          <InkSpinner type="dots" />
        </Box>
      ) : (
        config.glyph && <Text color={config.color}>{config.glyph} </Text>
      )}
      <Text color={config.color} bold>
        {config.label}
      </Text>
      <Text color={config.color}>]</Text>
    </Box>
  );
}

export default StatusBadge;
