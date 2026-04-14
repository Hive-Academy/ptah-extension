import React from 'react';
import { Box, Text } from 'ink';
import InkSpinner from 'ink-spinner';

export interface SpinnerProps {
  label?: string;
  type?: 'dots' | 'dots2' | 'line' | 'arrow3' | 'bouncingBar' | 'aesthetic';
}

export function Spinner({
  label,
  type = 'dots',
}: SpinnerProps): React.JSX.Element {
  return (
    <Box gap={1}>
      <InkSpinner type={type} />
      {label && <Text dimColor>{label}</Text>}
    </Box>
  );
}

export default Spinner;
