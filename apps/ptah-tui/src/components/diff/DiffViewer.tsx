/**
 * DiffViewer -- Placeholder for file-diff rendering in the TUI.
 *
 * TASK_2025_263 Batch 5
 *
 * Will be replaced with a full unified-diff renderer in a future release.
 * For now, shows a bordered placeholder so the component can be imported
 * and positioned in layouts without runtime errors.
 */

import React from 'react';
import { Box, Text } from 'ink';

export function DiffViewer(): React.JSX.Element {
  return (
    <Box borderStyle="single" borderColor="gray" padding={1}>
      <Text dimColor>Diff viewer — coming in a future release</Text>
    </Box>
  );
}
