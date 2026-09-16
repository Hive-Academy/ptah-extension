import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  NgModule,
  Output,
  computed,
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

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { VSCodeService } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ExecutionTreeBuilderService } from '@ptah-extension/chat-streaming';
import type {
  ExecutionChatMessage,
  ExecutionNode,
} from '@ptah-extension/shared';
import { ChatEmptyStateComponent } from '../../molecules/setup-plugins/chat-empty-state.component';
import { MessageBubbleComponent } from '../message-bubble.component';
import { ChatTranscriptComponent } from './chat-transcript.component';
import {
  ALWAYS_MOUNTED_TAIL,
  TranscriptRenderWindow,
} from './transcript-render-window';

@Component({
  selector: 'ptah-message-bubble',
  standalone: true,
  template: '',
})
class MessageBubbleStub {
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
class EmptyStateStub {
  @Output() promptSelected = new EventEmitter<string>();
}

interface FakeEntry {
  readonly target: Element;
  readonly isIntersecting: boolean;
  readonly boundingClientRect: { readonly height: number };
}

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly observed = new Set<Element>();

  constructor(private readonly callback: IntersectionObserverCallback) {
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

class FakeResizeObserver {
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

type TabStatus = 'resuming' | 'loaded' | 'streaming';

function makeMessage(id: string, timestamp: number): ExecutionChatMessage {
  return {
    id,
    role: 'assistant',
    rawContent: 'history',
    timestamp,
    streamingState: null,
  } as ExecutionChatMessage;
}

function makeTree(id: string, startTime: number): ExecutionNode {
  return {
    id,
    type: 'text',
    status: 'completed',
    content: 'replayed content',
    startTime,
  } as unknown as ExecutionNode;
}

function treeIds(count: number, prefix = 's'): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}${index}`);
}

interface Harness {
  readonly fixture: ComponentFixture<ChatTranscriptComponent>;
  readonly observer: FakeIntersectionObserver;
  readonly slots: () => HTMLElement[];
  readonly bubbles: () => MessageBubbleStub[];
  readonly setHistoryReplaying: (replaying: boolean) => void;
  readonly setStatus: (status: TabStatus) => void;
  readonly setMessages: (messages: readonly ExecutionChatMessage[]) => void;
  readonly setTrees: (ids: readonly string[]) => void;
}

function makeHarness(options: {
  readonly historyReplaying: boolean;
  readonly trees?: readonly string[];
  readonly messages?: readonly ExecutionChatMessage[];
  readonly status?: TabStatus;
}): Harness {
  const status = signal<TabStatus>(options.status ?? 'resuming');
  const messages = signal<readonly ExecutionChatMessage[]>(
    options.messages ?? [],
  );
  const streamingState = signal<unknown>({ revision: 0 });
  let currentTrees = options.trees ?? [];
  let revision = 0;
  const buildTree = jest.fn(() =>
    currentTrees.map((id, index) => makeTree(id, 1000 + index)),
  );
  const tabs = computed(() => [
    {
      id: 'tab-replay',
      claudeSessionId: 'session-replay',
      status: status(),
      messages: messages(),
      streamingState: streamingState(),
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
        useValue: { buildTree },
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
  fixture.componentRef.setInput('historyReplaying', options.historyReplaying);
  fixture.detectChanges();

  const renderWindow = fixture.debugElement.injector.get(
    TranscriptRenderWindow,
  );
  const container: HTMLElement = fixture.nativeElement.querySelector(
    '.chat-scroll-container',
  );
  renderWindow.attach(container);
  fixture.detectChanges();

  return {
    fixture,
    observer: FakeIntersectionObserver.instances[0],
    slots: () =>
      Array.from(fixture.nativeElement.querySelectorAll('.chat-msg-slot')),
    bubbles: () =>
      fixture.debugElement
        .queryAll(By.directive(MessageBubbleStub))
        .map((debugElement) => debugElement.componentInstance),
    setHistoryReplaying: (replaying) => {
      fixture.componentRef.setInput('historyReplaying', replaying);
    },
    setStatus: (nextStatus) => status.set(nextStatus),
    setMessages: (nextMessages) => messages.set(nextMessages),
    setTrees: (ids) => {
      currentTrees = ids;
      streamingState.set({ revision: ++revision });
    },
  };
}

describe('ChatTranscriptComponent replay render-window fence', () => {
  const globalWithObservers = globalThis as unknown as {
    IntersectionObserver?: unknown;
    ResizeObserver?: unknown;
  };
  let rafSpy: jest.SpyInstance;

  beforeEach(() => {
    FakeIntersectionObserver.instances = [];
    globalWithObservers.IntersectionObserver = FakeIntersectionObserver;
    globalWithObservers.ResizeObserver = FakeResizeObserver;
    rafSpy = jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 0;
      });
  });

  afterEach(() => {
    delete globalWithObservers.IntersectionObserver;
    delete globalWithObservers.ResizeObserver;
    FakeIntersectionObserver.instances = [];
    rafSpy.mockRestore();
    TestBed.resetTestingModule();
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  function entry(target: Element, isIntersecting: boolean): FakeEntry {
    return { target, isIntersecting, boundingClientRect: { height: 200 } };
  }

  it('defers a never-mounted intersection until replay retention releases', () => {
    const h = makeHarness({
      historyReplaying: true,
      trees: treeIds(50),
    });

    expect(h.slots()).toHaveLength(50);
    expect(h.bubbles()).toHaveLength(ALWAYS_MOUNTED_TAIL);

    const firstSlot = h.slots()[0];
    const leavingTailSlot = h.slots()[44];
    h.observer.emit([entry(firstSlot, true), entry(leavingTailSlot, true)]);
    h.fixture.detectChanges();
    expect(firstSlot.querySelector('ptah-message-bubble')).toBeFalsy();

    h.setTrees(treeIds(56));
    h.fixture.detectChanges();

    expect(h.slots()).toHaveLength(56);
    expect(leavingTailSlot.querySelector('ptah-message-bubble')).toBeTruthy();
    expect(h.bubbles()).toHaveLength(ALWAYS_MOUNTED_TAIL * 2);

    h.setStatus('loaded');
    h.setMessages(treeIds(56).map((id, index) => makeMessage(id, index)));
    h.setTrees([]);
    h.setHistoryReplaying(false);
    h.fixture.detectChanges();

    expect(firstSlot.querySelector('ptah-message-bubble')).toBeTruthy();
  });

  it('only grows the mounted tail across replay chunks', () => {
    const h = makeHarness({ historyReplaying: true, trees: treeIds(50) });
    const initiallyMounted = h.slots().slice(44);
    expect(h.bubbles()).toHaveLength(ALWAYS_MOUNTED_TAIL);

    h.setTrees(treeIds(98));
    h.fixture.detectChanges();
    const middleSlot = h.slots()[60];
    h.observer.emit([entry(middleSlot, true)]);
    h.fixture.detectChanges();

    expect(
      initiallyMounted.every((slot) =>
        slot.querySelector('ptah-message-bubble'),
      ),
    ).toBe(true);
    expect(middleSlot.querySelector('ptah-message-bubble')).toBeFalsy();
    expect(h.bubbles()).toHaveLength(ALWAYS_MOUNTED_TAIL * 2);

    const mountedAt98 = h
      .slots()
      .filter((slot) => slot.querySelector('ptah-message-bubble'));
    h.setTrees(treeIds(146));
    h.fixture.detectChanges();

    expect(
      mountedAt98.every((slot) => slot.querySelector('ptah-message-bubble')),
    ).toBe(true);
    expect(middleSlot.querySelector('ptah-message-bubble')).toBeFalsy();
    expect(h.bubbles()).toHaveLength(ALWAYS_MOUNTED_TAIL * 3);
  });

  it('enables retention before an admission-queued replay receives its first chunk', () => {
    const h = makeHarness({ historyReplaying: true, trees: [] });
    expect(h.slots()).toHaveLength(0);

    h.setTrees(treeIds(50));
    h.fixture.detectChanges();
    const firstTail = h.slots().slice(44);
    const neverMountedSlot = h.slots()[20];
    expect(h.bubbles()).toHaveLength(ALWAYS_MOUNTED_TAIL);

    h.observer.emit([entry(neverMountedSlot, true)]);
    h.fixture.detectChanges();
    expect(neverMountedSlot.querySelector('ptah-message-bubble')).toBeFalsy();

    h.setTrees(treeIds(98));
    h.fixture.detectChanges();

    expect(
      firstTail.every((slot) => slot.querySelector('ptah-message-bubble')),
    ).toBe(true);
    expect(neverMountedSlot.querySelector('ptah-message-bubble')).toBeFalsy();
    expect(h.bubbles()).toHaveLength(ALWAYS_MOUNTED_TAIL * 2);
  });

  it('starts the replay motion hold before scheduling retention release', () => {
    const h = makeHarness({ historyReplaying: true, trees: treeIds(50) });
    // H2 relies on the motion-hold effect, declared first, starting before the
    // render-window feed effect schedules its deferred release.
    const component = h.fixture.componentInstance as unknown as {
      replayMotionHold: () => boolean;
      scheduleReplayRetentionRelease: () => void;
    };
    const scheduleRelease =
      component.scheduleReplayRetentionRelease.bind(component);
    const scheduleSpy = jest
      .spyOn(component, 'scheduleReplayRetentionRelease')
      .mockImplementation(() => {
        expect(component.replayMotionHold()).toBe(true);
        scheduleRelease();
      });

    h.setHistoryReplaying(false);
    h.fixture.detectChanges();

    expect(scheduleSpy).toHaveBeenCalledTimes(1);
    scheduleSpy.mockRestore();
  });

  it('releases retained bubbles on the next frame at their measured height', () => {
    const h = makeHarness({ historyReplaying: true, trees: treeIds(50) });
    h.setTrees(treeIds(56));
    h.fixture.detectChanges();
    const leavingTailSlot = h.slots()[44];
    h.observer.emit([entry(leavingTailSlot, false)]);

    const queuedFrames: FrameRequestCallback[] = [];
    rafSpy.mockImplementation((callback: FrameRequestCallback) => {
      queuedFrames.push(callback);
      return queuedFrames.length;
    });
    h.setStatus('loaded');
    h.setMessages(treeIds(56).map((id, index) => makeMessage(id, index)));
    h.setTrees([]);
    h.setHistoryReplaying(false);
    h.fixture.detectChanges();

    expect(leavingTailSlot.querySelector('ptah-message-bubble')).toBeTruthy();
    queuedFrames.splice(0).forEach((callback) => callback(0));
    h.fixture.detectChanges();

    expect(leavingTailSlot.querySelector('ptah-message-bubble')).toBeFalsy();
    const placeholder = leavingTailSlot.querySelector('.chat-msg-placeholder');
    expect((placeholder as HTMLElement).style.minHeight).toBe('200px');
  });

  it('uses the timer fallback when a hidden-window frame never fires', () => {
    jest.useFakeTimers();
    rafSpy.mockRestore();
    rafSpy = jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation(() => 73);
    const h = makeHarness({ historyReplaying: true, trees: treeIds(50) });
    const cancelRafSpy = jest.spyOn(window, 'cancelAnimationFrame');
    h.setStatus('loaded');
    h.setMessages(treeIds(50).map((id, index) => makeMessage(id, index)));
    h.setTrees([]);
    h.setHistoryReplaying(false);
    h.fixture.detectChanges();

    const component = h.fixture.componentInstance as unknown as {
      retentionReleaseRafId: number | null;
      retentionReleaseTimeoutId: ReturnType<typeof setTimeout> | null;
    };
    expect(component.retentionReleaseRafId).toBe(73);
    jest.advanceTimersByTime(50);
    h.fixture.detectChanges();

    expect(cancelRafSpy).toHaveBeenCalledWith(73);
    expect(component.retentionReleaseRafId).toBeNull();
    expect(component.retentionReleaseTimeoutId).toBeNull();
    cancelRafSpy.mockRestore();
  });

  it('cancels pending retention release handles on destroy', () => {
    jest.useFakeTimers();
    rafSpy.mockRestore();
    rafSpy = jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation(() => 91);
    const h = makeHarness({ historyReplaying: true, trees: treeIds(50) });
    const cancelRafSpy = jest.spyOn(window, 'cancelAnimationFrame');
    h.setHistoryReplaying(false);
    h.fixture.detectChanges();

    const component = h.fixture.componentInstance as unknown as {
      retentionReleaseRafId: number | null;
      retentionReleaseTimeoutId: ReturnType<typeof setTimeout> | null;
    };
    expect(component.retentionReleaseRafId).toBe(91);
    expect(component.retentionReleaseTimeoutId).not.toBeNull();

    h.fixture.destroy();

    expect(cancelRafSpy).toHaveBeenCalledWith(91);
    expect(component.retentionReleaseRafId).toBeNull();
    expect(component.retentionReleaseTimeoutId).toBeNull();
    cancelRafSpy.mockRestore();
  });

  it('cancels a pending retention release when replay restarts', () => {
    jest.useFakeTimers();
    rafSpy.mockRestore();
    rafSpy = jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation(() => 117);
    const h = makeHarness({ historyReplaying: true, trees: treeIds(50) });
    const cancelRafSpy = jest.spyOn(window, 'cancelAnimationFrame');
    h.setHistoryReplaying(false);
    h.fixture.detectChanges();

    h.setHistoryReplaying(true);
    h.fixture.detectChanges();

    const component = h.fixture.componentInstance as unknown as {
      retentionReleaseRafId: number | null;
      retentionReleaseTimeoutId: ReturnType<typeof setTimeout> | null;
    };
    expect(cancelRafSpy).toHaveBeenCalledWith(117);
    expect(component.retentionReleaseRafId).toBeNull();
    expect(component.retentionReleaseTimeoutId).toBeNull();
    cancelRafSpy.mockRestore();
  });

  it('marks every rendered replay bubble as settled', () => {
    const h = makeHarness({
      historyReplaying: true,
      trees: treeIds(50),
    });

    expect(h.bubbles()).toHaveLength(ALWAYS_MOUNTED_TAIL);
    expect(h.bubbles().every((bubble) => !bubble.isStreaming)).toBe(true);
  });

  it('keeps the live bubble at the finalized boundary streaming', () => {
    const finalized = [makeMessage('m0', 0), makeMessage('m1', 1)];
    const h = makeHarness({
      historyReplaying: false,
      status: 'streaming',
      messages: finalized,
      trees: ['live'],
    });

    const liveBubble = h
      .bubbles()
      .find((bubble) => bubble.messageIndex >= finalized.length);
    expect(liveBubble).toBeDefined();
    expect(liveBubble?.isStreaming).toBe(true);
  });

  it('exempts live streaming messages from the window after replay settles', () => {
    const h = makeHarness({
      historyReplaying: true,
      trees: treeIds(50),
    });
    expect(h.bubbles()).toHaveLength(ALWAYS_MOUNTED_TAIL);

    const finalized = Array.from({ length: 50 }, (_, index) =>
      makeMessage(`m${index}`, index),
    );
    h.setHistoryReplaying(false);
    h.setStatus('loaded');
    h.setMessages(finalized);
    h.setTrees([]);
    h.fixture.detectChanges();
    expect(h.bubbles()).toHaveLength(ALWAYS_MOUNTED_TAIL);

    h.setStatus('streaming');
    h.setTrees(treeIds(10, 'live'));
    h.fixture.detectChanges();

    const firstLiveSlot = h.slots()[finalized.length];
    expect(firstLiveSlot.querySelector('ptah-message-bubble')).toBeTruthy();
    expect(h.bubbles()).toHaveLength(10);
  });
});
