/**
 * ChatTranscriptComponent — hidden-transcript reactivity pause (TASK_2026_155
 * Batch 2). While `active` is false the gated `vm` computed returns a frozen
 * snapshot: mutating the tab's messages/streaming state must NOT rebuild the
 * execution tree (spy on `ExecutionTreeBuilderService.buildTree`) and must NOT
 * change the rendered DOM. Flipping `active` true performs exactly ONE catch-up
 * render and restores the scroll offset.
 *
 * MessageBubble / empty-state children are swapped for lightweight stubs so the
 * test asserts on the transcript's own render decisions, not bubble internals.
 */

import {
  Component,
  Input,
  Output,
  EventEmitter,
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
import { ChatTranscriptComponent } from './chat-transcript.component';
import { MessageBubbleComponent } from '../message-bubble.component';
import { ChatEmptyStateComponent } from '../../molecules/setup-plugins/chat-empty-state.component';
import { VSCodeService } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ExecutionTreeBuilderService } from '@ptah-extension/chat-streaming';
import { SESSION_CONTEXT } from '../../../tokens/session-context.token';
import {
  ALWAYS_MOUNTED_TAIL,
  TranscriptRenderWindow,
} from './transcript-render-window';
import type {
  ExecutionChatMessage,
  ExecutionNode,
} from '@ptah-extension/shared';

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

