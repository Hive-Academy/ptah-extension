/**
 * AgentPanel -- Right sidebar panel showing real-time CLI agent status.
 *
 * TASK_2025_266 UI Enhancements
 *
 * Moved from the left Sidebar to a dedicated right panel so the main
 * chat area gets maximum width and sessions remain hidden by default.
 */

import React from 'react';
import { Box } from 'ink';

import { AgentMonitor } from './AgentMonitor.js';
import { SectionHeader } from '../molecules/index.js';

export function AgentPanel(): React.JSX.Element {
  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1}>
        <SectionHeader title="Agents" icon="◆" />
      </Box>
      <AgentMonitor />
    </Box>
  );
}
