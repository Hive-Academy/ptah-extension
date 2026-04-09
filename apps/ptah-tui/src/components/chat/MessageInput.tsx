/**
 * MessageInput -- Text input for composing and sending chat messages.
 *
 * TASK_2025_266 Batch 4: Added controlled value mode (value/onValueChange)
 * to allow ChatPanel to manage input state for slash command detection.
 *
 * Uses ink-text-input for controlled text entry.
 * When streaming, disables input and shows a streaming indicator.
 * Enter submits the message; Escape stops streaming.
 */

import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

import { useTheme } from '../../hooks/use-theme.js';

interface MessageInputProps {
  onSubmit: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  /** When true, suppress focus to allow overlays or modals to capture input. */
  modalActive?: boolean;
  /** Controlled value (optional). If provided, parent manages the input state. */
  value?: string;
  /** Controlled value change handler. Required when value is provided. */
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

  // Internal state for uncontrolled mode (backwards-compatible fallback)
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
          <Text color={theme.status.warning}>{'◉'}</Text>
          <Text color={theme.status.warning}>Streaming...</Text>
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
