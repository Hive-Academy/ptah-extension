import React from 'react';
import { Box, Text } from 'ink';

import { useTheme } from '../../hooks/use-theme.js';
import { GLYPHS } from '../../lib/glyphs.js';
import type {
  EffortLevel,
  PermissionLevel,
} from '../../hooks/use-agent-config.js';

interface AgentConfigBarProps {
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

  // The model moved to the status line and the `^R effort  ^P perms` hint moved
  // to the `?` overlay — both were duplicated here, and this row sat directly
  // above the composer competing with the status line for the same job. What
  // is left is the agent's current posture, which is worth a permanent row
  // because "Full Auto" is a safety state and not a status.
  return (
    <Box paddingX={1} gap={1} flexShrink={0}>
      <Text color={theme.ui.dimmed}>{'effort'}</Text>
      <Text color={dim ? theme.ui.dimmed : theme.ui.muted}>{effort}</Text>
      <Text color={theme.ui.borderSubtle}>{GLYPHS.separator}</Text>
      <Text color={permissionColor}>
        {PERMISSION_LABEL[permissionLevel].toLowerCase()}
      </Text>
      {autopilotEnabled && (
        <>
          <Text color={theme.ui.borderSubtle}>{GLYPHS.separator}</Text>
          <Text color={theme.status.warning}>autopilot</Text>
        </>
      )}
    </Box>
  );
}
