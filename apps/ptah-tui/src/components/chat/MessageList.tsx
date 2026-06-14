import React from 'react';
import { Box, Text } from 'ink';
import BigText from 'ink-big-text';
import Gradient from 'ink-gradient';

import type { ChatMessage } from '../../hooks/use-chat.js';
import { MessageBubble } from './MessageBubble.js';
import { Spinner, Divider, KeyHint } from '../atoms/index.js';
import { useTheme } from '../../hooks/use-theme.js';

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
}

const MAX_VISIBLE_MESSAGES = 50;

function WelcomeScreen(): React.JSX.Element {
  const theme = useTheme();

  return (
    <Box
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      flexGrow={1}
      paddingY={2}
    >
      <Box flexDirection="column" alignItems="center">
        <Gradient name="vice">
          <BigText text="PTAH" font="tiny" align="center" />
        </Gradient>
        <Text color={theme.ui.dimmed} italic>
          𓂀 The Coding Orchestra — AI-powered development in your terminal
        </Text>

        <Box marginTop={1}>
          <Divider title="Quick Start" width={52} />
        </Box>

        <Box marginTop={1} flexDirection="column" paddingX={4} gap={0}>
          <KeyHint
            keys="  Ctrl+S"
            label="Configure API keys and provider settings"
          />
          <KeyHint keys="  Ctrl+B" label="Toggle the agents sidebar" />
          <KeyHint keys="  Ctrl+E" label="Toggle the sessions sidebar" />
          <KeyHint keys="  Ctrl+K" label="Open the command palette" />
          <KeyHint keys="  Ctrl+Q" label="Quit the application" />
        </Box>

        <Box marginTop={1}>
          <Divider width={52} />
        </Box>

        <Box marginTop={1}>
          <Text dimColor italic>
            Type a message below to start chatting — or press Ctrl+S to set up a
            provider
          </Text>
        </Box>
      </Box>
    </Box>
  );
}

export function MessageList({
  messages,
  isStreaming,
}: MessageListProps): React.JSX.Element {
  const theme = useTheme();

  if (messages.length === 0 && !isStreaming) {
    return <WelcomeScreen />;
  }

  const last = messages[messages.length - 1];

  const showThinkingSpinner =
    isStreaming &&
    (!last || last.role !== 'assistant' || last.content.length === 0);

  // Cap the rendered history so the element tree can't grow unbounded; the
  // bounded viewport below keeps only the most recent messages on screen.
  const visible =
    messages.length > MAX_VISIBLE_MESSAGES
      ? messages.slice(-MAX_VISIBLE_MESSAGES)
      : messages;

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      flexShrink={1}
      overflow="hidden"
      justifyContent="flex-end"
      paddingX={1}
      paddingY={1}
    >
      {visible.map((message) => (
        <MessageBubble
          key={message.id}
          role={message.role}
          content={message.content}
          thinking={message.thinking}
          tools={message.tools}
          isStreaming={message.isStreaming === true}
        />
      ))}

      {showThinkingSpinner && (
        <Box paddingX={1} marginBottom={1} gap={1}>
          <Text color={theme.ui.accent}>{'┃'}</Text>
          <Spinner label="Thinking..." />
        </Box>
      )}
    </Box>
  );
}
