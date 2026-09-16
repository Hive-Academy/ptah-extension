import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  NgModule,
  Output,
  signal,
} from '@angular/core';

jest.mock('ngx-markdown', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'markdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: '',
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
import { ExecutionTreeBuilderService } from '@ptah-extension/chat-streaming';
import { TabManagerService } from '@ptah-extension/chat-state';
import type { ExecutionChatMessage } from '@ptah-extension/shared';
import { VSCodeService } from '@ptah-extension/core';
import { ChatEmptyStateComponent } from '../../molecules/setup-plugins/chat-empty-state.component';
import { MessageBubbleComponent } from '../message-bubble.component';
import { ChatTranscriptComponent } from './chat-transcript.component';

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

interface ReplayTab {
  readonly id: string;
  readonly claudeSessionId: string;
  readonly status: 'resuming' | 'loaded';
  readonly messages: readonly ExecutionChatMessage[];
  readonly streamingState: null;
}

describe('ChatTranscriptComponent replay motion suppression', () => {
  const finalizedMessage = {
    id: 'history-message',
    role: 'assistant',
    rawContent: 'history',
    timestamp: 1,
    streamingState: null,
  } as ExecutionChatMessage;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.useRealTimers();
  });

  function makeHarness(
    historyReplaying: boolean,
    status: ReplayTab['status'] = 'resuming',
  ) {
    const tabs = signal<readonly ReplayTab[]>([
      {
        id: 'tab-replay',
        claudeSessionId: 'session-replay',
        status,
        messages: [finalizedMessage],
        streamingState: null,
      },
    ]);
    TestBed.configureTestingModule({
      imports: [ChatTranscriptComponent],
      providers: [
        {
          provide: VSCodeService,
          useValue: { getPtahIconUri: () => 'ptah.svg' },
        },
        { provide: TabManagerService, useValue: { tabs } },
        {
          provide: ExecutionTreeBuilderService,
          useValue: { buildTree: jest.fn(() => []) },
        },
      ],
    });
    TestBed.overrideComponent(ChatTranscriptComponent, {
      remove: { imports: [MessageBubbleComponent, ChatEmptyStateComponent] },
      add: { imports: [MessageBubbleStub, EmptyStateStub] },
    });
    const fixture = TestBed.createComponent(ChatTranscriptComponent);
    fixture.componentRef.setInput('tabId', 'tab-replay');
    fixture.componentRef.setInput('active', true);
    fixture.componentRef.setInput('historyReplaying', historyReplaying);
    fixture.detectChanges();

    const bubble = fixture.debugElement.query(By.directive(MessageBubbleStub))
      .componentInstance as MessageBubbleStub;
    return { fixture, tabs, bubble };
  }

  function setStatus(
    tabs: ReturnType<typeof makeHarness>['tabs'],
    status: ReplayTab['status'],
  ): void {
    tabs.set([
      {
        id: 'tab-replay',
        claudeSessionId: 'session-replay',
        status,
        messages: [finalizedMessage],
        streamingState: null,
      },
    ]);
  }

  it('bridges the real replay-clear pass before loaded and holds through the 300 ms settle', () => {
    const h = makeHarness(true);
    expect(h.bubble.isFinalizing).toBe(true);

    // Real order: replay() clears its flag and zoneless CD may run before the
    // loader's await continuation changes status from resuming to loaded.
    h.fixture.componentRef.setInput('historyReplaying', false);
    h.fixture.detectChanges();
    expect(h.bubble.isFinalizing).toBe(true);

    setStatus(h.tabs, 'loaded');
    h.fixture.detectChanges();
    expect(h.bubble.isFinalizing).toBe(true);

    jest.advanceTimersByTime(299);
    h.fixture.detectChanges();
    expect(h.bubble.isFinalizing).toBe(true);

    jest.advanceTimersByTime(1);
    h.fixture.detectChanges();
    expect(h.bubble.isFinalizing).toBe(false);
  });

  it('keeps the existing live resuming-to-loaded finalization behaviour', () => {
    const h = makeHarness(false);
    expect(h.bubble.isFinalizing).toBe(false);

    setStatus(h.tabs, 'loaded');
    h.fixture.detectChanges();
    expect(h.bubble.isFinalizing).toBe(true);

    jest.advanceTimersByTime(300);
    h.fixture.detectChanges();
    expect(h.bubble.isFinalizing).toBe(false);
  });

  it('cancels a pending replay hold when a new replay starts', () => {
    const h = makeHarness(true);
    h.fixture.componentRef.setInput('historyReplaying', false);
    h.fixture.detectChanges();
    const component = h.fixture.componentInstance as unknown as {
      replayMotionHoldTimeoutId: ReturnType<typeof setTimeout> | null;
    };
    const holdTimer = component.replayMotionHoldTimeoutId;
    expect(holdTimer).not.toBeNull();
    const clearTimeoutSpy = jest.spyOn(globalThis, 'clearTimeout');

    h.fixture.componentRef.setInput('historyReplaying', true);
    h.fixture.detectChanges();

    expect(clearTimeoutSpy).toHaveBeenCalledWith(holdTimer);
    expect(component.replayMotionHoldTimeoutId).toBeNull();
    expect(h.bubble.isFinalizing).toBe(true);
    clearTimeoutSpy.mockRestore();
  });

  it('clears a pending replay hold timer on destroy', () => {
    const h = makeHarness(true);
    h.fixture.componentRef.setInput('historyReplaying', false);
    h.fixture.detectChanges();
    const component = h.fixture.componentInstance as unknown as {
      replayMotionHoldTimeoutId: ReturnType<typeof setTimeout> | null;
    };
    const holdTimer = component.replayMotionHoldTimeoutId;
    expect(holdTimer).not.toBeNull();
    const clearTimeoutSpy = jest.spyOn(globalThis, 'clearTimeout');

    h.fixture.destroy();

    expect(clearTimeoutSpy).toHaveBeenCalledWith(holdTimer);
    expect(component.replayMotionHoldTimeoutId).toBeNull();
    clearTimeoutSpy.mockRestore();
  });
});
