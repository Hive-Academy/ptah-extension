/** @jest-environment jsdom */
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConsoleClipComponent, EDGE_TOLERANCE_PX, insideViewport } from './console-clip.component';

const callbacks: IntersectionObserverCallback[] = [];
const disconnect = jest.fn();

class ObserverStub {
  public constructor(callback: IntersectionObserverCallback) {
    callbacks.push(callback);
  }
  public observe(): void {
    return undefined;
  }
  public disconnect(): void {
    disconnect();
  }
}

function installEnv(reducedMotion: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: jest.fn((query: string) => ({ matches: reducedMotion && query.includes('reduce') })),
  });
  Object.defineProperty(window, 'IntersectionObserver', { configurable: true, value: ObserverStub });
}

function mount(platform: 'server' | 'browser') {
  TestBed.configureTestingModule({
    imports: [ConsoleClipComponent],
    providers: [{ provide: PLATFORM_ID, useValue: platform }],
  });
  const fixture = TestBed.createComponent(ConsoleClipComponent);
  fixture.componentRef.setInput('video', '/clip.mp4');
  fixture.componentRef.setInput('videoWebm', '/clip.webm');
  fixture.componentRef.setInput('poster', '/clip.jpg');
  fixture.componentRef.setInput('label', 'Demo clip');
  fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, root: fixture.nativeElement as HTMLElement };
}

/** The clip's box: 300 px tall, well inside the 1024 px wide jsdom viewport. */
const CLIP_HEIGHT = 300;
let clipTop = 2000;

function box(): DOMRect {
  return {
    top: clipTop,
    bottom: clipTop + CLIP_HEIGHT,
    left: 100,
    right: 700,
    width: 600,
    height: CLIP_HEIGHT,
    x: 100,
    y: clipTop,
    toJSON: () => ({}),
  } as DOMRect;
}

/** Moves the clip and lets the visibility observer (callbacks[1]) report it. */
function place(top: number): void {
  clipTop = top;
  const onScreen = top < window.innerHeight && top + CLIP_HEIGHT > 0;
  callbacks[1]?.([{ isIntersecting: onScreen } as IntersectionObserverEntry], {} as IntersectionObserver);
}

/** Moves the clip by scrolling only: no observer event, just the scroll check. */
function scrollClipTo(top: number): void {
  clipTop = top;
  window.dispatchEvent(new Event('scroll'));
}

/** Nearness observer (callbacks[0]). */
function near(): void {
  callbacks[0]?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver);
}

