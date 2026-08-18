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
import {
  EscapeClaimProvider,
  useEscapeClaimed,
} from '../context/EscapeClaimContext.js';
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
import { HelpOverlay } from './overlays/HelpOverlay.js';
import { ModelSelector } from './overlays/ModelSelector.js';
import { QUIT_CONFIRM_WINDOW_MS } from '../lib/keymap.js';
import { applyEscape } from '../lib/escape-target.js';
import { isMetaChord, noteEscape } from '../lib/meta-chord.js';
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
  const escapeClaimed = useEscapeClaimed();

  const [activeView, setActiveView] = useState<ActiveView>(() =>
    resolveInitialView(authReady),
  );
  const [sidebarVisible, setSidebarVisible] = useState(false);
  // Closed by default. It was open by default, and for the overwhelming
  // majority of runs its entire contribution was the words "No active agents"
  // occupying a fifth of the terminal for the whole session.
  const [agentPanelVisible, setAgentPanelVisible] = useState(false);
  const [modalStack, setModalStack] = useState<React.ReactNode[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [hasConversation, setHasConversation] = useState(false);
  const [overlayActive, setOverlayActive] = useState(false);
  const [quitArmed, setQuitArmed] = useState(false);
  const quitTimerRef = useRef<NodeJS.Timeout | null>(null);

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

  const dismissTopModal = useCallback(() => {
    setModalStack((prev) => prev.slice(0, -1));
  }, []);

  const handleHelp = useCallback(() => {
    setModalStack((prev) => [
      ...prev,
      <HelpOverlay key={`help-${Date.now()}`} onDismiss={dismissTopModal} />,
    ]);
  }, [dismissTopModal]);

  useEffect(() => {
    return () => {
      if (quitTimerRef.current !== null) clearTimeout(quitTimerRef.current);
    };
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
      // Alt, not Ctrl. `Ctrl+<letter>` belongs to readline, and four of these
      // used to sit on line-editing defaults: Ctrl+E (end-of-line), Ctrl+K
      // (kill-to-end), Ctrl+N/Ctrl+P (history). In a composer that IS a text
      // input, the documented way to jump to the end of what you were typing
      // opened the sessions panel instead. `RESERVED_CHORDS` in `keymap.ts`
      // now fails the spec on that class; the layout follows Gemini CLI's.
      //
      // Ink reports Alt+<key> as `{ meta: true, input: '<key>' }` and plain
      // Escape as `{ escape: true }` with no meta, so the two never collide.
      // Verified on a real pty, not assumed.
      //
      // Ctrl+Q is also gone: XON in every terminal's default flow control, so
      // on the terminals that swallow it the advertised quit key did nothing.
      // Quitting is Ctrl+C twice or `/quit`, both in the keymap.
      //
      // `meta`, not `key.meta`: Ink only joins the two bytes of an Alt chord
      // into one keypress when they arrive within 20ms of each other, and when
      // they do not, every binding below silently became a typed letter. This
      // shell is the one place that sees both halves, so it is where the chord
      // is put back together — see `lib/meta-chord.ts`. Recorded before the
      // Escape handling further down, and outside its gates, because an Escape
      // that some other surface has claimed is just as likely to be half of an
      // Alt chord as one that reaches `applyEscape`.
      if (key.escape && key.meta !== true) {
        noteEscape();
      }
      const meta = isMetaChord(key, input);

      if (meta && input === 'a') {
        setAgentPanelVisible((prev) => !prev);
      }

      if (meta && input === 'l') {
        setSidebarVisible((prev) => !prev);
      }

      if (meta && input === 'n') {
        setActiveSession(null);
      }

      if (meta && input === 's') {
        setActiveView((prev) => (prev === 'settings' ? 'chat' : 'settings'));
      }

      if (meta && input === 't') {
        setActiveView((prev) => (prev === 'thoth' ? 'chat' : 'thoth'));
      }

      if (meta && input === 'e') {
        void agentConfig.cycleEffort();
      }

      // Shift+Tab, matching Gemini's `app.cycleApprovalMode`. Ink reports it
      // as `{ shift: true, tab: true }` with empty input.
      if (key.shift && key.tab) {
        void agentConfig.cyclePermission();
      }

      if (meta && input === 'k') {
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

      // Alt+M. Ctrl+M is carriage return (undeliverable) and Ctrl+O is
      // VDISCARD, so neither could carry this. See `keymap.ts`.
      if (meta && input === 'm') {
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

      if (key.ctrl && input === 'c') {
        // Ink is rendered with `exitOnCtrlC: false`, so this is the only Ctrl+C
        // handler. One press arms, a second within the window quits; anything
        // else disarms. A single stray Ctrl+C can no longer end the session.
        if (quitArmed) {
          if (quitTimerRef.current !== null) clearTimeout(quitTimerRef.current);
          handleQuit();
          return;
        }
        setQuitArmed(true);
        quitTimerRef.current = setTimeout(() => {
          setQuitArmed(false);
          quitTimerRef.current = null;
        }, QUIT_CONFIRM_WINDOW_MS);
        return;
      }

      if (quitArmed) {
        setQuitArmed(false);
        if (quitTimerRef.current !== null) {
          clearTimeout(quitTimerRef.current);
          quitTimerRef.current = null;
        }
      }

      // `escapeClaimed` covers the surfaces that bind Escape without being a
      // modal or an overlay — the sidebar's delete confirm and the settings
      // auth configurator. Both used to cancel *and* have this handler close
      // the panel underneath them, two surfaces for one press.
      if (key.escape && !isStreaming && !escapeClaimed) {
        // Exactly ONE surface per press, topmost first, so repeated presses
        // walk deterministically back to the chat. See `lib/escape-target.ts`.
        //
        // Gated on `!isStreaming` because the keymap declares Esc-interrupt
        // (`when: 'streaming'`) and Esc-cancel (`when: 'idle'`) as two
        // phase-disjoint bindings on one key — that is what lets the conflict
        // spec pass. Ungated, an Escape during a turn with a panel open would
        // fire both: stop the stream AND close the panel, which is the
        // two-things-per-press behaviour this task set out to remove.
        const next = applyEscape({
          view: activeView,
          sidebarVisible,
          agentPanelVisible,
        });
        setActiveView(next.view);
        setSidebarVisible(next.sidebarVisible);
        setAgentPanelVisible(next.agentPanelVisible);
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
      {/*
        The "Agent not ready" banner is gone from here: it duplicated the
        welcome screen's provider line, and `resolveInitialView` already opens
        Settings → Authentication when auth is missing, so the banner was
        telling you to press Ctrl+S while you were already looking at the panel
        it would have taken you to.
      */}
      <Layout
        sidebarVisible={sidebarVisible}
        agentPanelVisible={agentPanelVisible}
        activeView={activeView}
        isStreaming={isStreaming}
        hasConversation={hasConversation}
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
              onHelp={handleHelp}
              onConversationChange={setHasConversation}
              agentConfig={agentConfig}
              authReady={authReady}
              authError={authError}
            />
          )}
        </MainPanel>
      </Layout>
      {quitArmed && (
        <Box paddingX={1}>
          <Text color="yellow">
            Press Ctrl+C again to quit — any other key cancels.
          </Text>
        </Box>
      )}
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
              {/*
                Above AppShell because AppShell is the *consumer*: it reads the
                claim to decide whether an Escape press is its own.
              */}
              <EscapeClaimProvider>
                <AppShell
                  pushAdapter={pushAdapter}
                  fireAndForget={fireAndForget}
                  authReady={authReady}
                  authError={authError}
                  thothLifecycle={thothLifecycle}
                  onQuit={onQuit}
                />
              </EscapeClaimProvider>
            </ModeProvider>
          </SessionProvider>
        </FocusProvider>
      </ThemeProvider>
    </TuiProvider>
  );
}
