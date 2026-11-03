import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  ActivationEnd,
  GuardsCheckEnd,
  provideRouter,
  Router,
  RouterOutlet,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { detailParamKey, type MotionRouteKeyFn } from './motion-route-keys';
import { MotionRouteStageDirective } from './motion-route-stage.directive';
import { MotionStageDirective } from './motion-stage.directive';

@Component({ standalone: true, template: 'list', host: { class: 'ptah-motion-panel' } })
class ListPanel {}

@Component({ standalone: true, template: 'detail', host: { class: 'ptah-motion-panel' } })
class DetailPanel {}

@Component({ standalone: true, template: 'other', host: { class: 'ptah-motion-panel' } })
class OtherPanel {}

@Component({
  standalone: true,
  imports: [RouterOutlet, MotionRouteStageDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div ptahMotionRouteStage [motionRouteKey]="key" [motionLeaveClone]="clone()">
    <router-outlet />
  </div>`,
})
class RouteHost {
  private readonly route = inject(ActivatedRoute);
  private readonly detailKey = detailParamKey(this.route, 'id');
  readonly key: MotionRouteKeyFn = (target) => {
    const detail = this.detailKey(target);
    if (!detail) return null;
    return { ...detail, index: detail.key === '' ? 0 : detail.key === 'a' ? 1 : 2 };
  };
  readonly clone = signal(false);
}

function animationEvent(type: string, name: string, bubbles = false): Event {
  const event = new Event(type, { bubbles });
  Object.defineProperty(event, 'animationName', { value: name });
  return event;
}

describe('MotionRouteStageDirective', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([{
        path: 'x',
        component: RouteHost,
        children: [
          { path: '', pathMatch: 'full', component: ListPanel },
          { path: 'blocked', component: OtherPanel, canActivate: [() => false] },
          { path: 'redirect', component: OtherPanel, canActivate: [() => TestBed.inject(Router).parseUrl('/x/a')] },
          { path: ':id', component: DetailPanel },
        ],
      }, { path: 'other', component: OtherPanel }])],
    });
  });

  it('uses target snapshots before activation and replays only reused detail hosts', async () => {
    const router = TestBed.inject(Router);
    const replay = jest.spyOn(MotionStageDirective.prototype, 'replay');
    const seen: Array<{ key: string; direction: string | undefined }> = [];
    const activationDirections: string[] = [];
    let stage: HTMLElement | null = null;
    router.events.subscribe((event) => {
      if (event instanceof GuardsCheckEnd && event.shouldActivate) {
        const route = event.state.root.firstChild;
        seen.push({
          key: route?.firstChild?.paramMap.get('id') ?? '',
          direction: stage?.dataset['motionDir'],
        });
      }
      if (event instanceof ActivationEnd && stage) activationDirections.push(stage.dataset['motionDir'] ?? '');
    });
    try {
      const harness = await RouterTestingHarness.create();
      await harness.navigateByUrl('/x');
      stage = harness.routeNativeElement?.querySelector('[ptahMotionRouteStage]') ?? null;
      expect(stage).not.toBeNull();

      await harness.navigateByUrl('/x/a');
      const detailPanel = stage?.querySelector('.ptah-motion-panel');
      expect(detailPanel).not.toBeNull();
      expect(replay).not.toHaveBeenCalled();

      await harness.navigateByUrl('/x/b');
      expect(stage?.querySelector('.ptah-motion-panel')).toBe(detailPanel);
      expect(replay).toHaveBeenCalledTimes(1);
      expect(seen.map((entry) => entry.key)).toEqual(['', 'a', 'b']);

      await harness.navigateByUrl('/x');
      expect(replay).toHaveBeenCalledTimes(1);
      expect(seen.at(-1)?.key).toBe('');
      expect(stage?.dataset['motionDir']).toBe('back');
      expect(activationDirections).toContain('back');
    } finally {
      replay.mockRestore();
    }
  });

  it('replaces an unfinished leave clone and filters child animation events', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/x');
    const stage = harness.routeNativeElement?.querySelector('[ptahMotionRouteStage]') as HTMLElement;
    const routeHost = harness.routeDebugElement?.componentInstance;
    if (!(routeHost instanceof RouteHost)) throw new Error('The route host did not activate');
    routeHost.clone.set(true);
    harness.detectChanges();
    const requestFrame = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    try {
      await harness.navigateByUrl('/x/a');
      const firstClone = stage.querySelector('[data-motion-clone]') as HTMLElement;
      expect(firstClone.dataset['motionClone']).toBe('running');
      expect(firstClone.getAttribute('aria-hidden')).toBe('true');
      expect(firstClone.hasAttribute('inert')).toBe(true);

      await harness.navigateByUrl('/x/a?query=1');
      expect(stage.querySelector('[data-motion-clone]')).toBe(firstClone);

      await harness.navigateByUrl('/x');
      const clones = stage.querySelectorAll('[data-motion-clone]');
      expect(clones).toHaveLength(1);
      expect(firstClone.isConnected).toBe(false);
      const clone = clones[0] as HTMLElement;
      clone.appendChild(document.createElement('span'));
      clone.lastElementChild?.dispatchEvent(animationEvent('animationend', 'ptahMotionLeave', true));
      expect(clone.isConnected).toBe(true);
      clone.dispatchEvent(animationEvent('animationend', 'other'));
      expect(clone.isConnected).toBe(true);
      clone.dispatchEvent(animationEvent('animationend', 'ptahMotionLeave'));
      expect(stage.querySelector('[data-motion-clone]')).toBeNull();
    } finally {
      requestFrame.mockRestore();
    }
  });

  it('ignores a rejected guard and disposes a clone when no animation runs', async () => {
    const router = TestBed.inject(Router);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/x');
    const stage = harness.routeNativeElement?.querySelector('[ptahMotionRouteStage]') as HTMLElement;
    const routeHost = harness.routeDebugElement?.componentInstance;
    if (!(routeHost instanceof RouteHost)) throw new Error('The route host did not activate');
    routeHost.clone.set(true);
    harness.detectChanges();
    const frames: FrameRequestCallback[] = [];
    const requestFrame = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    try {
      await harness.navigateByUrl('/x/a');
      expect(stage.querySelector('[data-motion-clone]')).not.toBeNull();
      frames.at(-1)?.(0);
      expect(stage.querySelector('[data-motion-clone]')).toBeNull();

      const prior = stage.dataset['motionDir'];
      expect(await router.navigateByUrl('/x/blocked')).toBe(false);
      expect(stage.dataset['motionDir']).toBe(prior);
      expect(stage.querySelector('[data-motion-clone]')).toBeNull();

      await harness.navigateByUrl('/x');
      const clone = stage.querySelector('[data-motion-clone]') as HTMLElement;
      expect(clone).not.toBeNull();
      await harness.navigateByUrl('/other');
      expect(clone.isConnected).toBe(false);
    } finally {
      requestFrame.mockRestore();
    }
  });

  it('keeps the clone paused until NavigationEnd and strips inherited entrance classes', async () => {
    const router = TestBed.inject(Router);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/x');
    const stage = harness.routeNativeElement?.querySelector('[ptahMotionRouteStage]') as HTMLElement;
    const live = stage.querySelector('.ptah-motion-panel') as HTMLElement;
    live.classList.add('ptah-motion-enter');
    const routeHost = harness.routeDebugElement?.componentInstance;
    if (!(routeHost instanceof RouteHost)) throw new Error('The route host did not activate');
    routeHost.clone.set(true);
    harness.detectChanges();
    const states: string[] = [];
    const subscription = router.events.subscribe((event) => {
      if (event instanceof GuardsCheckEnd && event.shouldActivate) {
        const clone = stage.querySelector('[data-motion-clone]') as HTMLElement | null;
        states.push(clone?.dataset['motionClone'] ?? 'none');
        expect(clone?.classList.contains('ptah-motion-enter')).toBe(false);
        expect(stage.querySelector(':scope > .ptah-motion-panel:not([data-motion-clone])')).toBe(live);
      }
    });
    const requestFrame = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    try {
      await harness.navigateByUrl('/x/a');
      expect(states).toEqual(['pending']);
      expect((stage.querySelector('[data-motion-clone]') as HTMLElement).dataset['motionClone']).toBe('running');
    } finally {
      subscription.unsubscribe();
      requestFrame.mockRestore();
    }
  });

  it('follows a UrlTree guard redirect without retaining a pending clone', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/x');
    const stage = harness.routeNativeElement?.querySelector('[ptahMotionRouteStage]') as HTMLElement;
    const routeHost = harness.routeDebugElement?.componentInstance;
    if (!(routeHost instanceof RouteHost)) throw new Error('The route host did not activate');
    routeHost.clone.set(true);
    harness.detectChanges();
    const requestFrame = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1);
    try {
      await harness.navigateByUrl('/x/redirect');
      expect(TestBed.inject(Router).url).toBe('/x/a');
      expect(stage.dataset['motionDir']).toBe('forward');
      expect(stage.querySelectorAll('[data-motion-clone]')).toHaveLength(1);
    } finally {
      requestFrame.mockRestore();
    }
  });

  it('uses the animation completion fallback and the 1500ms hard cap', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/x');
    const stage = harness.routeNativeElement?.querySelector('[ptahMotionRouteStage]') as HTMLElement;
    stage.style.setProperty('--ptah-motion-out', '380ms');
    const routeHost = harness.routeDebugElement?.componentInstance;
    if (!(routeHost instanceof RouteHost)) throw new Error('The route host did not activate');
    routeHost.clone.set(true);
    harness.detectChanges();
    jest.useFakeTimers({ doNotFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    const frames: FrameRequestCallback[] = [];
    const requestFrame = jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    try {
      await harness.navigateByUrl('/x/a');
      const clone = stage.querySelector('[data-motion-clone]') as HTMLElement;
      Object.defineProperty(clone, 'getAnimations', { value: () => [{
        animationName: 'ptahMotionLeave', playState: 'running',
        effect: { getComputedTiming: () => ({ endTime: 380 }) },
      }] });
      frames.at(-1)?.(0);
      jest.advanceTimersByTime(429);
      expect(clone.isConnected).toBe(true);
      jest.advanceTimersByTime(1);
      expect(clone.isConnected).toBe(false);

      await harness.navigateByUrl('/x');
      const capped = stage.querySelector('[data-motion-clone]') as HTMLElement;
      expect(capped).not.toBeNull();
      jest.advanceTimersByTime(1499);
      expect(capped.isConnected).toBe(true);
      jest.advanceTimersByTime(1);
      expect(capped.isConnected).toBe(false);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
      requestFrame.mockRestore();
    }
  });

  it('clears clone listeners, timers and animation frame when destroyed', async () => {
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl('/x');
    const stage = harness.routeNativeElement?.querySelector('[ptahMotionRouteStage]') as HTMLElement;
    const routeHost = harness.routeDebugElement?.componentInstance;
    if (!(routeHost instanceof RouteHost)) throw new Error('The route host did not activate');
    routeHost.clone.set(true);
    harness.detectChanges();
    jest.useFakeTimers({ doNotFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    const requestFrame = jest.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 37);
    const cancelFrame = jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
    const clearTimer = jest.spyOn(window, 'clearTimeout');
    try {
      await harness.navigateByUrl('/x/a');
      const clone = stage.querySelector('[data-motion-clone]') as HTMLElement;
      const removeListener = jest.spyOn(clone, 'removeEventListener');
      expect(jest.getTimerCount()).toBeGreaterThan(0);
      await harness.navigateByUrl('/other');
      expect(clone.isConnected).toBe(false);
      expect(removeListener.mock.calls.map(([type]) => type)).toEqual(['animationend', 'animationcancel']);
      expect(cancelFrame).toHaveBeenCalledWith(37);
      expect(clearTimer).toHaveBeenCalled();
      jest.runOnlyPendingTimers();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
      clearTimer.mockRestore();
      cancelFrame.mockRestore();
      requestFrame.mockRestore();
    }
  });
});
