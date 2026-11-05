/** @jest-environment jsdom */
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConsoleClipComponent, FULL_VIEW_RATIO } from './console-clip.component';

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

/** callbacks[0] watches nearness, callbacks[1] watches visibility. */
function report(index: number, ratio: number): void {
  callbacks[index]?.(
    [{ isIntersecting: ratio > 0, intersectionRatio: ratio } as IntersectionObserverEntry],
    {} as IntersectionObserver,
  );
}

describe('ConsoleClipComponent', () => {
  let play: jest.SpyInstance;

  beforeEach(() => {
    callbacks.length = 0;
    play = jest.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
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

  it('loads the poster when near and plays only once fully in view', () => {
    installEnv(false);
    const { root, fixture } = mount('browser');
    fixture.detectChanges();

    expect(root.querySelector('video')?.hasAttribute('poster')).toBe(false);
    report(0, 0.01);
    fixture.detectChanges();
    expect(root.querySelector('video')?.getAttribute('poster')).toBe('/clip.jpg');

    expect(root.querySelector('button')?.hidden).toBe(false);
    report(1, 0.6);
    report(1, 0.95);
    expect(play).not.toHaveBeenCalled();
    report(1, FULL_VIEW_RATIO);
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

    it('pauses at the first departure below full view', async () => {
      const { fixture } = mount('browser');
      fixture.detectChanges();
      report(1, 1);
      await Promise.resolve();
      expect(play).toHaveBeenCalledTimes(1);
      expect(pause).not.toHaveBeenCalled();

      report(1, 0.97);
      expect(pause).toHaveBeenCalledTimes(1);
      report(1, 1);
      expect(play).toHaveBeenCalledTimes(2);
      fixture.destroy();
    });

    it('pauses a play that settles after the clip left the view', async () => {
      let settle!: () => void;
      play.mockImplementation(() => new Promise<void>((resolve) => (settle = resolve)));
      const { fixture } = mount('browser');
      fixture.detectChanges();

      report(1, 1);
      expect(play).toHaveBeenCalledTimes(1);
      // The clip leaves while play() is still pending (the element still reads as paused).
      report(1, 0.4);
      expect(pause).not.toHaveBeenCalled();
      settle();
      await Promise.resolve();
      await Promise.resolve();
      expect(pause).toHaveBeenCalledTimes(1);
      fixture.destroy();
    });

    it('pauses on destroy and ignores a play that settles afterwards', async () => {
      let settle!: () => void;
      play.mockImplementation(() => new Promise<void>((resolve) => (settle = resolve)));
      const { fixture } = mount('browser');
      fixture.detectChanges();
      report(1, 1);

      fixture.destroy();
      expect(pause).toHaveBeenCalledTimes(1);
      paused = false; // the late play would start playback
      settle();
      await Promise.resolve();
      await Promise.resolve();
      expect(pause).toHaveBeenCalledTimes(2);
      expect(paused).toBe(true);
    });
  });
});
