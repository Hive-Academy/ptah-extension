import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from '../../hooks/use-theme.js';

export interface DividerProps {
  title?: string;
  dashed?: boolean;
  width?: number;
}

export function Divider({
  title,
  dashed = false,
  width = 60,
}: DividerProps): React.JSX.Element {
  const theme = useTheme();
  const glyph = dashed ? '┄' : '─';

  if (!title) {
    return (
      <Box>
        <Text color={theme.ui.border}>{glyph.repeat(width)}</Text>
      </Box>
    );
  }

  const titleLen = title.length + 2;
  const side = Math.max(2, Math.floor((width - titleLen) / 2));
  const left = glyph.repeat(side);
  const right = glyph.repeat(Math.max(2, width - side - titleLen));

  return (
    <Box>
      <Text color={theme.ui.border}>{left} </Text>
      <Text color={theme.ui.muted} bold>
        {title}
      </Text>
      <Text color={theme.ui.border}> {right}</Text>
    </Box>
  );
}

export default Divider;