function makeMessage(
  id: string,
  role: 'user' | 'assistant' = 'assistant',
): ExecutionChatMessage {
  return {
    id,
    role,
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

interface Harness {
  fixture: ComponentFixture<ChatTranscriptComponent>;
  component: ChatTranscriptComponent;
  messagesSig: WritableSignal<readonly ExecutionChatMessage[]>;
  streamingStateSig: WritableSignal<unknown>;
  buildTreeMock: jest.Mock;
  bubbleCount: () => number;
  slots: () => HTMLElement[];
  placeholders: () => HTMLElement[];
}

function makeHarness(): Harness {
  const messagesSig = signal<readonly ExecutionChatMessage[]>([]);
  const streamingStateSig = signal<unknown>(null);
  const buildTreeMock = jest.fn(() => [] as ExecutionNode[]);

  const tabsSig = computed(() => [
    {
      id: 'tab-1',
      claudeSessionId: 'session-1',
      status: 'streaming',
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
  TestBed.overrideComponent(ChatTranscriptComponent, {
    remove: { imports: [MessageBubbleComponent, ChatEmptyStateComponent] },
    add: { imports: [MessageBubbleStub, EmptyStateStub] },
  });

  const fixture = TestBed.createComponent(ChatTranscriptComponent);
  fixture.componentRef.setInput('tabId', 'tab-1');
  fixture.componentRef.setInput('active', true);

  const bubbleCount = () =>
    fixture.nativeElement.querySelectorAll('ptah-message-bubble').length;
  const slots = (): HTMLElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.chat-msg-slot'));
  const placeholders = (): HTMLElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('.chat-msg-placeholder'));

  return {
    fixture,
    component: fixture.componentInstance,
    messagesSig,
    streamingStateSig,
    buildTreeMock,
    bubbleCount,
    slots,
    placeholders,
  };
}

describe('ChatTranscriptComponent — hidden-transcript reactivity pause', () => {
  let rafSpy: jest.SpyInstance;

  beforeEach(() => {
    rafSpy = jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });
  });

  afterEach(() => {
    rafSpy.mockRestore();
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('freezes the DOM and skips buildTree while hidden, then catches up on activation', () => {
    const h = makeHarness();
    h.messagesSig.set([makeMessage('m1')]);
    h.streamingStateSig.set({ pendingStats: null });
    h.buildTreeMock.mockReturnValue([makeTree('s1')]);
    h.fixture.detectChanges();

    // Active: one finalized + one streaming tree → two bubbles, tree built.
    expect(h.bubbleCount()).toBe(2);
    expect(h.buildTreeMock).toHaveBeenCalled();

    // Hide the transcript.
    h.fixture.componentRef.setInput('active', false);
    h.fixture.detectChanges();
    const callsWhenHidden = h.buildTreeMock.mock.calls.length;

    // Mutate the tab's messages + streaming state while hidden (still one
    // streaming tree, plus a newly finalized message → catch-up should show 3).
    h.streamingStateSig.set({ pendingStats: { tokens: 5 } });
    h.messagesSig.set([makeMessage('m1'), makeMessage('m2')]);
    h.fixture.detectChanges();

    // No recompute: tree not rebuilt, DOM frozen at the pre-hide snapshot.
    expect(h.buildTreeMock.mock.calls.length).toBe(callsWhenHidden);
    expect(h.bubbleCount()).toBe(2);

    // Activate → exactly one catch-up recompute + render.
    const callsBeforeActivate = h.buildTreeMock.mock.calls.length;
    h.fixture.componentRef.setInput('active', true);
    h.fixture.detectChanges();

    expect(h.buildTreeMock.mock.calls.length).toBe(callsBeforeActivate + 1);
    expect(h.bubbleCount()).toBe(3);
  });

  it('restores the saved scroll offset on the activation edge', () => {
    const h = makeHarness();
    h.fixture.componentRef.setInput('active', false);
    h.fixture.detectChanges();

    const container: HTMLElement = h.fixture.nativeElement.querySelector(
      '.chat-scroll-container',
    );
    expect(container).toBeTruthy();

    // Simulate a prior scroll offset that display:none would have reset.
    (h.component as unknown as { savedScrollTop: number }).savedScrollTop = 42;
    (h.component as unknown as { pinnedToBottom: boolean }).pinnedToBottom =
      false;

    h.fixture.componentRef.setInput('active', true);
    h.fixture.detectChanges();

    expect(container.scrollTop).toBe(42);
  });
});

/**
 * Render window integration (TASK_2026_381 component 3).
 *
 * jsdom has no `IntersectionObserver` and no layout, so both are supplied by
 * hand: a deterministic fake observer, and heights fed through the fake's
 * entries. Two consequences worth stating rather than hiding:
 *
 * - The fake must be installed BEFORE the component is created, because
 *   `TranscriptRenderWindow.supported` is decided in its constructor. Without
 *   it (the describe above) the window degrades to everything-mounted, which is
 *   exactly why the existing assertions there are unaffected by this change.
 * - The component's `afterNextRender` hook DOES run here, but it also builds a
 *   `ResizeObserver`, which jsdom does not define; that throw is swallowed by
 *   the TestBed error handler and logged. The hook therefore attaches the
 *   render window first, so the mount decision cannot be lost to an unrelated
 *   failure. `attach()` is idempotent, and the harness calls it again with the
 *   same element to stay correct if that ordering is ever revisited.
 */
interface FakeEntry {
  readonly target: Element;
  readonly isIntersecting: boolean;
  readonly boundingClientRect: { readonly height: number };
}

class FakeIntersectionObserver {
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
  emit(entries: readonly FakeEntry[]): void {
    this.callback(
      entries as unknown as IntersectionObserverEntry[],
      this as unknown as IntersectionObserver,
    );
  }
}

describe('ChatTranscriptComponent — render window', () => {
  const MESSAGE_COUNT = 20;
  let rafSpy: jest.SpyInstance;
  const globalWithIo = globalThis as unknown as {
    IntersectionObserver?: unknown;
  };

  beforeEach(() => {
    FakeIntersectionObserver.instances = [];
    globalWithIo.IntersectionObserver = FakeIntersectionObserver;
    rafSpy = jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });
  });

  afterEach(() => {
    delete globalWithIo.IntersectionObserver;
    FakeIntersectionObserver.instances = [];
    rafSpy.mockRestore();
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  function entry(
    target: Element,
    isIntersecting: boolean,
    height: number,
  ): FakeEntry {
    return { target, isIntersecting, boundingClientRect: { height } };
  }

  /**
   * Harness with `MESSAGE_COUNT` finalized messages plus `streamingTrees`
   * streaming ones, with the render window attached to the real scroll
   * container.
   */
  function makeWindowedHarness(streamingTrees: readonly string[] = []) {
    const h = makeHarness();
    h.messagesSig.set(
      Array.from({ length: MESSAGE_COUNT }, (_, i) => makeMessage(`m${i}`)),
    );
    h.streamingStateSig.set({ pendingStats: null });
    h.buildTreeMock.mockReturnValue(streamingTrees.map((id) => makeTree(id)));
    h.fixture.detectChanges();

    const renderWindow = h.fixture.debugElement.injector.get(
      TranscriptRenderWindow,
    );
    const container: HTMLElement = h.fixture.nativeElement.querySelector(
      '.chat-scroll-container',
    );
    renderWindow.attach(container);
    h.fixture.detectChanges();

    return {
      ...h,
      renderWindow,
      observer: FakeIntersectionObserver.instances[0],
    };
  }

  it('renders one slot per message but mounts only the tail before the observer reports', () => {
    const h = makeWindowedHarness();

    expect(h.slots()).toHaveLength(MESSAGE_COUNT);
    expect(h.bubbleCount()).toBe(ALWAYS_MOUNTED_TAIL);
    expect(h.placeholders()).toHaveLength(MESSAGE_COUNT - ALWAYS_MOUNTED_TAIL);
    // Every slot is registered with the observer, including the unmounted ones.
    expect(h.observer.observed.size).toBe(MESSAGE_COUNT);
  });

  it('mounts a bubble for a message the observer brings into the window', () => {
    const h = makeWindowedHarness();
    const slot = h.slots()[0];
    expect(slot.querySelector('ptah-message-bubble')).toBeNull();

    h.observer.emit([entry(slot, true, 0)]);
    h.fixture.detectChanges();

    expect(slot.querySelector('ptah-message-bubble')).toBeTruthy();
    expect(slot.querySelector('.chat-msg-placeholder')).toBeNull();
  });

  it('renders an unmounted message as an inert placeholder of its last measured height', () => {
    const h = makeWindowedHarness();
    const slot = h.slots()[5];

    // Enter (still showing the placeholder), then leave — the leaving entry's
    // rect is the mounted bubble's real height.
    h.observer.emit([entry(slot, true, 0)]);
    h.fixture.detectChanges();
    h.observer.emit([entry(slot, false, 733)]);
    h.fixture.detectChanges();

    const placeholder = slot.querySelector<HTMLElement>(
      '.chat-msg-placeholder',
    );
    expect(slot.querySelector('ptah-message-bubble')).toBeNull();
    expect(placeholder).toBeTruthy();
    expect(placeholder?.style.minHeight).toBe('733px');
    // Inert: never announced as a message, nothing focusable inside.
    expect(placeholder?.getAttribute('aria-hidden')).toBe('true');
    expect(placeholder?.children).toHaveLength(0);
  });

  it('never unmounts the streaming message, whatever the observer reports', () => {
    const h = makeWindowedHarness(['s1']);
    const slots = h.slots();
    expect(slots).toHaveLength(MESSAGE_COUNT + 1);
    const streamingSlot = slots[MESSAGE_COUNT];
    expect(streamingSlot.querySelector('ptah-message-bubble')).toBeTruthy();

    h.observer.emit(slots.map((slot) => entry(slot, false, 300)));
    h.fixture.detectChanges();

    expect(streamingSlot.querySelector('ptah-message-bubble')).toBeTruthy();
  });

  it('preserves total reserved height across a mount/unmount cycle', () => {
    const h = makeWindowedHarness();
    const slots = h.slots();
    const MEASURED_PX = 200;

    // Mount everything, then let the observer measure each mounted slot.
    h.observer.emit(slots.map((slot) => entry(slot, true, 0)));
    h.fixture.detectChanges();
    h.observer.emit(slots.map((slot) => entry(slot, true, MEASURED_PX)));
    h.fixture.detectChanges();
    expect(h.bubbleCount()).toBe(MESSAGE_COUNT);

    // jsdom performs no layout, so "reserved height" is computed the same way
    // the browser would sum it: a mounted slot contributes its measured height,
    // an unmounted one contributes its placeholder's min-height.
    const reservedHeight = () =>
      h.slots().reduce((total, slot) => {
        const placeholder = slot.querySelector<HTMLElement>(
          '.chat-msg-placeholder',
        );
        return (
          total +
          (placeholder
            ? Number.parseFloat(placeholder.style.minHeight)
            : MEASURED_PX)
        );
      }, 0);

    const before = reservedHeight();
    expect(before).toBe(MESSAGE_COUNT * MEASURED_PX);

    // Scroll the first ten out of the window.
    h.observer.emit(
      slots.slice(0, 10).map((slot) => entry(slot, false, MEASURED_PX)),
    );
    h.fixture.detectChanges();

    expect(h.bubbleCount()).toBe(MESSAGE_COUNT - 10);
    expect(h.placeholders()).toHaveLength(10);
    expect(reservedHeight()).toBe(before);
  });

  it('processes no observer callback while the transcript is inactive', () => {
    const h = makeWindowedHarness();
    const slots = h.slots();
    h.observer.emit(slots.map((slot) => entry(slot, true, 0)));
    h.fixture.detectChanges();
    expect(h.bubbleCount()).toBe(MESSAGE_COUNT);

    h.fixture.componentRef.setInput('active', false);
    h.fixture.detectChanges();

    // Under display:none every element reports non-intersecting. Acting on that
    // would unmount the whole hidden transcript and defeat the keep-alive.
    h.observer.emit(slots.map((slot) => entry(slot, false, 0)));
    h.fixture.detectChanges();
    expect(h.bubbleCount()).toBe(MESSAGE_COUNT);

    h.fixture.componentRef.setInput('active', true);
    h.fixture.detectChanges();
    expect(h.bubbleCount()).toBe(MESSAGE_COUNT);
  });
});
