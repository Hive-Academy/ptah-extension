import {
  ChangeDetectionStrategy,
  Component,
  Input,
  NgModule,
  signal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChatTranscriptComponent } from './chat-transcript.component';
import {
  configureTranscriptTestBed,
  installFakeIntersectionObserver,
  removeFakeIntersectionObserver,
} from './testing/transcript-spec-harness';

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

/** Records what is observed and lets the test fire resize entries. */
class CapturingResizeObserver {
  static instances: CapturingResizeObserver[] = [];
  readonly observed: Element[] = [];
  constructor(readonly callback: ResizeObserverCallback) {
    CapturingResizeObserver.instances.push(this);
  }
  observe(element: Element): void {
    this.observed.push(element);
  }
  unobserve(): void {
    /* not needed */
  }
  disconnect(): void {
    this.observed.length = 0;
  }
  resize(target: Element, height: number): void {
    this.callback(
      [{ target, contentRect: { height } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

const globalWithObserver = globalThis as unknown as {
  ResizeObserver?: unknown;
};

/**
 * Frames are queued, not run inline: Angular's zoneless scheduler also uses
 * requestAnimationFrame, and running it synchronously re-enters scheduling.
 */
let frames: FrameRequestCallback[] = [];
function flushFrames(): void {
  const pending = frames;
  frames = [];
  for (const cb of pending) cb(0);
}

describe('ChatTranscriptComponent viewport follow', () => {
  beforeEach(() => {
    frames = [];
    CapturingResizeObserver.instances = [];
    globalWithObserver.ResizeObserver = CapturingResizeObserver;
    installFakeIntersectionObserver();
    jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => {
        frames.push(cb);
        return frames.length;
      });
  });

  afterEach(() => {
    delete globalWithObserver.ResizeObserver;
    removeFakeIntersectionObserver();
    jest.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  async function mount() {
    configureTranscriptTestBed({
      tabs: signal([
        { id: 'tab-1', status: 'loaded', messages: [], streamingState: null },
      ]),
      buildTree: () => [],
      iconUri: 'data:image/svg+xml;base64,PHN2Zy8+',
    });
    const fixture = TestBed.createComponent(ChatTranscriptComponent);
    fixture.componentRef.setInput('tabId', 'tab-1');
    fixture.componentRef.setInput('active', true);
    fixture.detectChanges();
    await fixture.whenStable();

    const viewport = fixture.nativeElement.querySelector(
      '.chat-scroll-container',
    ) as HTMLElement;
    const scroll = { top: 600 };
    Object.defineProperty(viewport, 'scrollHeight', {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(viewport, 'clientHeight', {
      configurable: true,
      value: 300,
    });
    Object.defineProperty(viewport, 'scrollTop', {
      configurable: true,
      get: () => scroll.top,
      set: (value: number) => {
        scroll.top = value;
      },
    });
    const observer = CapturingResizeObserver.instances.at(-1);
    if (!observer) throw new Error('No ResizeObserver was created');
    /** Move the scroll offset the way the user would, firing `scroll`. */
    const userScrollTo = (top: number): void => {
      scroll.top = top;
      viewport.dispatchEvent(new Event('scroll'));
    };
    return { fixture, viewport, scroll, observer, userScrollTo };
  }

  it('re-sticks a pinned transcript when its viewport shrinks (composer expanding)', async () => {
    const { viewport, scroll, observer } = await mount();
    expect(observer.observed).toContain(viewport);

    observer.resize(viewport, 300);
    flushFrames();
    expect(scroll.top).toBe(1000);
  });

  it('leaves an unpinned transcript where the user scrolled it', async () => {
    const { viewport, scroll, observer, userScrollTo } = await mount();
    userScrollTo(600);
    userScrollTo(100);

    observer.resize(viewport, 260);
    flushFrames();
    expect(scroll.top).toBe(100);
  });

  it('defers to a pending scroll restore instead of sticking on resize', async () => {
    const { fixture, viewport, scroll, observer } = await mount();
    // A restore is pending between activation and the next render; the
    // component tracks it in this private ref. Simulate that window.
    const internals = fixture.componentInstance as unknown as {
      scrollRestoreRef: { destroy(): void } | null;
    };
    internals.scrollRestoreRef = { destroy: jest.fn() };
    const raf = window.requestAnimationFrame as jest.Mock;
    raf.mockClear();

    observer.resize(viewport, 260);
    expect(raf).not.toHaveBeenCalled();
    flushFrames();
    expect(scroll.top).toBe(600);
    internals.scrollRestoreRef = null;
  });

  it('disconnects the viewport observer on deactivation and ignores it after', async () => {
    const { fixture, viewport, scroll, observer } = await mount();
    const disconnect = jest.spyOn(observer, 'disconnect');

    fixture.componentRef.setInput('active', false);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(disconnect).toHaveBeenCalled();

    observer.resize(viewport, 200);
    flushFrames();
    expect(scroll.top).toBe(600);
  });

  it('disconnects the observer when the transcript is destroyed', async () => {
    const { fixture, observer } = await mount();
    const disconnect = jest.spyOn(observer, 'disconnect');
    fixture.destroy();
    expect(disconnect).toHaveBeenCalled();
  });
});
