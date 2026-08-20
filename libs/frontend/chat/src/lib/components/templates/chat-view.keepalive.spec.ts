/**
 * Workspace-switch transcript keep-alive (TASK_2026_155 Batch 2).
 *
 * Drives the REAL TabManagerService (+ real TabWorkspacePartitionService and
 * registries) through a workspace round-trip and asserts that a retained
 * transcript's component instance SURVIVES — same object reference after
 * switching away and back — rather than being torn down and rebuilt. Reuses the
 * zoneless TestBed + ngx-markdown stub pattern from `chat-view.memo.spec.ts`.
 *
 * A minimal host reproduces `ChatViewComponent`'s retention wiring (component-
 * scoped TranscriptRetentionService + `@for (tabId of retainedTabIds(); track
 * tabId)`), so the assertion isolates the keep-alive mechanism from
 * ChatViewComponent's unrelated singletons.
 */

import {
  Component,
  Input,
  Output,
  EventEmitter,
  NgModule,
  ChangeDetectionStrategy,
  inject,
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
import { By } from '@angular/platform-browser';
import type { ExecutionChatMessage } from '@ptah-extension/shared';
import {
  TabManagerService,
  TabWorkspacePartitionService,
  ConversationRegistry,
  TabSessionBinding,
  ConfirmationDialogService,
  MODEL_REFRESH_CONTROL,
  type ModelRefreshControl,
} from '@ptah-extension/chat-state';
import { ExecutionTreeBuilderService } from '@ptah-extension/chat-streaming';
import { VSCodeService } from '@ptah-extension/core';
import { ChatTranscriptComponent } from '../organisms/transcript/chat-transcript.component';
import { MessageBubbleComponent } from '../organisms/message-bubble.component';
import { ChatEmptyStateComponent } from '../molecules/setup-plugins/chat-empty-state.component';
import { TranscriptRetentionService } from '../../services/transcript-retention.service';
import { SESSION_CONTEXT } from '../../tokens/session-context.token';

@Component({
  selector: 'ptah-message-bubble',
  standalone: true,
  template: '',
})
class MessageBubbleStub {
  @Input() message: unknown;
  @Input() messageIndex = 0;
  @Input() totalMessages = 0;
  @Input() isStreaming = false;
  @Input() isFinalizing = false;
  @Input() isSessionActive = false;
  @Output() branchRequested = new EventEmitter<string>();
  @Output() rewindRequested = new EventEmitter<string>();
}

@Component({
  selector: 'ptah-chat-empty-state',
  standalone: true,
  template: '',
})
class EmptyStateStub {
  @Output() promptSelected = new EventEmitter<string>();
}

@Component({
  selector: 'ptah-keepalive-host',
  standalone: true,
  imports: [ChatTranscriptComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [TranscriptRetentionService],
  template: `
    @for (tabId of transcriptTabIds(); track tabId) {
      <ptah-chat-transcript
        [tabId]="tabId"
        [active]="tabId === activeTabId()"
      />
    }
  `,
})
class KeepAliveHostComponent {
  private readonly retention = inject(TranscriptRetentionService);
  private readonly tabManager = inject(TabManagerService);
  readonly transcriptTabIds = this.retention.retainedTabIds;
  readonly activeTabId = this.tabManager.activeTabId;
}

const WS_A = '/ws/a';
const WS_B = '/ws/b';

function makeMessage(id: string): ExecutionChatMessage {
  return {
    id,
    role: 'assistant',
    rawContent: 'content',
    timestamp: 0,
  } as unknown as ExecutionChatMessage;
}

describe('ChatViewComponent keep-alive — workspace-switch transcript survival', () => {
  beforeEach(() => {
    localStorage.clear();

    const modelRefreshMock: jest.Mocked<ModelRefreshControl> = {
      refreshModels: jest.fn().mockResolvedValue(undefined),
    } as jest.Mocked<ModelRefreshControl>;

    TestBed.configureTestingModule({
      imports: [KeepAliveHostComponent],
      providers: [
        TabManagerService,
        TabWorkspacePartitionService,
        ConversationRegistry,
        TabSessionBinding,
        ConfirmationDialogService,
        { provide: MODEL_REFRESH_CONTROL, useValue: modelRefreshMock },
        {
          provide: ExecutionTreeBuilderService,
          useValue: { buildTree: () => [], clearForTab: jest.fn() },
        },
        {
          provide: VSCodeService,
          useValue: {
            getPtahIconUri: () => 'data:image/svg+xml;base64,PHN2Zy8+',
          } as unknown as VSCodeService,
        },
        { provide: SESSION_CONTEXT, useValue: null },
      ],
    });
    TestBed.overrideComponent(ChatTranscriptComponent, {
      remove: { imports: [MessageBubbleComponent, ChatEmptyStateComponent] },
      add: { imports: [MessageBubbleStub, EmptyStateStub] },
    });
  });

  afterEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('keeps the previous workspace tab transcript mounted (same instance) across a switch round-trip', () => {
    const tabManager = TestBed.inject(TabManagerService);
    const fixture = TestBed.createComponent(KeepAliveHostComponent);

    const flush = () => {
      TestBed.tick();
      fixture.detectChanges();
    };

    const transcriptFor = (tabId: string): ChatTranscriptComponent | null => {
      const match = fixture.debugElement
        .queryAll(By.directive(ChatTranscriptComponent))
        .find((de) => de.componentInstance.tabId() === tabId);
      return match
        ? (match.componentInstance as ChatTranscriptComponent)
        : null;
    };

    // Workspace A: seed a tab with a message and render its transcript.
    tabManager.switchWorkspace(WS_A);
    const tabA = tabManager.createTab('A');
    tabManager.setMessages(tabA, [makeMessage('a-msg')]);
    flush();

    const transcriptA = transcriptFor(tabA);
    expect(transcriptA).toBeTruthy();
    expect(transcriptA!.active()).toBe(true);

    // Switch to workspace B and seed its own tab — A's transcript stays retained.
    tabManager.switchWorkspace(WS_B);
    const tabB = tabManager.createTab('B');
    tabManager.setMessages(tabB, [makeMessage('b-msg')]);
    flush();

    // Both transcripts are mounted; B is active, A is retained but hidden.
    expect(tabManager.tabs().some((t) => t.id === tabA)).toBe(false);
    const transcriptAWhileHidden = transcriptFor(tabA);
    expect(transcriptAWhileHidden).toBe(transcriptA); // same instance, not rebuilt
    expect(transcriptAWhileHidden!.active()).toBe(false);
    expect(transcriptFor(tabB)!.active()).toBe(true);

    // Switch back to A — the SAME component instance re-activates (no rebuild).
    tabManager.switchWorkspace(WS_A);
    flush();

    const transcriptAAfter = transcriptFor(tabA);
    expect(transcriptAAfter).toBe(transcriptA);
    expect(transcriptAAfter!.active()).toBe(true);
  });
});
