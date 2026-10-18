import { PlatformLocation } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  provideRouter,
  Router,
  RouterOutlet,
  withDisabledInitialNavigation,
  type Routes,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { MemoryPlatformLocation } from './memory-platform-location';
import { LoggingService } from '../services/logging.service';
import {
  SurfaceTransitionTracker,
  withSurfaceViewTransitions,
} from './surface-view-transitions';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: 'Surface',
})
class SurfaceProbe {}

@Component({
  imports: [RouterOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<router-outlet />',
})
class ChildSurfaceProbe {}

const routes: Routes = [
  { path: 'chat', children: [{ path: '', children: [] }, { path: ':tabId', children: [] }] },
  { path: 'settings', component: SurfaceProbe },
  { path: 'tasks', loadComponent: () => Promise.resolve(SurfaceProbe) },
  {
    path: 'thoth',
    loadChildren: () => [
      { path: '', component: ChildSurfaceProbe, children: [
        { path: 'overview', component: SurfaceProbe },
        { path: 'agents', component: SurfaceProbe },
      ] },
    ],
  },
  {
    path: 'marketplace',
    loadChildren: () => [
      { path: '', component: ChildSurfaceProbe, children: [
        { path: 'browse', component: SurfaceProbe },
        { path: 'installed', component: SurfaceProbe },
      ] },
    ],
  },
  { path: 'blocked', canActivate: [() => false], component: SurfaceProbe },
  { path: '', pathMatch: 'full', redirectTo: 'chat' },
  { path: '**', redirectTo: 'chat' },
];

interface StubTransition {
  transition: ViewTransition;
  skip: jest.Mock;
  finish: () => void;
  rejectFinish: (reason: Error) => void;
}

function makeTransition(): StubTransition {
  let finish: () => void = () => undefined;
  let rejectFinish: (reason: Error) => void = () => undefined;
  const finished = new Promise<void>((resolve, reject) => {
    finish = resolve;
    rejectFinish = reject;
  });
  const skip = jest.fn();
  return {
    transition: {
      ready: Promise.resolve(),
      updateCallbackDone: Promise.resolve(),
      finished,
      types: new Set<string>(),
      skipTransition: skip,
    },
    skip,
    finish,
    rejectFinish,
  };
}

describe('surface view transitions', () => {
  let originalStart: PropertyDescriptor | undefined;
  let originalMatch: PropertyDescriptor | undefined;
  let created: StubTransition[];
  let harness: RouterTestingHarness;
  let tracker: SurfaceTransitionTracker;

  beforeEach(async () => {
    originalStart = Object.getOwnPropertyDescriptor(document, 'startViewTransition');
    originalMatch = Object.getOwnPropertyDescriptor(globalThis, 'matchMedia');
    created = [];
    const startViewTransition: Document['startViewTransition'] = (options) => {
      const stub = makeTransition();
      const update = typeof options === 'function' ? options : options?.update;
      const updateCallbackDone = Promise.resolve().then(() => update?.()).then(() => undefined);
      created.push({ ...stub, transition: { ...stub.transition, updateCallbackDone } });
      return created[created.length - 1].transition;
    };
    Object.defineProperty(document, 'startViewTransition', {
      configurable: true,
      value: startViewTransition,
    });
    Object.defineProperty(globalThis, 'matchMedia', {
      configurable: true,
      value: jest.fn().mockReturnValue({ matches: false }),
    });
    TestBed.configureTestingModule({
      providers: [
        { provide: PlatformLocation, useClass: MemoryPlatformLocation },
        { provide: LoggingService, useValue: { error: jest.fn() } },
        provideRouter(routes, withDisabledInitialNavigation(), withSurfaceViewTransitions()),
      ],
    });
    harness = await RouterTestingHarness.create();
    tracker = TestBed.inject(SurfaceTransitionTracker);
  });

  afterEach(async () => {
    created.forEach(({ finish }) => finish());
    await Promise.all(created.map(({ transition }) => transition.finished.catch(() => undefined)));
    if (originalStart) Object.defineProperty(document, 'startViewTransition', originalStart);
    else Reflect.deleteProperty(document, 'startViewTransition');
    if (originalMatch) Object.defineProperty(globalThis, 'matchMedia', originalMatch);
    else Reflect.deleteProperty(globalThis, 'matchMedia');
    expect(document.documentElement.classList.contains('ptah-vt-active')).toBe(false);
    expect(document.documentElement.classList.contains('ptah-vt-entering')).toBe(false);
    expect(document.documentElement.classList.contains('ptah-vt-none')).toBe(false);
  });

  it('skips the first navigation, then tracks chat to settings', async () => {
    await harness.navigateByUrl('/chat');
    expect(created).toHaveLength(0);
    await harness.navigateByUrl('/settings');
    expect(created).toHaveLength(1);
    expect(created[0].skip).not.toHaveBeenCalled();
    expect(tracker.busy()).toBe(true);
    expect(document.documentElement.classList.contains('ptah-vt-active')).toBe(true);
    created[0].finish();
    await created[0].transition.finished;
    await Promise.resolve();
    expect(tracker.busy()).toBe(false);
    expect(document.documentElement.classList.contains('ptah-vt-active')).toBe(false);
  });

  it.each([
    ['/chat', '/chat/a'],
    ['/chat/a', '/chat/b'],
    ['/thoth/overview', '/thoth/agents'],
    ['/marketplace/browse', '/marketplace/installed'],
    ['/settings;panel=x', '/settings'],
    ['/chat/a', '/'],
    ['/chat/a', '/unrecognised'],
  ])('captures no snapshots for same-surface navigation %s to %s', async (from, to) => {
    await harness.navigateByUrl(from);
    await harness.navigateByUrl(to);
    expect(created).toHaveLength(1);
    expect(created[0].skip).not.toHaveBeenCalled();
    expect(tracker.busy()).toBe(false);
    expect(document.documentElement.classList.contains('ptah-vt-active')).toBe(false);
    expect(document.documentElement.classList.contains('ptah-vt-none')).toBe(true);
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(created[0].skip).not.toHaveBeenCalled();
    created[0].finish();
    await created[0].transition.finished;
    expect(document.documentElement.classList.contains('ptah-vt-none')).toBe(false);
  });

  it('clears the no-snapshot class when finished rejects', async () => {
    await harness.navigateByUrl('/chat');
    await harness.navigateByUrl('/chat/a');
    expect(document.documentElement.classList.contains('ptah-vt-none')).toBe(true);
    const error = new Error('view update failed');
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      created[0].rejectFinish(error);
      await expect(created[0].transition.finished).rejects.toBe(error);
      expect(document.documentElement.classList.contains('ptah-vt-none')).toBe(false);
      expect(consoleError).toHaveBeenCalledWith(error);
    } finally {
      consoleError.mockRestore();
    }
  });

  it('keeps the no-snapshot class until overlapping session switches finish', async () => {
    await harness.navigateByUrl('/chat');
    await harness.navigateByUrl('/chat/a');
    await harness.navigateByUrl('/chat/b');
    expect(created).toHaveLength(2);
    created[0].finish();
    await created[0].transition.finished;
    expect(document.documentElement.classList.contains('ptah-vt-none')).toBe(true);
    created[1].finish();
    await created[1].transition.finished;
    expect(document.documentElement.classList.contains('ptah-vt-none')).toBe(false);
    expect(created[0].skip).not.toHaveBeenCalled();
    expect(created[1].skip).not.toHaveBeenCalled();
  });

  it('restores cross-surface capture before tracking and ignores the old finish', async () => {
    await harness.navigateByUrl('/chat');
    await harness.navigateByUrl('/chat/a');
    expect(document.documentElement.classList.contains('ptah-vt-none')).toBe(true);
    const classAtTrack: boolean[] = [];
    const track = tracker.track.bind(tracker);
    const trackSpy = jest.spyOn(tracker, 'track').mockImplementation((transition) => {
      classAtTrack.push(document.documentElement.classList.contains('ptah-vt-none'));
      track(transition);
    });
    try {
      await harness.navigateByUrl('/settings');
      expect(classAtTrack).toEqual([false]);
      expect(document.documentElement.classList.contains('ptah-vt-none')).toBe(false);
      expect(tracker.busy()).toBe(true);
      created[0].finish();
      await created[0].transition.finished;
      expect(document.documentElement.classList.contains('ptah-vt-none')).toBe(false);
      expect(tracker.busy()).toBe(true);
      created[1].finish();
      await created[1].transition.finished;
    } finally {
      trackSpy.mockRestore();
    }
  });

  it('clears the no-snapshot class when the router injector is destroyed', async () => {
    await harness.navigateByUrl('/chat');
    await harness.navigateByUrl('/chat/a');
    expect(document.documentElement.classList.contains('ptah-vt-none')).toBe(true);
    TestBed.resetTestingModule();
    expect(document.documentElement.classList.contains('ptah-vt-none')).toBe(false);
    created[0].finish();
    await created[0].transition.finished;
    expect(document.documentElement.classList.contains('ptah-vt-none')).toBe(false);
  });

  it.each(['/','/unrecognised'])('animates settings to redirect %s', async (to) => {
    await harness.navigateByUrl('/settings');
    await harness.navigateByUrl(to);
    expect(created).toHaveLength(1);
    expect(created[0].skip).not.toHaveBeenCalled();
    expect(tracker.busy()).toBe(true);
  });

  it('captures no snapshots under reduced motion', async () => {
    await harness.navigateByUrl('/chat');
    Object.defineProperty(globalThis, 'matchMedia', {
      configurable: true,
      value: jest.fn().mockReturnValue({ matches: true }),
    });
    await harness.navigateByUrl('/settings');
    expect(created[0].skip).not.toHaveBeenCalled();
    expect(tracker.busy()).toBe(false);
    expect(document.documentElement.classList.contains('ptah-vt-active')).toBe(false);
    expect(document.documentElement.classList.contains('ptah-vt-none')).toBe(true);
    created[0].finish();
    await created[0].transition.finished;
    expect(document.documentElement.classList.contains('ptah-vt-none')).toBe(false);
  });

  it('does not create a transition for a guard-cancelled navigation', async () => {
    await harness.navigateByUrl('/chat');
    expect(await TestBed.inject(Router).navigateByUrl('/blocked')).toBe(false);
    expect(created).toHaveLength(0);
  });

  it('keeps the latest transition during rapid page changes', async () => {
    await harness.navigateByUrl('/chat');
    await harness.navigateByUrl('/settings');
    await harness.navigateByUrl('/tasks');
    expect(created).toHaveLength(2);
    const callback = jest.fn();
    tracker.afterTransition(callback);
    created[0].finish();
    await Promise.resolve();
    expect(tracker.busy()).toBe(true);
    expect(callback).not.toHaveBeenCalled();
    expect(document.documentElement.classList.contains('ptah-vt-active')).toBe(true);
    created[1].finish();
    await Promise.resolve();
    expect(tracker.busy()).toBe(false);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(document.documentElement.classList.contains('ptah-vt-active')).toBe(false);
  });
});

