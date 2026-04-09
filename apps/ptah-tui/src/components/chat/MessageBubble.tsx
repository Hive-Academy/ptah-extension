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

interface MessageBubbleProps {
  role: 'user' | 'assistant' | 'system';
  content: string;
  isStreaming?: boolean;
}

const ROLE_CONFIG: Record<
  MessageBubbleProps['role'],
  { label: string; color: string; gutter: string }
> = {
  user: { label: 'You', color: '#10b981', gutter: '┃' },
  assistant: { label: 'Ptah', color: '#06b6d4', gutter: '┃' },
  system: { label: 'System', color: '#f59e0b', gutter: '┃' },
};

export function MessageBubble({
  role,
  content,
  isStreaming,
}: MessageBubbleProps): React.JSX.Element {
  const config = ROLE_CONFIG[role];

  const renderedContent = useMemo(() => {
    if (role === 'assistant' && renderMarkdown && content.length > 0) {
      return renderMarkdown(content);
    }
    return content;
  }, [role, content]);

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
            <Text color="#f59e0b" dimColor>
              {'streaming...'}
            </Text>
          )}
        </Box>
        <Box paddingLeft={0}>
          <Text wrap="wrap">
            {renderedContent}
            {isStreaming ? <Text color={config.color}>{'\u2588'}</Text> : ''}
          </Text>
        </Box>
      </Box>
    </Box>
  );
}
