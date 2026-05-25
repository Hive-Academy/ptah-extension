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

import {
  Component,
  Input,
  NgModule,
  ChangeDetectionStrategy,
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
import { ChatViewComponent } from './chat-view.component';
import { ChatStore } from '../../services/chat.store';
import { ActionBannerService } from '../../services/action-banner.service';
import { CompactionLifecycleService } from '../../services/chat-store/compaction-lifecycle.service';
import {
  VSCodeService,
  ClaudeRpcService,
  AppStateManager,
  AuthStateService,
} from '@ptah-extension/core';
import {
  TabManagerService,
  ConversationRegistry,
  TabSessionBinding,
  ConfirmationDialogService,
} from '@ptah-extension/chat-state';
import {
  AgentMonitorStore,
  ExecutionTreeBuilderService,
} from '@ptah-extension/chat-streaming';
import { PanelResizeService } from '../../services/panel-resize.service';
import { SESSION_CONTEXT } from '../../tokens/session-context.token';
import { RpcResult } from '@ptah-extension/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a failed RpcResult with an error string. */
function rpcFail<T>(error: string): RpcResult<T> {
  return new RpcResult<T>(false, undefined, error);
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
  } = {},
) {
  const {
    sessionId = 'session-uuid-123',
    sessionIsActive = true,
    confirmResult = true,
  } = opts;

  // Writable signals for reactive control from tests
  const sessionIdSig = signal<string | null>(sessionId);
  const sessionIsActiveSig = signal<boolean>(sessionIsActive);
  const showErrorMock = jest.fn();
  const suppressAnimateOnceSig = signal<boolean>(false);

  const chatStoreStub = {
    currentSessionId: sessionIdSig.asReadonly(),
    sessionIsActive: sessionIsActiveSig.asReadonly(),
    // Other signals required by computed() inside the component
    activeTab: signal(null),
    messages: signal([]),
    isStreaming: signal(false),
    currentModel: signal('claude-sonnet-4-20250514'),
    sessionStatus: signal(null),
    queueRestoreContent: signal(null),
    agentPanelOpen: signal(false),
  } as unknown as ChatStore;

  // TabManagerService: resolvedTabId and resolvedSessionId depend on it
  const activeTabIdSig = signal<string | null>('tab-abc');
  const tabsSig = signal<
    Array<{
      id: string;
      claudeSessionId: string | null;
      hasLiveSession: boolean;
    }>
  >([
    {
      id: 'tab-abc',
      claudeSessionId: sessionId,
      hasLiveSession: sessionIsActive,
    },
  ]);
  const tabManagerStub = {
    activeTabId: activeTabIdSig.asReadonly(),
    activeTabSessionId: signal<string | null>(sessionId).asReadonly(),
    activeTabHasLiveSession: sessionIsActiveSig.asReadonly(),
    tabs: tabsSig.asReadonly(),
    createTab: jest.fn(),
    toggleTabViewMode: jest.fn(),
    streamingTabIds: signal<Set<string>>(new Set()).asReadonly(),
  } as unknown as TabManagerService;

  const vscodeStub = {
    config: jest.fn(() => ({
      workspaceRoot: '/test/workspace',
    })),
    getPtahIconUri: () => 'data:image/svg+xml;base64,PHN2Zy8+',
    getPtahUserIconUri: () => 'data:image/svg+xml;base64,PHN2Zy8+',
  } as unknown as VSCodeService;

  const rewindFilesMock = jest.fn();
  const rpcCallMock = jest.fn();
  const rpcStub = {
    rewindFiles: rewindFilesMock,
    call: rpcCallMock,
  } as unknown as ClaudeRpcService;

  const confirmMock = jest.fn().mockResolvedValue(confirmResult);
  const confirmDialogStub = {
    confirm: confirmMock,
  } as unknown as ConfirmationDialogService;

  const actionBannerStub = {
    error: signal<string | null>(null).asReadonly(),
    info: signal<string | null>(null).asReadonly(),
    showError: showErrorMock,
    showInfo: jest.fn(),
  } as unknown as ActionBannerService;

  const compactionLifecycleStub = {
    suppressAnimateOnce: suppressAnimateOnceSig.asReadonly(),
  } as unknown as CompactionLifecycleService;

  const agentMonitorStoreStub = {
    agents: signal([]).asReadonly(),
    agentsForSession: jest.fn(() => []),
  } as unknown as AgentMonitorStore;

  const panelResizeStub = {
    setDragging: jest.fn(),
    setCustomWidth: jest.fn(),
    customWidth: signal(null),
  } as unknown as PanelResizeService;

  const appStateStub = {
    currentView: signal('chat'),
  } as unknown as AppStateManager;

  const treeBuilderStub = {} as unknown as ExecutionTreeBuilderService;

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
      { provide: ChatStore, useValue: chatStoreStub },
      { provide: VSCodeService, useValue: vscodeStub },
      { provide: ClaudeRpcService, useValue: rpcStub },
      { provide: ConfirmationDialogService, useValue: confirmDialogStub },
      { provide: ActionBannerService, useValue: actionBannerStub },
      { provide: TabManagerService, useValue: tabManagerStub },
      {
        provide: CompactionLifecycleService,
        useValue: compactionLifecycleStub,
      },
      { provide: AgentMonitorStore, useValue: agentMonitorStoreStub },
      { provide: PanelResizeService, useValue: panelResizeStub },
      { provide: AppStateManager, useValue: appStateStub },
      { provide: ExecutionTreeBuilderService, useValue: treeBuilderStub },
      { provide: ConversationRegistry, useValue: conversationRegistryStub },
      { provide: TabSessionBinding, useValue: tabSessionBindingStub },
      { provide: AuthStateService, useValue: authStateStub },
      { provide: SESSION_CONTEXT, useValue: null },
    ],
  });

  const fixture = TestBed.createComponent(ChatViewComponent);
  const component = fixture.componentInstance;

  return {
    component,
    fixture,
    sessionId,
    rewindFilesMock,
    rpcCallMock,
    confirmMock,
    showErrorMock,
    sessionIsActiveSig,
    sessionIdSig,
    activeTabIdSig,
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ChatViewComponent — rewind flow (backend auto-resume)', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // sessionIsActive === false UI guard short-circuits before any RPC.
  // -------------------------------------------------------------------------

  it('shows error and does NOT call rewindFiles when sessionIsActive is false', async () => {
    const h = makeHarness({ sessionIsActive: false });

    await h.component.onRewindRequested('msg-inactive');

    expect(h.rewindFilesMock).not.toHaveBeenCalled();
    expect(h.rpcCallMock).not.toHaveBeenCalled();

    expect(h.showErrorMock).toHaveBeenCalledTimes(1);
    expect(h.showErrorMock).toHaveBeenCalledWith(
      expect.stringContaining('active conversation'),
    );
  });

  // -------------------------------------------------------------------------
  // dryRun failure surfaces a single error toast — NO frontend resume retry.
  // (Backend now owns the auto-resume; if it still failed at this point, the
  //  caller should see the raw error rather than trigger another resume call.)
  // -------------------------------------------------------------------------

  it('shows a single error toast and does NOT call chat:resume when dryRun rewindFiles fails', async () => {
    const h = makeHarness();

    h.rewindFilesMock.mockResolvedValueOnce(
      rpcFail('session-not-active: backend auto-resume failed'),
    );

    await h.component.onRewindRequested('msg-fail-1');

    expect(h.showErrorMock).toHaveBeenCalledTimes(1);
    expect(h.showErrorMock).toHaveBeenCalledWith(
      expect.stringContaining('Rewind failed'),
    );
    // No retry, no resume-confirm dialog, no chat:resume.
    expect(h.rewindFilesMock).toHaveBeenCalledTimes(1);
    expect(h.confirmMock).not.toHaveBeenCalled();
    expect(h.rpcCallMock).not.toHaveBeenCalledWith(
      'chat:resume',
      expect.anything(),
    );
  });
});
