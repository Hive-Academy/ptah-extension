/**
 * ChatPanel -- Container component for the chat interface.
 *
 * TASK_2025_263 Batch 3 + TASK_2025_266 Batch 4 + Batch 5
 *
 * Composes MessageList, CommandOverlay, FilePickerOverlay, and MessageInput.
 * Manages:
 *   - Chat state via useChat()
 *   - Slash command overlay detection (input starts with "/")
 *   - File picker overlay detection (input contains "@")
 *   - Command execution via useCommands()
 *   - File search via useFilePicker()
 *
 * The overlays are "inline" -- rendered within ChatPanel above MessageInput,
 * NOT pushed onto the App-level modal stack.
 */

import React, { useState, useCallback, useMemo } from 'react';
import { Box } from 'ink';

import { useChat } from '../../hooks/use-chat.js';
import { useCommands } from '../../hooks/use-commands.js';
import type {
  CommandCallbacks,
  CommandEntry,
} from '../../hooks/use-commands.js';
import { useFilePicker } from '../../hooks/use-file-picker.js';
import type { FileEntry } from '../../hooks/use-file-picker.js';
import { MessageList } from './MessageList.js';
import { MessageInput } from './MessageInput.js';
import { CommandOverlay } from '../overlays/CommandOverlay.js';
import { FilePickerOverlay } from '../overlays/FilePickerOverlay.js';

interface ChatPanelProps {
  /** When true, a modal overlay is active and keyboard input should be suppressed. */
  modalActive?: boolean;
  /** Notify parent when an inline overlay becomes active/inactive. */
  onOverlayActiveChange?: (active: boolean) => void;
  /** Clear the chat message history. */
  onClear?: () => void;
  /** Open the settings panel. */
  onSettings?: () => void;
  /** Toggle the session sidebar. */
  onSessions?: () => void;
  /** Exit the application. */
  onQuit?: () => void;
}

