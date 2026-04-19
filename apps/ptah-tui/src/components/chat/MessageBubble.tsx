/**
 * MessageBubble -- Single chat message with role-based styling and markdown rendering.
 *
 * Renders messages with:
 *   - Colored left gutter indicator per role
 *   - Role label with timestamp
 *   - Markdown rendering for assistant messages via marked-terminal
 *   - Block cursor when actively streaming
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';

import { useTheme, type TuiTheme } from '../../hooks/use-theme.js';
import { DiffViewer } from '../diff/DiffViewer.js';

// marked + marked-terminal for rendering markdown in assistant responses
let renderMarkdown: ((text: string) => string) | null = null;

try {
  const { marked } = require('marked') as {
    marked: { use: (ext: unknown) => void; parse: (text: string) => string };
  };

  const { markedTerminal } = require('marked-terminal') as {
    markedTerminal: (opts?: unknown) => unknown;
  };

  marked.use(
    markedTerminal({
      reflowText: true,
      width: 100,
      showSectionPrefix: false,
      tab: 2,
    }),
  );

  renderMarkdown = (text: string): string => {
    try {
      const rendered = marked.parse(text);
      // marked.parse returns string (synchronous when no async extensions)
      return (typeof rendered === 'string' ? rendered : text).trimEnd();
    } catch {
      return text;
    }
  };
} catch {
  // marked/marked-terminal not available -- fall back to plain text
}

/**
 * Detect whether a text block is a unified diff.
 *
 * Checks for the standard `--- ` / `+++ ` header pair or a
 * `diff --git` preamble line that git produces.
 */
function isDiffContent(text: string): boolean {
  return (
    (text.includes('--- ') && text.includes('+++ ')) ||
    text.startsWith('diff --git ')
  );
}

interface MessageBubbleProps {
  role: 'user' | 'assistant' | 'system';
  content: string;
  isStreaming?: boolean;
}

function getRoleConfig(
  theme: TuiTheme,
): Record<
  MessageBubbleProps['role'],
  { label: string; color: string; gutter: string }
> {
  return {
    user: { label: 'You', color: theme.roles.user, gutter: '┃' },
    assistant: { label: 'Ptah', color: theme.roles.assistant, gutter: '┃' },
    system: { label: 'System', color: theme.roles.system, gutter: '┃' },
  };
}

export function MessageBubble({
  role,
  content,
  isStreaming,
}: MessageBubbleProps): React.JSX.Element {
  const theme = useTheme();
  const roleConfig = useMemo(() => getRoleConfig(theme), [theme]);
  const config = roleConfig[role];

  const showDiff = useMemo(
    () => role === 'assistant' && !isStreaming && isDiffContent(content),
    [role, isStreaming, content],
  );

  const renderedContent = useMemo(() => {
    // Skip markdown rendering when we will render with DiffViewer instead
    if (showDiff) return content;
    if (role === 'assistant' && renderMarkdown && content.length > 0) {
      return renderMarkdown(content);
    }
    return content;
  }, [role, content, showDiff]);

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
        <Box paddingLeft={0}>
          {showDiff ? (
            <DiffViewer rawDiff={content} defaultCollapsed />
          ) : (
            <Text wrap="wrap">
              {renderedContent}
              {isStreaming ? <Text color={config.color}>{'\u2588'}</Text> : ''}
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}
