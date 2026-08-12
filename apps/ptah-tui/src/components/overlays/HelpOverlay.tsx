import React from 'react';
import { Box, Text, useInput } from 'ink';

import { useTheme } from '../../hooks/use-theme.js';
import { getHelpGroups } from '../../lib/keymap.js';
import { BORDER_STYLE, GLYPHS } from '../../lib/glyphs.js';

interface HelpOverlayProps {
  readonly onDismiss: () => void;
}

/**
 * `?` help. Reads the keymap registry, so it can never drift from what the app
 * actually binds — the previous "Quick Start" list on the welcome screen was
 * hand-maintained and had been wrong about three chords.
 */
export function HelpOverlay({ onDismiss }: HelpOverlayProps): React.JSX.Element {
  const theme = useTheme();
  const groups = getHelpGroups();

  useInput((_input, key) => {
    if (key.escape || key.return) {
      onDismiss();
    }
  });

  const keyColumn = Math.max(
    ...groups.flatMap((group) => group.bindings.map((b) => b.keys.length)),
  );

  return (
    <Box
      flexDirection="column"
      borderStyle={BORDER_STYLE}
      borderColor={theme.ui.borderActive}
      paddingX={2}
      paddingY={1}
    >
      <Box marginBottom={1}>
        <Text bold color={theme.ui.brand}>
          Keyboard shortcuts
        </Text>
      </Box>

      {groups.map((group) => (
        <Box key={group.group} flexDirection="column" marginBottom={1}>
          <Text bold color={theme.ui.accent}>
            {group.title}
          </Text>
          {group.bindings.map((binding) => (
            <Box key={binding.id}>
              <Text color={theme.ui.muted} bold>
                {`  ${binding.keys.padEnd(keyColumn)}`}
              </Text>
              <Text color={theme.ui.dimmed}>{`  ${GLYPHS.separator}  `}</Text>
              <Text>{binding.description}</Text>
            </Box>
          ))}
        </Box>
      ))}

      <Text color={theme.ui.dimmed} italic>
        Esc or Enter to close
      </Text>
    </Box>
  );
}
