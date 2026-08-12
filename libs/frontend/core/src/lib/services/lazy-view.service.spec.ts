import { InjectionToken, Type, WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { LazyViewService } from './lazy-view.service';
import type { LazyViewLoader } from '../tokens/lazy-view-components.token';

/** Stand-in for a real deferred view component. */
class FakeViewComponent {}

const TEST_VIEW_COMPONENT = new InjectionToken<LazyViewLoader>(
  'TEST_VIEW_COMPONENT',
);

describe('LazyViewService', () => {
  let loader: jest.Mock<Promise<Type<unknown>>, []>;
  let trigger: WritableSignal<boolean>;

  const configure = (withProvider: boolean): LazyViewService => {
    TestBed.configureTestingModule({
      providers: withProvider
        ? [{ provide: TEST_VIEW_COMPONENT, useValue: loader }]
        : [],
    });
    return TestBed.inject(LazyViewService);
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
    loader = jest.fn(() => Promise.resolve(FakeViewComponent as Type<unknown>));
    trigger = signal(false);
  });

  /**
   * R3 / I-2 — THE regression test for this batch.
   *
   * If `resolveWhen` is ever reimplemented read-gated (a bare `computed()` that
   * imports on first read), this assertion fails: reading the signal and running
   * the effect queue would be enough to start the import, and every registered
   * loader would fire on the first change-detection pass.
   */
  it('does not invoke the loader before the trigger is true', () => {
    const service = configure(true);

    const view = service.resolveWhen(TEST_VIEW_COMPONENT, () => trigger());

    // Read the signal and flush effects — neither may start the import.
    expect(view()).toBeNull();
    TestBed.tick();
    expect(view()).toBeNull();

    expect(loader).not.toHaveBeenCalled();
  });

  it('loads exactly once after the trigger goes true', async () => {
    const service = configure(true);

    const view = service.resolveWhen(TEST_VIEW_COMPONENT, () => trigger());
    TestBed.tick();
    expect(loader).not.toHaveBeenCalled();

    trigger.set(true);
    TestBed.tick();

    expect(loader).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(view()).toBe(FakeViewComponent);
  });

  it('does not load again if the trigger flips true -> false -> true', async () => {
    const service = configure(true);

    service.resolveWhen(TEST_VIEW_COMPONENT, () => trigger());

    trigger.set(true);
    TestBed.tick();
    await Promise.resolve();
    expect(loader).toHaveBeenCalledTimes(1);

    trigger.set(false);
    TestBed.tick();
    trigger.set(true);
    TestBed.tick();

    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('stays null and does not throw when the token has no provider', () => {
    const service = configure(false);

    let view: ReturnType<LazyViewService['resolveWhen']> | undefined;
    expect(() => {
      view = service.resolveWhen(TEST_VIEW_COMPONENT, () => trigger());
    }).not.toThrow();

    trigger.set(true);
    expect(() => TestBed.tick()).not.toThrow();

    expect(view?.()).toBeNull();
    expect(loader).not.toHaveBeenCalled();
  });

  it('exposes the resolved component type once the promise settles', async () => {
    let settle: ((component: Type<unknown>) => void) | undefined;
    loader = jest.fn(
      () =>
        new Promise<Type<unknown>>((resolve) => {
          settle = resolve;
        }),
    );
    const service = configure(true);

    const view = service.resolveWhen(TEST_VIEW_COMPONENT, () => trigger());
    trigger.set(true);
    TestBed.tick();

    // In flight: the outlet still shows its @else spinner.
    expect(view()).toBeNull();

    settle?.(FakeViewComponent as Type<unknown>);
    await Promise.resolve();

    expect(view()).toBe(FakeViewComponent);
  });

  it('keeps the signal null and does not throw when the import rejects', async () => {
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    loader = jest.fn(() => Promise.reject(new Error('chunk fetch failed')));
    const service = configure(true);

    const view = service.resolveWhen(TEST_VIEW_COMPONENT, () => trigger());
    trigger.set(true);
    TestBed.tick();
    await Promise.resolve();
    await Promise.resolve();

    expect(view()).toBeNull();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
