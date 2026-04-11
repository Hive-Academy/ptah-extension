/**
 * App -- Root Ink component for the TUI application.
 *
 * TASK_2025_263 Batch 3 + Batch 4 + TASK_2025_266 Batch 5
 *
 * Wraps the component tree in TuiProvider and wires up:
 *   - Global keybindings (Ctrl+Q quit, Ctrl+B sidebar, Ctrl+S settings, Escape)
 *   - Ctrl+K: Command Palette modal
 *   - Ctrl+M: Model Selector modal
 *   - Layout with sidebar and status bar
 *   - MainPanel with ChatPanel
 *   - ModalOverlay with modal stack for permission/question prompts
 *   - Push event subscriptions for 'permission:request' and 'ask-user-question:request'
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useInput, useApp } from 'ink';

import { TuiProvider } from '../context/TuiContext.js';
import { ThemeProvider } from '../context/ThemeContext.js';
import { SessionProvider } from '../context/SessionContext.js';
import { ModeProvider } from '../context/ModeContext.js';
import { FocusProvider } from '../hooks/use-focus-manager.js';
import type { CliMessageTransport } from '../transport/cli-message-transport.js';
import type { CliWebviewManagerAdapter } from '../transport/cli-webview-manager-adapter.js';
import type { CliFireAndForgetHandler } from '../transport/cli-fire-and-forget-handler.js';
import { ErrorBoundary } from './common/ErrorBoundary.js';
import { Layout } from './layout/Layout.js';
import { MainPanel } from './main-panel/MainPanel.js';
import { ChatPanel } from './chat/ChatPanel.js';
import { ModalOverlay } from './common/ModalOverlay.js';
import { PermissionPrompt } from './common/PermissionPrompt.js';
import { UserQuestionPrompt } from './common/UserQuestionPrompt.js';
import { CommandPalette } from './overlays/CommandPalette.js';
import { ModelSelector } from './overlays/ModelSelector.js';

interface AppProps {
  transport: CliMessageTransport;
  pushAdapter: CliWebviewManagerAdapter;
  fireAndForget: CliFireAndForgetHandler;
}

export function App({
  transport,
  pushAdapter,
  fireAndForget,
}: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const [activeView, setActiveView] = useState<'chat' | 'settings'>('chat');
  const [sidebarVisible, setSidebarVisible] = useState(false);
  const [agentPanelVisible, setAgentPanelVisible] = useState(true);
  const [modalStack, setModalStack] = useState<React.ReactNode[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);

  const handleSwitchView = useCallback((view: 'chat' | 'settings') => {
    setActiveView(view);
  }, []);

  // ---- Push event subscriptions for permission and question modals ----
  useEffect(() => {
    const handlePermissionRequest = (payload: unknown): void => {
      const data = payload as {
        id: string;
        toolName: string;
        description?: string;
        toolInput?: Readonly<Record<string, unknown>>;
      };
      const handleDecision = (
        decision: 'allow' | 'deny' | 'always_allow',
      ): void => {
        fireAndForget.handlePermissionResponse({
          id: data.id,
          decision,
        });
        setModalStack((prev) => prev.slice(0, -1));
      };
      setModalStack((prev) => [
        ...prev,
        <PermissionPrompt
          key={`perm-${data.id}`}
          toolName={data.toolName}
          description={data.description}
          input={data.toolInput}
          onDecision={handleDecision}
        />,
      ]);
    };

    const handleAskUserQuestion = (payload: unknown): void => {
      const data = payload as {
        id: string;
        questions: Array<{
          question: string;
          header: string;
          options: Array<{ label: string; description: string }>;
          multiSelect: boolean;
        }>;
      };
      const handleAnswer = (answers: Record<string, string>): void => {
        fireAndForget.handleQuestionResponse({
          id: data.id,
          answers,
        });
        setModalStack((prev) => prev.slice(0, -1));
      };
      setModalStack((prev) => [
        ...prev,
        <UserQuestionPrompt
          key={`q-${data.id}`}
          questions={data.questions}
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

  // Track streaming state from chat push events so StatusBar can show indicator
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

  // Derive modal active state for focus management (CRITICAL-2 fix).
  // When a modal is visible, all background useInput hooks must be disabled
  // to prevent Y/N/D keypresses from leaking into SessionList, SettingsPanel, etc.
  const modalActive = modalStack.length > 0;

  // Track inline overlay state (e.g., slash command overlay in ChatPanel).
  // This is separate from modals -- overlays render inline, not stacked.
  const [overlayActive, setOverlayActive] = useState(false);

  const handleOverlayActiveChange = useCallback((active: boolean) => {
    setOverlayActive(active);
  }, []);

  // Global keybindings (only active in real TTY environments and when no modal/overlay is open)
  useInput(
    (input, key) => {
      if (key.ctrl && input === 'q') {
        exit();
      }

      if (key.ctrl && input === 'b') {
        setAgentPanelVisible((prev) => !prev);
      }

      if (key.ctrl && input === 'e') {
        setSidebarVisible((prev) => !prev);
      }

      if (key.ctrl && input === 'n') {
        void transport.call('session:create', {});
      }

      if (key.ctrl && input === 's') {
        setActiveView((prev) => (prev === 'chat' ? 'settings' : 'chat'));
      }

      if (key.ctrl && input === 'k') {
        const handleDismiss = (): void => {
          setModalStack((prev) => prev.slice(0, -1));
        };
        const handleExecute = (name: string): void => {
          handleDismiss();
          // The command will be handled by ChatPanel's command system.
          // For now, we just close the palette.
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

  // Top modal in the stack (if any)
  const topModal = modalActive ? modalStack[modalStack.length - 1] : undefined;

  return (
    <TuiProvider
      transport={transport}
      pushAdapter={pushAdapter}
      fireAndForget={fireAndForget}
    >
      <ThemeProvider>
        <FocusProvider initialScope="global">
          <SessionProvider>
            <ModeProvider>
              <ErrorBoundary>
                <Layout
                  sidebarVisible={sidebarVisible}
                  agentPanelVisible={agentPanelVisible}
                  activeView={activeView}
                  isStreaming={isStreaming}
                  modalActive={modalActive || overlayActive}
                >
                  <MainPanel
                    activeView={activeView}
                    onSwitchView={handleSwitchView}
                    modalActive={modalActive}
                  >
                    <ChatPanel
                      modalActive={modalActive}
                      onOverlayActiveChange={handleOverlayActiveChange}
                      onSettings={() => setActiveView('settings')}
                      onSessions={() => setSidebarVisible((prev) => !prev)}
                      onQuit={() => exit()}
                    />
                  </MainPanel>
                </Layout>
                <ModalOverlay visible={modalStack.length > 0}>
                  {topModal}
                </ModalOverlay>
              </ErrorBoundary>
            </ModeProvider>
          </SessionProvider>
        </FocusProvider>
      </ThemeProvider>
    </TuiProvider>
  );
}
