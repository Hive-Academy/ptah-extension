import React from 'react';
import { Text } from 'ink';

import { useTheme } from '../../hooks/use-theme.js';

export interface ToolIconProps {
  name: string;
}

interface ToolConfig {
  glyph: string;
  colorKey: 'info' | 'success' | 'warning' | 'error' | 'accent' | 'dimmed';
}

const TOOL_CONFIG: Record<string, ToolConfig> = {
  Read: { glyph: '📄', colorKey: 'info' },
  Write: { glyph: '📝', colorKey: 'success' },
  Edit: { glyph: '✎', colorKey: 'accent' },
  MultiEdit: { glyph: '✎', colorKey: 'accent' },
  Bash: { glyph: '❯', colorKey: 'warning' },
  Grep: { glyph: '⌕', colorKey: 'info' },
  Glob: { glyph: '❋', colorKey: 'info' },
  WebFetch: { glyph: '🌐', colorKey: 'info' },
  WebSearch: { glyph: '🔍', colorKey: 'info' },
  TodoWrite: { glyph: '☐', colorKey: 'success' },
  Task: { glyph: '⚙', colorKey: 'accent' },
};

const DEFAULT_CONFIG: ToolConfig = { glyph: '▸', colorKey: 'dimmed' };

export function ToolIcon({ name }: ToolIconProps): React.JSX.Element {
  const theme = useTheme();
  const config = TOOL_CONFIG[name] ?? DEFAULT_CONFIG;

  const color = (() => {
    switch (config.colorKey) {
      case 'info':
        return theme.status.info;
      case 'success':
        return theme.status.success;
      case 'warning':
        return theme.status.warning;
      case 'error':
        return theme.status.error;
      case 'accent':
        return theme.ui.accent;
      case 'dimmed':
        return theme.ui.dimmed;
    }
  })();

  return <Text color={color}>{config.glyph}</Text>;
}

export default ToolIcon;
