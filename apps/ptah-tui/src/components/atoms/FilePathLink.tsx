import React from 'react';
import { Text } from 'ink';

import { useTheme } from '../../hooks/use-theme.js';

export interface FilePathLinkProps {
  path: string;
  shortened?: boolean;
}

function shortenPath(path: string): string {
  const segments = path.split(/[/\\]/).filter(Boolean);
  if (segments.length <= 2) return path;
  return `…/${segments.slice(-2).join('/')}`;
}

export function FilePathLink({
  path,
  shortened = true,
}: FilePathLinkProps): React.JSX.Element {
  const theme = useTheme();
  const display = shortened ? shortenPath(path) : path;

  return (
    <Text color={theme.status.info} underline>
      {display}
    </Text>
  );
}

export default FilePathLink;
