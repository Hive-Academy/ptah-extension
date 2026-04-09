/**
 * MessageInput -- Text input for composing and sending chat messages.
 *
 * Uses ink-text-input for controlled text entry.
 * When streaming, disables input and shows a streaming indicator.
 * Enter submits the message; Escape stops streaming.
 */

import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

interface MessageInputProps {
  onSubmit: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
}

export function MessageInput({
  onSubmit,
  onStop,
  isStreaming,
}: MessageInputProps): React.JSX.Element {
  const [value, setValue] = useState('');

  useInput(
    (_input, key) => {
      if (key.escape && isStreaming) {
        onStop();
      }
    },
    { isActive: isStreaming },
  );

  const handleSubmit = (text: string): void => {
    const trimmed = text.trim();
    if (!trimmed || isStreaming) return;

    onSubmit(trimmed);
    setValue('');
  };

  return (
    <Box
      borderStyle="round"
      borderColor={isStreaming ? '#f59e0b' : '#374151'}
      paddingX={1}
      marginX={0}
    >
      {isStreaming ? (
        <Box gap={1}>
          <Text color="#f59e0b">{'◉'}</Text>
          <Text color="#f59e0b">Streaming...</Text>
          <Text dimColor>(Escape to stop)</Text>
        </Box>
      ) : (
        <Box flexGrow={1}>
          <Text color="#7c3aed" bold>
            {'❯ '}
          </Text>
          <TextInput
            value={value}
            onChange={setValue}
            onSubmit={handleSubmit}
            placeholder="Send a message..."
            focus={!isStreaming}
          />
        </Box>
      )}
    </Box>
  );
}