describe('SurfaceTransitionTracker', () => {
  let tracker: SurfaceTransitionTracker;
  const logger = { error: jest.fn() };

  beforeEach(() => {
    logger.error.mockClear();
    TestBed.configureTestingModule({ providers: [{ provide: LoggingService, useValue: logger }] });
    tracker = TestBed.inject(SurfaceTransitionTracker);
  });

  it('marks the live entrance after the update and clears both classes on settle', async () => {
    let finishUpdate: () => void = () => undefined;
    const updateCallbackDone = new Promise<void>((resolve) => { finishUpdate = resolve; });
    const stub = makeTransition();
    tracker.track({ ...stub.transition, updateCallbackDone });

    expect(document.documentElement.classList.contains('ptah-vt-active')).toBe(true);
    expect(document.documentElement.classList.contains('ptah-vt-entering')).toBe(false);
    finishUpdate();
    await Promise.resolve();
    expect(document.documentElement.classList.contains('ptah-vt-entering')).toBe(true);

    stub.finish();
    await Promise.resolve();
    expect(document.documentElement.classList.contains('ptah-vt-active')).toBe(false);
    expect(document.documentElement.classList.contains('ptah-vt-entering')).toBe(false);
  });

  it('ignores a superseded update and clears the latest entrance on settle', async () => {
    let finishFirstUpdate: () => void = () => undefined;
    let finishSecondUpdate: () => void = () => undefined;
    let finishThirdUpdate: () => void = () => undefined;
    const firstUpdate = new Promise<void>((resolve) => { finishFirstUpdate = resolve; });
    const secondUpdate = new Promise<void>((resolve) => { finishSecondUpdate = resolve; });
    const thirdUpdate = new Promise<void>((resolve) => { finishThirdUpdate = resolve; });
    const first = makeTransition();
    const second = makeTransition();
    const third = makeTransition();

    tracker.track({ ...first.transition, updateCallbackDone: firstUpdate });
    finishFirstUpdate();
    await Promise.resolve();
    expect(document.documentElement.classList.contains('ptah-vt-entering')).toBe(true);

    tracker.track({ ...second.transition, updateCallbackDone: secondUpdate });
    expect(document.documentElement.classList.contains('ptah-vt-entering')).toBe(false);
    first.finish();
    await Promise.resolve();
    expect(document.documentElement.classList.contains('ptah-vt-active')).toBe(true);
    tracker.track({ ...third.transition, updateCallbackDone: thirdUpdate });
    finishSecondUpdate();
    await Promise.resolve();
    expect(document.documentElement.classList.contains('ptah-vt-entering')).toBe(false);
    finishThirdUpdate();
    await Promise.resolve();
    expect(document.documentElement.classList.contains('ptah-vt-entering')).toBe(true);

    second.finish();
    await Promise.resolve();
    expect(document.documentElement.classList.contains('ptah-vt-entering')).toBe(true);
    third.finish();
    await Promise.resolve();
    expect(document.documentElement.classList.contains('ptah-vt-active')).toBe(false);
    expect(document.documentElement.classList.contains('ptah-vt-entering')).toBe(false);
  });

  it('skips the active transition on capture-phase pointerdown', () => {
    const stub = makeTransition();
    tracker.track(stub.transition);
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(stub.skip).toHaveBeenCalledTimes(1);
    stub.finish();
  });

  it('skips the active transition on capture-phase keydown', () => {
    const stub = makeTransition();
    tracker.track(stub.transition);
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Tab' }));
    expect(stub.skip).toHaveBeenCalledTimes(1);
    stub.finish();
  });

  it('runs a queued callback once after an input skip settles', async () => {
    const stub = makeTransition();
    const callback = jest.fn();
    tracker.track(stub.transition);
    tracker.afterTransition(callback);
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(stub.skip).toHaveBeenCalledTimes(1);
    expect(callback).not.toHaveBeenCalled();
    stub.finish();
    await Promise.resolve();
    expect(callback).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('ignores input before tracking and after settling', async () => {
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    const stub = makeTransition();
    tracker.track(stub.transition);
    expect(stub.skip).not.toHaveBeenCalled();
    stub.finish();
    await Promise.resolve();
    document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    expect(stub.skip).not.toHaveBeenCalled();
  });

  it('installs one listener of each type and removes both on destroy', () => {
    const add = jest.spyOn(document, 'addEventListener');
    const remove = jest.spyOn(document, 'removeEventListener');
    try {
      const first = makeTransition();
      const second = makeTransition();
      tracker.track(first.transition);
      tracker.track(second.transition);
      expect(add.mock.calls.filter(([type]) => type === 'pointerdown')).toHaveLength(1);
      expect(add.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(1);
      TestBed.resetTestingModule();
      expect(remove).toHaveBeenCalledWith('pointerdown', expect.any(Function), true);
      expect(remove).toHaveBeenCalledWith('keydown', expect.any(Function), true);
      document.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      expect(second.skip).not.toHaveBeenCalled();
      first.finish();
      second.finish();
    } finally {
      add.mockRestore();
      remove.mockRestore();
    }
  });

  it('runs idle callbacks synchronously and busy callbacks in order', async () => {
    const calls: number[] = [];
    tracker.afterTransition(() => calls.push(1));
    expect(calls).toEqual([1]);
    const stub = makeTransition();
    tracker.track(stub.transition);
    expect(document.documentElement.classList.contains('ptah-vt-active')).toBe(true);
    tracker.afterTransition(() => calls.push(2));
    tracker.afterTransition(() => calls.push(3));
    expect(calls).toEqual([1]);
    stub.skip();
    stub.finish();
    await Promise.resolve();
    expect(calls).toEqual([1, 2, 3]);
    expect(tracker.busy()).toBe(false);
    expect(document.documentElement.classList.contains('ptah-vt-active')).toBe(false);
  });

  it('runs later callbacks after one throws and logs the failure', async () => {
    const stub = makeTransition();
    const error = new Error('callback failed');
    const later = jest.fn();
    tracker.track(stub.transition);
    tracker.afterTransition(() => { throw error; });
    tracker.afterTransition(later);
    stub.finish();
    await Promise.resolve();
    expect(later).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      'SurfaceTransitionTracker', 'Deferred callback failed', error,
    );
    expect(document.documentElement.classList.contains('ptah-vt-active')).toBe(false);
  });

  it('flushes after a rejected finished promise', async () => {
    let rejectFinished: (reason?: Error) => void = () => undefined;
    const stub = makeTransition();
    const finished = new Promise<void>((_resolve, reject) => { rejectFinished = reject; });
    tracker.track({ ...stub.transition, finished });
    const callback = jest.fn();
    tracker.afterTransition(callback);
    rejectFinished(new Error('view update failed'));
    await Promise.resolve();
    expect(callback).toHaveBeenCalledTimes(1);
    expect(tracker.busy()).toBe(false);
    expect(document.documentElement.classList.contains('ptah-vt-active')).toBe(false);
  });
});
