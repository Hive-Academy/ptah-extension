import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from '../../hooks/use-theme.js';

export interface KeyHintProps {
  keys: string;
  label: string;
  separator?: boolean;
}

export function KeyHint({
  keys,
  label,
  separator = false,
}: KeyHintProps): React.JSX.Element {
  const theme = useTheme();

  return (
    <Box>
      {separator && <Text color={theme.ui.border}>{' │ '}</Text>}
      <Text color={theme.ui.muted} bold>
        {keys}
      </Text>
      <Text> </Text>
      <Text dimColor>{label}</Text>
    </Box>
  );
}

export default KeyHint;
