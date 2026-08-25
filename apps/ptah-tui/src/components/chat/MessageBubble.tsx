import React, { useMemo } from 'react';
import { Box, Text } from 'ink';

import { useTheme, type TuiTheme } from '../../hooks/use-theme.js';
import { DiffViewer } from '../diff/DiffViewer.js';
import { Markdown } from './Markdown.js';
import { GLYPHS } from '../../lib/glyphs.js';
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
): Record<ChatRole, { label: string; color: string }> {
  return {
    user: { label: 'you', color: theme.roles.user },
    assistant: { label: 'ptah', color: theme.roles.assistant },
    system: { label: 'system', color: theme.roles.system },
  };
}

function toolStatusColor(
  theme: TuiTheme,
  status: ChatToolRow['status'],
): string {
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
      return GLYPHS.ok;
    case 'error':
      return GLYPHS.error;
    default:
      return GLYPHS.running;
  }
}

function collapseThinking(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > 80 ? `${collapsed.slice(0, 80)}…` : collapsed;
}

/**
 * One chat turn.
 *
 * The role label is a lowercase word in the role colour rather than a bold
 * "You"/"Ptah" title — the gutter rail already carries the attribution, so the
 * label only has to disambiguate, not shout. Assistant prose now goes through
 * `Markdown` instead of a bare `<Text>`, which is the single biggest visual
 * difference from the old transcript.
 */
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
  const renderMarkdown = role === 'assistant' && !showDiff;

  return (
    <Box flexDirection="row" marginBottom={1}>
      <Box marginRight={1}>
        <Text color={config.color}>{GLYPHS.gutter}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        <Text color={config.color} bold>
          {config.label}
        </Text>

        {thinkingLine.length > 0 && (
          <Text color={theme.ui.dimmed} italic>
            {`${GLYPHS.thinking} ${thinkingLine}`}
          </Text>
        )}

        {tools.length > 0 && (
          <Box flexDirection="column">
            {tools.map((tool) => (
              <Box key={tool.id} gap={1}>
                <Text color={toolStatusColor(theme, tool.status)}>
                  {toolStatusGlyph(tool.status)}
                </Text>
                <Text color={theme.ui.muted}>{tool.toolName}</Text>
              </Box>
            ))}
          </Box>
        )}

        {content.length > 0 &&
          (showDiff ? (
            <DiffViewer rawDiff={content} defaultCollapsed />
          ) : renderMarkdown ? (
            <Markdown
              text={content}
              streaming={isStreaming === true}
              cursorColor={config.color}
            />
          ) : (
            <Text wrap="wrap">
              {content}
              {isStreaming === true ? (
                <Text color={config.color}>{GLYPHS.cursor}</Text>
              ) : (
                ''
              )}
            </Text>
          ))}
      </Box>
    </Box>
  );
}
