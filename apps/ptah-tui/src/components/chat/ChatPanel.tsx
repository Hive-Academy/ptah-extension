/**
 * ChatPanel -- Container component for the chat interface.
 *
 * TASK_2025_263 Batch 3
 *
 * Composes MessageList and MessageInput, connecting them to the
 * useChat hook for state management and streaming.
 */

import React from 'react';
import { Box } from 'ink';

import { useChat } from '../../hooks/use-chat.js';
import { MessageList } from './MessageList.js';
import { MessageInput } from './MessageInput.js';

export function ChatPanel(): React.JSX.Element {
  const { messages, isStreaming, startChat, stopChat } = useChat();

  return (
    <Box flexDirection="column" flexGrow={1}>
      <MessageList messages={messages} isStreaming={isStreaming} />
      <MessageInput
        onSubmit={(text) => startChat(text)}
        onStop={() => stopChat()}
        isStreaming={isStreaming}
      />
    </Box>
  );
}
