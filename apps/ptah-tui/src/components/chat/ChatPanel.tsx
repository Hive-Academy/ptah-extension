import React, {
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { Box } from 'ink';

import { useTuiContext } from '../../context/TuiContext.js';
import { useChat } from '../../hooks/use-chat.js';
import { useCommands } from '../../hooks/use-commands.js';
import type {
  CommandCallbacks,
  CommandEntry,
} from '../../hooks/use-commands.js';
import { useFilePicker } from '../../hooks/use-file-picker.js';
import { useFilePickRequests } from '../../hooks/use-file-pick-requests.js';
import type { FileEntry } from '../../hooks/use-file-picker.js';
import { MessageList } from './MessageList.js';
import { MessageInput } from './MessageInput.js';
import { AgentConfigBar } from './AgentConfigBar.js';
import { CommandOverlay } from '../overlays/CommandOverlay.js';
import { FilePickerOverlay } from '../overlays/FilePickerOverlay.js';
import type { UseAgentConfigResult } from '../../hooks/use-agent-config.js';
import { shouldOpenHelp } from '../../lib/keymap.js';

interface ChatPanelProps {
  modalActive?: boolean;
  onOverlayActiveChange?: (active: boolean) => void;
  onStreamingChange?: (streaming: boolean) => void;
  /** Publishes this panel's command executor so the Ctrl+K palette can run it. */
  registerCommandSink?: (
    sink: ((name: string, args: string) => void) | null,
  ) => void;
  onClear?: () => void;
  onSettings?: () => void;
  onSessions?: () => void;
  onQuit?: () => void;
  onHelp?: () => void;
  agentConfig?: UseAgentConfigResult;
  authReady?: boolean;
  authError?: string;
  /** Reports transcript emptiness up so the status line can derive its label. */
  onConversationChange?: (hasConversation: boolean) => void;
}

export function ChatPanel({
  modalActive = false,
  onOverlayActiveChange,
  onStreamingChange,
  registerCommandSink,
  onClear,
  onSettings,
  onSessions,
  onQuit,
  onHelp,
  agentConfig,
  authReady = false,
  authError,
  onConversationChange,
}: ChatPanelProps): React.JSX.Element {
  // `workspacePath` comes from the context, not a prop: it was previously an
  // optional prop that no caller ever passed, so every chat session started
  // without a workspace root.
  const {
    transport,
    pushAdapter,
    workspacePath,
    filePicker: pickerBridge,
  } = useTuiContext();
  const { messages, isStreaming, send, stop, clear, addSystemMessage } =
    useChat(transport, pushAdapter, workspacePath);

  const [inputValue, setInputValue] = useState('');

  // Single source of truth for the status bar: the controller, not a second
  // set of push listeners that can never observe a watchdog timeout.
  useEffect(() => {
    onStreamingChange?.(isStreaming);
  }, [isStreaming, onStreamingChange]);

  // The status line derives its session label from this rather than from the
  // once-at-mount `sessions` array, which is what used to read "No session"
  // halfway through a conversation.
  useEffect(() => {
    onConversationChange?.(messages.length > 0);
  }, [messages.length, onConversationChange]);

  // Latest-callback refs so the unmount cleanup below can run exactly once
  // without capturing stale props or re-firing on every render.
  const teardownRef = useRef({ onOverlayActiveChange, onStreamingChange });
  teardownRef.current = { onOverlayActiveChange, onStreamingChange };

  // `overlayActive` lives in AppShell but is only ever cleared by callbacks
  // from here. Switching view with Ctrl+S / Ctrl+T while an overlay was open
  // unmounted this panel without clearing it, leaving the app-shell `useInput`
  // permanently disabled — Ctrl+S could then never bring you back.
  useEffect(() => {
    return () => {
      teardownRef.current.onOverlayActiveChange?.(false);
      teardownRef.current.onStreamingChange?.(false);
    };
  }, []);

  const [overlayType, setOverlayType] = useState<'command' | 'file' | null>(
    null,
  );
  const [overlayQuery, setOverlayQuery] = useState('');

  const filePicker = useFilePicker();
  // Backend-initiated `file:pick`: the RPC handler parks a request on the
  // bridge and this settles it from the same overlay the @-mention uses.
  const pickRequests = useFilePickRequests(pickerBridge, workspacePath);

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

  useEffect(() => {
    const sink = (name: string, args: string): void => {
      void executeCommand(name, args).then((result) => {
        if (result !== null) {
          addSystemMessage(result);
        }
      });
    };
    registerCommandSink?.(sink);
    return () => registerCommandSink?.(null);
  }, [registerCommandSink, executeCommand, addSystemMessage]);

  const handleInputChange = useCallback(
    (value: string): void => {
      // `?` on its own opens the shortcut help and clears the composer, so the
      // help is reachable without a Ctrl-chord — terminals intercept those
      // inconsistently, which is what made the old keymap feel broken. Any
      // longer string containing `?` is just a message.
      if (shouldOpenHelp(value)) {
        setInputValue('');
        onHelp?.();
        return;
      }

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
    [overlayType, onOverlayActiveChange, filePicker, onHelp],
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

  const isOverlayActive = overlayType !== null || pickRequests.active;
  const isCommandOverlay = overlayType === 'command';
  const isFileOverlay = overlayType === 'file' || pickRequests.active;

  return (
    <Box flexDirection="column" flexGrow={1}>
      <MessageList
        messages={messages}
        isStreaming={isStreaming}
        authReady={authReady}
        authError={authError}
        model={agentConfig?.model ?? null}
      />
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
          onSelect={
            pickRequests.active ? pickRequests.select : handleFileSelect
          }
          onDismiss={
            pickRequests.active ? pickRequests.finish : handleOverlayDismiss
          }
          isActive={isFileOverlay && !modalActive}
        />
      )}
      {agentConfig && (
        <AgentConfigBar
          effort={agentConfig.effort}
          permissionLevel={agentConfig.permissionLevel}
          autopilotEnabled={agentConfig.autopilotEnabled}
          authReady={authReady}
        />
      )}
      {/*
        `modalActive` and `isOverlayActive` used to be OR'd into one prop, which
        blurred the composer the instant an overlay opened. That is why file
        search looked broken: typing `@` opened the picker and then swallowed
        every following character, so the only query ever issued was the empty
        one and the list never narrowed.
      */}
      <MessageInput
        onSubmit={handleSubmit}
        onStop={() => void stop()}
        isStreaming={isStreaming}
        modalActive={modalActive}
        overlayActive={isOverlayActive}
        value={inputValue}
        onValueChange={handleInputChange}
      />
    </Box>
  );
}
