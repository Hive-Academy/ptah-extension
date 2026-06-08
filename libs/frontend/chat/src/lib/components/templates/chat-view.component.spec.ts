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

  const switchSessionMock = jest.fn().mockResolvedValue(undefined);
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
    switchSession: switchSessionMock,
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
  const openSessionTabMock = jest.fn();
  const findTabsBySessionIdMock = jest.fn().mockReturnValue([]);
  const closeTabMock = jest.fn().mockResolvedValue(undefined);
  const tabManagerStub = {
    activeTabId: activeTabIdSig.asReadonly(),
    activeTabSessionId: signal<string | null>(sessionId).asReadonly(),
    activeTabHasLiveSession: sessionIsActiveSig.asReadonly(),
    tabs: tabsSig.asReadonly(),
    createTab: jest.fn(),
    toggleTabViewMode: jest.fn(),
    streamingTabIds: signal<Set<string>>(new Set()).asReadonly(),
    openSessionTab: openSessionTabMock,
    findTabsBySessionId: findTabsBySessionIdMock,
    closeTab: closeTabMock,
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
  const actionBannerStub = {
    error: signal<string | null>(null).asReadonly(),
    info: signal<string | null>(null).asReadonly(),
    warning: signal<string | null>(null).asReadonly(),
    showError: showErrorMock,
    showInfo: showInfoMock,
    showWarning: showWarningMock,
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

  const layoutModeSig = signal<'single' | 'grid'>('single');
  const requestCanvasSessionMock = jest
    .fn<Promise<boolean>, [string, string?]>()
    .mockResolvedValue(true);
  const appStateStub = {
    currentView: signal('chat'),
    layoutMode: layoutModeSig.asReadonly(),
    requestCanvasSession: requestCanvasSessionMock,
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
    forkSessionMock,
    deleteSessionMock,
    confirmMock,
    confirmWithCheckboxesMock,
    switchSessionMock,
    openSessionTabMock,
    findTabsBySessionIdMock,
    closeTabMock,
    requestCanvasSessionMock,
    layoutModeSig,
    showErrorMock,
    showInfoMock,
    showWarningMock,
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

  it('happy path: dryRun ok → user confirms → forkSession succeeds → openSessionTab + switchSession called → success message → original NOT deleted', async () => {
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

    // Tab swap to new session
    expect(h.openSessionTabMock).toHaveBeenCalledWith(
      'new-session-uuid-999',
      'Rewind',
    );
    expect(h.switchSessionMock).toHaveBeenCalledWith('new-session-uuid-999');

    // Success message — no rollback suffix
    expect(h.showInfoMock).toHaveBeenCalledTimes(1);
    expect(h.showInfoMock).toHaveBeenCalledWith(
      'Rewind complete — switched to new session',
    );

    // Original NOT deleted
    expect(h.findTabsBySessionIdMock).not.toHaveBeenCalled();
    expect(h.deleteSessionMock).not.toHaveBeenCalled();
    expect(h.closeTabMock).not.toHaveBeenCalled();
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

    const firstClose = h.closeTabMock.mock.invocationCallOrder[0];
    const firstDelete = h.deleteSessionMock.mock.invocationCallOrder[0];
    expect(firstClose).toBeLessThan(firstDelete);

    expect(h.switchSessionMock).toHaveBeenCalledWith('new-session-uuid-999');
    expect(h.showInfoMock).toHaveBeenCalledWith(
      'Rewind complete — switched to new session',
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
    );
  });

  it('rewindFiles dryRun fails → error surfaced, forkSession NOT called', async () => {
    const h = makeHarness();
    h.rewindFilesMock.mockResolvedValueOnce(rpcFail('disk error'));

    await h.component.onRewindRequested('msg-dry-fail');

    expect(h.showErrorMock).toHaveBeenCalledWith(
      expect.stringContaining('Rewind failed'),
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
    );
    expect(h.showInfoMock).not.toHaveBeenCalled();
    expect(h.showWarningMock).toHaveBeenCalledTimes(1);
    expect(h.showWarningMock).toHaveBeenCalledWith(
      expect.stringContaining('file rollback skipped'),
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
      'Rewind complete — switched to new session',
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

  it('canvas-grid mode → requestCanvasSession(newSessionId, "Rewind") awaited; happy adoption shows success info', async () => {
    const h = makeHarness();
    primeHappyPath(h);
    h.layoutModeSig.set('grid');
    h.requestCanvasSessionMock.mockResolvedValueOnce(true);

    await h.component.onRewindRequested('msg-canvas');

    expect(h.requestCanvasSessionMock).toHaveBeenCalledWith(
      'new-session-uuid-999',
      'Rewind',
    );
    expect(h.openSessionTabMock).not.toHaveBeenCalled();
    expect(h.switchSessionMock).not.toHaveBeenCalled();
    expect(h.showInfoMock).toHaveBeenCalledWith(
      'Rewind complete — switched to new session',
    );
  });

  it('C4/UICS-012 — canvas adoption returns false (tile cap reached) → swapFailed, error shown, no delete-original', async () => {
    const h = makeHarness();
    primeHappyPath(h);
    h.layoutModeSig.set('grid');
    h.requestCanvasSessionMock.mockResolvedValueOnce(false);
    h.confirmWithCheckboxesMock.mockResolvedValueOnce({
      confirmed: true,
      checkboxes: { deleteOriginal: true },
    });

    await h.component.onRewindRequested('msg-canvas-fail');

    expect(h.requestCanvasSessionMock).toHaveBeenCalled();
    expect(h.showErrorMock).toHaveBeenCalledWith(
      expect.stringContaining('canvas tile could not be opened'),
    );
    expect(h.deleteSessionMock).not.toHaveBeenCalled();
    expect(h.showInfoMock).not.toHaveBeenCalled();
  });
});
