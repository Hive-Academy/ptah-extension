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
  inject,
  input,
  output,
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

import { By } from '@angular/platform-browser';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ChatTranscriptComponent } from './chat-transcript.component';
import { SURFACE_ACTIVE } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  ALWAYS_MOUNTED_TAIL,
  RENDER_WINDOW_MARGIN_PX,
  UNFOCUSED_RENDER_WINDOW_MARGIN_PX,
  TranscriptRenderWindow,
} from './transcript-render-window';
import { TranscriptPrependAnchorDirective } from './transcript-prepend-anchor.directive';
import {
  SESSION_CARD_ACTIONS,
  SESSION_CONTEXT,
  SESSION_FOCUSED,
  type SessionCardActions,
} from '../../../tokens/session-context.token';
import { STREAM_PRESENTATION_RECORDS_ENABLED } from '../../../services/stream-presentation-store.service';
import {
  createExecutionNode,
  type ExecutionChatMessage,
  type ExecutionNode,
  type PermissionRequest,
} from '@ptah-extension/shared';
import { SubagentTileComponent } from '../execution/subagent-tile.component';
import {
  SubagentExecutionStore,
  type SubagentExecutionEntry,
} from '@ptah-extension/chat-streaming';
import { SessionAgentRosterService } from '../../../services/session-agents/session-agent-roster.service';
import type { SessionAgent } from '../../../services/session-agents/session-agent-roster';
import { SingleChatSubagentViewComponent } from './single-chat-subagent-view.component';
import {
  configureTranscriptTestBed,
  FakeIntersectionObserver,
  installFakeIntersectionObserver,
  makeTranscriptMessage as makeMessage,
  makeTranscriptTree as makeTree,
  removeFakeIntersectionObserver,
  TranscriptMessageBubbleStub,
  type TranscriptIntersectionEntry,
} from './testing/transcript-spec-harness';

interface Harness {
  fixture: ComponentFixture<ChatTranscriptComponent>;
  component: ChatTranscriptComponent;
  messagesSig: WritableSignal<readonly ExecutionChatMessage[]>;
  streamingStateSig: WritableSignal<unknown>;
  buildTreeMock: jest.Mock;
  bubbleCount: () => number;
  bubbleComponents: () => TranscriptMessageBubbleStub[];
  slots: () => HTMLElement[];
  placeholders: () => HTMLElement[];
}

