import { Component, EventEmitter, Input, Output } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ExecutionTreeBuilderService } from '@ptah-extension/chat-streaming';
import { TabManagerService } from '@ptah-extension/chat-state';
import { VSCodeService } from '@ptah-extension/core';
import type {
  ExecutionChatMessage,
  ExecutionNode,
} from '@ptah-extension/shared';
import { ChatEmptyStateComponent } from '../../../molecules/setup-plugins/chat-empty-state.component';
import { MessageBubbleComponent } from '../../message-bubble.component';
import { SESSION_CONTEXT } from '../../../../tokens/session-context.token';
import { ChatTranscriptComponent } from '../chat-transcript.component';

@Component({
  selector: 'ptah-message-bubble',
  standalone: true,
  template: '',
})
export class TranscriptMessageBubbleStub {
  @Input() message!: ExecutionChatMessage;
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
export class TranscriptEmptyStateStub {
  @Output() promptSelected = new EventEmitter<string>();
}

export interface TranscriptTestBedOptions {
  readonly tabs: unknown;
  readonly buildTree: (...args: never[]) => unknown;
  readonly iconUri?: string;
  readonly sessionContext?: unknown;
}

export function configureTranscriptTestBed(
  options: TranscriptTestBedOptions,
): void {
  TestBed.configureTestingModule({
    imports: [ChatTranscriptComponent],
    providers: [
      {
        provide: VSCodeService,
        useValue: {
          getPtahIconUri: () => options.iconUri ?? 'ptah.svg',
        } as unknown as VSCodeService,
      },
      {
        provide: TabManagerService,
        useValue: { tabs: options.tabs } as unknown as TabManagerService,
      },
      {
        provide: ExecutionTreeBuilderService,
        useValue: { buildTree: options.buildTree },
      },
      {
        provide: SESSION_CONTEXT,
        useValue: options.sessionContext ?? null,
      },
    ],
  });
  TestBed.overrideComponent(ChatTranscriptComponent, {
    remove: { imports: [MessageBubbleComponent, ChatEmptyStateComponent] },
    add: {
      imports: [TranscriptMessageBubbleStub, TranscriptEmptyStateStub],
    },
  });
}

export interface TranscriptIntersectionEntry {
  readonly target: Element;
  readonly isIntersecting: boolean;
  readonly boundingClientRect?: { readonly height: number };
}

export class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];

  readonly observed = new Set<Element>();

  constructor(
    private readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    FakeIntersectionObserver.instances.push(this);
  }

  observe(element: Element): void {
    this.observed.add(element);
  }

  unobserve(element: Element): void {
    this.observed.delete(element);
  }

  disconnect(): void {
    this.observed.clear();
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  emit(entries: readonly TranscriptIntersectionEntry[]): void;
  emit(target: Element, isIntersecting: boolean): void;
  emit(
    entriesOrTarget: readonly TranscriptIntersectionEntry[] | Element,
    isIntersecting?: boolean,
  ): void {
    const entries = Array.isArray(entriesOrTarget)
      ? entriesOrTarget
      : [{ target: entriesOrTarget, isIntersecting: isIntersecting ?? false }];
    this.callback(
      entries as unknown as IntersectionObserverEntry[],
      this as unknown as IntersectionObserver,
    );
  }

  static reset(): void {
    FakeIntersectionObserver.instances = [];
  }
}

export class FakeResizeObserver {
  private readonly observed = new Set<Element>();

  observe(element: Element): void {
    this.observed.add(element);
  }

  unobserve(element: Element): void {
    this.observed.delete(element);
  }

  disconnect(): void {
    this.observed.clear();
  }
}

const globalWithObservers = globalThis as unknown as {
  IntersectionObserver?: typeof IntersectionObserver;
  ResizeObserver?: typeof ResizeObserver;
};

export function installFakeIntersectionObserver(): void {
  FakeIntersectionObserver.reset();
  globalWithObservers.IntersectionObserver =
    FakeIntersectionObserver as unknown as typeof IntersectionObserver;
}

export function removeFakeIntersectionObserver(): void {
  delete globalWithObservers.IntersectionObserver;
  FakeIntersectionObserver.reset();
}

export function installFakeResizeObserver(): void {
  globalWithObservers.ResizeObserver =
    FakeResizeObserver as unknown as typeof ResizeObserver;
}

export function removeFakeResizeObserver(): void {
  delete globalWithObservers.ResizeObserver;
}

export function makeTranscriptMessage(
  id: string,
  role: 'user' | 'assistant' = 'assistant',
  timestamp = 0,
  streamingState: ExecutionNode | null = null,
  rawContent = 'content',
): ExecutionChatMessage {
  return {
    id,
    role,
    rawContent,
    timestamp,
    streamingState,
  } as unknown as ExecutionChatMessage;
}

export function makeTranscriptTree(
  id: string,
  startTime?: number,
  content = 'tree content',
): ExecutionNode {
  return {
    id,
    type: 'text',
    status: 'completed',
    content,
    ...(startTime === undefined ? {} : { startTime }),
  } as unknown as ExecutionNode;
}
