/**
 * ChatViewComponent — unit spec.
 *
 * Covers the rewind-flow guards now that the backend auto-resumes inactive
 * sessions transparently (see `SessionRpcHandlers.registerRewindFiles` →
 * `ChatSessionService.ensureSessionActiveForRewind`). The previous
 * "session-not-active" frontend retry dance has been removed, so the cases
 * exercised here are:
 *
 * 1. sessionIsActive === false UI guard fires before any RPC.
 * 2. dryRun failure (including residual session-not-active) surfaces a
 *    single error toast — no resume retry.
 *
 * Testing strategy: construct ChatViewComponent via TestBed with minimal
 * value stubs for all injected services. The heavy Angular template is not
 * rendered (no compileComponents required since we only test TypeScript logic).
 *
 * Note: ngx-markdown must be mocked before any import that transitively
 * loads it (the component imports from @ptah-extension/chat-ui which pulls it).
 */

import { provideSurfaceActiveTesting } from '@ptah-extension/core/testing';
import {
  Component,
  Input,
  NgModule,
  NO_ERRORS_SCHEMA,
  ChangeDetectionStrategy,
  LOCALE_ID,
  signal,
} from '@angular/core';

// Stub ngx-markdown (ESM-only bundle) BEFORE any component import.
jest.mock('ngx-markdown', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'markdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<div data-test="markdown-stub">{{ data }}</div>`,
  })
  class MarkdownStubComponent {
    @Input() data: string | null | undefined = '';
  }

  @NgModule({
    imports: [MarkdownStubComponent],
    exports: [MarkdownStubComponent],
  })
  class MarkdownModule {}

  return {
    MarkdownModule,
    MarkdownComponent: MarkdownStubComponent,
    provideMarkdown: () => [],
    MARKED_OPTIONS: 'MARKED_OPTIONS',
    CLIPBOARD_OPTIONS: 'CLIPBOARD_OPTIONS',
    MARKED_EXTENSIONS: 'MARKED_EXTENSIONS',
    MERMAID_OPTIONS: 'MERMAID_OPTIONS',
    SANITIZE: 'SANITIZE',
  };
});

import { TestBed } from '@angular/core/testing';
import {
  ChatViewComponent,
  AGENT_PANEL_OVERLAY_BREAKPOINT,
} from './chat-view.component';
import {
  toStatsLimitLaneRun,
  type SessionStatsSource,
} from '../../services/session-stats/session-stats-source';
import {
  INSPECTOR_TAB_WIDTH,
  InspectorDockWidthStore,
  InspectorOpenStateService,
  SessionInspectorStore,
} from '../../services/session-inspector';
import { ChatStore } from '../../services/chat.store';
import { ActionBannerService } from '../../services/action-banner.service';
import { SessionHistoryReplayer } from '../../services/chat-store/session-history-replayer.service';
import { HistoryPagingService } from '../../services/chat-store/history-paging.service';
import {
  VSCodeService,
  ClaudeRpcService,
  AppStateManager,
  AuthStateService,
  PlanLimitsStore,
  type PlanLimitsSurfaceScope,
} from '@ptah-extension/core';
import type {
  PlanLimitOwnerSnapshot,
  PlanLimitsSnapshot,
  QuotaOwnerRef,
} from '@ptah-extension/shared';
import { formatLocalAbsolute } from '@ptah-extension/shared';
import {
  TabManagerService,
  ConversationRegistry,
  TabSessionBinding,
  ConfirmationDialogService,
} from '@ptah-extension/chat-state';
import type { TabViewMode } from '@ptah-extension/chat-types';
import {
  AgentMonitorStore,
  ExecutionTreeBuilderService,
  type MonitoredAgent,
  type SubagentRecord,
} from '@ptah-extension/chat-streaming';
import { PanelResizeService } from '../../services/panel-resize.service';
import {
  SESSION_CONTEXT,
  SESSION_VISIBLE,
  SESSION_FORCED_CARD,
  SESSION_START_GUARD,
} from '../../tokens/session-context.token';
import { RpcResult } from '@ptah-extension/core';
import {
  SidebarTabComponent,
  SplitHandleComponent,
} from '@ptah-extension/chat-ui';
import { By } from '@angular/platform-browser';
import { SESSION_EMBED_CHROME } from '../../tokens/session-embed-chrome.token';
import { INSPECTOR_DOCK_WIDTH_STORAGE_KEY } from '../../services/session-inspector/inspector-dock-width.store';
import { AgentMonitorPanelComponent } from '../organisms/agent-monitor-panel.component';
import type { SessionBudgetState } from '@ptah-extension/shared';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a failed RpcResult with an error string. */
function rpcFail<T>(error: string): RpcResult<T> {
  return new RpcResult<T>(false, undefined, error);
}

/** Build a successful RpcResult. */
function rpcOk<T>(data: T): RpcResult<T> {
  return new RpcResult<T>(true, data);
}