function makeHarness(
  surfaceActive?: WritableSignal<boolean>,
  sessionFocused?: WritableSignal<boolean>,
): Harness {
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
  if (sessionFocused)
    TestBed.configureTestingModule({
      providers: [{ provide: SESSION_FOCUSED, useValue: sessionFocused }],
    });
  const fixture = TestBed.createComponent(ChatTranscriptComponent);
  fixture.componentRef.setInput('tabId', 'tab-1');
  fixture.componentRef.setInput('active', true);

  const bubbleCount = () =>
    fixture.nativeElement.querySelectorAll('ptah-message-bubble').length;
  const bubbleComponents = () =>
    fixture.debugElement
      .queryAll(By.directive(TranscriptMessageBubbleStub))
      .map((bubble) => bubble.componentInstance as TranscriptMessageBubbleStub);
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
    bubbleComponents,
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
    expect(container.scrollTop).toBe(1000);
    staleFrames.forEach((frame) => frame(0));
    expect(container.scrollTop).toBe(1000);
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
    h.component.onScroll();
    container.scrollTop = 300;
    h.component.onScroll();
    surfaceActive.set(false);
    h.fixture.detectChanges();
    container.scrollTop = 0;
    h.component.onScroll();
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
    (
      h.component as unknown as { pinnedToBottom: WritableSignal<boolean> }
    ).pinnedToBottom.set(false);

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
    const pin = (
      h.component as unknown as { pinnedToBottom: WritableSignal<boolean> }
    ).pinnedToBottom;

    // Pinned at the bottom.
    container.scrollTop = 4500;
    h.component.onScroll();
    expect(pin()).toBe(true);

    // One wheel tick up — still inside NEAR_BOTTOM_PX, but it is the user.
    container.scrollTop = 4440;
    h.component.onScroll();
    expect(pin()).toBe(false);

    // Streaming content arrives: the transcript must not re-stick.
    h.messagesSig.set([makeMessage('m1')]);
    h.fixture.detectChanges();
    expect(container.scrollTop).toBe(4440);

    // Scrolling back down near the bottom re-pins.
    container.scrollTop = 4450;
    h.component.onScroll();
    expect(pin()).toBe(true);
  });

  it('listens to native scroll events, refreshes the pin binding, and detaches on destroy', () => {
    const h = makeHarness();
    h.fixture.detectChanges();
    const container = h.fixture.nativeElement.querySelector(
      '.chat-scroll-container',
    ) as HTMLElement;
    Object.defineProperty(container, 'scrollHeight', { value: 5000 });
    Object.defineProperty(container, 'clientHeight', { value: 500 });
    // The real prepend-anchor directive: its input is what a pin flip must
    // refresh. Asserted on the child, not on a mock of the handler.
    const anchorPin = (): boolean =>
      h.fixture.debugElement
        .query(By.directive(TranscriptPrependAnchorDirective))
        ?.injector.get(TranscriptPrependAnchorDirective)
        .pinnedToBottom() ?? false;

    // The listener is bound in afterNextRender; a dispatched event reaches it.
    container.scrollTop = 4500;
    container.dispatchEvent(new Event('scroll'));
    h.fixture.detectChanges();
    expect(anchorPin()).toBe(true);

    // One wheel tick up: the signal flip refreshes the child input even
    // though the listener runs outside the zone.
    container.scrollTop = 4400;
    container.dispatchEvent(new Event('scroll'));
    h.fixture.detectChanges();
    expect(anchorPin()).toBe(false);

    // Destroy removes the listener from the CAPTURED element, not a viewChild.
    const removeSpy = jest.spyOn(container, 'removeEventListener');
    h.fixture.destroy();
    expect(removeSpy).toHaveBeenCalledWith('scroll', expect.any(Function));
    removeSpy.mockRestore();
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

  it('defaults to the focused margin without a SESSION_FOCUSED provider', () => {
    const h = makeWindowedHarness();

    expect(FakeIntersectionObserver.instances.at(-1)?.options?.rootMargin).toBe(
      `${RENDER_WINDOW_MARGIN_PX}px 0px`,
    );
  });

  it('shrinks the render margin for an unfocused tile and widens it on refocus', () => {
    const focused = signal(false);
    const h = makeHarness(undefined, focused);
    h.messagesSig.set(
      Array.from({ length: MESSAGE_COUNT }, (_, i) => makeMessage(`m${i}`)),
    );
    h.streamingStateSig.set({ pendingStats: null });
    h.buildTreeMock.mockReturnValue([]);
    h.fixture.detectChanges();
    const renderWindow = h.fixture.debugElement.injector.get(
      TranscriptRenderWindow,
    );
    renderWindow.attach(
      h.fixture.nativeElement.querySelector(
        '.chat-scroll-container',
      ) as HTMLElement,
    );
    h.fixture.detectChanges();

    expect(FakeIntersectionObserver.instances.at(-1)?.options?.rootMargin).toBe(
      `${UNFOCUSED_RENDER_WINDOW_MARGIN_PX}px 0px`,
    );

    focused.set(true);
    h.fixture.detectChanges();

    expect(FakeIntersectionObserver.instances.at(-1)?.options?.rootMargin).toBe(
      `${RENDER_WINDOW_MARGIN_PX}px 0px`,
    );
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
    expect(
      h
        .slots()
        .map((slot) => slot.getAttribute('data-ptah-transcript-message-id')),
    ).toEqual(['assistant-earlier', 'live-tree', 'user-sent-mid-stream']);
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

describe('ChatTranscriptComponent — per-message presentation records (Phase 3)', () => {
  let rafSpy: jest.SpyInstance;

  beforeEach(() => {
    rafSpy = jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 0;
      });
  });

  afterEach(() => {
    rafSpy.mockRestore();
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('updates one live record without recomputing transcript-wide derivations', () => {
    const h = makeHarness();
    const unchangedTree = makeTree('live-unchanged', 2_000);
    const pendingStats = { tokens: 1 };
    h.streamingStateSig.set({ pendingStats });
    h.buildTreeMock.mockReturnValue([
      makeTree('live-changed', 1_000),
      unchangedTree,
    ]);
    h.fixture.detectChanges();
    const recordsBeforeDelta = h
      .bubbleComponents()
      .map((bubble) => bubble.message);

    const allMessages = jest.spyOn(h.component, 'allMessages');
    const finalizedMessageIds = jest.spyOn(
      h.component as unknown as {
        finalizedMessageIds: () => ReadonlySet<string>;
      },
      'finalizedMessageIds',
    );
    const renderWindow = h.fixture.debugElement.injector.get(
      TranscriptRenderWindow,
    );
    const renderWindowIds = jest.spyOn(renderWindow, 'syncMessages');
    allMessages.mockClear();
    finalizedMessageIds.mockClear();
    renderWindowIds.mockClear();

    h.streamingStateSig.set({ pendingStats });
    h.buildTreeMock.mockReturnValue([
      makeTree('live-changed', 1_000),
      unchangedTree,
    ]);
    h.fixture.detectChanges();

    expect(h.bubbleComponents().map((bubble) => bubble.message.id)).toEqual([
      'live-changed',
      'live-unchanged',
    ]);
    expect(h.bubbleComponents()[0].message).not.toBe(recordsBeforeDelta[0]);
    expect(h.bubbleComponents()[1].message).toBe(recordsBeforeDelta[1]);
    expect(allMessages).not.toHaveBeenCalled();
    expect(finalizedMessageIds).not.toHaveBeenCalled();
    expect(renderWindowIds).not.toHaveBeenCalled();
  });

  it('keeps the bubble component when a live record finalizes with its id', () => {
    const h = makeHarness();
    const liveTree = makeTree('stable-id', 1_000);
    h.streamingStateSig.set({ pendingStats: null });
    h.buildTreeMock.mockReturnValue([liveTree]);
    h.fixture.detectChanges();

    const liveBubble = h.bubbleComponents()[0];
    h.messagesSig.set([makeMessage('stable-id', 'assistant', 1_000)]);
    h.fixture.detectChanges();

    expect(h.bubbleComponents()).toHaveLength(1);
    expect(h.bubbleComponents()[0]).toBe(liveBubble);
    expect(h.bubbleComponents()[0].message.streamingState).toBeNull();
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

// ---------------------------------------------------------------------------
// One tree build per published tab snapshot (TASK_2026_628 Batch 5)
//
// Every surface of a tab (main panel, canvas tile, a detail row) shares one
// build: with presentation records on, the store is the only `buildTree`
// caller and dedups on the published tab object; with them off, every surface
// uses the `tab-<id>` key, so the builder's per-key cache is shared too.
// ---------------------------------------------------------------------------
describe('ChatTranscriptComponent — one buildTree per published tab snapshot', () => {
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

  it('builds once when two transcripts of the same tab render in the same frame', () => {
    const h = makeHarness();
    const second = TestBed.createComponent(ChatTranscriptComponent);
    second.componentRef.setInput('tabId', 'tab-1');
    second.componentRef.setInput('active', true);
    h.buildTreeMock.mockReturnValue([makeTree('s1')]);

    h.streamingStateSig.set({ pendingStats: null });
    h.fixture.detectChanges();
    second.detectChanges();
    expect(h.buildTreeMock).toHaveBeenCalledTimes(1);

    // Next published snapshot: still exactly one build for both surfaces.
    h.streamingStateSig.set({ pendingStats: { tokens: 3 } });
    second.detectChanges();
    h.fixture.detectChanges();
    expect(h.buildTreeMock).toHaveBeenCalledTimes(2);
    for (const call of h.buildTreeMock.mock.calls as unknown[][]) {
      expect(call[1]).toBe('tab-tab-1');
    }
    expect(h.bubbleCount()).toBe(1);
    expect(
      second.nativeElement.querySelectorAll('ptah-message-bubble').length,
    ).toBe(1);
  });

  it('uses the tab-<id> key on a tile surface when presentation records are off', () => {
    const streamingStateSig = signal<unknown>(null);
    const buildTreeMock = jest.fn(() => [makeTree('s1')] as ExecutionNode[]);
    const tabs = computed(() => [
      {
        id: 'tab-1',
        claudeSessionId: 'session-1',
        status: 'streaming',
        messages: [],
        streamingState: streamingStateSig(),
      },
    ]);
    configureTranscriptTestBed({
      tabs,
      buildTree: buildTreeMock,
      sessionContext: { sessionId: 'session-1' },
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: STREAM_PRESENTATION_RECORDS_ENABLED, useValue: false },
      ],
    });
    const fixture = TestBed.createComponent(ChatTranscriptComponent);
    fixture.componentRef.setInput('tabId', 'tab-1');
    fixture.componentRef.setInput('active', true);

    streamingStateSig.set({ pendingStats: null });
    fixture.detectChanges();

    expect(buildTreeMock).toHaveBeenCalled();
    for (const call of buildTreeMock.mock.calls as unknown[][]) {
      expect(call[1]).toBe('tab-tab-1');
    }
  });
});

// --- Single chat sub-agent full view (TASK_2026_629 R9n, parity row 103) ---

@Component({
  selector: 'ptah-single-chat-subagent-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@for (child of output(); track child.id) {
    <span data-testid="stored-agent-output">{{
      child.content || child.toolName
    }}</span>
  }`,
})
class SubagentViewStub {
  readonly node = input.required<ExecutionNode>();
  readonly isStreaming = input<boolean>(false);
  readonly back = output<void>();
  private readonly executions = inject(SubagentExecutionStore);
  protected readonly output = computed(() => {
    this.executions.entries();
    const key = this.node().toolCallId;
    return key ? this.executions.treeFor(key) : [];
  });
}

/** Pending permissions by tool call id, read by the real tiles below. */
const PENDING_PERMISSIONS = new Map<string, PermissionRequest>();

/** Renders the REAL sub-agent tile for every agent node of the message. */
@Component({
  selector: 'ptah-message-bubble',
  standalone: true,
  imports: [SubagentTileComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    @for (agent of agentNodes(); track agent.id) {
      <ptah-subagent-tile [node]="agent" [getPermissionForTool]="lookup" />
    }
  `,
})
class TileBubbleStub extends TranscriptMessageBubbleStub {
  protected readonly lookup = (toolCallId: string): PermissionRequest | null =>
    PENDING_PERMISSIONS.get(toolCallId) ?? null;

  protected agentNodes(): ExecutionNode[] {
    const found: ExecutionNode[] = [];
    const walk = (node: ExecutionNode): void => {
      if (node.type === 'agent') found.push(node);
      else node.children.forEach(walk);
    };
    if (this.message?.streamingState) walk(this.message.streamingState);
    return found;
  }
}

/** Injects the card tokens exactly as CompactSessionCardComponent does. */
@Component({
  selector: 'ptah-card-probe',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class CompactCardProbe {
  readonly cardActions = inject(SESSION_CARD_ACTIONS, { optional: true });
  readonly sessionContext = inject(SESSION_CONTEXT, { optional: true });
  /** compact-session-card.component.ts: strict when either is injected. */
  readonly strict = Boolean(this.cardActions || this.sessionContext);
}

/** ChatView's shape: compact card and composer are SIBLINGS of the transcript. */
@Component({
  standalone: true,
  imports: [ChatTranscriptComponent, CompactCardProbe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ptah-card-probe />
    <ptah-chat-transcript tabId="tab-1" [active]="true" />
    <textarea data-testid="composer-draft"></textarea>
  `,
})
class SingleChatHost {}

/**
 * Same shape for the real-tile case. A separate class because a host's
 * compiled template keeps the transcript definition of its first compile, so
 * a later import override would not reach a host already used.
 */
@Component({
  standalone: true,
  imports: [ChatTranscriptComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ptah-chat-transcript tabId="tab-1" [active]="true" />`,
})
class SingleChatTileHost {}

const railActions = {
  openLane: jest.fn(),
  openSession: jest.fn(),
} satisfies SessionCardActions;

/** A Rail-like host that provides its own card actions. */
@Component({
  standalone: true,
  imports: [ChatTranscriptComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: SESSION_CARD_ACTIONS, useValue: railActions }],
  template: `<ptah-chat-transcript tabId="tab-1" [active]="true" />`,
})
class RailHost {}

/** A host that switches the rendered tab and hides it, like a Rail detail. */
@Component({
  standalone: true,
  imports: [ChatTranscriptComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ptah-chat-transcript [tabId]="tabId()" [active]="active()" />`,
})
class SwitchingHost {
  readonly tabId = signal('tab-1');
  readonly active = signal(true);
}

function agentTree(agentChildren: readonly ExecutionNode[]): ExecutionNode {
  return createExecutionNode({
    id: 'm1-tree',
    type: 'message',
    status: 'streaming',
    children: [
      createExecutionNode({
        id: 'task-1',
        type: 'tool',
        status: 'streaming',
        toolName: 'Task',
        toolCallId: 'agent-1',
        children: [
          createExecutionNode({
            id: 'agent-node-1',
            type: 'agent',
            status: 'streaming',
            toolCallId: 'agent-1',
            agentType: 'reviewer',
            children: [...agentChildren],
          }),
        ],
      }),
    ],
  });
}

function toolNode(toolCallId: string): ExecutionNode {
  return createExecutionNode({
    id: `node-${toolCallId}`,
    type: 'tool',
    status: 'pending',
    toolName: 'Bash',
    toolCallId,
  });
}

function mountHost<T>(host: new () => T): ComponentFixture<T> {
  const fixture = TestBed.createComponent(host);
  fixture.detectChanges();
  return fixture;
}

describe('ChatTranscriptComponent — single chat sub-agent view (R9n)', () => {
  let rafSpy: jest.SpyInstance;
  let messagesSig: WritableSignal<readonly ExecutionChatMessage[]>;
  let sessionSig: WritableSignal<string | null>;
  const outputTree = signal<ExecutionNode[]>([]);
  const nestedTrees = signal<ReadonlyMap<string, ExecutionNode[]>>(new Map());
  const executionEntries = signal<ReadonlyMap<string, SubagentExecutionEntry>>(
    new Map(),
  );

  function configure(options: { realTiles?: boolean } = {}): void {
    messagesSig = signal<readonly ExecutionChatMessage[]>([
      makeMessage('u1', 'user', 1),
      makeMessage('m1', 'assistant', 2, agentTree([toolNode('tool-a')])),
    ]);
    sessionSig = signal<string | null>('session-1');
    const tabs = computed(() => [
      {
        id: 'tab-1',
        claudeSessionId: sessionSig(),
        status: 'loaded',
        messages: messagesSig(),
        streamingState: null,
      },
      {
        id: 'tab-2',
        claudeSessionId: 'session-2',
        status: 'loaded',
        messages: [makeMessage('u9', 'user', 9)],
        streamingState: null,
      },
    ]);
    configureTranscriptTestBed({ tabs, buildTree: jest.fn(() => []) });
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SubagentExecutionStore,
          useValue: {
            entries: executionEntries,
            treeFor: (key: string) => nestedTrees().get(key) ?? outputTree(),
          },
        },
      ],
    });
    TestBed.overrideComponent(ChatTranscriptComponent, {
      remove: {
        imports: [
          SingleChatSubagentViewComponent,
          ...(options.realTiles ? [TranscriptMessageBubbleStub] : []),
        ],
      },
      add: {
        imports: [
          SubagentViewStub,
          ...(options.realTiles ? [TileBubbleStub] : []),
        ],
      },
    });
  }

  function transcriptOf<T>(fixture: ComponentFixture<T>) {
    const element = fixture.debugElement.query(
      By.directive(ChatTranscriptComponent),
    );
    const scroller = element.query(
      By.css('[data-testid="chat-transcript-scroller"]'),
    );
    return {
      component: element.componentInstance as ChatTranscriptComponent,
      scroller: scroller.nativeElement as HTMLElement,
      /** What any descendant (a tile) resolves for SESSION_CARD_ACTIONS. */
      descendantActions: () =>
        scroller.injector.get(SESSION_CARD_ACTIONS, null),
      view: (): SubagentViewStub | null =>
        (element.query(By.directive(SubagentViewStub))?.componentInstance as
          SubagentViewStub | undefined) ?? null,
      notice: () =>
        (
          element.nativeElement.querySelector(
            '[data-testid="subagent-notice"]',
          ) as HTMLElement
        ).textContent?.trim(),
    };
  }

  beforeEach(() => {
    outputTree.set([]);
    nestedTrees.set(new Map());
    executionEntries.set(new Map());
    rafSpy = jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 0;
      });
  });

  afterEach(() => {
    rafSpy.mockRestore();
    PENDING_PERMISSIONS.clear();
    railActions.openLane.mockReset();
    railActions.openSession.mockReset();
    TestBed.resetTestingModule();
  });

  it('opts every main-transcript bubble into agent tile mode', () => {
    configure();
    const fixture = mountHost(SingleChatHost);
    const bubbles = fixture.debugElement
      .queryAll(By.directive(TranscriptMessageBubbleStub))
      .map((b) => b.componentInstance as TranscriptMessageBubbleStub);
    expect(bubbles.length).toBe(2);
    expect(bubbles.every((bubble) => bubble.agentTileMode === true)).toBe(true);
  });

  it('passes a top-level agent chip to its turn after agent children leave the parent tree', () => {
    configure();
    const agent: SessionAgent = {
      key: 'sub:agent-1',
      kind: 'subagent',
      name: 'reviewer',
      cliId: null,
      agentType: 'reviewer',
      status: 'running',
      startedAt: null,
      endedAt: null,
      activity: null,
      openRequestIds: [],
    };
    TestBed.overrideProvider(SessionAgentRosterService, {
      useValue: { roster: () => [agent] },
    });
    const fixture = mountHost(SingleChatHost);
    const assistant = fixture.debugElement
      .queryAll(By.directive(TranscriptMessageBubbleStub))
      .map((item) => item.componentInstance as TranscriptMessageBubbleStub)
      .find((bubble) => bubble.message.role === 'assistant');
    expect(assistant?.agents.map((item) => item.key)).toContain('sub:agent-1');
  });

  it('adds a nested agent chip from the store and opens its in-place view', () => {
    configure();
    const parent: SessionAgent = {
      key: 'sub:agent-1',
      kind: 'subagent',
      name: 'reviewer',
      cliId: null,
      agentType: 'reviewer',
      status: 'running',
      startedAt: null,
      endedAt: null,
      activity: null,
      openRequestIds: [],
    };
    const child: SessionAgent = {
      ...parent,
      key: 'sub:agent-2',
      name: 'nested reviewer',
    };
    TestBed.overrideProvider(SessionAgentRosterService, {
      useValue: { roster: () => [parent, child] },
    });
    const fixture = mountHost(SingleChatHost);
    const assistant = () =>
      fixture.debugElement
        .queryAll(By.directive(TranscriptMessageBubbleStub))
        .map((item) => item.componentInstance as TranscriptMessageBubbleStub)
        .find((bubble) => bubble.message.role === 'assistant');
    expect(assistant()?.agents.map((item) => item.key)).toEqual([
      'sub:agent-1',
    ]);

    const nested = createExecutionNode({
      id: 'nested-agent',
      type: 'agent',
      status: 'streaming',
      toolCallId: 'agent-2',
      agentType: 'reviewer',
    });
    nestedTrees.set(
      new Map([
        ['agent-1', [nested]],
        [
          'agent-2',
          [
            createExecutionNode({
              id: 'nested-output',
              type: 'text',
              status: 'complete',
              content: 'Nested output',
            }),
          ],
        ],
      ]),
    );
    executionEntries.set(new Map());
    fixture.detectChanges();

    expect(assistant()?.agents.map((item) => item.key)).toEqual([
      'sub:agent-1',
      'sub:agent-2',
    ]);
    assistant()?.laneRequested.emit('sub:agent-2');
    fixture.detectChanges();
    expect(transcriptOf(fixture).view()?.node().id).toBe('nested-agent');
    expect(
      fixture.nativeElement.querySelector('[data-testid="stored-agent-output"]')
        ?.textContent,
    ).toContain('Nested output');
  });

  it('keeps a top-level agent tile without an agent-start record and opens output arriving after parent completion', () => {
    configure({ realTiles: true });
    const fixture = mountHost(SingleChatTileHost);
    const tile: HTMLElement = fixture.nativeElement.querySelector(
      '[data-testid="subagent-tile"]',
    );
    expect(tile).toBeTruthy();
    expect(tile.textContent).toContain('reviewer');
    const open: HTMLButtonElement = tile.querySelector(
      '[data-testid="subagent-open"]',
    )!;
    open.click();
    fixture.detectChanges();
    const view = transcriptOf(fixture).view();
    expect(view?.node().toolCallId).toBe('agent-1');
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="stored-agent-output"]',
      ),
    ).toBeNull();
    outputTree.set([
      createExecutionNode({
        id: 'late-output',
        type: 'text',
        status: 'complete',
        content: 'Arrived after chat complete',
      }),
    ]);
    executionEntries.set(new Map());
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="stored-agent-output"]')
        .textContent,
    ).toContain('Arrived after chat complete');
  });

  it('tile -> live full view in place -> Back restores scroll, focus and the draft', () => {
    configure();
    const fixture = mountHost(SingleChatHost);
    const t = transcriptOf(fixture);
    Object.defineProperty(t.scroller, 'scrollHeight', { value: 1000 });
    Object.defineProperty(t.scroller, 'clientHeight', { value: 200 });
    t.scroller.scrollTop = 800;
    t.component.onScroll();
    t.scroller.scrollTop = 300;
    t.component.onScroll();

    const draft: HTMLTextAreaElement = fixture.nativeElement.querySelector(
      '[data-testid="composer-draft"]',
    );
    draft.value = 'half-written prompt';
    draft.focus();

    t.descendantActions()?.openLane('sub:agent-1');
    fixture.detectChanges();

    const view = t.view();
    expect(view?.node().id).toBe('agent-node-1');
    expect(t.scroller.hasAttribute('inert')).toBe(true);

    // Live: the tree grows while the view is open; the same view follows it.
    messagesSig.set([
      makeMessage('u1', 'user', 1),
      makeMessage(
        'm1',
        'assistant',
        2,
        agentTree([toolNode('tool-a'), toolNode('tool-b')]),
      ),
    ]);
    fixture.detectChanges();
    expect(t.view()).toBe(view);
    expect(view?.node().children.map((child) => child.toolCallId)).toEqual([
      'tool-a',
      'tool-b',
    ]);

    // Something moved the covered transcript while the view was open.
    t.scroller.scrollTop = 0;
    view?.back.emit();
    fixture.detectChanges();

    expect(t.view()).toBeNull();
    expect(t.scroller.hasAttribute('inert')).toBe(false);
    expect(t.scroller.scrollTop).toBe(300);
    expect(document.activeElement).toBe(draft);
    expect(draft.value).toBe('half-written prompt');
    // The transcript itself was never torn down.
    expect(transcriptOf(fixture).component).toBe(t.component);
  });

  it('a pinned transcript returns to the bottom on Back', () => {
    configure();
    const fixture = mountHost(SingleChatHost);
    const t = transcriptOf(fixture);
    Object.defineProperty(t.scroller, 'scrollHeight', { value: 1000 });
    Object.defineProperty(t.scroller, 'clientHeight', { value: 200 });

    t.descendantActions()?.openLane('sub:agent-1');
    fixture.detectChanges();
    t.scroller.scrollTop = 0;
    t.view()?.back.emit();
    fixture.detectChanges();

    expect(t.scroller.scrollTop).toBe(1000);
  });

  it('keeps the transcript and announces when a lane cannot be opened here', () => {
    configure();
    const fixture = mountHost(SingleChatHost);
    const t = transcriptOf(fixture);

    t.descendantActions()?.openLane('sub:not-in-this-tab');
    t.descendantActions()?.openLane('cli:agent-1');
    fixture.detectChanges();

    expect(t.view()).toBeNull();
    expect(t.scroller.hasAttribute('inert')).toBe(false);
    expect(t.notice()).toBe(
      'This agent is not available in this conversation.',
    );
  });

  it('an agent gone from the open conversation closes the view, restores the transcript and announces', () => {
    configure();
    const fixture = mountHost(SingleChatHost);
    const t = transcriptOf(fixture);
    t.descendantActions()?.openLane('bg:agent-1');
    fixture.detectChanges();
    expect(t.view()?.node().id).toBe('agent-node-1');
    expect(t.scroller.hasAttribute('inert')).toBe(true);

    messagesSig.set([makeMessage('u1', 'user', 1)]);
    fixture.detectChanges();

    expect(t.view()).toBeNull();
    expect(t.scroller.hasAttribute('inert')).toBe(false);
    expect(t.notice()).toBe(
      'This agent is no longer available in this conversation.',
    );
    // Closed for good: the agent coming back does not reopen the view.
    messagesSig.set([
      makeMessage('u1', 'user', 1),
      makeMessage('m1', 'assistant', 2, agentTree([toolNode('tool-a')])),
    ]);
    fixture.detectChanges();
    expect(t.view()).toBeNull();
  });

  it('a session switch while open closes the view without a stale restore', () => {
    configure();
    const fixture = mountHost(SingleChatHost);
    const t = transcriptOf(fixture);
    t.descendantActions()?.openLane('sub:agent-1');
    fixture.detectChanges();
    expect(t.view()).not.toBeNull();

    // The tab now holds another session; even a tree that still carries the
    // same tool call id belongs to it, not to the agent that was open.
    sessionSig.set('session-other');
    fixture.detectChanges();

    expect(t.view()).toBeNull();
    expect(t.scroller.hasAttribute('inert')).toBe(false);
    expect(t.notice()).toBe('');
  });

  it('a conversation that receives its first session id keeps the view open', () => {
    configure();
    sessionSig.set(null);
    const fixture = mountHost(SingleChatHost);
    const t = transcriptOf(fixture);
    t.descendantActions()?.openLane('sub:agent-1');
    fixture.detectChanges();

    sessionSig.set('session-1');
    fixture.detectChanges();
    expect(t.view()?.node().id).toBe('agent-node-1');

    // From then on, a change is a switch.
    sessionSig.set('session-other');
    fixture.detectChanges();
    expect(t.view()).toBeNull();
  });

  it('a tab switch while open closes the view and leaves the transcript usable', () => {
    configure();
    const fixture = mountHost(SwitchingHost);
    const t = transcriptOf(fixture);
    t.descendantActions()?.openLane('sub:agent-1');
    fixture.detectChanges();
    expect(t.view()).not.toBeNull();

    fixture.componentInstance.tabId.set('tab-2');
    fixture.detectChanges();

    expect(t.view()).toBeNull();
    expect(t.scroller.hasAttribute('inert')).toBe(false);
    // Back on the first tab, the agent is not reopened.
    fixture.componentInstance.tabId.set('tab-1');
    fixture.detectChanges();
    expect(t.view()).toBeNull();
  });

  it('a hidden transcript keeps the frozen view and re-checks on reactivation', () => {
    configure();
    const fixture = mountHost(SwitchingHost);
    const t = transcriptOf(fixture);
    t.descendantActions()?.openLane('sub:agent-1');
    fixture.detectChanges();

    fixture.componentInstance.active.set(false);
    fixture.detectChanges();
    messagesSig.set([makeMessage('u1', 'user', 1)]);
    fixture.detectChanges();
    expect(t.view()?.node().id).toBe('agent-node-1');

    fixture.componentInstance.active.set(true);
    fixture.detectChanges();
    expect(t.view()).toBeNull();
    expect(t.scroller.hasAttribute('inert')).toBe(false);
    expect(t.notice()).toBe(
      'This agent is no longer available in this conversation.',
    );
  });

  it('main-panel compact card stays tolerant: the handler is scoped to the transcript', () => {
    configure();
    const fixture = mountHost(SingleChatHost);
    const probe = fixture.debugElement.query(By.directive(CompactCardProbe))
      .componentInstance as CompactCardProbe;

    expect(probe.cardActions).toBeNull();
    expect(probe.sessionContext).toBeNull();
    expect(probe.strict).toBe(false);
    // ...while the transcript's own descendants get the local handler.
    expect(transcriptOf(fixture).descendantActions()).not.toBeNull();
  });

  it('parent provider wins: a Rail host receives the lane and no in-place view opens', () => {
    configure({ realTiles: true });
    const fixture = mountHost(RailHost);
    const t = transcriptOf(fixture);

    expect(t.descendantActions()).toBe(railActions);
    const open: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-testid="subagent-open"]',
    );
    open.click();
    fixture.detectChanges();

    expect(railActions.openLane).toHaveBeenCalledWith('sub:agent-1');
    expect(t.view()).toBeNull();
  });

  it('a pending descendant permission in tile mode is answerable: the badge opens the full agent (R9g finding 3)', () => {
    configure({ realTiles: true });
    messagesSig.set([
      makeMessage('u1', 'user', 1),
      makeMessage('m1', 'assistant', 2, agentTree([toolNode('tool-p')])),
    ]);
    PENDING_PERMISSIONS.set('tool-p', {
      id: 'perm-1',
      toolUseId: 'tool-p',
    } as unknown as PermissionRequest);
    const fixture = mountHost(SingleChatTileHost);
    const t = transcriptOf(fixture);

    const badge: HTMLButtonElement = fixture.nativeElement.querySelector(
      '[data-testid="subagent-permission"]',
    );
    expect(badge).not.toBeNull();
    expect(badge.disabled).toBe(false);
    badge.focus();
    badge.click();
    fixture.detectChanges();

    // The full view holds the tool that waits for approval; its card and
    // answer path are covered in single-chat-subagent-view.component.spec.
    const node = t.view()?.node();
    expect(node?.toolCallId).toBe('agent-1');
    expect(node?.children.map((child) => child.toolCallId)).toEqual(['tool-p']);

    t.view()?.back.emit();
    fixture.detectChanges();
    expect(document.activeElement).toBe(badge);
  });
});
