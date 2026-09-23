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
  let callbacks: (() => void)[];
  let disconnects: jest.Mock[];

  beforeEach(() => {
    callbacks = [];
    disconnects = [];
    globalThis.ResizeObserver = class {
      observe = jest.fn();
      unobserve = jest.fn();
      disconnect = jest.fn();
      constructor(callback: ResizeObserverCallback) {
        callbacks.push(() => callback([], this));
        disconnects.push(this.disconnect);
      }
    };
    TestBed.configureTestingModule({ imports: [ScrollHost] });
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    globalThis.ResizeObserver = original;
  });

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
    for (const lane of lanes)
      Object.defineProperty(lane, 'scrollHeight', { value: 1200 });
    callbacks.forEach((callback) => callback());
    expect(lanes[0].scrollTop).toBe(100);
    expect(lanes[1].scrollTop).toBe(1200);
    lanes[0].scrollTop = 1000;
    lanes[0].dispatchEvent(new Event('scroll'));
    callbacks[0]();
    expect(lanes[0].scrollTop).toBe(1200);
    fixture.destroy();
    expect(
      disconnects.every((disconnect) => disconnect.mock.calls.length === 1),
    ).toBe(true);
  });
});
