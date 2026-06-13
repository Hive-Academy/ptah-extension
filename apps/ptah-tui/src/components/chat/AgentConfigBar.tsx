import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from '../../hooks/use-theme.js';
import type {
  EffortLevel,
  PermissionLevel,
} from '../../hooks/use-agent-config.js';

interface AgentConfigBarProps {
  model: string | null;
  effort: EffortLevel;
  permissionLevel: PermissionLevel;
  autopilotEnabled: boolean;
  authReady: boolean;
}

const PERMISSION_LABEL: Record<PermissionLevel, string> = {
  ask: 'Ask',
  'auto-edit': 'Auto-Edit',
  yolo: 'Full Auto',
  plan: 'Plan',
};

export function AgentConfigBar({
  model,
  effort,
  permissionLevel,
  autopilotEnabled,
  authReady,
}: AgentConfigBarProps): React.JSX.Element {
  const theme = useTheme();
  const dim = !authReady;

  const permissionColor = dim
    ? theme.ui.dimmed
    : permissionLevel === 'yolo'
      ? theme.status.error
      : permissionLevel === 'plan'
        ? theme.status.info
        : theme.status.success;

  return (
    <Box paddingX={1} gap={1}>
      <Text color={dim ? theme.ui.dimmed : theme.ui.brand}>
        {model ?? 'No model'}
      </Text>
      <Text color={theme.ui.border}>{'·'}</Text>
      <Text color={theme.ui.dimmed}>effort:</Text>
      <Text color={dim ? theme.ui.dimmed : theme.ui.accent}>{effort}</Text>
      <Text color={theme.ui.border}>{'·'}</Text>
      <Text color={permissionColor}>
        {autopilotEnabled || permissionLevel !== 'ask' ? '◉' : '○'}{' '}
        {PERMISSION_LABEL[permissionLevel]}
      </Text>
      <Text color={theme.ui.dimmed}>{'^R effort  ^P perms'}</Text>
    </Box>
  );
}
