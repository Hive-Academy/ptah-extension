import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from '../../hooks/use-theme.js';

export interface ChatFileInfo {
  path: string;
  name: string;
  type?: 'text' | 'image' | 'binary';
  size?: number;
  isLarge?: boolean;
}

export interface FileTagProps {
  file: ChatFileInfo;
}

function iconFor(type?: ChatFileInfo['type']): string {
  switch (type) {
    case 'image':
      return '🖼';
    case 'binary':
      return '📦';
    case 'text':
    default:
      return '📄';
  }
}

export function FileTag({ file }: FileTagProps): React.JSX.Element {
  const theme = useTheme();
  const color = file.isLarge ? theme.status.warning : theme.ui.accent;

  return (
    <Box>
      <Text color={color}>[</Text>
      <Text color={color}>
        {iconFor(file.type)} {file.name}
      </Text>
      <Text color={color}>]</Text>
    </Box>
  );
}

export default FileTag;
