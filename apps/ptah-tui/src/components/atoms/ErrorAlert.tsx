import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from '../../hooks/use-theme.js';

export interface ErrorAlertProps {
  message: string;
  title?: string;
}

export function ErrorAlert({
  message,
  title = 'Error',
}: ErrorAlertProps): React.JSX.Element {
  const theme = useTheme();

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.status.error}
      paddingX={1}
    >
      <Text color={theme.status.error} bold>
        ✗ {title}
      </Text>
      <Text color={theme.status.error}>{message}</Text>
    </Box>
  );
}

export default ErrorAlert;