export function ChatPanel({
  modalActive = false,
  onOverlayActiveChange,
  onClear,
  onSettings,
  onSessions,
  onQuit,
}: ChatPanelProps): React.JSX.Element {
  const {
    messages,
    isStreaming,
    startChat,
    stopChat,
    clearMessages,
    addSystemMessage,
  } = useChat();

  // Input value is lifted here so ChatPanel can clear it after command execution.
  const [inputValue, setInputValue] = useState('');

  // Overlay state
  const [overlayType, setOverlayType] = useState<'command' | 'file' | null>(
    null,
  );
  const [overlayQuery, setOverlayQuery] = useState('');

  // File picker hook
  const filePicker = useFilePicker();

  // Command callbacks
  const commandCallbacks = useMemo(
    (): CommandCallbacks => ({
      onClear: () => {
        clearMessages();
        onClear?.();
      },
      onSettings: () => {
        onSettings?.();
      },
      onSessions: () => {
        onSessions?.();
      },
      onQuit: () => {
        onQuit?.();
      },
      onSystemMessage: (text: string) => {
        addSystemMessage(text);
      },
      onSendMessage: (text: string) => {
        void startChat(text);
      },
    }),
    [
      clearMessages,
      addSystemMessage,
      startChat,
      onClear,
      onSettings,
      onSessions,
      onQuit,
    ],
  );

  const { commands, executeCommand } = useCommands(commandCallbacks);

  /**
   * Handle input value changes to detect slash command prefix and @ file picker.
   * "/" detection takes priority over "@".
   */
  const handleInputChange = useCallback(
    (value: string): void => {
      setInputValue(value);

      // "/" detection (slash commands) takes priority
      if (value.startsWith('/')) {
        const newQuery = value.slice(1);
        setOverlayType('command');
        setOverlayQuery(newQuery);
        onOverlayActiveChange?.(true);
        return;
      }

      // "@" detection (file picker) -- find the last "@" in the input
      const atIndex = value.lastIndexOf('@');
      if (atIndex >= 0) {
        // Extract text after the last "@" until end of string
        const afterAt = value.slice(atIndex + 1);
        // Only activate if there's no space after the @ (still typing the query)
        // or the query is empty (just typed "@")
        const spaceIndex = afterAt.indexOf(' ');
        if (spaceIndex < 0) {
          // Still typing after @ -- activate file picker
          setOverlayType('file');
          setOverlayQuery(afterAt);
          filePicker.searchFiles(afterAt);
          onOverlayActiveChange?.(true);
          return;
        }
      }

      // No trigger detected -- dismiss any active overlay
      if (overlayType !== null) {
        setOverlayType(null);
        setOverlayQuery('');
        onOverlayActiveChange?.(false);
      }
    },
    [overlayType, onOverlayActiveChange, filePicker],
  );

  /**
   * Handle command selection from the overlay.
   * Extracts the command name from the current input, executes it,
   * and clears the overlay and input.
   */
  const handleCommandSelect = useCallback(
    async (command: CommandEntry): Promise<void> => {
      // Parse args from input: "/commandname some args" -> args = "some args"
      const inputWithoutSlash = inputValue.slice(1);
      const spaceIndex = inputWithoutSlash.indexOf(' ');
      const args =
        spaceIndex >= 0 ? inputWithoutSlash.slice(spaceIndex + 1) : '';

      const result = await executeCommand(command.name, args);

      if (result !== null) {
        addSystemMessage(result);
      }

      // Clear overlay and input
      setOverlayType(null);
      setOverlayQuery('');
      setInputValue('');
      onOverlayActiveChange?.(false);
    },
    [inputValue, executeCommand, addSystemMessage, onOverlayActiveChange],
  );

  /**
   * Handle file selection from the file picker overlay.
   * Replaces "@query" in the input with "@relativePath ".
   */
  const handleFileSelect = useCallback(
    (file: FileEntry): void => {
      const atIndex = inputValue.lastIndexOf('@');
      if (atIndex >= 0) {
        const before = inputValue.slice(0, atIndex);
        const newValue = `${before}@${file.relativePath} `;
        setInputValue(newValue);
      }

      setOverlayType(null);
      setOverlayQuery('');
      onOverlayActiveChange?.(false);
    },
    [inputValue, onOverlayActiveChange],
  );

  /**
   * Dismiss the overlay without executing a command.
   */
  const handleOverlayDismiss = useCallback((): void => {
    setOverlayType(null);
    setOverlayQuery('');
    setInputValue('');
    onOverlayActiveChange?.(false);
  }, [onOverlayActiveChange]);

  /**
   * Handle message submission. If the text starts with "/", treat it as a
   * command; otherwise send it as a chat message.
   */
  const handleSubmit = useCallback(
    (text: string): void => {
      if (text.startsWith('/')) {
        // Parse as command
        const withoutSlash = text.slice(1);
        const spaceIndex = withoutSlash.indexOf(' ');
        const name =
          spaceIndex >= 0 ? withoutSlash.slice(0, spaceIndex) : withoutSlash;
        const args = spaceIndex >= 0 ? withoutSlash.slice(spaceIndex + 1) : '';

        void executeCommand(name, args).then((result) => {
          if (result !== null) {
            addSystemMessage(result);
          }
        });

        // Clear overlay if active
        setOverlayType(null);
        setOverlayQuery('');
        onOverlayActiveChange?.(false);
        return;
      }

      void startChat(text);
    },
    [startChat, executeCommand, addSystemMessage, onOverlayActiveChange],
  );

  const isOverlayActive = overlayType !== null;
  const isCommandOverlay = overlayType === 'command';
  const isFileOverlay = overlayType === 'file';

  return (
    <Box flexDirection="column" flexGrow={1}>
      <MessageList messages={messages} isStreaming={isStreaming} />
      {isCommandOverlay && (
        <CommandOverlay
          query={overlayQuery}
          commands={commands}
          onSelect={(cmd) => {
            void handleCommandSelect(cmd);
          }}
          onDismiss={handleOverlayDismiss}
          isActive={isCommandOverlay && !modalActive}
        />
      )}
      {isFileOverlay && (
        <FilePickerOverlay
          query={overlayQuery}
          files={filePicker.files}
          loading={filePicker.loading}
          onSelect={handleFileSelect}
          onDismiss={handleOverlayDismiss}
          isActive={isFileOverlay && !modalActive}
        />
      )}
      <MessageInput
        onSubmit={handleSubmit}
        onStop={() => stopChat()}
        isStreaming={isStreaming}
        modalActive={modalActive || isOverlayActive}
        value={inputValue}
        onValueChange={handleInputChange}
      />
    </Box>
  );
}
