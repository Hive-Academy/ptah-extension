import React from 'react';
import { Box, Text, useInput } from 'ink';
import type { PermissionRequest } from '@ptah-extension/shared';

import { useTheme } from '../../hooks/use-theme.js';
import { usePushFocus } from '../../hooks/use-focus-manager.js';
import { Badge, KeyHint, Panel, ToolIcon } from '../atoms/index.js';

export type PermissionDecision = 'allow' | 'deny' | 'always_allow';

interface PermissionPromptProps {
  request: PermissionRequest;
  onDecision: (decision: PermissionDecision) => void;
}

export function PermissionPrompt({
  request,
  onDecision,
}: PermissionPromptProps): React.JSX.Element {
  const theme = useTheme();
  const isActive = usePushFocus('permission-prompt');

  const { toolName, description, toolInput } = request;

  useInput(
    (char, key) => {
      const lower = char.toLowerCase();
      if (lower === 'y') {
        onDecision('allow');
      } else if (lower === 'n') {
        onDecision('deny');
      } else if (lower === 'a') {
        onDecision('always_allow');
      } else if (key.escape) {
        onDecision('deny');
      }
    },
    { isActive },
  );

  let inputDisplay: string | undefined;
  if (toolInput && Object.keys(toolInput).length > 0) {
    const raw = JSON.stringify(toolInput, null, 2);
    const maxLines = 15;
    const lines = raw.split('\n');
    inputDisplay =
      lines.length > maxLines
        ? lines.slice(0, maxLines).join('\n') + '\n  ...(truncated)'
        : raw;
  }

  return (
    <Panel title="Permission Request" isActive padding={1}>
      <Box flexDirection="column">
        <Box gap={1}>
          <ToolIcon name={toolName} />
          <Text>Tool:</Text>
          <Text bold color={theme.ui.accent}>
            {toolName}
          </Text>
          <Badge variant="warning">needs approval</Badge>
        </Box>

        {description && (
          <Box marginTop={1}>
            <Text>{description}</Text>
          </Box>
        )}

        {inputDisplay && (
          <Box marginTop={1}>
            <Panel variant="subtle" padding={1}>
              <Text dimColor>{inputDisplay}</Text>
            </Panel>
          </Box>
        )}

        <Box marginTop={1} gap={2}>
          <KeyHint keys="Y" label="Allow" />
          <KeyHint keys="N" label="Deny" />
          <KeyHint keys="A" label="Always Allow" />
          <KeyHint keys="Esc" label="Cancel" />
        </Box>
      </Box>
    </Panel>
  );
}
