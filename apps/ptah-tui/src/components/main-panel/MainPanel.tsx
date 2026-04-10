/**
 * MainPanel -- Primary content area that switches between chat and settings views.
 *
 * TASK_2025_263 Batch 3 + Batch 4
 *
 * When activeView is 'chat', renders children (the chat interface).
 * When activeView is 'settings', renders the SettingsPanel.
 */

import React from 'react';
import { Box } from 'ink';

import { SettingsPanel } from '../settings/SettingsPanel.js';

interface MainPanelProps {
  activeView: 'chat' | 'settings';
  /** Callback to switch the active view. */
  onSwitchView?: (view: 'chat' | 'settings') => void;
  /** When true, a modal overlay is active and keyboard input should be suppressed. */
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
