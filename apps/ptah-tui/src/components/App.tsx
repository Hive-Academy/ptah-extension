import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import type {
  PermissionRequest,
  AskUserQuestionRequest,
} from '@ptah-extension/shared';
import type {
  CliMessageTransport,
  CliWebviewManagerAdapter,
  CliFireAndForgetHandler,
} from '@ptah-extension/cli-engine';

import { TuiProvider } from '../context/TuiContext.js';
import type { TuiFilePickerBridge } from '../transport/tui-file-picker-bridge.js';
import { ThemeProvider } from '../context/ThemeContext.js';
import {
  SessionProvider,
  useSessionContext,
} from '../context/SessionContext.js';
import { ModeProvider } from '../context/ModeContext.js';
import { FocusProvider } from '../hooks/use-focus-manager.js';
import { ErrorBoundary } from './common/ErrorBoundary.js';
import { Layout } from './layout/Layout.js';
import { MainPanel } from './main-panel/MainPanel.js';
import { ChatPanel } from './chat/ChatPanel.js';
import { ModalOverlay } from './common/ModalOverlay.js';
import { PermissionPrompt } from './common/PermissionPrompt.js';
import type { PermissionDecision } from './common/PermissionPrompt.js';
import { UserQuestionPrompt } from './common/UserQuestionPrompt.js';
import { CommandPalette } from './overlays/CommandPalette.js';
import { ModelSelector } from './overlays/ModelSelector.js';
import { ThothPanel } from './thoth/ThothPanel.js';
import type { ThothLifecycle } from '../lib/thoth-lifecycle.js';
import { useAgentConfig } from '../hooks/use-agent-config.js';
import { resolveInitialView } from './initial-view.js';
import type { ActiveView } from './initial-view.js';

interface AppProps {
  transport: CliMessageTransport;
  pushAdapter: CliWebviewManagerAdapter;
  fireAndForget: CliFireAndForgetHandler;
  workspacePath: string;
  filePicker?: TuiFilePickerBridge;
  authReady: boolean;
  authError?: string;
  reinitializeSdk: () => Promise<boolean>;
  thothLifecycle: ThothLifecycle;
  onQuit: () => void;
}

interface AppShellProps {
  pushAdapter: CliWebviewManagerAdapter;
  fireAndForget: CliFireAndForgetHandler;
  authReady: boolean;
  authError?: string;
  thothLifecycle: ThothLifecycle;
  onQuit: () => void;
}

