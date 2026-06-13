import React from 'react';
import { Box } from 'ink';

import { SettingsPanel } from '../settings/SettingsPanel.js';

interface MainPanelProps {
  activeView: 'chat' | 'settings';
  onSwitchView?: (view: 'chat' | 'settings') => void;
  modalActive?: boolean;
  children: React.ReactNode;
}

export function MainPanel({
  activeView,
  onSwitchView,
  modalActive = false,
  children,
}: MainPanelProps): React.JSX.Element {
  void onSwitchView;

  if (activeView === 'settings') {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <SettingsPanel modalActive={modalActive} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      {children}
    </Box>
  );
}
