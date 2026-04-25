/**
 * Layout -- Top-level layout shell for the TUI application.
 *
 * Arranges: Header > (Sessions Sidebar? | Main Content | Agent Panel?) > StatusBar
 *
 * Sessions sidebar (left): hidden by default, toggled via Ctrl+E.
 * Agent panel (right):     visible by default, toggled via Ctrl+B.
 */

import React from 'react';
import { Box } from 'ink';

import { Header } from './Header.js';
import { Sidebar } from '../sidebar/Sidebar.js';
import { AgentPanel } from '../sidebar/AgentPanel.js';
import { StatusBar } from './StatusBar.js';
import { Panel } from '../atoms/index.js';

interface LayoutProps {
  sidebarVisible: boolean;
  agentPanelVisible: boolean;
  activeView: 'chat' | 'settings';
  isStreaming: boolean;
  modalActive?: boolean;
  children: React.ReactNode;
}

export function Layout({
  sidebarVisible,
  agentPanelVisible,
  activeView,
  isStreaming,
  modalActive = false,
  children,
}: LayoutProps): React.JSX.Element {
  void activeView;

  return (
    <Box flexDirection="column" width="100%" height="100%">
      <Header />
      <Box flexDirection="row" flexGrow={1}>
        {sidebarVisible && (
          <Panel width="22%" minWidth={22} padding={0}>
            <Sidebar modalActive={modalActive} />
          </Panel>
        )}
        <Box flexGrow={1} flexDirection="column">
          {children}
        </Box>
        {agentPanelVisible && (
          <Panel width="22%" minWidth={22} padding={0}>
            <AgentPanel />
          </Panel>
        )}
      </Box>
      <StatusBar isStreaming={isStreaming} />
    </Box>
  );
}
