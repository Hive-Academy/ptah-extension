import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

import { useTheme } from '../../hooks/use-theme.js';
import { Spinner } from '../atoms/index.js';

interface MessageInputProps {
  onSubmit: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  modalActive?: boolean;
  value?: string;
  onValueChange?: (value: string) => void;
}

export function MessageInput({
  onSubmit,
  onStop,
  isStreaming,
  modalActive = false,
  value: controlledValue,
  onValueChange,
}: MessageInputProps): React.JSX.Element {
  const theme = useTheme();

  const [internalValue, setInternalValue] = useState('');

  const isControlled = controlledValue !== undefined;
  const currentValue = isControlled ? controlledValue : internalValue;

  const handleChange = useCallback(
    (newValue: string): void => {
      if (isControlled) {
        onValueChange?.(newValue);
      } else {
        setInternalValue(newValue);
      }
    },
    [isControlled, onValueChange],
  );

  useInput(
    (_input, key) => {
      if (key.escape && isStreaming) {
        onStop();
      }
    },
    { isActive: isStreaming },
  );

  const handleSubmit = useCallback(
    (text: string): void => {
      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;

      onSubmit(trimmed);

      if (isControlled) {
        onValueChange?.('');
      } else {
        setInternalValue('');
      }
    },
    [isStreaming, onSubmit, isControlled, onValueChange],
  );

  return (
    <Box
      borderStyle="round"
      borderColor={isStreaming ? theme.status.warning : theme.ui.border}
      paddingX={1}
      marginX={0}
    >
      {isStreaming ? (
        <Box gap={1}>
          <Spinner label="Streaming..." />
          <Text dimColor>(Escape to stop)</Text>
        </Box>
      ) : (
        <Box flexGrow={1}>
          <Text color={theme.ui.brand} bold>
            {'❯ '}
          </Text>
          <TextInput
            value={currentValue}
            onChange={handleChange}
            onSubmit={handleSubmit}
            placeholder="Send a message..."
            focus={!isStreaming && !modalActive}
          />
        </Box>
      )}
    </Box>
  );
}
