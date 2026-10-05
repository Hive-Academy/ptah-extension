import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AgentLaneScrollDirective } from './agent-lane-scroll.directive';

@Component({
  standalone: true,
  imports: [AgentLaneScrollDirective],
  template:
    '<div ptahAgentLaneScroll><div>First</div></div><div ptahAgentLaneScroll><div>Second</div></div>',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class ScrollHost {}

describe('independent lane scrolling', () => {
  const original = globalThis.ResizeObserver;
  const originalRaf = globalThis.requestAnimationFrame;
  const originalCancelRaf = globalThis.cancelAnimationFrame;
  let callbacks: (() => void)[];
  let disconnects: jest.Mock[];
  let scheduledFrames: Map<number, FrameRequestCallback>;
  let nextHandle: number;

  beforeEach(() => {
    callbacks = [];
    disconnects = [];
    scheduledFrames = new Map();
    nextHandle = 1;
    globalThis.ResizeObserver = class {
      observe = jest.fn();
      unobserve = jest.fn();
      disconnect = jest.fn();
      constructor(callback: ResizeObserverCallback) {
        callbacks.push(() => callback([], this));
        disconnects.push(this.disconnect);
      }
    };
    globalThis.requestAnimationFrame = (cb: FrameRequestCallback): number => {
      const handle = nextHandle++;
      scheduledFrames.set(handle, cb);
      return handle;
    };
    globalThis.cancelAnimationFrame = (handle: number): void => {
      scheduledFrames.delete(handle);
    };
    TestBed.configureTestingModule({ imports: [ScrollHost] });
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    globalThis.ResizeObserver = original;
    globalThis.requestAnimationFrame = originalRaf;
    globalThis.cancelAnimationFrame = originalCancelRaf;
  });

  /** Run the coalesced pin measurement for the frames scheduled so far. */
  function flushFrames(): void {
    const pending = [...scheduledFrames.values()];
    scheduledFrames.clear();
    for (const callback of pending) callback(0);
  }

  it('follows each lane independently and resumes after the reader returns to its bottom', () => {
    const fixture = TestBed.createComponent(ScrollHost);
    fixture.detectChanges();
    const lanes: NodeListOf<HTMLElement> =
      fixture.nativeElement.querySelectorAll('[ptahAgentLaneScroll]');
    for (const lane of lanes) {
      Object.defineProperty(lane, 'scrollHeight', {
        value: 1000,
        configurable: true,
      });
      Object.defineProperty(lane, 'clientHeight', { value: 200 });
    }
    callbacks.forEach((callback) => callback());
    expect(lanes[0].scrollTop).toBe(1000);
    expect(lanes[1].scrollTop).toBe(1000);
    lanes[0].scrollTop = 100;
    lanes[0].dispatchEvent(new Event('scroll'));
    // The pin state updates in the next animation frame, not synchronously
    // in the scroll handler (a synchronous read forces a full layout).
    flushFrames();
    for (const lane of lanes)
      Object.defineProperty(lane, 'scrollHeight', { value: 1200 });
    callbacks.forEach((callback) => callback());
    expect(lanes[0].scrollTop).toBe(100);
    expect(lanes[1].scrollTop).toBe(1200);
    lanes[0].scrollTop = 1000;
    lanes[0].dispatchEvent(new Event('scroll'));
    flushFrames();
    callbacks[0]();
    expect(lanes[0].scrollTop).toBe(1200);
    fixture.destroy();
    expect(
      disconnects.every((disconnect) => disconnect.mock.calls.length === 1),
    ).toBe(true);
  });

  it('coalesces a burst of scroll events into one measurement per frame', () => {
    const fixture = TestBed.createComponent(ScrollHost);
    fixture.detectChanges();
    const lane = fixture.nativeElement.querySelector(
      '[ptahAgentLaneScroll]',
    ) as HTMLElement;
    Object.defineProperty(lane, 'scrollHeight', {
      value: 1000,
      configurable: true,
    });
    Object.defineProperty(lane, 'clientHeight', { value: 200 });

    lane.scrollTop = 100;
    lane.dispatchEvent(new Event('scroll'));
    lane.dispatchEvent(new Event('scroll'));
    lane.dispatchEvent(new Event('scroll'));
    expect(scheduledFrames.size).toBe(1);
    flushFrames();
    // 700px above the bottom: unpinned, so content growth does not follow.
    callbacks[0]();
    expect(lane.scrollTop).toBe(100);
  });

  it('cancels a pending measurement when the lane is destroyed', () => {
    const fixture = TestBed.createComponent(ScrollHost);
    fixture.detectChanges();
    const lane = fixture.nativeElement.querySelector(
      '[ptahAgentLaneScroll]',
    ) as HTMLElement;

    lane.scrollTop = 100;
    lane.dispatchEvent(new Event('scroll'));
    expect(scheduledFrames.size).toBe(1);

    fixture.destroy();
    expect(scheduledFrames.size).toBe(0);
    expect(
      disconnects.every((disconnect) => disconnect.mock.calls.length === 1),
    ).toBe(true);
  });
});