function AppShell({
  pushAdapter,
  fireAndForget,
  authReady,
  authError,
  thothLifecycle,
  onQuit,
}: AppShellProps): React.JSX.Element {
  const { exit } = useApp();
  const { setActiveSession } = useSessionContext();
  const agentConfig = useAgentConfig();

  const [activeView, setActiveView] = useState<ActiveView>(() =>
    resolveInitialView(authReady),
  );
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [agentPanelVisible, setAgentPanelVisible] = useState(true);
  const [modalStack, setModalStack] = useState<React.ReactNode[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [overlayActive, setOverlayActive] = useState(false);

  // Ctrl+K opens the palette from the shell, but the command machinery
  // (`useCommands`) is owned by ChatPanel, which holds the chat callbacks the
  // commands act on. ChatPanel publishes its executor here on mount so the
  // palette can actually run a selection — previously `onExecute` was
  // `handleDismiss(); void name;`, i.e. the advertised ^K did nothing at all.
  const commandSinkRef = useRef<((name: string, args: string) => void) | null>(
    null,
  );
  const registerCommandSink = useCallback(
    (sink: ((name: string, args: string) => void) | null) => {
      commandSinkRef.current = sink;
    },
    [],
  );

  const handleQuit = useCallback(() => {
    onQuit();
    exit();
  }, [onQuit, exit]);

  const handleSwitchView = useCallback((view: 'chat' | 'settings') => {
    setActiveView(view);
  }, []);

  useEffect(() => {
    const handlePermissionRequest = (payload: unknown): void => {
      const request = payload as PermissionRequest;
      const handleDecision = (decision: PermissionDecision): void => {
        fireAndForget.handlePermissionResponse({
          id: request.id,
          decision,
        });
        setModalStack((prev) => prev.slice(0, -1));
      };
      setModalStack((prev) => [
        ...prev,
        <PermissionPrompt
          key={`perm-${request.id}`}
          request={request}
          onDecision={handleDecision}
        />,
      ]);
    };

    const handleAskUserQuestion = (payload: unknown): void => {
      const request = payload as AskUserQuestionRequest;
      const handleAnswer = (answers: Record<string, string>): void => {
        fireAndForget.handleQuestionResponse({
          id: request.id,
          answers,
        });
        setModalStack((prev) => prev.slice(0, -1));
      };
      setModalStack((prev) => [
        ...prev,
        <UserQuestionPrompt
          key={`q-${request.id}`}
          request={request}
          onAnswer={handleAnswer}
        />,
      ]);
    };

    pushAdapter.on('permission:request', handlePermissionRequest);
    pushAdapter.on('ask-user-question:request', handleAskUserQuestion);

    return () => {
      pushAdapter.off('permission:request', handlePermissionRequest);
      pushAdapter.off('ask-user-question:request', handleAskUserQuestion);
    };
  }, [pushAdapter, fireAndForget]);

  // The status bar used to derive `isStreaming` from its own
  // `chat:chunk`/`chat:complete` listeners. That is a second source of truth
  // for one piece of state, and it only ever cleared on a push event — so when
  // the backend went silent the bar stayed on "◉ Streaming" forever even after
  // ChatStreamController's watchdog had already ended the turn. The controller
  // is now the only owner; ChatPanel reports its state up.
  const modalActive = modalStack.length > 0;

  const handleOverlayActiveChange = useCallback((active: boolean) => {
    setOverlayActive(active);
  }, []);

  useInput(
    (input, key) => {
      if (key.ctrl && input === 'q') {
        handleQuit();
        return;
      }

      if (key.ctrl && input === 'b') {
        setAgentPanelVisible((prev) => !prev);
      }

      if (key.ctrl && input === 'e') {
        setSidebarVisible((prev) => !prev);
      }

      if (key.ctrl && input === 'n') {
        setActiveSession(null);
      }

      if (key.ctrl && input === 's') {
        setActiveView((prev) => (prev === 'settings' ? 'chat' : 'settings'));
      }

      if (key.ctrl && input === 't') {
        setActiveView((prev) => (prev === 'thoth' ? 'chat' : 'thoth'));
      }

      if (key.ctrl && input === 'r') {
        void agentConfig.cycleEffort();
      }

      if (key.ctrl && input === 'p') {
        void agentConfig.cyclePermission();
      }

      if (key.ctrl && input === 'k') {
        const handleDismiss = (): void => {
          setModalStack((prev) => prev.slice(0, -1));
        };
        const handleExecute = (name: string, args: string): void => {
          handleDismiss();
          commandSinkRef.current?.(name, args);
        };
        setModalStack((prev) => [
          ...prev,
          <CommandPalette
            key={`palette-${Date.now()}`}
            onExecute={handleExecute}
            onDismiss={handleDismiss}
          />,
        ]);
      }

      if (key.ctrl && input === 'm') {
        const handleDismiss = (): void => {
          setModalStack((prev) => prev.slice(0, -1));
        };
        setModalStack((prev) => [
          ...prev,
          <ModelSelector
            key={`model-${Date.now()}`}
            onDismiss={handleDismiss}
          />,
        ]);
      }

      if (key.escape) {
        // Escape returns to the chat surface AND drops the sessions sidebar,
        // which otherwise kept the composer blurred with no obvious way back.
        setActiveView('chat');
        setSidebarVisible(false);
      }
    },
    {
      isActive: process.stdin.isTTY === true && !modalActive && !overlayActive,
    },
  );

  const topModal = modalActive ? modalStack[modalStack.length - 1] : undefined;
  const layoutView: 'chat' | 'settings' =
    activeView === 'settings' ? 'settings' : 'chat';

  return (
    <ErrorBoundary>
      {!authReady && (
        <Box paddingX={1} marginBottom={0}>
          <Text color="yellow">
            Agent not ready
            {authError ? ` — ${authError}` : ''}. Press Ctrl+S → Authentication
            to configure a provider.
          </Text>
        </Box>
      )}
      <Layout
        sidebarVisible={sidebarVisible}
        agentPanelVisible={agentPanelVisible}
        activeView={layoutView}
        isStreaming={isStreaming}
        modalActive={modalActive || overlayActive}
        fallbackModel={agentConfig.model}
      >
        <MainPanel
          activeView={layoutView}
          onSwitchView={handleSwitchView}
          modalActive={modalActive}
        >
          {activeView === 'thoth' ? (
            <ThothPanel
              lifecycle={thothLifecycle}
              pushAdapter={pushAdapter}
              isActive={
                process.stdin.isTTY === true && !modalActive && !overlayActive
              }
            />
          ) : (
            <ChatPanel
              // The sidebar counts as modal for the composer. `SessionList`
              // binds bare letters (n = new, d = delete, y = confirm) and
              // Enter/arrows with only `isFocused={!modalActive}` to guard
              // them, so while the sidebar was open every one of those keys
              // fired from *inside* a chat message: typing "and" created a
              // session and armed a delete. Blurring the composer gives the
              // sidebar sole ownership of the keyboard while it is up.
              modalActive={modalActive || sidebarVisible}
              onOverlayActiveChange={handleOverlayActiveChange}
              onStreamingChange={setIsStreaming}
              registerCommandSink={registerCommandSink}
              onSettings={() => setActiveView('settings')}
              onSessions={() => setSidebarVisible((prev) => !prev)}
              onQuit={handleQuit}
              agentConfig={agentConfig}
              authReady={authReady}
            />
          )}
        </MainPanel>
      </Layout>
      <ModalOverlay visible={modalStack.length > 0}>{topModal}</ModalOverlay>
    </ErrorBoundary>
  );
}

export function App({
  transport,
  pushAdapter,
  fireAndForget,
  workspacePath,
  filePicker,
  authReady,
  authError,
  reinitializeSdk,
  thothLifecycle,
  onQuit,
}: AppProps): React.JSX.Element {
  return (
    <TuiProvider
      transport={transport}
      pushAdapter={pushAdapter}
      fireAndForget={fireAndForget}
      workspacePath={workspacePath}
      filePicker={filePicker}
      reinitializeSdk={reinitializeSdk}
    >
      <ThemeProvider>
        <FocusProvider initialScope="global">
          <SessionProvider
            transport={transport}
            pushAdapter={pushAdapter}
            workspacePath={workspacePath}
          >
            <ModeProvider>
              <AppShell
                pushAdapter={pushAdapter}
                fireAndForget={fireAndForget}
                authReady={authReady}
                authError={authError}
                thothLifecycle={thothLifecycle}
                onQuit={onQuit}
              />
            </ModeProvider>
          </SessionProvider>
        </FocusProvider>
      </ThemeProvider>
    </TuiProvider>
  );
}
