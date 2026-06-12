import React, { useState, useCallback, useMemo } from 'react';
import { Box } from 'ink';

import { useTuiContext } from '../../context/TuiContext.js';
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
import { AgentConfigBar } from './AgentConfigBar.js';
import { CommandOverlay } from '../overlays/CommandOverlay.js';
import { FilePickerOverlay } from '../overlays/FilePickerOverlay.js';
import type { UseAgentConfigResult } from '../../hooks/use-agent-config.js';

interface ChatPanelProps {
  modalActive?: boolean;
  onOverlayActiveChange?: (active: boolean) => void;
  onClear?: () => void;
  onSettings?: () => void;
  onSessions?: () => void;
  onQuit?: () => void;
  workspacePath?: string;
  agentConfig?: UseAgentConfigResult;
  authReady?: boolean;
}

export function ChatPanel({
  modalActive = false,
  onOverlayActiveChange,
  onClear,
  onSettings,
  onSessions,
  onQuit,
  workspacePath,
  agentConfig,
  authReady = false,
}: ChatPanelProps): React.JSX.Element {
  const { transport, pushAdapter } = useTuiContext();
  const { messages, isStreaming, send, stop, clear, addSystemMessage } =
    useChat(transport, pushAdapter, workspacePath);

  const [inputValue, setInputValue] = useState('');

  const [overlayType, setOverlayType] = useState<'command' | 'file' | null>(
    null,
  );
  const [overlayQuery, setOverlayQuery] = useState('');

  const filePicker = useFilePicker();

  const commandCallbacks = useMemo(
    (): CommandCallbacks => ({
      onClear: () => {
        clear();
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
        void send(text);
      },
    }),
    [clear, addSystemMessage, send, onClear, onSettings, onSessions, onQuit],
  );

  const { commands, executeCommand } = useCommands(commandCallbacks);

  const handleInputChange = useCallback(
    (value: string): void => {
      setInputValue(value);

      if (value.startsWith('/')) {
        const newQuery = value.slice(1);
        setOverlayType('command');
        setOverlayQuery(newQuery);
        onOverlayActiveChange?.(true);
        return;
      }

      const atIndex = value.lastIndexOf('@');
      if (atIndex >= 0) {
        const afterAt = value.slice(atIndex + 1);
        const spaceIndex = afterAt.indexOf(' ');
        if (spaceIndex < 0) {
          setOverlayType('file');
          setOverlayQuery(afterAt);
          filePicker.searchFiles(afterAt);
          onOverlayActiveChange?.(true);
          return;
        }
      }

      if (overlayType !== null) {
        setOverlayType(null);
        setOverlayQuery('');
        onOverlayActiveChange?.(false);
      }
    },
    [overlayType, onOverlayActiveChange, filePicker],
  );

  const handleCommandSelect = useCallback(
    async (command: CommandEntry): Promise<void> => {
      const inputWithoutSlash = inputValue.slice(1);
      const spaceIndex = inputWithoutSlash.indexOf(' ');
      const args =
        spaceIndex >= 0 ? inputWithoutSlash.slice(spaceIndex + 1) : '';

      const result = await executeCommand(command.name, args);

      if (result !== null) {
        addSystemMessage(result);
      }

      setOverlayType(null);
      setOverlayQuery('');
      setInputValue('');
      onOverlayActiveChange?.(false);
    },
    [inputValue, executeCommand, addSystemMessage, onOverlayActiveChange],
  );

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

  const handleOverlayDismiss = useCallback((): void => {
    setOverlayType(null);
    setOverlayQuery('');
    setInputValue('');
    onOverlayActiveChange?.(false);
  }, [onOverlayActiveChange]);

  const handleSubmit = useCallback(
    (text: string): void => {
      if (text.startsWith('/')) {
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

        setOverlayType(null);
        setOverlayQuery('');
        onOverlayActiveChange?.(false);
        return;
      }

      void send(text);
    },
    [send, executeCommand, addSystemMessage, onOverlayActiveChange],
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
      {agentConfig && (
        <AgentConfigBar
          model={agentConfig.model}
          effort={agentConfig.effort}
          permissionLevel={agentConfig.permissionLevel}
          autopilotEnabled={agentConfig.autopilotEnabled}
          authReady={authReady}
        />
      )}
      <MessageInput
        onSubmit={handleSubmit}
        onStop={() => void stop()}
        isStreaming={isStreaming}
        modalActive={modalActive || isOverlayActive}
        value={inputValue}
        onValueChange={handleInputChange}
      />
    </Box>
  );
}
