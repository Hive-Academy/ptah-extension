import {
  Component,
  Input,
  NgModule,
  ChangeDetectionStrategy,
  signal,
  computed,
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

import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ChatTranscriptComponent } from '../organisms/transcript/chat-transcript.component';
import { VSCodeService } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ExecutionTreeBuilderService } from '@ptah-extension/chat-streaming';
import { SESSION_CONTEXT } from '../../tokens/session-context.token';
import type {
  ExecutionChatMessage,
  ExecutionNode,
} from '@ptah-extension/shared';

interface MemoHarness {
  fixture: ComponentFixture<ChatTranscriptComponent>;
  component: ChatTranscriptComponent;
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

/**
 * The memoization invariants of the transcript (`finalizedMessageIds`,
 * `streamingMessages`, `allMessages`) were extracted from `ChatViewComponent`
 * into `ChatTranscriptComponent` (TASK_2026_155 Batch 1). Data now resolves
 * per-tab from `TabManagerService.tabs()` keyed by the `tabId` input rather
 * than from the `ChatStore` facade — the harness seeds a single tab whose
 * `messages` / `streamingState` are driven by writable signals.
 */
function makeMemoHarness(): MemoHarness {
  const messagesSig = signal<readonly ExecutionChatMessage[]>([]);
  const streamingStateSig = signal<unknown>(null);
  const buildTreeMock = jest.fn(() => [] as ExecutionNode[]);

  const tabsSig = computed(() => [
    {
      id: 'tab-1',
      claudeSessionId: 'session-1',
      status: 'idle',
      messages: messagesSig(),
      streamingState: streamingStateSig(),
    },
  ]);

  const tabManagerStub = {
    tabs: tabsSig,
    activeTabId: signal<string | null>('tab-1').asReadonly(),
  } as unknown as TabManagerService;

  TestBed.configureTestingModule({
    imports: [ChatTranscriptComponent],
    providers: [
      {
        provide: VSCodeService,
        useValue: {
          getPtahIconUri: () => 'data:image/svg+xml;base64,PHN2Zy8+',
        } as unknown as VSCodeService,
      },
      { provide: TabManagerService, useValue: tabManagerStub },
      {
        provide: ExecutionTreeBuilderService,
        useValue: { buildTree: buildTreeMock },
      },
      { provide: SESSION_CONTEXT, useValue: null },
    ],
  });

  const fixture = TestBed.createComponent(ChatTranscriptComponent);
  fixture.componentRef.setInput('tabId', 'tab-1');
  fixture.componentRef.setInput('active', true);
  return {
    fixture,
    component: fixture.componentInstance,
    messagesSig,
    streamingStateSig,
    buildTreeMock,
  };
}

describe('ChatTranscriptComponent — memoization invariants (Batch A)', () => {
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