/** Build a failed RpcResult carrying a structured error code. */
function rpcFailWithCode<T>(
  error: string,
  errorCode: 'MESSAGE_ID_NOT_FOUND' | 'SESSION_NOT_FOUND',
): RpcResult<T> {
  return new RpcResult<T>(false, undefined, error, errorCode);
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/**
 * Create a minimal testing environment for ChatViewComponent.
 *
 * All collaborating services are provided as value stubs so no real DI graph
 * is needed. The component is instantiated but NOT attached to a DOM (we only
 * test TypeScript method logic, not template rendering).
 */
function makeHarness(
  opts: {
    sessionId?: string;
    sessionIsActive?: boolean;
    confirmResult?: boolean;
    /**
     * When true, wire the REAL `ActionBannerService` instead of the jest stub
     * so the per-tile banner filtering computeds (`actionInfo`/`actionWarning`/
     * `actionError`) are exercised end-to-end.
     */
    useRealBanner?: boolean;
    /**
     * Tile id for `SESSION_CONTEXT`. When provided, the component resolves its
     * own tab id to this value (canvas/tile mode) instead of the global active
     * tab — the scenario where a banner from another tile must NOT leak in.
     */
    sessionContextTabId?: string;
    /**
     * Initial value for the `SESSION_VISIBLE` signal (tile on-screen state).
     * When provided, `SESSION_VISIBLE` is wired so `mainPanelShowing()` reflects
     * it. Absent → token not provided (treated as always visible).
     */
    sessionVisible?: boolean;
    /**
     * When true, the component's own real `PanelResizeService` is used instead
     * of the jest stub, so drag coalescing tests can read the live signal.
     */
    realPanelResize?: boolean;
    /** Render the production template with only overlay-relevant children. */
    renderOverlayTemplate?: boolean;
    /**
     * Render the production template with `CompactSessionCardComponent`
     * swapped out (via `NO_ERRORS_SCHEMA`) so the compact-mode `@if` gate can
     * be exercised without wiring that component's own DI graph.
     */
    renderCompactTemplate?: boolean;
    /** Initial `activeTabViewMode` stub value. Defaults to 'full'. */
    activeTabViewMode?: TabViewMode;
    /** When set, provide a tile-local signal that forces the compact card. */
    forcedCard?: boolean;
    /** Start with the docked inspector open. */
    inspectorOpen?: boolean;
    /**
     * Render the production template with the Stats tab, the split handle
     * and the agent panel real (everything else unknown via
     * `NO_ERRORS_SCHEMA`), so the inspector dock wiring can be exercised.
     */
    renderInspectorTemplate?: boolean;
    /** Provide `SESSION_EMBED_CHROME` (a host with its own session chrome). */
    embedChrome?: 'bare';
    startGuard?: () => string | null;
    isElectron?: boolean;
  } = {},
) {
  const {
    sessionId = 'session-uuid-123',
    sessionIsActive = true,
    confirmResult = true,
    useRealBanner = false,
    sessionContextTabId,
    sessionVisible,
    realPanelResize = false,
    renderOverlayTemplate = false,
    renderCompactTemplate = false,
    activeTabViewMode = 'full',
    forcedCard,
    inspectorOpen = false,
    renderInspectorTemplate = false,
    embedChrome,
    startGuard,
    isElectron = false,
  } = opts;
  // The docked open choice, reactive so a toggle re-renders.
  const dockedOpenSig = signal(inspectorOpen);
  const sessionVisibleSig =
    sessionVisible === undefined ? null : signal<boolean>(sessionVisible);
  const forcedCardSig =
    forcedCard === undefined ? null : signal<boolean>(forcedCard);

  // Writable signals for reactive control from tests
  const sessionIdSig = signal<string | null>(sessionId);
  const messagesSig = signal<unknown[]>([]);
  const sessionIsActiveSig = signal<boolean>(sessionIsActive);
  const showErrorMock = jest.fn();
  const loadOlderMock = jest.fn().mockResolvedValue('prepended');
  const olderHistoryLoadingTabIds = signal<ReadonlySet<string>>(new Set());
  const agentsSig = signal<MonitoredAgent[]>([]);
  const replayingTabIds = new Set<string>();
  const isReplayingMock = jest.fn((tabId: string) =>
    replayingTabIds.has(tabId),
  );

  // Interrupted subagents the "N interrupted agents — Resume" banner reads.
  const resumableSubagentsSig = signal<SubagentRecord[]>([]);
  const switchSessionMock = jest.fn().mockResolvedValue(undefined);
  const sendOrQueueMessageMock = jest.fn().mockResolvedValue({ success: true });
  const removeResumableSubagentMock = jest.fn();
  const upsertSessionSummaryMock = jest.fn();
  const removeSessionFromListMock = jest.fn();
  const isCompactingForTabMock = jest.fn(
    (_tabId: string | null | undefined): boolean => false,
  );
  const chatStoreStub = {
    isCompactingForTab: isCompactingForTabMock,
    currentSessionId: sessionIdSig.asReadonly(),
    sessionIsActive: sessionIsActiveSig.asReadonly(),
    // Other signals required by computed() inside the component
    activeTab: signal(null),
    messages: messagesSig,
    // Read by the stats source (the inspector's SESSION section).
    sessionStats: signal(null),
    liveModelStats: signal(null),
    compactionCount: signal(0),
    isStreaming: signal(false),
    currentModel: signal('claude-sonnet-4-20250514'),
    sessionStatus: signal(null),
    queueRestoreContent: signal(null),
    queuedContent: signal<string | null>(null),
    agentPanelOpen: signal(false),
    unmatchedPermissions: signal([]),
    questionRequests: signal([]),
    resumableSubagents: resumableSubagentsSig.asReadonly(),
    handlePermissionResponse: jest.fn(),
    handleQuestionResponse: jest.fn(),
    switchSession: switchSessionMock,
    sendOrQueueMessage: sendOrQueueMessageMock,
    removeResumableSubagent: removeResumableSubagentMock,
    upsertSessionSummary: upsertSessionSummaryMock,
    removeSessionFromList: removeSessionFromListMock,
  } as unknown as ChatStore;

  // TabManagerService: resolvedTabId and resolvedSessionId depend on it
  const activeTabIdSig = signal<string | null>('tab-abc');
  const tabsSig = signal<
    Array<{
      id: string;
      claudeSessionId: string | null;
       hasLiveSession: boolean;
       viewMode: TabViewMode;
      olderHistoryCursor?: string | null;
    }>
  >([
    {
      id: 'tab-abc',
      claudeSessionId: sessionId,
       hasLiveSession: sessionIsActive,
       viewMode: activeTabViewMode,
      olderHistoryCursor: 'older-cursor',
    },
  ]);
  const openSessionTabMock = jest.fn();
  const createTabMock = jest.fn().mockReturnValue('tab-new');
  const findTabsBySessionIdMock = jest.fn().mockReturnValue([]);
  const findTabByIdAcrossWorkspacesMock = jest.fn();
  const closeTabMock = jest.fn().mockResolvedValue(undefined);
  const forgetWorkflowSessionMock = jest.fn();
  const rebindTabSessionMock = jest.fn();
  const originTab = {
    id: 'tab-abc',
    name: 'Original Session',
    claudeSessionId: sessionId,
    viewMode: activeTabViewMode,
  };
  const findTabBySessionIdMock = jest.fn().mockReturnValue(originTab);
  const activeTabMock = jest.fn().mockReturnValue(originTab);
  const tabManagerStub = {
    activeTabId: activeTabIdSig.asReadonly(),
    activeTab: activeTabMock,
    activeTabSessionId: signal<string | null>(sessionId).asReadonly(),
    activeTabStatus: signal<string | null>(null).asReadonly(),
    activeTabViewMode: signal<TabViewMode>(activeTabViewMode).asReadonly(),
    activeTabHasLiveSession: sessionIsActiveSig.asReadonly(),
    pendingSessionLoad: signal<string | null>(null).asReadonly(),
    visibleTabIds: signal<ReadonlySet<string>>(new Set()).asReadonly(),
    tabs: tabsSig.asReadonly(),
    createTab: createTabMock,
    activeWorkspacePath: '/ws',
    toggleTabViewMode: jest.fn(),
    streamingTabIds: signal<Set<string>>(new Set()).asReadonly(),
    openSessionTab: openSessionTabMock,
    findTabBySessionId: findTabBySessionIdMock,
    findTabsBySessionId: findTabsBySessionIdMock,
    rebindTabSession: rebindTabSessionMock,
    closeTab: closeTabMock,
    forgetWorkflowSession: forgetWorkflowSessionMock,
    // Consumed by the component-scoped TranscriptRetentionService effects.
    closedTab: signal(null).asReadonly(),
    onTabClosed: jest.fn(() => () => undefined),
    removedWorkspace$: signal(null).asReadonly(),
    findTabByIdAcrossWorkspaces: findTabByIdAcrossWorkspacesMock,
    clearRemovedWorkspace: jest.fn(),
    clearPendingSessionLoad: jest.fn(),
  } as unknown as TabManagerService;

  const vscodeStub = {
    isElectron,
    config: jest.fn(() => ({
      workspaceRoot: '/test/workspace',
    })),
    getPtahIconUri: () => 'data:image/svg+xml;base64,PHN2Zy8+',
    getPtahUserIconUri: () => 'data:image/svg+xml;base64,PHN2Zy8+',
  } as unknown as VSCodeService;

  const rewindFilesMock = jest.fn();
  const rpcCallMock = jest.fn();
  const forkSessionMock = jest.fn();
  const deleteSessionMock = jest
    .fn()
    .mockResolvedValue(rpcOk({ success: true }));
  const rpcStub = {
    rewindFiles: rewindFilesMock,
    call: rpcCallMock,
    forkSession: forkSessionMock,
    deleteSession: deleteSessionMock,
  } as unknown as ClaudeRpcService;

  const confirmMock = jest.fn().mockResolvedValue(confirmResult);
  const confirmWithCheckboxesMock = jest.fn().mockResolvedValue({
    confirmed: true,
    checkboxes: { deleteOriginal: false },
  });
  const confirmDialogStub = {
    confirm: confirmMock,
    confirmWithCheckboxes: confirmWithCheckboxesMock,
  } as unknown as ConfirmationDialogService;

  const showInfoMock = jest.fn();
  const showWarningMock = jest.fn();
  const realActionBanner = new ActionBannerService();
  const actionBannerStub = {
    banner: signal<unknown>(null).asReadonly(),
    error: signal<string | null>(null).asReadonly(),
    info: signal<string | null>(null).asReadonly(),
    warning: signal<string | null>(null).asReadonly(),
    showError: showErrorMock,
    showInfo: showInfoMock,
    showWarning: showWarningMock,
  } as unknown as ActionBannerService;
  const actionBannerProvider: ActionBannerService = useRealBanner
    ? realActionBanner
    : actionBannerStub;

  const agentsForSessionMock = jest.fn(
    (_sessionId: string): MonitoredAgent[] => [],
  );
  const planLimitsScopeUpdateMock = jest.fn(
    async (_scope: PlanLimitsSurfaceScope): Promise<void> => undefined,
  );
  const planLimitsScopeReleaseMock = jest.fn();
  const planLimitsSnapshotSig = signal<PlanLimitsSnapshot | null>(null);
  const planLimitsNowSig = signal<number>(Date.UTC(2026, 9, 5, 12, 0, 0));
  const planLimitsLoadErrorSig = signal(false);
  const planLimitsRegisterScopeMock = jest.fn((_destroyRef: unknown) => ({
    id: 1,
    update: planLimitsScopeUpdateMock,
    release: planLimitsScopeReleaseMock,
  }));
  const planLimitsStub = {
    registerScope: planLimitsRegisterScopeMock,
    snapshot: planLimitsSnapshotSig.asReadonly(),
    now: planLimitsNowSig.asReadonly(),
    loading: signal(false).asReadonly(),
    loadError: planLimitsLoadErrorSig.asReadonly(),
    sessionOwner: (sessionId: string) =>
      planLimitsSnapshotSig()?.sessionOwners[sessionId] ?? null,
  } as unknown as PlanLimitsStore;

  const agentMonitorStoreStub = {
    agents: agentsSig.asReadonly(),
    agentsForSession: agentsForSessionMock,
    // Exact-parent rule of the real store: an unresolved parent matches none.
    agentsOwnedBySession: (sessionId: string): MonitoredAgent[] =>
      sessionId
        ? agentsSig().filter((a) => a.parentSessionId === sessionId)
        : [],
    activeTabAgents: signal([]).asReadonly(),
    activeWorkflowSubagents: signal([]).asReadonly(),
    pendingPermissions: signal([]).asReadonly(),
    panelOpen: signal(false).asReadonly(),
    workflowSubagentsForSession: jest.fn(() => []),
    activeSessionSubagents: signal([]).asReadonly(),
    sessionSubagentsForSession: jest.fn(() => []),
    getSubagent: jest.fn(() => undefined),
    clearCompleted: jest.fn(),
    clearCompletedInSession: jest.fn(),
    clearPermission: jest.fn(),
    closePanel: jest.fn(),
    getSubagentTranscript: jest.fn(),
    toggleAgentExpanded: jest.fn(),
    tick: signal(0),
    cliOutputDemand: signal<readonly { sessionId: string; agentId: string }[]>(
      [],
    ).asReadonly(),
    panelOpenRequest: signal({ seq: 0, tabId: null }).asReadonly(),
  } as unknown as AgentMonitorStore;

  const panelResizeStub = {
    setDragging: jest.fn(),
    setCustomWidth: jest.fn(),
    customWidth: signal(null),
    dragging: signal(false),
  } as unknown as PanelResizeService;

  const layoutModeSig = signal<'single' | 'grid'>('single');
  const requestCanvasSessionMock = jest
    .fn<Promise<boolean>, [string, string?]>()
    .mockResolvedValue(true);
  const requestCanvasTabMock = jest.fn();
  const requestComposerPrefillMock = jest.fn();
  const appStateStub = {
    currentView: signal('chat'),
    layoutMode: layoutModeSig.asReadonly(),
    composerPrefillRequest: signal({
      seq: 0,
      text: '',
      tabId: null,
    }).asReadonly(),
    requestCanvasSession: requestCanvasSessionMock,
    requestCanvasTab: requestCanvasTabMock,
    requestComposerPrefill: requestComposerPrefillMock,
  } as unknown as AppStateManager;

  const treeBuilderStub = {
    clearForTab: jest.fn(),
  } as unknown as ExecutionTreeBuilderService;

  const conversationRegistryStub = {
    getIsCompacting: jest.fn(() => false),
    compactingConversationIds: signal(new Set<string>()),
  } as unknown as ConversationRegistry;

  const tabSessionBindingStub = {
    getConversationId: jest.fn(() => null),
  } as unknown as TabSessionBinding;

  const authStateStub = {
    authRequiredBanner: signal(null),
    codexLogin: jest.fn(async () => undefined),
    clearAuthRequiredBanner: jest.fn(),
  } as unknown as AuthStateService;

  TestBed.configureTestingModule({
    imports: [ChatViewComponent],
    providers: [
      provideSurfaceActiveTesting(),
      { provide: ChatStore, useValue: chatStoreStub },
      { provide: VSCodeService, useValue: vscodeStub },
      { provide: ClaudeRpcService, useValue: rpcStub },
      { provide: ConfirmationDialogService, useValue: confirmDialogStub },
      { provide: ActionBannerService, useValue: actionBannerProvider },
      { provide: TabManagerService, useValue: tabManagerStub },
      {
        provide: SessionHistoryReplayer,
        useValue: { isReplaying: isReplayingMock },
      },
      {
        provide: HistoryPagingService,
        useValue: {
          loadOlder: loadOlderMock,
          loadingTabIds: olderHistoryLoadingTabIds.asReadonly(),
        },
      },
      { provide: AgentMonitorStore, useValue: agentMonitorStoreStub },
      {
        provide: PanelResizeService,
        useValue: realPanelResize
          ? new PanelResizeService()
          : (panelResizeStub as unknown as PanelResizeService),
      },
      { provide: AppStateManager, useValue: appStateStub },
      { provide: ExecutionTreeBuilderService, useValue: treeBuilderStub },
      { provide: ConversationRegistry, useValue: conversationRegistryStub },
      { provide: TabSessionBinding, useValue: tabSessionBindingStub },
      { provide: AuthStateService, useValue: authStateStub },
      { provide: PlanLimitsStore, useValue: planLimitsStub },
      // The inspector stays closed here: no deferred inspector chunk renders.
      {
        provide: SessionInspectorStore,
        useValue: {
          // The session header and the toggle dot read the needs-you count.
          modelFor: jest.fn(() => signal({ needsYouCount: 0 })),
          reportAnswerMiss: jest.fn(),
          clearAnswerMiss: jest.fn(),
        },
      },
      {
        provide: InspectorOpenStateService,
        useValue: {
          dockedOpen: () => dockedOpenSig(),
          setDocked: jest.fn((_tabId: string, _mode: string, open: boolean) =>
            dockedOpenSig.set(open),
          ),
        },
      },
      ...(embedChrome
        ? [{ provide: SESSION_EMBED_CHROME, useValue: embedChrome }]
        : []),
      ...(startGuard
        ? [{ provide: SESSION_START_GUARD, useValue: startGuard }]
        : []),
      {
        provide: SESSION_CONTEXT,
        useValue:
          sessionContextTabId === undefined
            ? null
            : signal<string | null>(sessionContextTabId).asReadonly(),
      },
      {
        provide: SESSION_VISIBLE,
        useValue: sessionVisibleSig ? sessionVisibleSig.asReadonly() : null,
      },
      ...(forcedCardSig
        ? [
            {
              provide: SESSION_FORCED_CARD,
              useValue: forcedCardSig.asReadonly(),
            },
          ]
        : []),
    ],
  });

  if (renderOverlayTemplate) {
    TestBed.overrideComponent(ChatViewComponent, {
      set: {
        imports: [AgentMonitorPanelComponent, SidebarTabComponent],
        schemas: [NO_ERRORS_SCHEMA],
      },
    });
  }

  if (renderCompactTemplate) {
    TestBed.overrideComponent(ChatViewComponent, {
      set: {
        imports: [],
        schemas: [NO_ERRORS_SCHEMA],
      },
    });
  }

  if (renderInspectorTemplate) {
    TestBed.overrideComponent(ChatViewComponent, {
      set: {
        imports: [
          AgentMonitorPanelComponent,
          SidebarTabComponent,
          SplitHandleComponent,
        ],
        schemas: [NO_ERRORS_SCHEMA],
      },
    });
  }

  const fixture = TestBed.createComponent(ChatViewComponent);
  const component = fixture.componentInstance;

  return {
    component,
    fixture,
    sessionId,
    rewindFilesMock,
    rpcCallMock,
    forkSessionMock,
    deleteSessionMock,
    confirmMock,
    confirmWithCheckboxesMock,
    switchSessionMock,
    openSessionTabMock,
    findTabBySessionIdMock,
    findTabsBySessionIdMock,
    findTabByIdAcrossWorkspacesMock,
    rebindTabSessionMock,
    closeTabMock,
    tabManagerStub,
    forgetWorkflowSessionMock,
    upsertSessionSummaryMock,
    removeSessionFromListMock,
    requestCanvasSessionMock,
    layoutModeSig,
    showErrorMock,
    showInfoMock,
    showWarningMock,
    realActionBanner,
    sessionIsActiveSig,
    sessionIdSig,
    messagesSig,
    activeTabIdSig,
    sessionVisibleSig,
    forcedCardSig,
    resumableSubagentsSig,
    isCompactingForTabMock,
    replayingTabIds,
    isReplayingMock,
    loadOlderMock,
    olderHistoryLoadingTabIds,
    agentsSig,
    agentsForSessionMock,
    planLimitsScopeUpdateMock,
    planLimitsRegisterScopeMock,
    planLimitsSnapshotSig,
    planLimitsLoadErrorSig,
    activeTabMock,
    createTabMock,
    sendOrQueueMessageMock,
    removeResumableSubagentMock,
    requestCanvasTabMock,
    requestComposerPrefillMock,
    dockedOpenSig,
  };
}

describe('ChatViewComponent — inspector Answer focus', () => {
  beforeEach(() => jest.useFakeTimers());

  afterEach(() => {
    jest.useRealTimers();
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  function addQuestionCard(h: ReturnType<typeof makeHarness>, requestId: string) {
    const card = document.createElement('ptah-question-card');
    card.setAttribute('data-request-id', requestId);
    const option = document.createElement('button');
    card.appendChild(option);
    h.fixture.nativeElement.appendChild(card);
    return jest.spyOn(option, 'focus');
  }

  it('focuses the first option when the card is already present', () => {
    const h = makeHarness();
    const focus = addQuestionCard(h, 'question-now');
    const miss = jest.spyOn(TestBed.inject(SessionInspectorStore), 'reportAnswerMiss');

    h.component['focusQuestionCard']('question-now');

    expect(focus).toHaveBeenCalledTimes(1);
    expect(miss).not.toHaveBeenCalled();
  });

  it('focuses the first option when the card appears during the wait', () => {
    const h = makeHarness();
    const miss = jest.spyOn(TestBed.inject(SessionInspectorStore), 'reportAnswerMiss');

    h.component['focusQuestionCard']('question-late');
    jest.advanceTimersByTime(500);
    const focus = addQuestionCard(h, 'question-late');
    jest.advanceTimersByTime(500);

    expect(focus).toHaveBeenCalledTimes(1);
    expect(miss).not.toHaveBeenCalled();
  });

  it('reports a miss when no card appears by the end of the wait', () => {
    const h = makeHarness();
    const miss = jest.spyOn(TestBed.inject(SessionInspectorStore), 'reportAnswerMiss');

    h.component['focusQuestionCard']('question-missing');
    jest.advanceTimersByTime(1000);

    expect(miss).toHaveBeenCalledWith('question-missing');
  });
});

describe('ChatViewComponent — older history orchestration', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('counts identical loaded prompts after the anchor from the end', () => {
    const h = makeHarness();
    const messages = signal([
      { id: 'first', role: 'user', rawContent: 'repeat' },
      { id: 'answer', role: 'assistant', rawContent: 'answer' },
      { id: 'anchor', role: 'user', rawContent: 'repeat' },
      { id: 'later', role: 'user', rawContent: 'repeat' },
      { id: 'last', role: 'user', rawContent: 'different' },
    ]);
    const component = h.component as unknown as {
      resolvedMessages: typeof messages;
      buildAnchorHint(messageId: string): unknown;
    };
    component.resolvedMessages = messages;

    expect(component.buildAnchorHint('anchor')).toEqual({
      text: 'repeat',
      occurrence: 1,
      occurrenceFromEnd: 1,
    });
  });

  it('reports stale history with reopen guidance and does not resume automatically', async () => {
    const h = makeHarness();
    h.loadOlderMock.mockResolvedValue('stale');

    await (
      h.component as unknown as {
        onOlderHistoryRequested(tabId: string): Promise<void>;
      }
    ).onOlderHistoryRequested('tab-abc');

    expect(h.showErrorMock).toHaveBeenCalledWith(
      expect.stringMatching(/reopen the session/i),
      'tab-abc',
    );
    expect(h.switchSessionMock).not.toHaveBeenCalled();
  });

  it('reports a retryable error when loading older history fails', async () => {
    const h = makeHarness();
    h.loadOlderMock.mockResolvedValue('failed');

    await (
      h.component as unknown as {
        onOlderHistoryRequested(tabId: string): Promise<void>;
      }
    ).onOlderHistoryRequested('tab-abc');

    expect(h.showErrorMock).toHaveBeenCalledWith(
      expect.stringMatching(/try again/i),
      'tab-abc',
    );
  });

  it('reports older-history availability from the requested tab cursor', () => {
    const h = makeHarness();
    const component = h.component as unknown as {
      hasOlderHistory(tabId: string): boolean;
    };

    h.findTabByIdAcrossWorkspacesMock.mockImplementation((tabId: string) =>
      tabId === 'background-tab'
        ? {
            tab: { id: 'background-tab', olderHistoryCursor: 'older-cursor' },
            workspacePath: 'D:/background-repo',
          }
        : null,
    );

    expect(component.hasOlderHistory('background-tab')).toBe(true);
    expect(component.hasOlderHistory('missing-tab')).toBe(false);
  });

  it('reports older-history loading state per tab', () => {
    const h = makeHarness();
    const component = h.component as unknown as {
      isOlderHistoryLoading(tabId: string): boolean;
    };

    expect(component.isOlderHistoryLoading('tab-abc')).toBe(false);
    h.olderHistoryLoadingTabIds.set(new Set(['tab-abc']));
    expect(component.isOlderHistoryLoading('tab-abc')).toBe(true);
    expect(component.isOlderHistoryLoading('other-tab')).toBe(false);
  });
});

describe('ChatViewComponent — replay motion input', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('queries replay state with the rendered transcript tab id', () => {
    const h = makeHarness();
    const component = h.component as unknown as {
      transcriptTabIds(): readonly string[];
      isHistoryReplaying(tabId: string): boolean;
    };
    const renderedTabId = component.transcriptTabIds()[0];
    expect(renderedTabId).toBe('tab-abc');

    h.replayingTabIds.add(renderedTabId);
    expect(component.isHistoryReplaying(renderedTabId)).toBe(true);
    expect(h.isReplayingMock).toHaveBeenLastCalledWith('tab-abc');

    h.replayingTabIds.delete(renderedTabId);
    expect(component.isHistoryReplaying(renderedTabId)).toBe(false);
    expect(h.isReplayingMock).toHaveBeenLastCalledWith('tab-abc');
  });
});

describe('ChatViewComponent — compaction banner source', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('resolvedIsCompacting delegates to chatStore.isCompactingForTab with the resolved tab id', () => {
    const h = makeHarness();
    h.isCompactingForTabMock.mockImplementation((id) => id === 'tab-abc');
    expect(h.component.resolvedIsCompacting()).toBe(true);
    expect(h.isCompactingForTabMock).toHaveBeenCalledWith('tab-abc');
  });

  it('reports no banner when the shared derivation says the tab is not compacting', () => {
    const h = makeHarness();
    h.isCompactingForTabMock.mockReturnValue(false);
    expect(h.component.resolvedIsCompacting()).toBe(false);
  });

  it('a tile whose SESSION_CONTEXT tab id is absent from tabs() asks about ITS id, not the active tab', () => {
    // PR #493 review C: the banner derived its id from `resolvedTab()`, which
    // is null for a context tab id missing from `tabs()` — a tile still
    // resolving, or one whose tab just closed — and fell back to the GLOBAL
    // active tab. ChatInputComponent reads the context id, so the banner and
    // the input overlay could report different compaction states.
    const h = makeHarness({ sessionContextTabId: 'tile-unknown' });
    h.isCompactingForTabMock.mockImplementation((id) => id === 'tab-abc');

    expect(h.component.resolvedIsCompacting()).toBe(false);
    expect(h.isCompactingForTabMock).toHaveBeenCalledWith('tile-unknown');
    expect(h.isCompactingForTabMock).not.toHaveBeenCalledWith('tab-abc');
  });
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ChatViewComponent — rewind flow (backend auto-resume)', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('C1 — historical (inactive) sessions are now allowed to rewind; backend auto-resumes', async () => {
    const h = makeHarness({ sessionIsActive: false });
    h.rewindFilesMock
      .mockResolvedValueOnce(
        rpcOk({
          canRewind: true,
          filesChanged: ['a.ts'],
          insertions: 1,
          deletions: 0,
        }),
      )
      .mockResolvedValueOnce(
        rpcOk({
          canRewind: true,
          filesChanged: ['a.ts'],
          insertions: 1,
          deletions: 0,
        }),
      );
    h.forkSessionMock.mockResolvedValueOnce(
      rpcOk({ newSessionId: 'new-session-uuid-from-historical' }),
    );

    await h.component.onRewindRequested('msg-historical');

    expect(h.rewindFilesMock).toHaveBeenCalled();
    expect(h.forkSessionMock).toHaveBeenCalled();
    expect(h.showErrorMock).not.toHaveBeenCalledWith(
      expect.stringContaining('active conversation'),
    );
  });

  it('shows a single error toast and does NOT call chat:resume when dryRun rewindFiles fails', async () => {
    const h = makeHarness();

    h.rewindFilesMock.mockResolvedValueOnce(
      rpcFail('session-not-active: backend auto-resume failed'),
    );

    await h.component.onRewindRequested('msg-fail-1');

    expect(h.showErrorMock).toHaveBeenCalledTimes(1);
    expect(h.showErrorMock).toHaveBeenCalledWith(
      expect.stringContaining('Rewind failed'),
      null,
    );
    expect(h.rewindFilesMock).toHaveBeenCalledTimes(1);
    expect(h.confirmMock).not.toHaveBeenCalled();
    expect(h.rpcCallMock).not.toHaveBeenCalledWith(
      'chat:resume',
      expect.anything(),
    );
  });
});

