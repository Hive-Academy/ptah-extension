/**
 * Layout -- Top-level layout shell for the TUI application.
 *
 * Arranges: Header > (Sidebar | Main Content) > StatusBar
 * The sidebar can be toggled via Ctrl+B.
 */

import React from 'react';
import { Box } from 'ink';

import { useTheme } from '../../hooks/use-theme.js';

import { Header } from './Header.js';
import { Sidebar } from '../sidebar/Sidebar.js';
import { StatusBar } from './StatusBar.js';

interface LayoutProps {
  sidebarVisible: boolean;
  activeView: 'chat' | 'settings';
  isStreaming: boolean;
  modalActive?: boolean;
  children: React.ReactNode;
}

export function Layout({
  sidebarVisible,
  activeView,
  isStreaming,
  modalActive = false,
  children,
}: LayoutProps): React.JSX.Element {
  void activeView;

  const theme = useTheme();

  return (
    <Box flexDirection="column" width="100%" height="100%">
      <Header />
      <Box flexDirection="row" flexGrow={1}>
        {sidebarVisible && (
          <Box
            width="25%"
            minWidth={24}
            borderStyle="round"
            borderColor={theme.ui.border}
            flexDirection="column"
          >
            <Sidebar modalActive={modalActive} />
          </Box>
        )}
        <Box flexGrow={1} flexDirection="column">
          {children}
        </Box>
      </Box>
      <StatusBar isStreaming={isStreaming} />
    </Box>
  );
}