describe('ConsoleClipComponent', () => {
  let play: jest.SpyInstance;

  beforeEach(() => {
    callbacks.length = 0;
    clipTop = 2000;
    play = jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
    jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(box);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('server render: poster, lazy preload and native controls', () => {
    const { root, fixture } = mount('server');
    const video = root.querySelector('video');
    expect(video?.getAttribute('poster')).toBe('/clip.jpg');
    expect(video?.getAttribute('preload')).toBe('none');
    expect(video?.hasAttribute('controls')).toBe(true);
    expect(root.querySelector('button')?.hidden).toBe(true);
    fixture.destroy();
  });

  it('keeps controls and never autoplays under reduced motion', () => {
    installEnv(true);
    const { component, root, fixture } = mount('browser');
    fixture.detectChanges();

    expect(component.autoplay()).toBe(false);
    expect(callbacks).toHaveLength(1);
    expect(root.querySelector('video')?.hasAttribute('controls')).toBe(true);
    fixture.destroy();
  });

  it('loads the poster when near and plays only once the box is inside the viewport', () => {
    installEnv(false);
    const { root, fixture } = mount('browser');
    fixture.detectChanges();

    expect(root.querySelector('video')?.hasAttribute('poster')).toBe(false);
    near();
    fixture.detectChanges();
    expect(root.querySelector('video')?.getAttribute('poster')).toBe('/clip.jpg');

    expect(root.querySelector('button')?.hidden).toBe(false);
    place(-120);
    place(-(EDGE_TOLERANCE_PX + 1));
    expect(play).not.toHaveBeenCalled();
    // One pixel past the top edge is rounding, not a departure: it plays.
    place(-1);
    expect(play).toHaveBeenCalledTimes(1);

    fixture.destroy();
    expect(disconnect).toHaveBeenCalled();
  });

  describe('play and pause boundaries', () => {
    let paused: boolean;
    let pause: jest.SpyInstance;

    beforeEach(() => {
      paused = true;
      jest.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(() => paused);
      pause = jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {
        paused = true;
      });
      play.mockImplementation(() => {
        paused = false;
        return Promise.resolve();
      });
      installEnv(false);
    });

    it('plays 1 px inside either edge and pauses on the first scroll beyond the tolerance', async () => {
      const { fixture } = mount('browser');
      fixture.detectChanges();
      // Bottom edge 1 px inside the viewport.
      place(window.innerHeight - CLIP_HEIGHT - 1);
      await Promise.resolve();
      expect(play).toHaveBeenCalledTimes(1);

      // Still inside the tolerance at the bottom: keeps playing.
      scrollClipTo(window.innerHeight - CLIP_HEIGHT + EDGE_TOLERANCE_PX);
      expect(pause).not.toHaveBeenCalled();

      // One more pixel: a real departure, caught by the scroll check with no observer event.
      scrollClipTo(window.innerHeight - CLIP_HEIGHT + EDGE_TOLERANCE_PX + 1);
      expect(pause).toHaveBeenCalledTimes(1);

      // Back inside (1 px below the top edge): plays again.
      scrollClipTo(1);
      expect(play).toHaveBeenCalledTimes(2);
      fixture.destroy();
    });

    it('pauses a play that settles after the clip left the view', async () => {
      let settle!: () => void;
      play.mockImplementation(() => new Promise<void>((resolve) => (settle = resolve)));
      const { fixture } = mount('browser');
      fixture.detectChanges();

      place(100);
      expect(play).toHaveBeenCalledTimes(1);
      // The clip leaves while play() is still pending (the element still reads as paused).
      scrollClipTo(-200);
      expect(pause).not.toHaveBeenCalled();
      settle();
      await Promise.resolve();
      await Promise.resolve();
      expect(pause).toHaveBeenCalledTimes(1);
      fixture.destroy();
    });

    it('pauses on destroy, drops the scroll check and ignores a play that settles afterwards', async () => {
      let settle!: () => void;
      play.mockImplementation(() => new Promise<void>((resolve) => (settle = resolve)));
      const removed = jest.spyOn(window, 'removeEventListener');
      const { fixture } = mount('browser');
      fixture.detectChanges();
      place(100);

      fixture.destroy();
      expect(pause).toHaveBeenCalledTimes(1);
      expect(removed).toHaveBeenCalledWith('scroll', expect.any(Function));
      expect(removed).toHaveBeenCalledWith('resize', expect.any(Function));
      paused = false; // the late play would start playback
      settle();
      await Promise.resolve();
      await Promise.resolve();
      expect(pause).toHaveBeenCalledTimes(2);
      expect(paused).toBe(true);
    });
  });
});

describe('insideViewport', () => {
  const rect = (top: number, left: number, width: number, height: number): DOMRectReadOnly =>
    ({ top, left, width, height, bottom: top + height, right: left + width }) as DOMRectReadOnly;

  it('accepts a clip that bleeds off the right page edge while vertically inside', () => {
    expect(insideViewport(rect(100, 400, 1200, 600), 1440, 900)).toBe(true);
  });

  it('rejects a clip that is vertically cut beyond the tolerance', () => {
    expect(insideViewport(rect(-EDGE_TOLERANCE_PX - 1, 0, 600, 600), 1440, 900)).toBe(false);
    expect(insideViewport(rect(301 + EDGE_TOLERANCE_PX, 0, 600, 600), 1440, 900)).toBe(false);
  });

  it('rejects a clip that is fully off screen horizontally', () => {
    expect(insideViewport(rect(100, 1440, 600, 600), 1440, 900)).toBe(false);
  });
});
