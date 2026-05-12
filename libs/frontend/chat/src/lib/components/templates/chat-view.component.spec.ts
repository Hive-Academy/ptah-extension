/**
 * ChatViewComponent — unit spec (TASK_2026_118 Batch 8, Task 8.4).
 *
 * Covers the resume-and-retry path in handleRewindError() (4 cases per §6d):
 *
 * 1. session-not-active error → confirmation dialog shown; on user confirm,
 *    chat:resume is called with activate: true.
 * 2. chat:resume returns success with activated: true → second rewindFiles
 *    RPC is issued (attemptRewind() retried).
 * 3. chat:resume returns success with activated: false → error toast shown,
 *    no second rewindFiles call.
 * 4. chat:resume returns failure (isSuccess() = false) → error toast shown,
 *    no retry.
 *
 * Testing strategy: construct ChatViewComponent via TestBed with minimal
 * value stubs for all injected services. The heavy Angular template is not
 * rendered (no compileComponents required since we only test TypeScript logic).
 * We trigger the path by calling onRewindRequested() with:
 *   - chatStore.currentSessionId() returning a valid session ID, and
 *   - chatStore.sessionIsActive() returning true (bypasses the UI guard), and
 *   - _claudeRpc.rewindFiles() returning a session-not-active RpcResult error
 *     so attemptRewind() immediately invokes handleRewindError().
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
import type { SessionId } from '@ptah-extension/shared';
import { RpcResult } from '@ptah-extension/core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a successful RpcResult with typed data. */
function rpcOk<T>(data: T): RpcResult<T> {
  return new RpcResult<T>(true, data);
}

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
  };
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('ChatViewComponent — handleRewindError resume-and-retry (TASK_2026_118)', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Case 1: session-not-active error → confirm dialog shown; chat:resume called
  //         with activate: true on confirm.
  // -------------------------------------------------------------------------

  it('shows confirm dialog and calls chat:resume with activate:true when session-not-active error occurs', async () => {
    const h = makeHarness({ confirmResult: true });

    // First rewindFiles returns a session-not-active error to trigger the branch
    h.rewindFilesMock.mockResolvedValue(
      rpcFail('session-not-active: session not loaded'),
    );

    // chat:resume returns a failure (we just need it to not throw)
    h.rpcCallMock.mockResolvedValue(rpcFail('resume failed'));

    await h.component.onRewindRequested('msg-id-1');

    // Confirm dialog must have been shown
    expect(h.confirmMock).toHaveBeenCalledTimes(1);
    expect(h.confirmMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Session not active',
      }),
    );

    // chat:resume must have been called with activate: true
    expect(h.rpcCallMock).toHaveBeenCalledWith(
      'chat:resume',
      expect.objectContaining({
        sessionId: h.sessionId,
        activate: true,
      }),
    );
  });

  it('does NOT call chat:resume when user cancels the confirmation dialog', async () => {
    const h = makeHarness({ confirmResult: false });

    h.rewindFilesMock.mockResolvedValue(
      rpcFail('session-not-active: not loaded'),
    );

    await h.component.onRewindRequested('msg-cancel-1');

    expect(h.confirmMock).toHaveBeenCalledTimes(1);
    expect(h.rpcCallMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Case 2: chat:resume success with activated:true → second rewindFiles call
  //         (attemptRewind retried).
  // -------------------------------------------------------------------------

  it('retries rewindFiles (second call) when chat:resume succeeds with activated:true', async () => {
    const h = makeHarness({ confirmResult: true });

    // First rewindFiles call: session-not-active → triggers handleRewindError
    h.rewindFilesMock.mockResolvedValueOnce(
      rpcFail('session-not-active: not loaded'),
    );

    // chat:resume: success with activated: true
    h.rpcCallMock.mockResolvedValue(rpcOk({ activated: true, success: true }));

    // Second rewindFiles call (retry): return a non-error result so we don't
    // loop back into handleRewindError (canRewind = false gives a clean exit)
    h.rewindFilesMock.mockResolvedValueOnce(
      rpcOk({ canRewind: false, error: 'Checkpoint missing' }),
    );

    await h.component.onRewindRequested('msg-retry-1');

    // rewindFiles must have been called TWICE:
    // once (dryRun) → session-not-active, then resume, then once more (retry dryRun)
    expect(h.rewindFilesMock).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Case 3: chat:resume success with activated:false → error toast, no retry.
  // -------------------------------------------------------------------------

  it('shows error toast and does NOT retry when chat:resume returns activated:false', async () => {
    const h = makeHarness({ confirmResult: true });

    h.rewindFilesMock.mockResolvedValueOnce(
      rpcFail('session-not-active: not loaded'),
    );

    // chat:resume succeeds but activated is false
    h.rpcCallMock.mockResolvedValue(rpcOk({ activated: false, success: true }));

    await h.component.onRewindRequested('msg-notactivated-1');

    // Error toast shown (actionBanner.showError called)
    expect(h.showErrorMock).toHaveBeenCalledTimes(1);
    expect(h.showErrorMock).toHaveBeenCalledWith(
      expect.stringContaining('activated'),
    );

    // No second rewindFiles call
    expect(h.rewindFilesMock).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Case 4: chat:resume failure (isSuccess() = false) → error toast, no retry.
  // -------------------------------------------------------------------------

  it('shows error toast and does NOT retry when chat:resume itself fails', async () => {
    const h = makeHarness({ confirmResult: true });

    h.rewindFilesMock.mockResolvedValueOnce(
      rpcFail('session-not-active: not loaded'),
    );

    // chat:resume fails entirely
    h.rpcCallMock.mockResolvedValue(rpcFail('network error'));

    await h.component.onRewindRequested('msg-resumefail-1');

    // Error toast must be shown
    expect(h.showErrorMock).toHaveBeenCalledTimes(1);
    expect(h.showErrorMock).toHaveBeenCalledWith(
      expect.stringContaining('Resume failed'),
    );

    // No retry
    expect(h.rewindFilesMock).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Gap 16: retry COUNT cap — second session-not-active after successful
  //         resume must NOT issue a third chat:resume call (infinite-loop guard).
  // -------------------------------------------------------------------------

  it('infinite-loop guard: second session-not-active after successful resume does NOT issue a third chat:resume', async () => {
    const h = makeHarness({ confirmResult: true });

    // First dryRun attempt fails with session-not-active → triggers handleRewindError
    h.rewindFilesMock.mockResolvedValueOnce(rpcFail('session-not-active: foo'));

    // User confirms "Resume & retry" in the dialog (confirmResult: true above)

    // chat:resume succeeds with activated: true
    h.rpcCallMock.mockResolvedValue(rpcOk({ activated: true, success: true }));

    // Second dryRun attempt (the retry) ALSO returns session-not-active.
    // Now retryCount === 1, so retryCount > 0 must gate a third chat:resume.
    h.rewindFilesMock.mockResolvedValueOnce(rpcFail('session-not-active: foo'));

    await h.component.onRewindRequested('msg-cap-1');

    // chat:resume must have been called EXACTLY once (not a second time after
    // the second session-not-active, which would start an infinite loop).
    expect(h.rpcCallMock).toHaveBeenCalledWith(
      'chat:resume',
      expect.objectContaining({ activate: true }),
    );
    expect(
      h.rpcCallMock.mock.calls.filter(
        ([method]: [string]) => method === 'chat:resume',
      ),
    ).toHaveLength(1);

    // Error toast must be shown with the retry-failed message
    expect(h.showErrorMock).toHaveBeenCalledTimes(1);
    expect(h.showErrorMock).toHaveBeenCalledWith(
      expect.stringContaining('Rewind failed after resume retry'),
    );

    // rewindFiles called exactly twice: first attempt + retry after resume
    expect(h.rewindFilesMock).toHaveBeenCalledTimes(2);
  });
});
