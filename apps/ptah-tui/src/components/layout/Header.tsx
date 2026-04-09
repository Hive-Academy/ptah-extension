/**
 * Header -- Top bar showing Ptah branding and current context.
 *
 * Displays the app name with styled branding, workspace path hint,
 * and session info in a visually distinctive header bar.
 */

import React from 'react';
import { Box, Text } from 'ink';

interface HeaderProps {
  workspaceName?: string;
}

export function Header({ workspaceName }: HeaderProps): React.JSX.Element {
  const workspace = workspaceName ?? process.cwd().split(/[\\/]/).pop() ?? '';

  return (
    <Box
      borderStyle="bold"
      borderColor="#7c3aed"
      borderBottom
      borderTop={false}
      borderLeft={false}
      borderRight={false}
      paddingX={1}
      justifyContent="space-between"
    >
      <Box gap={1}>
        <Text color="#7c3aed" bold>
          {'𓂀'}
        </Text>
        <Text color="#7c3aed" bold>
          Ptah
        </Text>
        <Text dimColor>{'·'}</Text>
        <Text dimColor italic>
          The Coding Orchestra
        </Text>
      </Box>
      <Box gap={1}>
        {workspace && (
          <>
            <Text dimColor>{'📁'}</Text>
            <Text color="#6b7280">{workspace}</Text>
          </>
        )}
      </Box>
    </Box>
  );
}