// ---------------------------------------------------------------------------
// attemptRewindV2 — fork-and-switch flow (B4)
// ---------------------------------------------------------------------------

describe('ChatViewComponent — attemptRewindV2 (fork-and-switch)', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  /** Wire up a successful dryRun + commit on rewindFiles and a successful fork. */
  function primeHappyPath(h: ReturnType<typeof makeHarness>): void {
    h.rewindFilesMock
      .mockResolvedValueOnce(
        rpcOk({
          canRewind: true,
          filesChanged: ['a.ts'],
          insertions: 1,
          deletions: 0,
        }),
      )
      .mockResolvedValueOnce(
        rpcOk({
          canRewind: true,
          filesChanged: ['a.ts'],
          insertions: 1,
          deletions: 0,
        }),
      );
    h.forkSessionMock.mockResolvedValueOnce(
      rpcOk({ newSessionId: 'new-session-uuid-999' }),
    );
  }

  it('happy path: dryRun ok → user confirms → forkSession succeeds → tab rebound in place + switchSession(activate) called → success message → original NOT deleted', async () => {
    const h = makeHarness();
    primeHappyPath(h);

    await h.component.onRewindRequested('msg-happy');

    // Dialog asked with checkbox option, default unchecked
    expect(h.confirmWithCheckboxesMock).toHaveBeenCalledTimes(1);
    const dialogArg = h.confirmWithCheckboxesMock.mock.calls[0][0];
    expect(dialogArg.checkboxes).toEqual([
      expect.objectContaining({ id: 'deleteOriginal', defaultChecked: false }),
    ]);

    // Fork called with kind: 'rewind' (anchorHint undefined — message not in
    // the resolved list for this harness, so no text hint is built).
    expect(h.forkSessionMock).toHaveBeenCalledWith(
      'session-uuid-123',
      'msg-happy',
      undefined,
      'rewind',
      undefined,
    );

    // In-place rebind of the originating tab — no second tab/tile opened.
    expect(h.rebindTabSessionMock).toHaveBeenCalledWith(
      'tab-abc',
      'new-session-uuid-999',
      'Original Session (rewind)',
    );
    expect(h.openSessionTabMock).not.toHaveBeenCalled();
    expect(h.switchSessionMock).toHaveBeenCalledWith('new-session-uuid-999', {
      activate: true,
    });

    // Forked session optimistically surfaced in the sidebar before rebind.
    expect(h.upsertSessionSummaryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'new-session-uuid-999',
        name: 'Original Session (rewind)',
        isActive: true,
      }),
    );

    // Success message — no rollback suffix
    expect(h.showInfoMock).toHaveBeenCalledTimes(1);
    expect(h.showInfoMock).toHaveBeenCalledWith(
      'Rewind complete — conversation rewound to this message',
      'tab-abc',
    );

    // Original NOT deleted
    expect(h.findTabsBySessionIdMock).not.toHaveBeenCalled();
    expect(h.deleteSessionMock).not.toHaveBeenCalled();
    expect(h.closeTabMock).not.toHaveBeenCalled();
    expect(h.removeSessionFromListMock).not.toHaveBeenCalled();
  });

  it('delete-original path: checkbox checked + all tabs closed → findTabsBySessionId + closeTab + claudeRpc.deleteSession called in order', async () => {
    const h = makeHarness();
    primeHappyPath(h);
    h.confirmWithCheckboxesMock.mockResolvedValueOnce({
      confirmed: true,
      checkboxes: { deleteOriginal: true },
    });
    h.findTabsBySessionIdMock
      .mockReturnValueOnce([{ id: 'tab-orig-1' }, { id: 'tab-orig-2' }])
      .mockReturnValueOnce([]);

    await h.component.onRewindRequested('msg-delete-orig');

    expect(h.findTabsBySessionIdMock).toHaveBeenCalledWith('session-uuid-123');
    expect(h.closeTabMock).toHaveBeenNthCalledWith(1, 'tab-orig-1');
    expect(h.closeTabMock).toHaveBeenNthCalledWith(2, 'tab-orig-2');
    expect(h.deleteSessionMock).toHaveBeenCalledWith('session-uuid-123');
    expect(h.forgetWorkflowSessionMock).toHaveBeenCalledWith(
      'session-uuid-123',
      '/ws',
    );

    const firstClose = h.closeTabMock.mock.invocationCallOrder[0];
    const firstDelete = h.deleteSessionMock.mock.invocationCallOrder[0];
    expect(firstClose).toBeLessThan(firstDelete);

    // Original dropped from the sidebar immediately after a successful delete.
    expect(h.removeSessionFromListMock).toHaveBeenCalledWith(
      'session-uuid-123',
    );

    expect(h.switchSessionMock).toHaveBeenCalledWith('new-session-uuid-999', {
      activate: true,
    });
    expect(h.showInfoMock).toHaveBeenCalledWith(
      'Rewind complete — conversation rewound to this message',
      'tab-abc',
    );
  });

  it('keeps the origin workspace when it changes during tab close', async () => {
    const h = makeHarness();
    primeHappyPath(h);
    h.confirmWithCheckboxesMock.mockResolvedValueOnce({
      confirmed: true,
      checkboxes: { deleteOriginal: true },
    });
    h.findTabsBySessionIdMock
      .mockReturnValueOnce([{ id: 'tab-abc' }])
      .mockReturnValueOnce([]);
    h.closeTabMock.mockImplementationOnce(async () => {
      Object.defineProperty(h.tabManagerStub, 'activeWorkspacePath', {
        value: '/other',
        configurable: true,
      });
    });

    await h.component.onRewindRequested('msg-delete-orig');
    expect(h.forgetWorkflowSessionMock).toHaveBeenCalledWith(
      'session-uuid-123',
      '/ws',
    );
  });
  it('C5/UICS-011 — delete-original aborts when a streaming tab survives closeTab cancellation; warning banner shown', async () => {
    const h = makeHarness();
    primeHappyPath(h);
    h.confirmWithCheckboxesMock.mockResolvedValueOnce({
      confirmed: true,
      checkboxes: { deleteOriginal: true },
    });
    h.findTabsBySessionIdMock
      .mockReturnValueOnce([{ id: 'tab-streaming' }])
      .mockReturnValueOnce([{ id: 'tab-streaming' }]);

    await h.component.onRewindRequested('msg-delete-orig-cancel');

    expect(h.closeTabMock).toHaveBeenCalledWith('tab-streaming');
    expect(h.deleteSessionMock).not.toHaveBeenCalled();
    expect(h.showWarningMock).toHaveBeenCalledWith(
      expect.stringContaining('original session left in place'),
      'tab-abc',
    );
  });

  it('EH-005 — delete-original surfaces backend deleteSession failure via warning banner', async () => {
    const h = makeHarness();
    primeHappyPath(h);
    h.confirmWithCheckboxesMock.mockResolvedValueOnce({
      confirmed: true,
      checkboxes: { deleteOriginal: true },
    });
    h.findTabsBySessionIdMock
      .mockReturnValueOnce([{ id: 'tab-orig' }])
      .mockReturnValueOnce([]);
    h.deleteSessionMock.mockResolvedValueOnce(rpcFail('backend write error'));

    await h.component.onRewindRequested('msg-delete-fail');

    expect(h.deleteSessionMock).toHaveBeenCalledWith('session-uuid-123');
    expect(h.showWarningMock).toHaveBeenCalledWith(
      expect.stringContaining('original session delete failed'),
      'tab-abc',
    );
  });

  it('rewindFiles dryRun fails → error surfaced, forkSession NOT called', async () => {
    const h = makeHarness();
    h.rewindFilesMock.mockResolvedValueOnce(rpcFail('disk error'));

    await h.component.onRewindRequested('msg-dry-fail');

    expect(h.showErrorMock).toHaveBeenCalledWith(
      expect.stringContaining('Rewind failed'),
      null,
    );
    expect(h.forkSessionMock).not.toHaveBeenCalled();
    expect(h.openSessionTabMock).not.toHaveBeenCalled();
    expect(h.switchSessionMock).not.toHaveBeenCalled();
    expect(h.deleteSessionMock).not.toHaveBeenCalled();
  });

  it('UICS-014 — rewindFiles commit soft-fails → fork still attempted, success surfaced via WARNING banner with "file rollback skipped" suffix', async () => {
    const h = makeHarness();
    h.rewindFilesMock
      .mockResolvedValueOnce(
        rpcOk({
          canRewind: true,
          filesChanged: ['a.ts'],
          insertions: 1,
          deletions: 0,
        }),
      )
      .mockResolvedValueOnce(rpcFail('lock contention'));
    h.forkSessionMock.mockResolvedValueOnce(
      rpcOk({ newSessionId: 'new-session-uuid-after-rollback-fail' }),
    );

    await h.component.onRewindRequested('msg-rollback-fail');

    expect(h.forkSessionMock).toHaveBeenCalledTimes(1);
    expect(h.switchSessionMock).toHaveBeenCalledWith(
      'new-session-uuid-after-rollback-fail',
      { activate: true },
    );
    expect(h.showInfoMock).not.toHaveBeenCalled();
    expect(h.showWarningMock).toHaveBeenCalledTimes(1);
    expect(h.showWarningMock).toHaveBeenCalledWith(
      expect.stringContaining('file rollback skipped'),
      'tab-abc',
    );
  });

  it('EH-002 — rewindFiles commit returns session-not-active: → hard error (no fork, no rollback-suffix demotion)', async () => {
    const h = makeHarness();
    h.rewindFilesMock
      .mockResolvedValueOnce(
        rpcOk({
          canRewind: true,
          filesChanged: ['a.ts'],
          insertions: 1,
          deletions: 0,
        }),
      )
      .mockResolvedValueOnce(
        rpcFail('session-not-active: backend re-resume gave up'),
      );
    h.forkSessionMock.mockResolvedValueOnce(
      rpcOk({ newSessionId: 'should-not-be-used' }),
    );

    await h.component.onRewindRequested('msg-hard-fail');

    expect(h.showErrorMock).toHaveBeenCalledWith(
      expect.stringContaining('Rewind failed'),
      null,
    );
    expect(h.forkSessionMock).not.toHaveBeenCalled();
    expect(h.openSessionTabMock).not.toHaveBeenCalled();
    expect(h.showWarningMock).not.toHaveBeenCalled();
    expect(h.showInfoMock).not.toHaveBeenCalled();
  });

  it('EH-002 — rewindFiles commit returns unauthorized-path-rewrite: → hard error', async () => {
    const h = makeHarness();
    h.rewindFilesMock
      .mockResolvedValueOnce(
        rpcOk({
          canRewind: true,
          filesChanged: ['a.ts'],
          insertions: 1,
          deletions: 0,
        }),
      )
      .mockResolvedValueOnce(
        rpcFail('unauthorized-path-rewrite: ../etc/passwd outside workspace'),
      );

    await h.component.onRewindRequested('msg-path-rewrite');

    expect(h.showErrorMock).toHaveBeenCalledWith(
      expect.stringContaining('Rewind failed'),
      null,
    );
    expect(h.forkSessionMock).not.toHaveBeenCalled();
  });

  it('C3 — checkpointsLost (zero-files dry-run) skips commit rewindFiles RPC entirely', async () => {
    const h = makeHarness();
    h.rewindFilesMock.mockResolvedValueOnce(
      rpcOk({
        canRewind: true,
        filesChanged: [],
        insertions: 0,
        deletions: 0,
      }),
    );
    h.forkSessionMock.mockResolvedValueOnce(
      rpcOk({ newSessionId: 'new-session-uuid-cp-lost' }),
    );

    await h.component.onRewindRequested('msg-cp-lost');

    expect(h.rewindFilesMock).toHaveBeenCalledTimes(1);
    expect(h.forkSessionMock).toHaveBeenCalled();
    expect(h.showInfoMock).toHaveBeenCalledWith(
      'Rewind complete — conversation rewound to this message',
      'tab-abc',
    );
  });

  it('C2 — dryRun canRewind=false treated as checkpointsLost (fork-anyway), warning banner with skip-reason', async () => {
    const h = makeHarness();
    h.rewindFilesMock.mockResolvedValueOnce(
      rpcOk({
        canRewind: false,
        error: 'no checkpoint store for this message',
        filesChanged: [],
        insertions: 0,
        deletions: 0,
      }),
    );
    h.forkSessionMock.mockResolvedValueOnce(
      rpcOk({ newSessionId: 'new-session-uuid-cant-rewind' }),
    );

    await h.component.onRewindRequested('msg-cannot-rewind');

    expect(h.rewindFilesMock).toHaveBeenCalledTimes(1);
    expect(h.forkSessionMock).toHaveBeenCalled();
    expect(h.showErrorMock).not.toHaveBeenCalledWith(
      expect.stringContaining('Cannot rewind'),
    );
    expect(h.showWarningMock).toHaveBeenCalledWith(
      expect.stringContaining('file rollback skipped'),
      'tab-abc',
    );
  });

  it('forkSession fails → error surfaced, no tab swap, no delete', async () => {
    const h = makeHarness();
    h.rewindFilesMock
      .mockResolvedValueOnce(
        rpcOk({
          canRewind: true,
          filesChanged: [],
          insertions: 0,
          deletions: 0,
        }),
      )
      .mockResolvedValueOnce(
        rpcOk({
          canRewind: true,
          filesChanged: [],
          insertions: 0,
          deletions: 0,
        }),
      );
    h.forkSessionMock.mockResolvedValueOnce(rpcFail('SDK fork failed'));
    h.confirmWithCheckboxesMock.mockResolvedValueOnce({
      confirmed: true,
      checkboxes: { deleteOriginal: true },
    });

    await h.component.onRewindRequested('msg-fork-fail');

    expect(h.showErrorMock).toHaveBeenCalledWith(
      expect.stringContaining('Rewind failed'),
      null,
    );
    expect(h.openSessionTabMock).not.toHaveBeenCalled();
    expect(h.switchSessionMock).not.toHaveBeenCalled();
    expect(h.deleteSessionMock).not.toHaveBeenCalled();
    expect(h.closeTabMock).not.toHaveBeenCalled();
  });

  it('forkSession returns MESSAGE_ID_NOT_FOUND → user-friendly "Cannot rewind to this point…" message surfaced', async () => {
    const h = makeHarness();
    h.rewindFilesMock
      .mockResolvedValueOnce(
        rpcOk({
          canRewind: true,
          filesChanged: [],
          insertions: 0,
          deletions: 0,
        }),
      )
      .mockResolvedValueOnce(
        rpcOk({
          canRewind: true,
          filesChanged: [],
          insertions: 0,
          deletions: 0,
        }),
      );
    h.forkSessionMock.mockResolvedValueOnce(
      rpcFailWithCode(
        'msg-x not found in session history',
        'MESSAGE_ID_NOT_FOUND',
      ),
    );

    await h.component.onRewindRequested('msg-not-found');

    expect(h.showErrorMock).toHaveBeenCalledWith(
      'Cannot rewind to this point — no assistant reply exists yet.',
      null,
    );
    expect(h.openSessionTabMock).not.toHaveBeenCalled();
    expect(h.switchSessionMock).not.toHaveBeenCalled();
  });

  it('user cancels confirmation → no fork, no delete, no tab swap', async () => {
    const h = makeHarness();
    h.rewindFilesMock.mockResolvedValueOnce(
      rpcOk({ canRewind: true, filesChanged: [], insertions: 0, deletions: 0 }),
    );
    h.confirmWithCheckboxesMock.mockResolvedValueOnce({ confirmed: false });

    await h.component.onRewindRequested('msg-cancel');

    expect(h.forkSessionMock).not.toHaveBeenCalled();
    expect(h.openSessionTabMock).not.toHaveBeenCalled();
    expect(h.switchSessionMock).not.toHaveBeenCalled();
    expect(h.deleteSessionMock).not.toHaveBeenCalled();
    expect(h.showInfoMock).not.toHaveBeenCalled();
  });

  it('canvas-grid mode → rebinds the originating tile in place + switchSession(activate); never opens a second tile via requestCanvasSession', async () => {
    const h = makeHarness();
    primeHappyPath(h);
    h.layoutModeSig.set('grid');

    await h.component.onRewindRequested('msg-canvas');

    // In-place rebind keeps the same tile (keyed by tabId) — no second tile.
    expect(h.rebindTabSessionMock).toHaveBeenCalledWith(
      'tab-abc',
      'new-session-uuid-999',
      'Original Session (rewind)',
    );
    expect(h.requestCanvasSessionMock).not.toHaveBeenCalled();
    expect(h.openSessionTabMock).not.toHaveBeenCalled();
    expect(h.switchSessionMock).toHaveBeenCalledWith('new-session-uuid-999', {
      activate: true,
    });
    expect(h.showInfoMock).toHaveBeenCalledWith(
      'Rewind complete — conversation rewound to this message',
      'tab-abc',
    );
  });

  it('C4/UICS-012 — switchSession(activate) throws → swapFailed, error shown, no delete-original', async () => {
    const h = makeHarness();
    primeHappyPath(h);
    h.layoutModeSig.set('grid');
    h.switchSessionMock.mockRejectedValueOnce(new Error('resume boom'));
    h.confirmWithCheckboxesMock.mockResolvedValueOnce({
      confirmed: true,
      checkboxes: { deleteOriginal: true },
    });

    await h.component.onRewindRequested('msg-canvas-fail');

    expect(h.rebindTabSessionMock).toHaveBeenCalled();
    expect(h.showErrorMock).toHaveBeenCalledWith(
      expect.stringContaining('activating it failed'),
      'tab-abc',
    );
    expect(h.deleteSessionMock).not.toHaveBeenCalled();
    expect(h.showInfoMock).not.toHaveBeenCalled();
  });

  it('aborts when the originating tab cannot be found — does NOT rewire the active tab', async () => {
    const h = makeHarness();
    primeHappyPath(h);
    // Simulate the originating tab having been closed mid-dialog (or a
    // workspace-partition mismatch): the singular lookup returns null.
    h.findTabBySessionIdMock.mockReturnValue(null);

    await h.component.onRewindRequested('msg-no-origin-tab');

    // The origin-tab check now runs BEFORE forkSession, so we abort without
    // creating an orphaned fork on disk. The active tab is NOT silently
    // rewired to the fork (the wrong-session-rewind regression).
    expect(h.forkSessionMock).not.toHaveBeenCalled();
    expect(h.rebindTabSessionMock).not.toHaveBeenCalled();
    expect(h.switchSessionMock).not.toHaveBeenCalled();
    expect(h.upsertSessionSummaryMock).not.toHaveBeenCalled();
    expect(h.showErrorMock).toHaveBeenCalledWith(
      expect.stringContaining('originating tab could not be found'),
      null,
    );
    expect(h.showInfoMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Per-tile banner scoping — the wrong-session-toast regression.
//
// Two sessions are mounted side by side in canvas/tile mode. A rewind fired on
// session A surfaces its success/warning toast scoped to A's tab id. Before the
// fix the banner signals were global, so B's `ChatViewComponent` rendered A's
// toast too ("the success message showed in the other tab"). These tests wire
// the REAL `ActionBannerService` and a tile `SESSION_CONTEXT` so the filtering
// computeds are exercised end-to-end: a banner scoped to another tile must NOT
// leak into this tile, a global (`null`) banner must, and the kind must match.
// ---------------------------------------------------------------------------
describe('ChatViewComponent — canvas start guard', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  const agents = [
    { agentId: 'a', agentType: 'Explore', toolCallId: 'tool-a' },
    { agentId: 'b', agentType: 'Explore', toolCallId: 'tool-b' },
  ] as SubagentRecord[];

  it.each(['single', 'all'] as const)(
    'keeps %s resumable entries and shows the cap reason',
    (mode) => {
      const h = makeHarness({
        sessionContextTabId: 'tile-A',
        useRealBanner: true,
        startGuard: () => 'Running cap reached',
      });
      if (mode === 'single') h.component.handleResumeAgent(agents[0]);
      else h.component.handleResumeAllAgents(agents);
      expect(h.sendOrQueueMessageMock).not.toHaveBeenCalled();
      expect(h.removeResumableSubagentMock).not.toHaveBeenCalled();
      expect(h.component.actionError()).toBe('Running cap reached');
    },
  );

  it.each([null, undefined])(
    'sends both resume paths when guard is %s',
    (result) => {
      const h = makeHarness({
        startGuard: result === undefined ? undefined : () => null,
      });
      h.component.handleResumeAgent(agents[0]);
      h.component.handleResumeAllAgents(agents);
      expect(h.sendOrQueueMessageMock).toHaveBeenCalledTimes(2);
      expect(h.removeResumableSubagentMock).toHaveBeenCalledTimes(3);
    },
  );

  it('blocks the budget wrap-up send with the same notice', async () => {
    const h = makeHarness({
      sessionContextTabId: 'tile-A',
      useRealBanner: true,
      startGuard: () => 'Running cap reached',
    });
    await (
      h.component as unknown as { onBudgetWrapUp(): Promise<void> }
    ).onBudgetWrapUp();
    expect(h.sendOrQueueMessageMock).not.toHaveBeenCalled();
    expect(h.component.actionError()).toBe('Running cap reached');
  });
});

describe('ChatViewComponent — per-tile banner scoping', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('surfaces a banner scoped to THIS tile', () => {
    const h = makeHarness({
      useRealBanner: true,
      sessionContextTabId: 'tile-A',
    });
    h.realActionBanner.showInfo('rewind complete', 'tile-A');
    expect(h.component.actionInfo()).toBe('rewind complete');
    h.realActionBanner.clear();
  });

  it('does NOT surface a banner scoped to ANOTHER tile (the wrong-session-toast bug)', () => {
    const h = makeHarness({
      useRealBanner: true,
      sessionContextTabId: 'tile-A',
    });
    // Banner fired by session B's rewind, scoped to tile-B.
    h.realActionBanner.showInfo('rewind complete', 'tile-B');
    expect(h.component.actionInfo()).toBeNull();
    h.realActionBanner.clear();
  });

  it('surfaces a global (tabId: null) banner on every tile', () => {
    const h = makeHarness({
      useRealBanner: true,
      sessionContextTabId: 'tile-A',
    });
    h.realActionBanner.showError('No active session to rewind.', null);
    expect(h.component.actionError()).toBe('No active session to rewind.');
    h.realActionBanner.clear();
  });

  it('discriminates by kind — a warning does not leak into the info/error slots', () => {
    const h = makeHarness({
      useRealBanner: true,
      sessionContextTabId: 'tile-A',
    });
    h.realActionBanner.showWarning('rollback skipped', 'tile-A');
    expect(h.component.actionWarning()).toBe('rollback skipped');
    expect(h.component.actionInfo()).toBeNull();
    expect(h.component.actionError()).toBeNull();
    h.realActionBanner.clear();
  });
});

// ---------------------------------------------------------------------------
// mainPanelShowing() / SESSION_VISIBLE gating.
//
// `mainPanelShowing()` is the single computed that prevents the hidden main
// panel from double-rendering a tab that a canvas tile already renders live
// (plan risk 5), and freezes a hidden-workspace tile's transcript via the
// injected SESSION_VISIBLE signal (plan §3.6). Direct coverage so a refactor
// can't silently break the gate.
// ---------------------------------------------------------------------------
describe('ChatViewComponent — mainPanelShowing() / SESSION_VISIBLE gating', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('main panel: true outside grid layout, false in grid layout', () => {
    const h = makeHarness();
    // Default single layout → main panel renders its transcript live.
    expect(h.component.mainPanelShowing()).toBe(true);

    // Grid layout → tiles own the live render; the hidden main panel must not.
    h.layoutModeSig.set('grid');
    expect(h.component.mainPanelShowing()).toBe(false);
  });

  it('tile mode: reflects the injected SESSION_VISIBLE signal', () => {
    const h = makeHarness({
      sessionContextTabId: 'tile-A',
      sessionVisible: false,
    });
    // Hidden tile → frozen (not showing).
    expect(h.component.mainPanelShowing()).toBe(false);

    // Becomes visible → shows, independent of the global layout mode.
    h.sessionVisibleSig!.set(true);
    expect(h.component.mainPanelShowing()).toBe(true);
  });

  it('tile mode without SESSION_VISIBLE token defaults to showing', () => {
    const h = makeHarness({ sessionContextTabId: 'tile-A' });
    expect(h.component.mainPanelShowing()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TASK_2026_295 — the "N interrupted agents — Resume" banner in tile mode.
//
// The filter was a strict `s.parentSessionId === sid`. An interrupted subagent
// whose owning session was never resolved matched no tile at all, so the banner
// never rendered for exactly the agents most likely to need resuming.
// ---------------------------------------------------------------------------
describe('ChatViewComponent — resolvedResumableSubagents() scoping', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  function subagent(
    parentToolUseId: string,
    parentSessionId: string | undefined,
  ): SubagentRecord {
    return {
      parentToolUseId,
      status: 'stopped',
      parentSessionId,
    } as SubagentRecord;
  }

  it('surfaces an interrupted subagent whose owning session was never resolved', () => {
    const h = makeHarness({ sessionContextTabId: 'tab-abc' });
    h.resumableSubagentsSig.set([subagent('toolu_ownerless', undefined)]);

    expect(
      h.component.resolvedResumableSubagents().map((s) => s.parentToolUseId),
    ).toEqual(['toolu_ownerless']);
  });

  it('still hides another session`s interrupted subagent', () => {
    const h = makeHarness({ sessionContextTabId: 'tab-abc' });
    h.resumableSubagentsSig.set([
      subagent('toolu_mine', h.sessionId),
      subagent('toolu_theirs', 'session-other'),
    ]);

    expect(
      h.component.resolvedResumableSubagents().map((s) => s.parentToolUseId),
    ).toEqual(['toolu_mine']);
  });

  it('leaves the main panel list untouched', () => {
    const h = makeHarness();
    h.resumableSubagentsSig.set([
      subagent('toolu_mine', h.sessionId),
      subagent('toolu_theirs', 'session-other'),
    ]);

    expect(h.component.resolvedResumableSubagents()).toHaveLength(2);
  });
});

// -----------------------------------------------------------------------------
// TASK_2026_596 Batch 20 — plan-limit wiring of the stats strip.
// -----------------------------------------------------------------------------
describe('ChatViewComponent — plan limits wiring (TASK_2026_596)', () => {
  const OWNER_A: QuotaOwnerRef = {
    key: 'openai-codex#account:aaa',
    providerId: 'openai-codex',
    identityKind: 'account',
    label: 'Codex account',
  };
  const OWNER_B: QuotaOwnerRef = {
    key: 'openai-codex#account:bbb',
    providerId: 'openai-codex',
    identityKind: 'account',
    label: 'Codex account',
  };
  const STARTED = Date.UTC(2026, 9, 5, 11, 0, 0);

  function run(
    agentId: string,
    parentSessionId: string,
    extra: Partial<MonitoredAgent> = {},
  ): MonitoredAgent {
    return {
      agentId,
      cli: 'codex',
      task: `task ${agentId}`,
      status: 'completed',
      startedAt: STARTED,
      stdout: '',
      stderr: '',
      expanded: false,
      segments: [],
      streamEvents: [],
      streamRevision: 0,
      permissionQueue: [],
      parentSessionId,
      ...extra,
    } as MonitoredAgent;
  }

  function ownerSnapshot(owner: QuotaOwnerRef): PlanLimitOwnerSnapshot {
    return {
      owner,
      status: 'available',
      windowSetEstablished: true,
      windows: [
        {
          key: 'weekly_model:opus',
          kind: 'weekly_model',
          label: 'Weekly · Opus',
          modelScope: 'opus',
          used: { kind: 'percent', percent: 10 },
          usedSource: 'provider-api',
          usedObservedAt: STARTED,
          observedAt: STARTED,
        },
      ],
      ownerEvidence: [],
    };
  }

  /** The inspector's limits, from the view's one stats source (Delta 3). */
  type StatsView = { stats: SessionStatsSource };
  function statsLimits(h: ReturnType<typeof makeHarness>) {
    return (h.component as unknown as StatsView).stats.inputs()?.limits;
  }

  function harness() {
    // Children are swapped out (NO_ERRORS_SCHEMA) so `TestBed.tick()` can run
    // the effects without wiring every child component's DI graph.
    const h = makeHarness({ renderCompactTemplate: true });
    // The stats show from the first message on (the old strip mount rule).
    h.messagesSig.set([{ id: 'm1', role: 'user', timestamp: 0 }]);
    // The monitor's TOLERANT rule (unresolved parent visible everywhere). The
    // quota and lane tiles must not read it; they use the exact accessor.
    h.agentsForSessionMock.mockImplementation((sessionId: string) =>
      h
        .agentsSig()
        .filter((a) => !a.parentSessionId || a.parentSessionId === sessionId),
    );
    return h;
  }

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('registers ONE plan-limits scope per surface, bound to its DestroyRef', () => {
    const h = harness();
    TestBed.tick();

    expect(h.planLimitsRegisterScopeMock).toHaveBeenCalledTimes(1);
    expect(h.planLimitsRegisterScopeMock).toHaveBeenCalledWith(
      expect.objectContaining({ onDestroy: expect.any(Function) }),
    );
  });

  it('scopes the session with its recorded owner keys, and names [] for both once no session is open', () => {
    const h = harness();
    h.agentsSig.set([
      run('a1', h.sessionId, { quotaOwner: OWNER_A }),
      // No recorded owner: contributes no key, never the current owner's.
      run('a2', h.sessionId),
      run('b1', 'session-other', { quotaOwner: OWNER_B }),
    ]);
    TestBed.tick();

    expect(h.planLimitsScopeUpdateMock).toHaveBeenLastCalledWith({
      sessionIds: [h.sessionId],
      ownerKeys: [OWNER_A.key],
    });

    h.sessionIdSig.set(null);
    TestBed.tick();

    expect(h.planLimitsScopeUpdateMock).toHaveBeenLastCalledWith({
      sessionIds: [],
      ownerKeys: [],
    });
    expect(statsLimits(h)).toBeNull();
  });

  it('reloads when the recorded owner set changes, not on a usage-only update', () => {
    const h = harness();
    h.agentsSig.set([run('a1', h.sessionId, { quotaOwner: OWNER_A })]);
    TestBed.tick();
    const calls = h.planLimitsScopeUpdateMock.mock.calls.length;

    h.agentsSig.set([
      run('a1', h.sessionId, {
        quotaOwner: OWNER_A,
        usageTotals: { inputTokens: 5 },
      }),
    ]);
    TestBed.tick();
    expect(h.planLimitsScopeUpdateMock.mock.calls.length).toBe(calls);

    h.agentsSig.update((list) => [
      ...list,
      run('a3', h.sessionId, { quotaOwner: OWNER_B }),
    ]);
    TestBed.tick();
    expect(h.planLimitsScopeUpdateMock).toHaveBeenLastCalledWith({
      sessionIds: [h.sessionId],
      ownerKeys: [OWNER_A.key, OWNER_B.key],
    });
  });

  it('builds limits from this session`s runs only (F58), and only once a snapshot exists', () => {
    const h = harness();
    h.agentsSig.set([
      run('a1', h.sessionId, { quotaOwner: OWNER_A }),
      run('a2', h.sessionId),
      run('b1', 'session-other', { quotaOwner: OWNER_A }),
    ]);
    expect(statsLimits(h)).toBeNull();

    h.planLimitsSnapshotSig.set({
      generatedAt: STARTED,
      owners: [ownerSnapshot(OWNER_A)],
      sessionOwners: {
        [h.sessionId]: { ownerKey: OWNER_A.key, modelScope: 'opus' },
      },
    });

    const limits = statsLimits(h);
    expect(limits?.lanesCount).toBe(2);
    const statuses = limits?.laneTiles
      .flatMap((tile) => tile.subgroups)
      .map((group) => group.ownerStatus)
      .sort();
    expect(statuses).toEqual(['not-recorded', 'same']);
    // The session's backend-resolved scope (`opus`) shows its window tile.
    expect(limits?.planTiles.some((tile) => tile.kind === 'window')).toBe(true);
    // A run carries no resolved scope, so model-scoped limits are not applied.
    const sameGroup = limits?.laneTiles
      .flatMap((tile) => tile.subgroups)
      .find((group) => group.ownerStatus === 'same');
    expect(sameGroup?.notes).toContainEqual({
      tone: 'info',
      text: 'Model unknown · model-specific limits are not applied',
    });
  });

  it('passes a failed refresh to the strip while data is held, and clears it on the next good read', () => {
    const h = harness();
    h.planLimitsSnapshotSig.set({
      generatedAt: STARTED,
      owners: [ownerSnapshot(OWNER_A)],
      sessionOwners: {
        [h.sessionId]: { ownerKey: OWNER_A.key, modelScope: 'opus' },
      },
    });
    expect(statsLimits(h)?.refreshNotice).toBeUndefined();

    h.planLimitsLoadErrorSig.set(true);
    expect(statsLimits(h)?.refreshNotice).toMatch(
      /^Refresh failed — showing last observed data/,
    );

    h.planLimitsLoadErrorSig.set(false);
    expect(statsLimits(h)?.refreshNotice).toBeUndefined();
  });

  it('shows a lane in no session`s tiles until its parent resolves, then only in that session`s', () => {
    // One surface viewed under two sessions (TestBed mounts one ChatView per
    // test); the store-level spec covers both sessions side by side.
    const OTHER = 'session-other';
    const h = harness();
    h.planLimitsSnapshotSig.set({
      generatedAt: STARTED,
      owners: [ownerSnapshot(OWNER_A)],
      sessionOwners: {
        [h.sessionId]: { ownerKey: OWNER_A.key, modelScope: null },
        [OTHER]: { ownerKey: OWNER_A.key, modelScope: null },
      },
    });
    const lanes = () => statsLimits(h)?.lanesCount;

    // Unresolved parent: the lane is in neither session's tiles, even though
    // the monitor's tolerant accessor would list it in both.
    const lane = run('lane', h.sessionId, { quotaOwner: OWNER_A });
    delete (lane as { parentSessionId?: string }).parentSessionId;
    h.agentsSig.set([lane]);
    expect(lanes()).toBe(0);
    h.sessionIdSig.set(OTHER);
    expect(lanes()).toBe(0);

    // Resolved to OTHER: only OTHER's tiles count it.
    h.agentsSig.set([run('lane', OTHER, { quotaOwner: OWNER_A })]);
    expect(lanes()).toBe(1);
    h.sessionIdSig.set(h.sessionId);
    expect(lanes()).toBe(0);
  });

  it('formats times in the host zone and app locale, never a fixed UTC', () => {
    const real = Intl.DateTimeFormat.prototype.resolvedOptions;
    jest
      .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
      .mockImplementation(function (this: Intl.DateTimeFormat) {
        return { ...real.call(this), timeZone: 'Europe/Berlin' };
      });
    const h = harness();
    // The time options live inside the stats source and reach the view only
    // through the formatted reset line, so give the window a reset instant.
    const owner = ownerSnapshot(OWNER_A);
    const now = Date.UTC(2026, 9, 5, 12, 0, 0); // the harness's `now()`
    const resetsAt = now + 3 * 60 * 60 * 1000;
    h.planLimitsSnapshotSig.set({
      generatedAt: STARTED,
      owners: [{ ...owner, windows: [{ ...owner.windows[0], resetsAt }] }],
      sessionOwners: {
        [h.sessionId]: { ownerKey: OWNER_A.key, modelScope: 'opus' },
      },
    });

    const resetLine = statsLimits(h)?.planTiles.find(
      (tile) => tile.kind === 'window',
    )?.resetLine;
    const zoneNameLocale = TestBed.inject(LOCALE_ID);
    expect(resetLine).toContain(
      formatLocalAbsolute(resetsAt, now, {
        timeZone: 'Europe/Berlin',
        zoneNameLocale,
      }),
    );
    expect(resetLine).not.toContain(
      formatLocalAbsolute(resetsAt, now, { timeZone: 'UTC', zoneNameLocale }),
    );
  });

  describe('toStatsLimitLaneRun', () => {
    it('marks a run restored only by the restore flag, not by its status', () => {
      expect(
        toStatsLimitLaneRun(
          run('r', 's', { restored: true, status: 'running' }),
        ).restored,
      ).toBe(true);
      expect(
        toStatsLimitLaneRun(run('l', 's', { status: 'completed' })).restored,
      ).toBe(false);
    });

    it.each([
      ['null', null],
      ['absent', undefined],
    ])('passes %s usageTotals through as unknown, never 0', (_label, usage) => {
      const lane = toStatsLimitLaneRun(
        run('u', 's', usage === null ? { usageTotals: null } : {}),
      );
      expect(lane.usageTotals ?? null).toBeNull();
    });

    it('uses the card display name, persisted model scope, and keeps an absent owner absent', () => {
      const named = toStatsLimitLaneRun(
        run('n', 's', {
          displayName: 'Codex',
          model: 'gpt-5-codex',
          modelScope: 'gpt-5-codex',
        }),
      );
      expect(named.cliLabel).toBe('Codex');
      expect(named.model).toBe('gpt-5-codex');
      expect(named.modelScope).toBe('gpt-5-codex');
      expect(named.quotaOwner).toBeUndefined();

      const bare = toStatsLimitLaneRun(run('b', 's'));
      expect(bare.cliLabel).toBe('Codex');
      expect(bare.model).toBeNull();
    });

    it('labels a restored Ptah CLI run without a display name by product name, never the raw id', () => {
      const restored = toStatsLimitLaneRun(
        run('r', 's', { cli: 'ptah-cli', restored: true }),
      );
      expect(restored.cliLabel).toBe('Ptah CLI');
    });
  });
});

// -----------------------------------------------------------------------------
// TASK_2026_176 — panel resize coalescing + blur/Escape teardown
//
// The pointer-move listener used to run inside the Angular zone and called
// getBoundingClientRect() once per native pointer event, costing a change-
// detection pass plus a forced synchronous layout each time. It now runs
// outside the zone, records only the latest pointer event, and arms a single
// requestAnimationFrame. The actual width write (and the template-bound
// signal) only happens inside ngZone.run in the frame callback, so live visual
// feedback is preserved while the per-event overhead is removed.
// -----------------------------------------------------------------------------
describe('ChatViewComponent — panel resize coalescing and teardown (TASK_2026_176)', () => {
  let h: ReturnType<typeof makeHarness>;
  let host: HTMLElement;
  let handle: HTMLElement;
  let setPointerCapture: jest.Mock;
  let hasPointerCapture: jest.Mock;
  let releasePointerCapture: jest.Mock;
  let frames: Map<number, FrameRequestCallback>;
  let nextFrameId: number;
  let rafSpy: jest.SpyInstance;
  let cafSpy: jest.SpyInstance;

  function tickFrame(): void {
    const pending = [...frames.values()];
    frames.clear();
    for (const cb of pending) cb(performance.now());
  }

  function pointerEvent(
    type: string,
    init: {
      clientX?: number;
      pointerId?: number;
      button?: number;
      bubbles?: boolean;
      cancelable?: boolean;
    } = {},
  ): Event {
    const event = new MouseEvent(type, {
      bubbles: init.bubbles ?? true,
      cancelable: init.cancelable ?? true,
      clientX: init.clientX ?? 0,
      button: init.button ?? 0,
    });
    Object.defineProperty(event, 'pointerId', {
      value: init.pointerId ?? 0,
      configurable: true,
    });
    return event;
  }

  function startDrag(clientX: number): void {
    rafSpy.mockClear();
    frames.clear();
    const event = pointerEvent('pointerdown', {
      button: 0,
      clientX,
      pointerId: 1,
    });
    Object.defineProperty(event, 'currentTarget', {
      value: handle,
      configurable: true,
    });
    h.component.onResizeStart(event as unknown as PointerEvent);
  }

  function moveTo(clientX: number): void {
    handle.dispatchEvent(
      pointerEvent('pointermove', { clientX, pointerId: 1 }),
    );
  }

  function endDrag(): void {
    handle.dispatchEvent(pointerEvent('pointerup', { pointerId: 1 }));
  }

  beforeEach(() => {
    frames = new Map();
    nextFrameId = 1;
    rafSpy = jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        const id = nextFrameId++;
        frames.set(id, cb);
        return id;
      });
    cafSpy = jest
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation((id: number) => {
        frames.delete(id);
      });

    h = makeHarness({ realPanelResize: true });
    host = h.fixture.nativeElement as HTMLElement;
    Object.defineProperty(host, 'clientWidth', {
      value: 1000,
      configurable: true,
    });
    host.getBoundingClientRect = () => ({ right: 1000 }) as DOMRect;

    handle = document.createElement('div');
    host.appendChild(handle);
    setPointerCapture = jest.fn();
    hasPointerCapture = jest.fn().mockReturnValue(true);
    releasePointerCapture = jest.fn();
    Object.defineProperties(handle, {
      setPointerCapture: { value: setPointerCapture, configurable: true },
      hasPointerCapture: { value: hasPointerCapture, configurable: true },
      releasePointerCapture: {
        value: releasePointerCapture,
        configurable: true,
      },
    });
  });

  afterEach(() => {
    h.fixture.destroy();
    rafSpy.mockRestore();
    cafSpy.mockRestore();
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('coalesces pointermove to one setCustomWidth per frame and applies only the latest width', () => {
    const service = h.component.panelResizeService;
    service.setCustomWidth(400, 1000);
    const spy = jest.spyOn(service, 'setCustomWidth');

    startDrag(600);
    moveTo(700); // width 300 → min 300
    moveTo(600); // width 400 → 400
    moveTo(500); // width 500 → 500

    expect(rafSpy).toHaveBeenCalledTimes(1);
    expect(spy).not.toHaveBeenCalled();

    tickFrame();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(service.customWidth()).toBe(500);

    moveTo(650); // width 350 → 350
    moveTo(550); // width 450 → 450
    expect(rafSpy).toHaveBeenCalledTimes(2);

    tickFrame();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(service.customWidth()).toBe(450);

    endDrag();
    spy.mockRestore();
  });

  it('cancels the pending frame on pointerup and still applies the release width', () => {
    const service = h.component.panelResizeService;
    service.setCustomWidth(400, 1000);
    const spy = jest.spyOn(service, 'setCustomWidth');

    startDrag(600);
    moveTo(700); // width 300 → min 300
    expect(frames.size).toBe(1);

    endDrag();
    expect(cafSpy).toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(service.customWidth()).toBe(300);

    moveTo(400);
    expect(rafSpy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockRestore();
  });

  it('preserves the 300px/750px panel clamp', () => {
    const service = h.component.panelResizeService;
    service.setCustomWidth(400, 1000);

    startDrag(600);
    moveTo(0); // width 1000 → max 750
    tickFrame();
    expect(service.customWidth()).toBe(750);

    moveTo(950); // width 50 → min 300
    tickFrame();
    expect(service.customWidth()).toBe(300);

    endDrag();
  });

  it('restores the original width and ends the drag on window blur', () => {
    const service = h.component.panelResizeService;
    service.setCustomWidth(400, 1000);

    startDrag(600);
    moveTo(500); // would become 500

    window.dispatchEvent(new Event('blur'));

    expect(cafSpy).toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(service.customWidth()).toBe(400);
    expect(service.dragging()).toBe(false);
    expect(releasePointerCapture).toHaveBeenCalled();
  });

  it('restores the original width and ends the drag on Escape', () => {
    const service = h.component.panelResizeService;
    service.setCustomWidth(400, 1000);

    startDrag(600);
    moveTo(500);

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );

    expect(frames.size).toBe(0);
    expect(service.customWidth()).toBe(400);
    expect(service.dragging()).toBe(false);
  });

  it('cancels a pending frame on destroy so no update lands after teardown', () => {
    const service = h.component.panelResizeService;
    service.setCustomWidth(400, 1000);
    const spy = jest.spyOn(service, 'setCustomWidth');

    startDrag(600);
    moveTo(500);
    expect(frames.size).toBe(1);

    h.fixture.destroy();

    expect(cafSpy).toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
  });
});

describe('agent panel narrow overlay mode', () => {
  let h: ReturnType<typeof makeHarness>;
  let resizeCallbacks: ResizeObserverCallback[];
  let observeMock: jest.Mock;
  let disconnectMock: jest.Mock;
  let originalResizeObserver: typeof ResizeObserver | undefined;

  beforeEach(() => {
    resizeCallbacks = [];
    observeMock = jest.fn();
    disconnectMock = jest.fn();
    originalResizeObserver = global.ResizeObserver;

    global.ResizeObserver = jest
      .fn()
      .mockImplementation((cb: ResizeObserverCallback) => {
        resizeCallbacks.push(cb);
        return {
          observe: observeMock,
          unobserve: jest.fn(),
          disconnect: disconnectMock,
        };
      }) as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    if (originalResizeObserver) {
      global.ResizeObserver = originalResizeObserver;
    } else {
      delete (global as Record<string, unknown>)['ResizeObserver'];
    }
    h?.fixture.destroy();
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  function emitHostWidth(width: number): void {
    const entry = {
      contentRect: { width },
      target: h.fixture.nativeElement,
    } as unknown as ResizeObserverEntry;

    resizeCallbacks[0]([entry], {} as ResizeObserver);
    h.fixture.detectChanges();
  }

  function panel(): HTMLElement {
    return h.fixture.nativeElement.querySelector('ptah-agent-monitor-panel');
  }

  // Scoped to the Agents controls: the Stats tab is another
  // `ptah-sidebar-tab` and the dock handle another separator.
  function sidebarTab(): HTMLElement | null {
    return h.fixture.nativeElement.querySelector(
      'ptah-sidebar-tab:not([data-inspector-tab])',
    );
  }

  function resizeHandle(): HTMLElement | null {
    return h.fixture.nativeElement.querySelector(
      '[data-testid="agent-resize-handle"]',
    );
  }

  function openPanelFromSidebar(): void {
    const button = h.fixture.nativeElement.querySelector(
      'ptah-sidebar-tab:not([data-inspector-tab]) button',
    ) as HTMLButtonElement;
    button.click();
    h.fixture.detectChanges();
  }

  it('renders overlay chrome below 600px and wide controls at 600px in both directions', () => {
    h = makeHarness({ sessionId: '', renderOverlayTemplate: true });
    h.fixture.detectChanges();
    expect(AGENT_PANEL_OVERLAY_BREAKPOINT).toBe(600);
    expect(observeMock).toHaveBeenCalledWith(h.fixture.nativeElement);

    emitHostWidth(599);
    openPanelFromSidebar();

    expect(panel().classList.contains('absolute')).toBe(true);
    expect(panel().classList.contains('inset-0')).toBe(true);
    expect(panel().classList.contains('w-full')).toBe(true);
    expect(panel().classList.contains('h-full')).toBe(true);
    expect(panel().classList.contains('z-20')).toBe(true);
    expect(panel().classList.contains('bg-base-200')).toBe(true);
    expect(sidebarTab()).toBeNull();
    expect(resizeHandle()).toBeNull();

    emitHostWidth(600);
    expect(panel().classList.contains('absolute')).toBe(false);
    expect(sidebarTab()).not.toBeNull();
    expect(resizeHandle()).not.toBeNull();

    emitHostWidth(599);
    expect(panel().classList.contains('absolute')).toBe(true);
    expect(sidebarTab()).toBeNull();
    expect(resizeHandle()).toBeNull();
  });

  it('renders an already-open panel as an overlay while its initial width is unknown', () => {
    h = makeHarness({ sessionId: '', renderOverlayTemplate: true });
    h.component.toggleAgentPanel();
    h.fixture.detectChanges();

    expect(resizeCallbacks.length).toBeGreaterThan(0);
    expect(panel().classList.contains('absolute')).toBe(true);
    expect(panel().classList.contains('w-full')).toBe(true);
    expect(sidebarTab()).toBeNull();
    expect(resizeHandle()).toBeNull();
  });

  it('closes the overlay on Escape, restores tab focus, and stays closed when an agent starts running', () => {
    h = makeHarness({ sessionId: '', renderOverlayTemplate: true });
    h.fixture.detectChanges();
    emitHostWidth(500);
    openPanelFromSidebar();
    expect(panel().classList.contains('absolute')).toBe(true);
    expect(
      h.fixture.nativeElement.querySelector('button[title="Close panel"]'),
    ).toBe(document.activeElement);

    // The binding is host-scoped, not document-scoped: a canvas holds many
    // chat tiles and Escape must close only the tile it was pressed in.
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    h.fixture.detectChanges();

    expect(panel().classList.contains('absolute')).toBe(false);
    expect(sidebarTab()).not.toBeNull();
    expect(resizeHandle()).toBeNull();
    expect(
      h.fixture.nativeElement.querySelector(
        'ptah-sidebar-tab:not([data-inspector-tab]) button',
      ),
    ).toBe(document.activeElement);

    h.agentsSig.set([
      {
        agentId: 'running-agent',
        cli: 'ptah-cli',
        task: 'test task',
        status: 'running',
        startedAt: Date.now(),
        stdout: '',
        stderr: '',
        expanded: false,
        segments: [],
        streamEvents: [],
        streamRevision: 0,
        permissionQueue: [],
      } as MonitoredAgent,
    ]);
    h.fixture.detectChanges();

    expect(panel().classList.contains('absolute')).toBe(false);
    expect(sidebarTab()).not.toBeNull();
  });

  it('keeps the overlay closed after its close button is used and an agent starts running', () => {
    h = makeHarness({ sessionId: '', renderOverlayTemplate: true });
    h.fixture.detectChanges();
    emitHostWidth(500);
    openPanelFromSidebar();

    const closeButton = h.fixture.nativeElement.querySelector(
      'button[title="Close panel"]',
    ) as HTMLButtonElement;
    closeButton.click();
    h.fixture.detectChanges();

    expect(panel().classList.contains('absolute')).toBe(false);
    expect(sidebarTab()).not.toBeNull();

    h.agentsSig.set([
      {
        agentId: 'running-agent',
        cli: 'ptah-cli',
        task: 'test task',
        status: 'running',
        startedAt: Date.now(),
        stdout: '',
        stderr: '',
        expanded: false,
        segments: [],
        streamEvents: [],
        streamRevision: 0,
        permissionQueue: [],
      } as MonitoredAgent,
    ]);
    h.fixture.detectChanges();

    expect(panel().classList.contains('absolute')).toBe(false);
    expect(sidebarTab()).not.toBeNull();
  });

  it('leaves the overlay open when an inner component already claimed Escape (defaultPrevented)', () => {
    h = makeHarness({ sessionId: '', renderOverlayTemplate: true });
    h.fixture.detectChanges();
    emitHostWidth(500);
    openPanelFromSidebar();
    expect(panel().classList.contains('absolute')).toBe(true);
    const closeSpy = jest.spyOn(h.component, 'closeAgentPanel');

    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();
    document.activeElement?.dispatchEvent(event);
    h.fixture.detectChanges();

    expect(event.defaultPrevented).toBe(true);
    expect(closeSpy).not.toHaveBeenCalled();
    expect(panel().classList.contains('absolute')).toBe(true);
  });

  it('does not close the panel on Escape when in wide mode', () => {
    h = makeHarness({ sessionId: '', renderOverlayTemplate: true });
    h.fixture.detectChanges();
    emitHostWidth(800);
    openPanelFromSidebar();
    expect(resizeHandle()).not.toBeNull();

    h.fixture.nativeElement.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    h.fixture.detectChanges();

    expect(panel().classList.contains('absolute')).toBe(false);
    expect(sidebarTab()).not.toBeNull();
    expect(resizeHandle()).not.toBeNull();
  });

  it('disconnects ResizeObserver on fixture destroy', () => {
    h = makeHarness({ sessionId: '', renderOverlayTemplate: true });
    expect(disconnectMock).not.toHaveBeenCalled();

    h.fixture.destroy();
    expect(disconnectMock).toHaveBeenCalled();
  });
});

describe('ChatViewComponent — compact card gate (forced only)', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('renders the condensed card for a user-chosen compact view', () => {
    const { fixture } = makeHarness({
      activeTabViewMode: 'compact',
      renderCompactTemplate: true,
    });
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('ptah-compact-session-card'),
    ).not.toBeNull();
    const region = fixture.nativeElement.querySelector('[inert].hidden');
    expect(region).not.toBeNull();
    expect(region.querySelector('ptah-chat-transcript')).not.toBeNull();
    expect(region.querySelector('ptah-chat-input')).not.toBeNull();
  });

  it('keeps transcript and composer instances through full, compact, full', () => {
    const h = makeHarness({ renderCompactTemplate: true });
    const tab = signal({ ...h.activeTabMock() });
    h.activeTabMock.mockImplementation(() => tab());
    h.fixture.detectChanges();
    const transcript = h.fixture.nativeElement.querySelector('ptah-chat-transcript');
    const composer = h.fixture.nativeElement.querySelector('ptah-chat-input');
    expect(transcript).not.toBeNull();
    expect(composer).not.toBeNull();

    tab.set({ ...tab(), viewMode: 'compact' });
    h.fixture.detectChanges();
    expect(h.fixture.nativeElement.querySelector('ptah-chat-transcript')).toBe(transcript);
    expect(h.fixture.nativeElement.querySelector('ptah-chat-input')).toBe(composer);
    expect(h.fixture.nativeElement.querySelector('[inert].hidden')).not.toBeNull();

    tab.set({ ...tab(), viewMode: 'full' });
    h.fixture.detectChanges();
    expect(h.fixture.nativeElement.querySelector('ptah-chat-transcript')).toBe(transcript);
    expect(h.fixture.nativeElement.querySelector('ptah-chat-input')).toBe(composer);
    expect(h.fixture.nativeElement.querySelector('[inert].hidden')).toBeNull();
  });

  it('removes the open inspector in compact mode and restores it in full mode', () => {
    const h = makeHarness({ renderCompactTemplate: true, inspectorOpen: true });
    const tab = signal({ ...h.activeTabMock() });
    h.activeTabMock.mockImplementation(() => tab());
    h.findTabByIdAcrossWorkspacesMock.mockImplementation(() => ({ tab: tab() }));
    h.fixture.detectChanges();
    expect(h.fixture.nativeElement.querySelector('.cs-inspector')).not.toBeNull();

    tab.set({ ...tab(), viewMode: 'compact' });
    h.fixture.detectChanges();
    expect(h.fixture.nativeElement.querySelector('.cs-inspector')).toBeNull();

    tab.set({ ...tab(), viewMode: 'full' });
    h.fixture.detectChanges();
    expect(h.fixture.nativeElement.querySelector('.cs-inspector')).not.toBeNull();
  });

  it('expands a user compact tab once', () => {
    const h = makeHarness({ activeTabViewMode: 'compact' });
    h.component.expandToFullView();
    expect(h.tabManagerStub.toggleTabViewMode).toHaveBeenCalledTimes(1);
    expect(h.tabManagerStub.toggleTabViewMode).toHaveBeenCalledWith('tab-abc');
  });

  it('does not toggle a full tab when its card is forced', () => {
    const h = makeHarness({ activeTabViewMode: 'full', forcedCard: true });
    h.component.expandToFullView();
    expect(h.tabManagerStub.toggleTabViewMode).not.toHaveBeenCalled();
  });

  it('hides the display dock for a user-chosen compact mode', () => {
    const { fixture } = makeHarness({
      activeTabViewMode: 'compact',
      renderCompactTemplate: true,
      isElectron: true,
    });
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('ptah-sidebar-tab'),
    ).toBeNull();
  });

  it('hides the display dock when card mode is forced', () => {
    const forced = makeHarness({
      activeTabViewMode: 'compact',
      renderCompactTemplate: true,
      isElectron: true,
      forcedCard: true,
    });
    forced.fixture.detectChanges();
    expect(
      forced.fixture.nativeElement.querySelector('ptah-sidebar-tab'),
    ).toBeNull();
  });

  it('forces a compact card in full mode and restores the full view when cleared', () => {
    const { fixture, forcedCardSig } = makeHarness({
      activeTabViewMode: 'full',
      forcedCard: true,
      renderCompactTemplate: true,
    });
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('ptah-compact-session-card'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('ptah-chat-transcript'),
    ).toBeNull();
    expect(fixture.nativeElement.querySelector('ptah-sidebar-tab')).toBeNull();
    // A forced card hosts no inspector, so it has no session header.
    expect(
      fixture.nativeElement.querySelector('ptah-session-header'),
    ).toBeNull();

    forcedCardSig!.set(false);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('ptah-compact-session-card'),
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector('ptah-chat-input'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('ptah-chat-transcript'),
    ).not.toBeNull();
  });

  it('renders the full view (not the compact card) for "full"', () => {
    const { fixture } = makeHarness({
      activeTabViewMode: 'full',
      renderCompactTemplate: true,
    });
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('ptah-compact-session-card'),
    ).toBeNull();
    expect(
      fixture.nativeElement.querySelector('ptah-chat-input'),
    ).not.toBeNull();
  });
});

// The banner state is covered in session-budget-actions.service.spec.ts and
// the banner itself in session-budget-banner.component.spec.ts; these cases
// pin only the view's wiring to its own tab and session.
describe('ChatViewComponent — session budget banner wiring', () => {
  const SESSION = '11111111-1111-4111-8111-111111111111';
  const BUDGET: SessionBudgetState = {
    sessionId: SESSION,
    stage: 'handoff',
    unit: 'tokens',
    measure: 'tokens',
    used: 41_200_000,
    limit: 50_000_000,
    percent: 82.4,
    lowerBound: false,
    revision: 9,
    compactions: 0,
  };

  type BudgetView = {
    resolvedSessionBudget(): SessionBudgetState | null;
    showSessionBudgetBanner(): boolean;
    budgetDisplayStage(): SessionBudgetState['stage'] | null;
    budgetDismissedStage(): SessionBudgetState['stage'] | null;
    budgetWrapUpSent(): boolean;
    onBudgetWrapUp(): Promise<void>;
    onBudgetDismiss(): void;
  };

  function setup(
    budget: SessionBudgetState | null = BUDGET,
    status: 'loaded' | 'streaming' = 'loaded',
    liveBudgetStage: 'handoff' | 'limit' | null = null,
  ) {
    const h = makeHarness();
    const tab = signal({
      id: 'tab-abc',
      claudeSessionId: SESSION,
      sessionBudget: budget,
      liveBudgetStage,
      status,
    });
    h.activeTabMock.mockImplementation(() => tab());
    return { h, tab, view: h.component as unknown as BudgetView };
  }

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('passes the tab budget through and shows the banner on the idle active tab', () => {
    const { view } = setup();
    expect(view.resolvedSessionBudget()).toBe(BUDGET);
    expect(view.showSessionBudgetBanner()).toBe(true);
  });

  it('shows no banner without a budget', () => {
    const { view } = setup(null);
    expect(view.showSessionBudgetBanner()).toBe(false);
  });

  it('keeps the banner while streaming and binds the live display stage', () => {
    const { tab, view } = setup(
      { ...BUDGET, stage: 'tighten' },
      'streaming',
      'limit',
    );
    expect(view.showSessionBudgetBanner()).toBe(true);
    expect(view.budgetDisplayStage()).toBe('limit');

    tab.update((current) => ({ ...current, status: 'loaded' }));
    expect(view.budgetDisplayStage()).toBe('tighten');
  });

  it('sends the wrap-up prompt through the composer send path for this tab', async () => {
    const { h, view } = setup();

    await view.onBudgetWrapUp();

    expect(h.sendOrQueueMessageMock).toHaveBeenCalledTimes(1);
    expect(h.sendOrQueueMessageMock).toHaveBeenCalledWith(
      expect.stringContaining('This session has used 41.2M tokens.'),
      { tabId: 'tab-abc' },
    );
    expect(view.budgetWrapUpSent()).toBe(true);
  });

  it('dismisses the shown stage locally', () => {
    const { view } = setup();

    view.onBudgetDismiss();

    expect(view.budgetDismissedStage()).toBe('handoff');
  });
});

// Stats tab, docked width and resize handle (TASK_2026_699 Batch 3, fix
// round decision 13). The shell width reaches the controller through a fake
// ResizeObserver on `.cs-shell`; the stored width is the real
// `InspectorDockWidthStore`.
describe('ChatViewComponent — Stats tab and inspector dock', () => {
  const KEY = INSPECTOR_DOCK_WIDTH_STORAGE_KEY;
  let h: ReturnType<typeof makeHarness> | undefined;
  let observers: FakeResizeObserver[] = [];
  let originalResizeObserver: typeof ResizeObserver | undefined;
  let offsetParentSpy: jest.SpyInstance | undefined;

  class FakeResizeObserver {
    readonly targets = new Set<Element>();
    constructor(readonly callback: ResizeObserverCallback) {
      observers.push(this);
    }
    observe(target: Element): void {
      this.targets.add(target);
    }
    unobserve(target: Element): void {
      this.targets.delete(target);
    }
    disconnect(): void {
      this.targets.clear();
    }
  }

  beforeEach(() => {
    observers = [];
    localStorage.clear();
    originalResizeObserver = global.ResizeObserver;
    global.ResizeObserver =
      FakeResizeObserver as unknown as typeof ResizeObserver;
    // jsdom has no layout; the focus routine only moves focus to rendered
    // elements, so report every element as rendered.
    offsetParentSpy = jest
      .spyOn(HTMLElement.prototype, 'offsetParent', 'get')
      .mockReturnValue(document.body);
  });

  afterEach(() => {
    h?.fixture.destroy();
    h = undefined;
    if (originalResizeObserver) {
      global.ResizeObserver = originalResizeObserver;
    } else {
      delete (global as Record<string, unknown>)['ResizeObserver'];
    }
    offsetParentSpy?.mockRestore();
    TestBed.resetTestingModule();
    jest.restoreAllMocks();
    localStorage.clear();
  });

  /** Harness with the bound tab resolvable; not yet rendered. */
  function setup(
    opts: Parameters<typeof makeHarness>[0] = {},
    tabExtra: Record<string, unknown> = {},
  ): ReturnType<typeof makeHarness> {
    const harness = makeHarness({ renderInspectorTemplate: true, ...opts });
    const tab = { ...harness.activeTabMock(), ...tabExtra };
    harness.findTabByIdAcrossWorkspacesMock.mockImplementation(() => ({
      tab,
      workspacePath: '/ws',
    }));
    // Read by the real agent panel's lane link for a non-empty session id.
    Object.assign(harness.tabManagerStub, {
      findTabBySessionIdAcrossWorkspaces: jest.fn(() => null),
    });
    h = harness;
    return harness;
  }

  function create(
    opts: Parameters<typeof makeHarness>[0] = {},
    tabExtra: Record<string, unknown> = {},
  ): ReturnType<typeof makeHarness> {
    const harness = setup(opts, tabExtra);
    detect();
    return harness;
  }

  function native(): HTMLElement {
    return h!.fixture.nativeElement as HTMLElement;
  }

  // `afterNextRender` work (shell attach, focus restore) runs on an app tick.
  function detect(): void {
    h!.fixture.detectChanges();
    TestBed.tick();
  }

  function emitWidth(target: Element, width: number): void {
    const matching = observers.filter((o) => o.targets.has(target));
    expect(matching.length).toBeGreaterThan(0);
    for (const observer of matching) {
      observer.callback(
        [{ contentRect: { width }, target } as unknown as ResizeObserverEntry],
        observer as unknown as ResizeObserver,
      );
    }
    detect();
  }

  /** `width` = main column + dock; the measured shell also holds the tab. */
  function emitShellWidth(width: number): void {
    emitWidth(
      native().querySelector('.cs-shell')!,
      width + INSPECTOR_TAB_WIDTH,
    );
  }

  function sessionTab(): HTMLElement | null {
    return native().querySelector('ptah-sidebar-tab[data-inspector-tab]');
  }

  function sessionTabButton(): HTMLButtonElement {
    return native().querySelector(
      'ptah-sidebar-tab[data-inspector-tab] button',
    ) as HTMLButtonElement;
  }

  function agentsTabButton(): HTMLButtonElement {
    return native().querySelector(
      'ptah-sidebar-tab:not([data-inspector-tab]) button',
    ) as HTMLButtonElement;
  }

  function header(): (HTMLElement & { inspectorOpen?: boolean }) | null {
    return native().querySelector('ptah-session-header');
  }

  function separator(): HTMLElement | null {
    return native().querySelector('ptah-split-handle [role="separator"]');
  }

  function handle(): SplitHandleComponent {
    const debug = h!.fixture.debugElement.query(
      By.directive(SplitHandleComponent),
    );
    expect(debug).not.toBeNull();
    return debug.componentInstance as SplitHandleComponent;
  }

  function dock(): HTMLElement | null {
    return native().querySelector('.cs-inspector');
  }

  function store(): InspectorDockWidthStore {
    return TestBed.inject(InspectorDockWidthStore);
  }

  function dispatchStorage(newValue: string | null): void {
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: KEY,
        newValue,
        storageArea: localStorage,
      }),
    );
    detect();
  }

  it('renders the Stats tab inside the shell after the main column and keeps tab and header in sync (AC 1.1, 1.2, 1.5)', () => {
    create();
    const tab = sessionTab();
    expect(tab).not.toBeNull();
    const slot = tab!.parentElement!;
    expect(slot.classList.contains('cs-stats-tab-slot')).toBe(true);
    expect(slot.parentElement!.classList.contains('cs-shell')).toBe(true);
    // Closed: the tab is the right edge of the chat column.
    expect(slot.previousElementSibling?.hasAttribute('inert')).toBe(false);
    expect(
      slot.nextElementSibling?.classList.contains('cs-inspector') ?? false,
    ).toBe(false);
    expect(sessionTabButton().getAttribute('aria-expanded')).toBe('false');
    expect(sessionTabButton().getAttribute('title')).toBe('Show Stats');
    expect(sessionTabButton().getAttribute('aria-label')).toBe(
      'Toggle Stats panel',
    );
    expect(sessionTabButton().textContent?.trim()).toBe('Stats');
    // The header toggle alone controls the inspector region.
    expect(sessionTabButton().hasAttribute('aria-controls')).toBe(false);
    expect(dock()).toBeNull();

    sessionTabButton().click();
    detect();
    expect(sessionTabButton().getAttribute('aria-expanded')).toBe('true');
    expect(header()?.inspectorOpen).toBe(true);
    expect(dock()).not.toBeNull();
    // Open: the tab sits immediately left of the dock's leading edge, and
    // its active line (side="left": the right edge) faces the dock.
    expect(slot.nextElementSibling?.classList.contains('cs-dock-slot')).toBe(
      true,
    );
    expect(sessionTabButton().classList.contains('border-r')).toBe(true);
    expect(
      sessionTabButton().querySelector('.bg-primary.right-0'),
    ).not.toBeNull();

    sessionTabButton().click();
    detect();
    expect(sessionTabButton().getAttribute('aria-expanded')).toBe('false');
    expect(header()?.inspectorOpen).toBe(false);
    expect(dock()).toBeNull();
  });

  it('renders no Stats tab and no handle in compact, forced-card, tile and bare views (AC 1.7)', () => {
    const views: Array<Parameters<typeof makeHarness>[0]> = [
      { activeTabViewMode: 'compact' },
      { forcedCard: true },
      { sessionContextTabId: 'tab-abc' },
      { embedChrome: 'bare' },
    ];
    for (const view of views) {
      create({ inspectorOpen: true, ...view });
      expect(sessionTab()).toBeNull();
      expect(native().querySelector('ptah-split-handle')).toBeNull();
      expect(native().querySelector('.cs-dock-slot')).toBeNull();
      h!.fixture.destroy();
      h = undefined;
      TestBed.resetTestingModule();
    }
  });

  it('mirrors the header dot on the tab badge (AC 1.8)', () => {
    setup();
    (
      TestBed.inject(SessionInspectorStore).modelFor as jest.Mock
    ).mockImplementation(() => signal({ needsYouCount: 2 }));
    detect();
    expect(sessionTabButton().querySelector('.bg-warning')).not.toBeNull();

    // Open: no dot anywhere.
    sessionTabButton().click();
    detect();
    expect(sessionTabButton().querySelector('.bg-warning')).toBeNull();
    expect(sessionTabButton().querySelector('.bg-info')).toBeNull();
  });

  it('shows the info dot for a workflow tab (sel)', () => {
    create({}, { workflow: 'tribunal' });
    expect(sessionTabButton().querySelector('.bg-info')).not.toBeNull();
    expect(sessionTabButton().querySelector('.bg-warning')).toBeNull();
  });

  it('renders the separator with the 336 default and the effective max (AC 2.1)', () => {
    create({ inspectorOpen: true });
    emitShellWidth(1000);
    const sep = separator()!;
    expect(sep.getAttribute('aria-label')).toBe('Resize session details');
    expect(sep.getAttribute('aria-orientation')).toBe('vertical');
    expect(sep.getAttribute('aria-valuenow')).toBe('336');
    expect(sep.getAttribute('aria-valuemin')).toBe('300');
    expect(sep.getAttribute('aria-valuemax')).toBe('376');
    expect(dock()!.style.width).toBe('336px');
    // The handle sits in a 0 px slot inside the shell, before the dock.
    expect(sep.closest('.cs-dock-slot')).not.toBeNull();
    expect(sep.closest('.cs-shell')).not.toBeNull();
  });

  it('renders a seeded 480 preference at a 1124 px shell', () => {
    localStorage.setItem(KEY, '480');
    create({ inspectorOpen: true });
    emitShellWidth(1124);
    expect(separator()!.getAttribute('aria-valuenow')).toBe('480');
    expect(separator()!.getAttribute('aria-valuemax')).toBe('500');
    expect(dock()!.style.width).toBe('480px');
  });

  it('grows the dock by one ArrowLeft step and persists it (AC 2.3, 3.4)', () => {
    localStorage.setItem(KEY, '480');
    create({ inspectorOpen: true });
    emitShellWidth(1124);
    separator()!.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
    );
    detect();
    expect(localStorage.getItem(KEY)).toBe('496');
    expect(store().preference()).toBe(496);
    expect(dock()!.style.width).toBe('496px');
    expect(separator()!.getAttribute('aria-valuenow')).toBe('496');
  });

  it('resets to the default on double-click and removes the key (AC 2.5)', () => {
    localStorage.setItem(KEY, '480');
    create({ inspectorOpen: true });
    emitShellWidth(1124);
    separator()!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    detect();
    expect(localStorage.getItem(KEY)).toBeNull();
    expect(store().preference()).toBeNull();
    expect(dock()!.style.width).toBe('400px');
  });

  it('floors a fractional shell max so the chat column keeps 624 px (AC 3.2)', () => {
    localStorage.setItem(KEY, '560');
    create({ inspectorOpen: true });
    emitShellWidth(960.5);
    expect(dock()!.style.width).toBe('336px');
    expect(separator()!.getAttribute('aria-valuenow')).toBe('336');
    expect(separator()!.getAttribute('aria-valuemax')).toBe('336');
    expect(store().preference()).toBe(560);
  });

  it('never counts the Stats tab toward the band or the dock max', () => {
    create({ inspectorOpen: true });
    const shellEl = native().querySelector('.cs-shell')!;
    // 991 px measured = 959 px for main column + dock: the sheet band.
    emitWidth(shellEl, 991);
    expect(native().querySelector('ptah-split-handle')).toBeNull();
    // 992 px measured = 960 px: docked, max 960 - 624.
    emitWidth(shellEl, 992);
    expect(separator()!.getAttribute('aria-valuemax')).toBe('336');
    expect(dock()!.style.width).toBe('336px');
  });

  it('keeps the wider stored preference when a drag is cancelled (AC 2.4, 3.3)', () => {
    localStorage.setItem(KEY, '560');
    create({ inspectorOpen: true });
    emitShellWidth(960);
    expect(separator()!.getAttribute('aria-valuenow')).toBe('336');
    expect(dock()!.style.width).toBe('336px');

    handle().sizeChange.emit(320);
    detect();
    expect(dock()!.style.width).toBe('320px');

    handle().sizeChange.emit(336);
    handle().sizeCancel.emit();
    detect();
    expect(localStorage.getItem(KEY)).toBe('560');
    expect(store().preference()).toBe(560);
    expect(dock()!.style.width).toBe('336px');

    emitShellWidth(1500);
    expect(dock()!.style.width).toBe('560px');
  });

  it('writes nothing for a click without movement at a shell-clamped width', () => {
    localStorage.setItem(KEY, '560');
    create({ inspectorOpen: true });
    emitShellWidth(960);
    const setItem = jest.spyOn(Storage.prototype, 'setItem');

    handle().sizeChange.emit(336);
    handle().sizeCommit.emit();
    detect();

    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.getItem(KEY)).toBe('560');
    expect(store().preference()).toBe(560);
  });

  it('restores a committed width in a new chat view over the same storage (AC 3.4, 3.6)', () => {
    create({ inspectorOpen: true });
    emitShellWidth(1124);
    handle().sizeChange.emit(480);
    handle().sizeCommit.emit();
    detect();
    expect(localStorage.getItem(KEY)).toBe('480');

    h!.fixture.destroy();
    h = undefined;
    TestBed.resetTestingModule();
    observers = [];

    create({ inspectorOpen: true });
    emitShellWidth(1124);
    expect(dock()!.style.width).toBe('480px');
  });

  it('follows a width stored by another document when no drag is in progress', () => {
    create({ inspectorOpen: true });
    emitShellWidth(1500);
    expect(dock()!.style.width).toBe('448px');

    dispatchStorage('520');
    expect(dock()!.style.width).toBe('520px');
  });

  it('keeps the drag width over a live sync, then renders the synced width on cancel (R8)', () => {
    create({ inspectorOpen: true });
    emitShellWidth(1500);
    const setItem = jest.spyOn(Storage.prototype, 'setItem');

    handle().sizeChange.emit(400);
    detect();
    expect(dock()!.style.width).toBe('400px');

    dispatchStorage('520');
    expect(dock()!.style.width).toBe('400px');
    expect(store().preference()).toBe(520);

    handle().sizeChange.emit(448);
    handle().sizeCancel.emit();
    detect();
    expect(dock()!.style.width).toBe('520px');
    // No per-frame persistence, and the cancel writes nothing.
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('turns the dock entrance animation off only while dragging', () => {
    create({ inspectorOpen: true });
    emitShellWidth(1500);
    expect(dock()!.classList.contains('cs-inspector--resizing')).toBe(false);

    handle().draggingChange.emit(true);
    detect();
    expect(dock()!.classList.contains('cs-inspector--resizing')).toBe(true);

    handle().draggingChange.emit(false);
    detect();
    expect(dock()!.classList.contains('cs-inspector--resizing')).toBe(false);
  });

  it('drops a stale draft when the handle is destroyed mid-drag (R1)', () => {
    create({ inspectorOpen: true });
    emitShellWidth(1500);
    handle().draggingChange.emit(true);
    handle().sizeChange.emit(400);
    detect();
    expect(dock()!.style.width).toBe('400px');

    // Into the sheet band: the slot and its handle go away without a cancel.
    emitShellWidth(800);
    expect(native().querySelector('ptah-split-handle')).toBeNull();

    emitShellWidth(1500);
    expect(dock()!.style.width).toBe('448px');
    expect(dock()!.classList.contains('cs-inspector--resizing')).toBe(false);
    expect(separator()!.getAttribute('aria-valuenow')).toBe('448');
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('keeps the tab visible but inert in the sheet band, with no handle and no inline width (AC 1.3, 1.4, 2.7, 5.1)', () => {
    create();
    emitShellWidth(800);
    expect(sessionTab()).not.toBeNull();
    expect(sessionTab()!.hasAttribute('inert')).toBe(false);
    expect(sessionTab()!.classList.contains('opacity-50')).toBe(false);

    sessionTabButton().click();
    detect();
    expect(sessionTab()!.hasAttribute('inert')).toBe(true);
    expect(sessionTab()!.classList.contains('opacity-50')).toBe(true);
    // Floats immediately left of the sheet, above the scrim.
    expect(sessionTab()!.classList.contains('cs-stats-tab--sheet')).toBe(true);
    expect(sessionTab()!.classList.contains('cs-stats-tab--full')).toBe(false);
    expect(native().querySelector('ptah-split-handle')).toBeNull();
    expect(dock()).not.toBeNull();
    expect(dock()!.classList.contains('cs-inspector--sheet')).toBe(true);
    expect(dock()!.style.width).toBe('');
  });

  it('pins the tab to the shell start over the full-width sheet', () => {
    create();
    emitShellWidth(500);
    sessionTabButton().click();
    detect();
    expect(dock()!.classList.contains('cs-inspector--sheet')).toBe(true);
    expect(sessionTab()!.classList.contains('cs-stats-tab--sheet')).toBe(true);
    expect(sessionTab()!.classList.contains('cs-stats-tab--full')).toBe(true);
    expect(sessionTab()!.hasAttribute('inert')).toBe(true);
  });

  it('returns focus to the Stats tab after a docked close from the inspector (AC 1.6)', async () => {
    create();
    emitShellWidth(1500);
    sessionTabButton().focus();
    sessionTabButton().click();
    detect();
    await h!.fixture.whenStable();
    detect();
    separator()!.focus();
    expect(document.activeElement).toBe(separator());

    const inspector = native().querySelector('ptah-session-inspector');
    expect(inspector).not.toBeNull();
    inspector!.dispatchEvent(new CustomEvent('closeRequested'));
    detect();

    expect(dock()).toBeNull();
    expect(document.activeElement).toBe(sessionTabButton());
  });

  it('restores focus to the Agents tab, not the Stats tab, after the agent overlay closes', () => {
    create({ sessionId: '' });
    emitWidth(native(), 500);
    expect(sessionTab()).not.toBeNull();

    agentsTabButton().click();
    detect();
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    detect();

    expect(document.activeElement).toBe(agentsTabButton());
    expect(document.activeElement).not.toBe(sessionTabButton());
  });
});
