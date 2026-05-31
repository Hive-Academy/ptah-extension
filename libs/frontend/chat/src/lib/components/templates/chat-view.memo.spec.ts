import {
  Component,
  Input,
  NgModule,
  ChangeDetectionStrategy,
  signal,
  WritableSignal,
} from '@angular/core';

jest.mock('ngx-markdown', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'markdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: '<div data-test="markdown-stub">{{ data }}</div>',
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
import type {
  ExecutionChatMessage,
  ExecutionNode,
} from '@ptah-extension/shared';

interface MemoHarness {
  component: ChatViewComponent;
  messagesSig: WritableSignal<readonly ExecutionChatMessage[]>;
  streamingStateSig: WritableSignal<unknown>;
  buildTreeMock: jest.Mock;
}

function makeMessage(id: string): ExecutionChatMessage {
  return {
    id,
    role: 'assistant',
    rawContent: 'content',
    timestamp: 0,
  } as unknown as ExecutionChatMessage;
}

function makeTree(id: string): ExecutionNode {
  return {
    id,
    type: 'text',
    status: 'completed',
    content: 'tree content',
  } as unknown as ExecutionNode;
}

function makeMemoHarness(): MemoHarness {
  const messagesSig = signal<readonly ExecutionChatMessage[]>([]);
  const streamingStateSig = signal<unknown>(null);
  const buildTreeMock = jest.fn(() => [] as ExecutionNode[]);

  const chatStoreStub = {
    currentSessionId: signal('session-1').asReadonly(),
    sessionIsActive: signal(true).asReadonly(),
    activeTab: signal(null),
    messages: messagesSig.asReadonly(),
    isStreaming: signal(false),
    currentModel: signal('claude-sonnet-4-20250514'),
    sessionStatus: signal(null),
    queueRestoreContent: signal(null),
    agentPanelOpen: signal(false),
    activeStreamingState: streamingStateSig.asReadonly(),
    preloadedStats: signal(null),
    liveModelStats: signal(null),
    modelUsageList: signal(null),
    compactionCount: signal(0),
    isCompacting: signal(false),
    questionRequests: signal([]),
    questionTargetTabsFor: jest.fn(() => []),
    queuedContent: signal(null),
    clearQueuedContent: jest.fn(),
    sendOrQueueMessage: jest.fn(),
    removeResumableSubagent: jest.fn(),
    switchSession: jest.fn(),
  } as unknown as ChatStore;

  const tabManagerStub = {
    activeTabId: signal<string | null>(null).asReadonly(),
    activeTabSessionId: signal<string | null>('session-1').asReadonly(),
    activeTabHasLiveSession: signal(true).asReadonly(),
    activeTab: signal(null).asReadonly(),
    activeTabViewMode: signal('full').asReadonly(),
    tabs: signal([]).asReadonly(),
    createTab: jest.fn(),
    toggleTabViewMode: jest.fn(),
    streamingTabIds: signal<Set<string>>(new Set()).asReadonly(),
  } as unknown as TabManagerService;

  TestBed.configureTestingModule({
    imports: [ChatViewComponent],
    providers: [
      { provide: ChatStore, useValue: chatStoreStub },
      {
        provide: VSCodeService,
        useValue: {
          config: jest.fn(() => ({ workspaceRoot: '/ws' })),
          getPtahIconUri: () => 'data:image/svg+xml;base64,PHN2Zy8+',
          getPtahUserIconUri: () => 'data:image/svg+xml;base64,PHN2Zy8+',
        } as unknown as VSCodeService,
      },
      {
        provide: ClaudeRpcService,
        useValue: { rewindFiles: jest.fn(), call: jest.fn() },
      },
      {
        provide: ConfirmationDialogService,
        useValue: { confirm: jest.fn() },
      },
      {
        provide: ActionBannerService,
        useValue: {
          error: signal(null).asReadonly(),
          info: signal(null).asReadonly(),
          showError: jest.fn(),
          showInfo: jest.fn(),
        },
      },
      { provide: TabManagerService, useValue: tabManagerStub },
      {
        provide: CompactionLifecycleService,
        useValue: { suppressAnimateOnce: signal(false).asReadonly() },
      },
      {
        provide: AgentMonitorStore,
        useValue: {
          agents: signal([]).asReadonly(),
          agentsForSession: jest.fn(() => []),
        },
      },
      {
        provide: PanelResizeService,
        useValue: {
          setDragging: jest.fn(),
          setCustomWidth: jest.fn(),
          customWidth: signal(null),
        },
      },
      {
        provide: AppStateManager,
        useValue: {
          currentView: signal('chat'),
          layoutMode: signal('single').asReadonly(),
          setCurrentView: jest.fn(),
          requestCanvasSession: jest.fn(),
        },
      },
      {
        provide: ExecutionTreeBuilderService,
        useValue: { buildTree: buildTreeMock },
      },
      {
        provide: ConversationRegistry,
        useValue: {
          compactionStateFor: jest.fn(() => null),
        },
      },
      {
        provide: TabSessionBinding,
        useValue: { conversationFor: jest.fn(() => null) },
      },
      {
        provide: AuthStateService,
        useValue: {
          authRequiredBanner: signal(null),
          codexLogin: jest.fn(async () => undefined),
          clearAuthRequiredBanner: jest.fn(),
        },
      },
      { provide: SESSION_CONTEXT, useValue: null },
    ],
  });

  const fixture = TestBed.createComponent(ChatViewComponent);
  return {
    component: fixture.componentInstance,
    messagesSig,
    streamingStateSig,
    buildTreeMock,
  };
}

describe('ChatViewComponent — memoization invariants (Batch A)', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('finalizedMessageIds is the EMPTY_STRING_SET ref for empty messages', () => {
    const h = makeMemoHarness();
    const c = h.component as unknown as {
      finalizedMessageIds: () => ReadonlySet<string>;
    };
    const first = c.finalizedMessageIds();
    const second = c.finalizedMessageIds();
    expect(first).toBe(second);
    expect(first.size).toBe(0);
  });

  it('allMessages returns the SAME array ref when neither finalized nor streaming changes', () => {
    const h = makeMemoHarness();
    h.messagesSig.set([makeMessage('m1'), makeMessage('m2')]);

    const c = h.component as unknown as {
      allMessages: () => readonly ExecutionChatMessage[];
    };
    const r1 = c.allMessages();
    const r2 = c.allMessages();
    expect(r2).toBe(r1);
  });

  it('allMessages returns a NEW array ref when finalized messages change', () => {
    const h = makeMemoHarness();
    h.messagesSig.set([makeMessage('m1')]);

    const c = h.component as unknown as {
      allMessages: () => readonly ExecutionChatMessage[];
    };
    const before = c.allMessages();

    h.messagesSig.set([makeMessage('m1'), makeMessage('m2')]);
    const after = c.allMessages();

    expect(after).not.toBe(before);
    expect(after.length).toBe(2);
  });

  it('streamingMessages returns [] when no streaming state and no trees', () => {
    const h = makeMemoHarness();
    const c = h.component as unknown as {
      streamingMessages: () => ExecutionChatMessage[];
    };
    expect(c.streamingMessages()).toEqual([]);
    expect(h.buildTreeMock).not.toHaveBeenCalled();
  });

  it('finalized + streaming concat: when streaming yields trees, allMessages includes them', () => {
    const h = makeMemoHarness();
    h.messagesSig.set([makeMessage('m1')]);
    h.streamingStateSig.set({ pendingStats: null });
    h.buildTreeMock.mockReturnValue([makeTree('tree-stream')]);

    const c = h.component as unknown as {
      allMessages: () => readonly ExecutionChatMessage[];
    };
    const result = c.allMessages();
    expect(result.length).toBe(2);
    expect(result.map((m) => m.id)).toEqual(['m1', 'tree-stream']);
  });

  it('perf: re-reading allMessages many times with no input change does NOT re-invoke buildTree', () => {
    const h = makeMemoHarness();
    h.messagesSig.set([makeMessage('m1')]);
    h.streamingStateSig.set({ pendingStats: null });
    h.buildTreeMock.mockReturnValue([makeTree('t1')]);

    const c = h.component as unknown as {
      allMessages: () => readonly ExecutionChatMessage[];
    };

    c.allMessages();
    const callsAfterFirst = h.buildTreeMock.mock.calls.length;

    for (let i = 0; i < 20; i++) c.allMessages();

    expect(h.buildTreeMock.mock.calls.length).toBe(callsAfterFirst);
  });
});
