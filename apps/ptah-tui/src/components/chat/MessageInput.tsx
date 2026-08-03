import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';

import { useTheme } from '../../hooks/use-theme.js';
import { Spinner } from '../atoms/index.js';
import {
  isComposerFocused,
  shouldComposerSubmit,
  shouldRollBackChord,
} from './composer-state.js';

interface MessageInputProps {
  onSubmit: (text: string) => void;
  onStop: () => void;
  isStreaming: boolean;
  /** A real modal (permission prompt, palette) owns the screen — blur. */
  modalActive?: boolean;
  /**
   * The inline `/` command or `@` file overlay is open. The composer KEEPS
   * focus (the overlay filters on what you type here) but yields Enter.
   */
  overlayActive?: boolean;
  value?: string;
  onValueChange?: (value: string) => void;
}

export function MessageInput({
  onSubmit,
  onStop,
  isStreaming,
  modalActive = false,
  overlayActive = false,
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

  const composerState = { modalActive, overlayActive, isStreaming };
  const inputFocused = isComposerFocused(composerState);

  useInput(
    (input, key) => {
      if (key.escape && isStreaming) {
        onStop();
        return;
      }

      // This handler runs AFTER TextInput's (child effects register first), so
      // the stray character is already in the buffer and we roll the value
      // back to what it was before the chord.
      if (shouldRollBackChord(composerState, key, input)) {
        handleChange(currentValue);
      }
    },
    { isActive: isStreaming || inputFocused },
  );

  const handleSubmit = useCallback(
    (text: string): void => {
      if (!shouldComposerSubmit({ modalActive, overlayActive, isStreaming })) {
        return;
      }

      const trimmed = text.trim();
      if (!trimmed || isStreaming) return;

      onSubmit(trimmed);

      if (isControlled) {
        onValueChange?.('');
      } else {
        setInternalValue('');
      }
    },
    [
      modalActive,
      overlayActive,
      isStreaming,
      onSubmit,
      isControlled,
      onValueChange,
    ],
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
            focus={inputFocused}
          />
        </Box>
      )}
    </Box>
  );
}
