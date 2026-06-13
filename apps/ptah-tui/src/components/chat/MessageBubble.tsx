import React, { useMemo } from 'react';
import { Box, Text } from 'ink';

import { useTheme, type TuiTheme } from '../../hooks/use-theme.js';
import { DiffViewer } from '../diff/DiffViewer.js';
import { ToolIcon } from '../atoms/index.js';
import type { ChatRole, ChatToolRow } from '../../hooks/use-chat.js';

function isDiffContent(text: string): boolean {
  return (
    (text.includes('--- ') && text.includes('+++ ')) ||
    text.startsWith('diff --git ')
  );
}

interface MessageBubbleProps {
  role: ChatRole;
  content: string;
  thinking?: string;
  tools?: readonly ChatToolRow[];
  isStreaming?: boolean;
}

function getRoleConfig(
  theme: TuiTheme,
): Record<ChatRole, { label: string; color: string; gutter: string }> {
  return {
    user: { label: 'You', color: theme.roles.user, gutter: '┃' },
    assistant: { label: 'Ptah', color: theme.roles.assistant, gutter: '┃' },
    system: { label: 'System', color: theme.roles.system, gutter: '┃' },
  };
}

function toolStatusColor(theme: TuiTheme, status: ChatToolRow['status']): string {
  switch (status) {
    case 'ok':
      return theme.status.success;
    case 'error':
      return theme.status.error;
    default:
      return theme.status.warning;
  }
}

function toolStatusGlyph(status: ChatToolRow['status']): string {
  switch (status) {
    case 'ok':
      return '✓';
    case 'error':
      return '✗';
    default:
      return '…';
  }
}

function collapseThinking(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > 80 ? `${collapsed.slice(0, 80)}…` : collapsed;
}

export function MessageBubble({
  role,
  content,
  thinking = '',
  tools = [],
  isStreaming,
}: MessageBubbleProps): React.JSX.Element {
  const theme = useTheme();
  const roleConfig = useMemo(() => getRoleConfig(theme), [theme]);
  const config = roleConfig[role];

  const showDiff = useMemo(
    () => role === 'assistant' && !isStreaming && isDiffContent(content),
    [role, isStreaming, content],
  );

  const thinkingLine = useMemo(() => collapseThinking(thinking), [thinking]);

  return (
    <Box flexDirection="row" marginBottom={1}>
      <Box marginRight={1}>
        <Text color={config.color}>{config.gutter}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        <Box gap={1} marginBottom={0}>
          <Text bold color={config.color}>
            {config.label}
          </Text>
          {isStreaming && (
            <Text color={theme.status.warning} dimColor>
              {'streaming...'}
            </Text>
          )}
        </Box>

        {thinkingLine.length > 0 && (
          <Box paddingLeft={0}>
            <Text color={theme.ui.dimmed} italic>
              {`✦ ${thinkingLine}`}
            </Text>
          </Box>
        )}

        {tools.length > 0 && (
          <Box flexDirection="column" paddingLeft={0}>
            {tools.map((tool) => (
              <Box key={tool.id} gap={1}>
                <ToolIcon name={tool.toolName} />
                <Text color={theme.ui.dimmed}>{tool.toolName}</Text>
                <Text color={toolStatusColor(theme, tool.status)}>
                  {toolStatusGlyph(tool.status)}
                </Text>
              </Box>
            ))}
          </Box>
        )}

        {content.length > 0 && (
          <Box paddingLeft={0}>
            {showDiff ? (
              <DiffViewer rawDiff={content} defaultCollapsed />
            ) : (
              <Text wrap="wrap">
                {content}
                {isStreaming ? (
                  <Text color={config.color}>{'█'}</Text>
                ) : (
                  ''
                )}
              </Text>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
}
