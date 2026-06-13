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
