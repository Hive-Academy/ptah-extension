/**
 * MessageList -- Scrollable list of chat messages with welcome screen.
 *
 * Renders all messages as MessageBubble components.
 * Shows a styled welcome screen when no messages are present.
 * Shows a Spinner when streaming has started but no assistant content yet.
 */

import React from 'react';
import { Box, Text } from 'ink';

import type { ChatMessage } from '../../hooks/use-chat.js';
import { MessageBubble } from './MessageBubble.js';
import { Spinner } from '../common/Spinner.js';

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
}

function WelcomeScreen(): React.JSX.Element {
  return (
    <Box
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      flexGrow={1}
      paddingY={2}
    >
      <Box flexDirection="column" alignItems="center" gap={1}>
        <Text color="#7c3aed" bold>
          {'𓂀  Welcome to Ptah'}
        </Text>
        <Text color="#6b7280">
          The Coding Orchestra — AI-powered development in your terminal
        </Text>

        <Box marginTop={1} flexDirection="column" alignItems="center">
          <Text dimColor>{'─'.repeat(50)}</Text>
        </Box>

        <Box marginTop={1} flexDirection="column" gap={0} paddingX={4}>
          <Box gap={1}>
            <Text color="#06b6d4" bold>
              {'  Chat'}
            </Text>
            <Text dimColor> Type a message below to start a conversation</Text>
          </Box>
          <Box gap={1}>
            <Text color="#10b981" bold>
              {'  Ctrl+S'}
            </Text>
            <Text dimColor>Configure API keys and provider settings</Text>
          </Box>
          <Box gap={1}>
            <Text color="#f59e0b" bold>
              {'  Ctrl+B'}
            </Text>
            <Text dimColor>Toggle the session sidebar</Text>
          </Box>
          <Box gap={1}>
            <Text color="#ef4444" bold>
              {'  Ctrl+Q'}
            </Text>
            <Text dimColor>Quit the application</Text>
          </Box>
        </Box>

        <Box marginTop={1} flexDirection="column" alignItems="center">
          <Text dimColor>{'─'.repeat(50)}</Text>
        </Box>

        <Text dimColor italic>
          Configure your API key in Settings (Ctrl+S) to get started
        </Text>
      </Box>
    </Box>
  );
}

export function MessageList({
  messages,
  isStreaming,
}: MessageListProps): React.JSX.Element {
  const lastMessage = messages[messages.length - 1];
  const showThinkingSpinner =
    isStreaming &&
    (!lastMessage ||
      lastMessage.role !== 'assistant' ||
      lastMessage.content.length === 0);

  if (messages.length === 0 && !isStreaming) {
    return <WelcomeScreen />;
  }

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} paddingY={1}>
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          role={message.role}
          content={message.content}
          isStreaming={message.isStreaming}
        />
      ))}
      {showThinkingSpinner && (
        <Box paddingX={1} marginBottom={1} gap={1}>
          <Text color="#06b6d4">{'┃'}</Text>
          <Spinner label="Thinking..." />
        </Box>
      )}
    </Box>
  );
}
