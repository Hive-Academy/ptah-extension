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
import { SURFACE_ACTIVE } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  ALWAYS_MOUNTED_TAIL,
  TranscriptRenderWindow,
} from './transcript-render-window';
import type {
  ExecutionChatMessage,
  ExecutionNode,
} from '@ptah-extension/shared';
import {
  configureTranscriptTestBed,
  FakeIntersectionObserver,
  installFakeIntersectionObserver,
  makeTranscriptMessage as makeMessage,
  makeTranscriptTree as makeTree,
  removeFakeIntersectionObserver,
  type TranscriptIntersectionEntry,
} from './testing/transcript-spec-harness';

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

function makeHarness(surfaceActive?: WritableSignal<boolean>): Harness {
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

  configureTranscriptTestBed({
    tabs: tabManagerStub.tabs,
    buildTree: buildTreeMock,
    iconUri: 'data:image/svg+xml;base64,PHN2Zy8+',
  });

  if (surfaceActive)
    TestBed.configureTestingModule({
      providers: [{ provide: SURFACE_ACTIVE, useValue: surfaceActive }],
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

  it('combines inherited surface activity with tab activity and cancels stale scroll frames', () => {
    const frames: FrameRequestCallback[] = [];
    rafSpy.mockImplementation((callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
    const cancel = jest.spyOn(window, 'cancelAnimationFrame');
    const surfaceActive = signal(true);
    const h = makeHarness(surfaceActive);
    h.messagesSig.set([makeMessage('m1')]);
    h.fixture.detectChanges();
    const container = h.fixture.nativeElement.querySelector(
      '.chat-scroll-container',
    ) as HTMLElement;
    Object.defineProperty(container, 'scrollHeight', { value: 1000 });
    Object.defineProperty(container, 'clientHeight', { value: 200 });
    container.scrollTop = 300;
    const staleFrames = [...frames];
    surfaceActive.set(false);
    h.fixture.detectChanges();
    expect(cancel).toHaveBeenCalled();
    h.messagesSig.set([makeMessage('m1'), makeMessage('m2')]);
    const frameCount = frames.length;
    h.fixture.detectChanges();
    expect(h.bubbleCount()).toBe(1);
    expect(frames).toHaveLength(frameCount);
    staleFrames.forEach((frame) => frame(0));
    expect(container.scrollTop).toBe(300);
    surfaceActive.set(true);
    h.fixture.detectChanges();
    expect(h.bubbleCount()).toBe(2);
    staleFrames.forEach((frame) => frame(0));
    expect(container.scrollTop).toBe(300);
    h.fixture.componentRef.setInput('active', false);
    h.fixture.detectChanges();
    h.messagesSig.set([
      makeMessage('m1'),
      makeMessage('m2'),
      makeMessage('m3'),
    ]);
    h.fixture.detectChanges();
    expect(h.bubbleCount()).toBe(2);
    cancel.mockRestore();
  });

  it('restores the saved unpinned scroll offset after surface reactivation', () => {
    const surfaceActive = signal(true);
    const h = makeHarness(surfaceActive);
    h.fixture.detectChanges();
    const container = h.fixture.nativeElement.querySelector(
      '.chat-scroll-container',
    ) as HTMLElement;
    Object.defineProperty(container, 'scrollHeight', { value: 1000 });
    Object.defineProperty(container, 'clientHeight', { value: 200 });
    container.scrollTop = 800;
    h.component.onScroll(new Event('scroll'));
    container.scrollTop = 300;
    h.component.onScroll(new Event('scroll'));
    surfaceActive.set(false);
    h.fixture.detectChanges();
    container.scrollTop = 0;
    h.component.onScroll(new Event('scroll'));
    surfaceActive.set(true);
    h.fixture.detectChanges();
    expect(container.scrollTop).toBe(300);
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

  it('unpins on a single small scroll up and never pulls the user back', () => {
    const h = makeHarness();
    h.fixture.detectChanges();
    const container: HTMLElement = h.fixture.nativeElement.querySelector(
      '.chat-scroll-container',
    );
    Object.defineProperty(container, 'scrollHeight', { value: 5000 });
    Object.defineProperty(container, 'clientHeight', { value: 500 });
    const state = h.component as unknown as { pinnedToBottom: boolean };

    // Pinned at the bottom.
    container.scrollTop = 4500;
    h.component.onScroll(new Event('scroll'));
    expect(state.pinnedToBottom).toBe(true);

    // One wheel tick up — still inside NEAR_BOTTOM_PX, but it is the user.
    container.scrollTop = 4440;
    h.component.onScroll(new Event('scroll'));
    expect(state.pinnedToBottom).toBe(false);

    // Streaming content arrives: the transcript must not re-stick.
    h.messagesSig.set([makeMessage('m1')]);
    h.fixture.detectChanges();
    expect(container.scrollTop).toBe(4440);

    // Scrolling back down near the bottom re-pins.
    container.scrollTop = 4450;
    h.component.onScroll(new Event('scroll'));
    expect(state.pinnedToBottom).toBe(true);
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
describe('ChatTranscriptComponent — render window', () => {
  const MESSAGE_COUNT = 20;
  let rafSpy: jest.SpyInstance;

  beforeEach(() => {
    installFakeIntersectionObserver();
    rafSpy = jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });
  });

  afterEach(() => {
    removeFakeIntersectionObserver();
    rafSpy.mockRestore();
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  function entry(
    target: Element,
    isIntersecting: boolean,
    height: number,
  ): TranscriptIntersectionEntry {
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

/**
 * Gate A of the TASK_2026_381 measurement harness, implemented in Jest rather
 * than as the planned Electron e2e spec (see test-report.md).
 *
 * The claim under test is "cause #1 is bounded": the number of MOUNTED message
 * bubbles does not grow with the number of messages in the transcript. The
 * assertion is a ceiling derived from the window constants — never a
 * wall-clock or a byte threshold — so it is identical on every machine.
 *
 * The paired Gate B (a finalized message serializes below a stated ceiling)
 * already exists as
 * `chat-streaming/src/lib/message-finalization.retention.spec.ts`
 * "keeps the finalized message under a stated serialized ceiling".
 */
describe('ChatTranscriptComponent — Gate A: mounted bubbles are bounded', () => {
  /** How many contiguous slots the simulated viewport reports as intersecting. */
  const VIEWPORT_SLOTS = 12;
  /** The ceiling the mechanism guarantees, from the window constants alone. */
  const MOUNTED_CEILING = ALWAYS_MOUNTED_TAIL + VIEWPORT_SLOTS;

  let rafSpy: jest.SpyInstance;

  beforeEach(() => {
    installFakeIntersectionObserver();
    rafSpy = jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });
  });

  afterEach(() => {
    removeFakeIntersectionObserver();
    rafSpy.mockRestore();
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  /**
   * Seed `total` finalized messages, attach the window, then report exactly one
   * viewport-sized run of intersecting slots in the MIDDLE of the transcript —
   * the steady state of a user who has scrolled up. Everything else, including
   * the run's neighbours, is reported out of the window.
   */
  function mountedAt(total: number): {
    mounted: number;
    slots: number;
    placeholders: number;
  } {
    // Callable twice inside one test (the "does not grow with N" case), so the
    // module has to be torn down before each harness.
    TestBed.resetTestingModule();
    FakeIntersectionObserver.reset();

    const h = makeHarness();
    h.messagesSig.set(
      Array.from({ length: total }, (_, i) => makeMessage(`m${i}`)),
    );
    h.streamingStateSig.set({ pendingStats: null });
    h.buildTreeMock.mockReturnValue([]);
    h.fixture.detectChanges();

    const container: HTMLElement = h.fixture.nativeElement.querySelector(
      '.chat-scroll-container',
    );
    h.fixture.debugElement.injector
      .get(TranscriptRenderWindow)
      .attach(container);
    h.fixture.detectChanges();

    const observer = FakeIntersectionObserver.instances[0];
    const slots = h.slots();
    const firstVisible = Math.floor(total / 2);
    observer.emit(
      slots.map((slot, i) => ({
        target: slot,
        isIntersecting: i >= firstVisible && i < firstVisible + VIEWPORT_SLOTS,
        boundingClientRect: { height: 200 },
      })),
    );
    h.fixture.detectChanges();

    return {
      mounted: h.bubbleCount(),
      slots: slots.length,
      placeholders: h.placeholders().length,
    };
  }

  it.each([50, 200, 1000])(
    'mounts at most the tail plus the viewport with %i messages',
    (total) => {
      const result = mountedAt(total);

      // One slot per message: the scroll container keeps its real extent.
      expect(result.slots).toBe(total);
      expect(result.mounted).toBe(MOUNTED_CEILING);
      expect(result.placeholders).toBe(total - MOUNTED_CEILING);
    },
  );

  it('mounts the same number at 1000 messages as at 50 — it does not grow with N', () => {
    // This is the whole claim of cause #1 in one assertion. Before the render
    // window, mounted === total at every N.
    expect(mountedAt(1000).mounted).toBe(mountedAt(50).mounted);
  });

  it('mounts everything when the platform has no IntersectionObserver', () => {
    // The documented failure mode is today's behaviour, not a missing message.
    removeFakeIntersectionObserver();

    const h = makeHarness();
    h.messagesSig.set(
      Array.from({ length: 40 }, (_, i) => makeMessage(`m${i}`)),
    );
    h.streamingStateSig.set({ pendingStats: null });
    h.buildTreeMock.mockReturnValue([]);
    h.fixture.detectChanges();

    const container: HTMLElement = h.fixture.nativeElement.querySelector(
      '.chat-scroll-container',
    );
    h.fixture.debugElement.injector
      .get(TranscriptRenderWindow)
      .attach(container);
    h.fixture.detectChanges();

    expect(h.bubbleCount()).toBe(40);
    expect(h.placeholders()).toHaveLength(0);
  });
});

describe('ChatTranscriptComponent — transcript ordering (TASK_2026_382 D1)', () => {
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

  it('sorts a user message sent DURING a live stream below the streaming bubble', () => {
    const h = makeHarness();
    // The defect window: the send path thought the tab was idle, so the user
    // bubble landed in `messages` while the tree was still streaming.
    h.messagesSig.set([
      makeMessage('assistant-earlier', 'assistant', 0, makeTree('t0', 0)),
      makeMessage('user-sent-mid-stream', 'user', 5_000),
    ]);
    h.streamingStateSig.set({ pendingStats: null });
    h.buildTreeMock.mockReturnValue([makeTree('live-tree', 1_000)]);
    h.fixture.detectChanges();

    expect(h.component.allMessages().map((m) => m.id)).toEqual([
      'assistant-earlier',
      'live-tree',
      'user-sent-mid-stream',
    ]);
  });

  it('keeps lifecycle order when the keys tie, so equal-timestamp turns do not shuffle', () => {
    const h = makeHarness();
    h.messagesSig.set([makeMessage('finalized', 'assistant', 1_000)]);
    h.streamingStateSig.set({ pendingStats: null });
    h.buildTreeMock.mockReturnValue([makeTree('streaming', 1_000)]);
    h.fixture.detectChanges();

    expect(h.component.allMessages().map((m) => m.id)).toEqual([
      'finalized',
      'streaming',
    ]);
  });

  it('does not reallocate the merged array while its two inputs are unchanged', () => {
    const h = makeHarness();
    h.messagesSig.set([makeMessage('m1', 'assistant', 0, makeTree('m1', 0))]);
    h.streamingStateSig.set({ pendingStats: null });
    const tree = makeTree('live', 1_000);
    // Same tree ARRAY identity on every call — what the incremental builder
    // returns for a delta that moves no root digest.
    const trees = [tree];
    h.buildTreeMock.mockReturnValue(trees);
    h.fixture.detectChanges();

    const first = h.component.allMessages();
    const second = h.component.allMessages();

    expect(second).toBe(first);
    expect(first.map((m) => m.id)).toEqual(['m1', 'live']);
  });
});

// ---------------------------------------------------------------------------
// Agent-output link markers (TASK_2026_413 Batch 8c-2)
//
// The transcript IS agent output, so it opts its rendered markdown into
// file-link routing and names the tab whose workspace a relative path belongs
// to. Both are HOST bindings: they sit outside every `<markdown>` element, so
// agent-authored HTML can neither opt a surface in nor point it at another
// workspace (R2/R8). If either disappears, agent file links silently stop
// working, or start resolving against the wrong root.
// ---------------------------------------------------------------------------
describe('ChatTranscriptComponent — agent-output link markers', () => {
  it('carries the opt-in marker and the tab id on the HOST, not in content', () => {
    const h = makeHarness();
    h.fixture.detectChanges();
    const host = h.fixture.nativeElement as HTMLElement;

    expect(host.hasAttribute('data-ptah-file-links')).toBe(true);
    expect(host.getAttribute('data-ptah-tab-id')).toBe('tab-1');
    expect(host.querySelector('markdown[data-ptah-file-links]')).toBeNull();
  });
});
