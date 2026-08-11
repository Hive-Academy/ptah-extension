import React, { useEffect, useState } from 'react';
import { Box, Text, useStdout } from 'ink';

import { Sidebar } from '../sidebar/Sidebar.js';
import { AgentPanel } from '../sidebar/AgentPanel.js';
import { StatusBar } from './StatusBar.js';
import { useTheme } from '../../hooks/use-theme.js';
import { GLYPHS } from '../../lib/glyphs.js';
import type { FooterView } from '../../lib/keymap.js';

interface LayoutProps {
  sidebarVisible: boolean;
  agentPanelVisible: boolean;
  activeView: FooterView;
  isStreaming: boolean;
  hasConversation: boolean;
  modalActive?: boolean;
  fallbackModel?: string | null;
  children: React.ReactNode;
}

/** A transient panel gets at most this many rows before the chat is squeezed. */
const PANEL_MAX_ROWS = 8;

function TransientPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const theme = useTheme();

  return (
    <Box flexDirection="column" flexShrink={0} paddingX={1}>
      <Box>
        <Text color={theme.ui.accent} bold>
          {title}
        </Text>
        <Text color={theme.ui.borderSubtle}>{`  ${GLYPHS.rule.repeat(3)}`}</Text>
      </Box>
      <Box flexDirection="column" height={PANEL_MAX_ROWS} overflow="hidden">
        {children}
      </Box>
    </Box>
  );
}

/**
 * Content-first shell.
 *
 * What this replaced: a bordered `Header` bar across the top, and two bordered
 * 22%-wide columns pinned open for the entire session — the agents column was
 * visible by default and, for the overwhelming majority of runs, its whole
 * contribution was the words "No active agents" occupying a fifth of the
 * screen. Chat now owns the full width; the sessions and agents panels are
 * transient, collapse to nothing when closed, and are bounded when open. The
 * only remaining border in the chat view is the composer's, which is the one
 * border that carries meaning — it says "type here".
 */
export function Layout({
  sidebarVisible,
  agentPanelVisible,
  activeView,
  isStreaming,
  hasConversation,
  modalActive = false,
  fallbackModel = null,
  children,
}: LayoutProps): React.JSX.Element {
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
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {children}
      </Box>

      {sidebarVisible && (
        <TransientPanel title="Sessions">
          <Sidebar modalActive={modalActive} />
        </TransientPanel>
      )}

      {agentPanelVisible && (
        <TransientPanel title="Agents">
          <AgentPanel />
        </TransientPanel>
      )}

      <StatusBar
        isStreaming={isStreaming}
        hasConversation={hasConversation}
        fallbackModel={fallbackModel}
        view={activeView}
        panelOpen={sidebarVisible || agentPanelVisible}
        overlayOpen={modalActive}
      />
    </Box>
  );
}
