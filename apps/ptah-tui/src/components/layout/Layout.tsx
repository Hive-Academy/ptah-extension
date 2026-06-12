import React, { useEffect, useState } from 'react';
import { Box, useStdout } from 'ink';

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
  fallbackModel?: string | null;
  children: React.ReactNode;
}

export function Layout({
  sidebarVisible,
  agentPanelVisible,
  activeView,
  isStreaming,
  modalActive = false,
  fallbackModel = null,
  children,
}: LayoutProps): React.JSX.Element {
  void activeView;

  const { stdout } = useStdout();
  const [size, setSize] = useState({
    rows: stdout.rows ?? 24,
    columns: stdout.columns ?? 80,
  });

  useEffect(() => {
    const onResize = (): void => {
      setSize({ rows: stdout.rows ?? 24, columns: stdout.columns ?? 80 });
    };
    stdout.on('resize', onResize);
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  return (
    <Box
      flexDirection="column"
      width={size.columns}
      height={size.rows}
      overflow="hidden"
    >
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
      <StatusBar isStreaming={isStreaming} fallbackModel={fallbackModel} />
    </Box>
  );
}