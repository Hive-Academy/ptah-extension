import { ChangeDetectionStrategy, Component, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MotionStageDirective } from './motion-stage.directive';

@Component({
  standalone: true,
  imports: [MotionStageDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div ptahMotionStage [motionIndex]="index()" [motionReplayKey]="key()">
    <div class="ptah-motion-panel"><span class="child">content</span></div>
  </div>`,
})
class StageHost {
  readonly index = signal<number | null>(null);
  readonly key = signal(0);
  readonly stage = viewChild.required(MotionStageDirective);
}

function animationEvent(type: string, name: string, bubbles = false): Event {
  const event = new Event(type, { bubbles });
  Object.defineProperty(event, 'animationName', { value: name });
  return event;
}

describe('MotionStageDirective', () => {
  let fixture: ComponentFixture<StageHost>;
  let host: StageHost;
  let stageElement: HTMLElement;
  let panel: HTMLElement;
  let requestFrame: jest.SpyInstance;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [StageHost] });
    fixture = TestBed.createComponent(StageHost);
    host = fixture.componentInstance;
    fixture.detectChanges();
    stageElement = fixture.nativeElement.querySelector('[ptahMotionStage]');
    panel = stageElement.querySelector('.ptah-motion-panel') as HTMLElement;
    requestFrame = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
  });

  afterEach(() => {
    fixture.destroy();
    requestFrame.mockRestore();
    document.documentElement.classList.remove('ptah-vt-active');
  });

  it('skips a child entrance during a surface crossfade and replays an in-surface change', async () => {
    document.documentElement.classList.add('ptah-vt-active');
    host.key.set(1);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(panel.classList.contains('ptah-motion-enter')).toBe(false);

    document.documentElement.classList.remove('ptah-vt-active');
    host.key.set(2);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(panel.classList.contains('ptah-motion-enter')).toBe(true);
  });

  it('skips a queued replay if the surface crossfade starts before render', async () => {
    host.stage().replay();
    document.documentElement.classList.add('ptah-vt-active');
    fixture.detectChanges();
    await fixture.whenStable();
    expect(panel.classList.contains('ptah-motion-enter')).toBe(false);
  });

  it('derives direction from bound indices and preserves it for null and equal indices', () => {
    expect(stageElement.dataset['motionDir']).toBe('forward');
    host.index.set(2);
    fixture.detectChanges();
    host.index.set(1);
    fixture.detectChanges();
    expect(stageElement.dataset['motionDir']).toBe('back');
    host.index.set(null);
    fixture.detectChanges();
    expect(stageElement.dataset['motionDir']).toBe('back');
  });

  it('supports imperative direction and state restoration', () => {
    const stage = host.stage();
    stage.setIndex(3);
    const saved = stage.captureState();
    stage.setIndex(1);
    expect(stageElement.dataset['motionDir']).toBe('back');
    stage.restoreState(saved);
    expect(stageElement.dataset['motionDir']).toBe('forward');
    expect(stage.captureState()).toEqual(saved);
  });

  it('filters bubbling child events and unrelated animation names', async () => {
    host.stage().replay();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(panel.classList.contains('ptah-motion-enter')).toBe(true);
    const child = panel.querySelector('.child') as HTMLElement;
    child.dispatchEvent(animationEvent('animationend', 'ptahMotionEnter', true));
    panel.dispatchEvent(animationEvent('animationend', 'other'));
    expect(panel.classList.contains('ptah-motion-enter')).toBe(true);
    panel.dispatchEvent(animationEvent('animationend', 'ptahMotionEnter'));
    expect(panel.classList.contains('ptah-motion-enter')).toBe(false);
  });

  it('cleans a cancelled replay and a no-animation replay', async () => {
    host.key.set(1);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(panel.classList.contains('ptah-motion-enter')).toBe(true);
    panel.dispatchEvent(animationEvent('animationcancel', 'ptahMotionEnter'));
    expect(panel.classList.contains('ptah-motion-enter')).toBe(false);

    let callback: FrameRequestCallback | undefined;
    requestFrame.mockImplementation((next: FrameRequestCallback) => { callback = next; return 2; });
    host.stage().replay();
    fixture.detectChanges();
    await fixture.whenStable();
    callback?.(0);
    expect(panel.classList.contains('ptah-motion-enter')).toBe(false);
  });

  it('keeps only the latest replay and clears it on destroy', async () => {
    host.stage().replay();
    host.stage().replay();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(panel.classList.contains('ptah-motion-enter')).toBe(true);
    fixture.destroy();
    expect(panel.classList.contains('ptah-motion-enter')).toBe(false);
  });
});
