import React, { useState, useCallback, useEffect } from 'react';
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
import { ThemeProvider } from '../context/ThemeContext.js';
import { SessionProvider, useSessionContext } from '../context/SessionContext.js';
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

type ActiveView = 'chat' | 'settings' | 'thoth';

interface AppProps {
  transport: CliMessageTransport;
  pushAdapter: CliWebviewManagerAdapter;
  fireAndForget: CliFireAndForgetHandler;
  workspacePath: string;
  authReady: boolean;
  authError?: string;
  reinitializeSdk: () => Promise<boolean>;
  onQuit: () => void;
}

interface AppShellProps {
  pushAdapter: CliWebviewManagerAdapter;
  fireAndForget: CliFireAndForgetHandler;
  authReady: boolean;
  authError?: string;
  onQuit: () => void;
}

function AppShell({
  pushAdapter,
  fireAndForget,
  authReady,
  authError,
  onQuit,
}: AppShellProps): React.JSX.Element {
  const { exit } = useApp();
  const { setActiveSession } = useSessionContext();

  const [activeView, setActiveView] = useState<ActiveView>('chat');
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [agentPanelVisible, setAgentPanelVisible] = useState(true);
  const [modalStack, setModalStack] = useState<React.ReactNode[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [overlayActive, setOverlayActive] = useState(false);

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

  useEffect(() => {
    const handleChunk = (): void => {
      setIsStreaming(true);
    };
    const handleComplete = (): void => {
      setIsStreaming(false);
    };
    const handleError = (): void => {
      setIsStreaming(false);
    };

    pushAdapter.on('chat:chunk', handleChunk);
    pushAdapter.on('chat:complete', handleComplete);
    pushAdapter.on('chat:error', handleError);

    return () => {
      pushAdapter.off('chat:chunk', handleChunk);
      pushAdapter.off('chat:complete', handleComplete);
      pushAdapter.off('chat:error', handleError);
    };
  }, [pushAdapter]);

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

      if (key.ctrl && input === 'k') {
        const handleDismiss = (): void => {
          setModalStack((prev) => prev.slice(0, -1));
        };
        const handleExecute = (name: string): void => {
          handleDismiss();
          void name;
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
        setActiveView('chat');
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
      >
        <MainPanel
          activeView={layoutView}
          onSwitchView={handleSwitchView}
          modalActive={modalActive}
        >
          <ChatPanel
            modalActive={modalActive}
            onOverlayActiveChange={handleOverlayActiveChange}
            onSettings={() => setActiveView('settings')}
            onSessions={() => setSidebarVisible((prev) => !prev)}
            onQuit={handleQuit}
          />
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
  authReady,
  authError,
  reinitializeSdk,
  onQuit,
}: AppProps): React.JSX.Element {
  return (
    <TuiProvider
      transport={transport}
      pushAdapter={pushAdapter}
      fireAndForget={fireAndForget}
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
                onQuit={onQuit}
              />
            </ModeProvider>
          </SessionProvider>
        </FocusProvider>
      </ThemeProvider>
    </TuiProvider>
  );
}
