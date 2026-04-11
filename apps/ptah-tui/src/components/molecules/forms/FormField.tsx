import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from '../../../hooks/use-theme.js';

export interface FormFieldProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}

export function FormField({
  label,
  hint,
  error,
  required = false,
  children,
}: FormFieldProps): React.JSX.Element {
  const theme = useTheme();

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={theme.ui.muted} bold>
          {label}
        </Text>
        {required && <Text color={theme.status.error}> *</Text>}
      </Box>
      <Box marginTop={0}>{children}</Box>
      {hint && !error && (
        <Box marginTop={0}>
          <Text dimColor italic>
            {hint}
          </Text>
        </Box>
      )}
      {error && (
        <Box marginTop={0}>
          <Text color={theme.status.error}>✗ {error}</Text>
        </Box>
      )}
    </Box>
  );
}

export default FormField;
