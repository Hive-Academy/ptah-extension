/**
 * MessageList -- Chat messages rendered into permanent terminal scrollback.
 *
 * Uses Ink's `<Static>` component so completed messages are written to the
 * terminal exactly once and then remain in native scroll history — the user
 * scrolls with their terminal (mouse wheel, shift+PgUp, etc.) rather than a
 * viewport emulation. Only the currently streaming message (if any) and the
 * "thinking" spinner are rendered dynamically.
 *
 * This replaces the previous viewport hack that computed a fixed-rows slice
 * and handled PgUp/PgDn internally.
 */

import React from 'react';
import { Box, Static, Text } from 'ink';
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

  // Split completed vs live: the trailing streaming message (if any) must
  // render dynamically so its content can update. Everything before it is
  // frozen and handed to Static for permanent scrollback.
  const lastIdx = messages.length - 1;
  const last = lastIdx >= 0 ? messages[lastIdx] : undefined;
  const isLastLive = last?.isStreaming === true;

  const completed = isLastLive ? messages.slice(0, -1) : messages;
  const live = isLastLive ? last : undefined;

  const showThinkingSpinner =
    isStreaming &&
    (!live || live.role !== 'assistant' || live.content.length === 0);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1}>
      <Static items={completed}>
        {(message) => (
          <MessageBubble
            key={message.id}
            role={message.role}
            content={message.content}
            isStreaming={false}
          />
        )}
      </Static>

      {live && (
        <MessageBubble
          key={live.id}
          role={live.role}
          content={live.content}
          isStreaming={true}
        />
      )}

      {showThinkingSpinner && (
        <Box paddingX={1} marginBottom={1} gap={1}>
          <Text color={theme.ui.accent}>{'┃'}</Text>
          <Spinner label="Thinking..." />
        </Box>
      )}
    </Box>
  );
}
