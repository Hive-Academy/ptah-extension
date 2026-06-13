import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from '../../hooks/use-theme.js';
import { Panel } from '../atoms/index.js';

interface CodeBlockProps {
  code: string;
  language?: string;
}

export function CodeBlock({
  code,
  language,
}: CodeBlockProps): React.JSX.Element {
  const theme = useTheme();

  return (
    <Panel>
      {language && (
        <Box
          borderStyle="single"
          borderColor={theme.ui.borderSubtle}
          borderBottom
          borderTop={false}
          borderLeft={false}
          borderRight={false}
          marginBottom={0}
        >
          <Text color={theme.ui.brand} bold>
            {language}
          </Text>
        </Box>
      )}
      <Text>{code}</Text>
    </Panel>
  );
}
