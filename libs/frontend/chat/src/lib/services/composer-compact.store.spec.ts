import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ComposerCompactStore } from './composer-compact.store';

function setup() {
  TestBed.configureTestingModule({ providers: [ComposerCompactStore] });
  const store = TestBed.inject(ComposerCompactStore);
  const sources = {
    scope: signal<string | null>('tab-1'),
    streaming: signal(false),
    hasContent: signal(false),
    focused: signal(false),
    overlayOpen: signal(false),
    dragging: signal(false),
  };
  store.connect(sources);
  TestBed.tick();
  return { store, sources };
}

/** Stub `matchMedia` for the reduced-motion query (jsdom has none). */
function mockReducedMotion(matches: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: jest.fn().mockReturnValue({
      matches,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn(),
    }),
  });
}

describe('ComposerCompactStore', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
    delete (window as { matchMedia?: unknown }).matchMedia;
    TestBed.resetTestingModule();
  });

  it('is full while not streaming', () => {
    const { store } = setup();
    expect(store.compact()).toBe(false);
  });

  it('compacts only while streaming and fully idle', () => {
    const { store, sources } = setup();
    sources.streaming.set(true);
    expect(store.compact()).toBe(true);

    for (const key of [
      'hasContent',
      'focused',
      'overlayOpen',
      'dragging',
    ] as const) {
      sources[key].set(true);
      expect(store.compact()).toBe(false);
      sources[key].set(false);
      expect(store.compact()).toBe(true);
    }
  });

  it('stays expanded after a user expand while the composer is in use', () => {
    const { store, sources } = setup();
    sources.streaming.set(true);
    store.expand();
    expect(store.compact()).toBe(false);

    sources.focused.set(true);
    TestBed.tick();
    jest.advanceTimersByTime(5_000);
    expect(store.compact()).toBe(false);
  });

  it('refolds an expanded composer after it sits idle for the delay', () => {
    const { store, sources } = setup();
    sources.streaming.set(true);
    store.expand();
    TestBed.tick();

    jest.advanceTimersByTime(ComposerCompactStore.REFOLD_DELAY_MS - 1);
    expect(store.compact()).toBe(false);
    jest.advanceTimersByTime(1);
    expect(store.compact()).toBe(true);
  });

  it('restarts the refold delay when focus comes back before it elapses', () => {
    const { store, sources } = setup();
    sources.streaming.set(true);
    store.expand();
    TestBed.tick();
    jest.advanceTimersByTime(1_000);

    sources.focused.set(true);
    TestBed.tick();
    sources.focused.set(false);
    TestBed.tick();
    jest.advanceTimersByTime(1_000);
    expect(store.compact()).toBe(false);
    jest.advanceTimersByTime(ComposerCompactStore.REFOLD_DELAY_MS);
    expect(store.compact()).toBe(true);
  });

  it('never refolds while there is text', () => {
    const { store, sources } = setup();
    sources.streaming.set(true);
    store.expand();
    sources.hasContent.set(true);
    TestBed.tick();
    jest.advanceTimersByTime(10_000);
    expect(store.compact()).toBe(false);
  });

  it('expands when the stream ends and forgets the expansion for the next stream', () => {
    const { store, sources } = setup();
    sources.streaming.set(true);
    store.expand();
    sources.focused.set(true);
    TestBed.tick();

    sources.streaming.set(false);
    TestBed.tick();
    expect(store.compact()).toBe(false);

    sources.focused.set(false);
    sources.streaming.set(true);
    TestBed.tick();
    expect(store.compact()).toBe(true);
  });

  it('forgets a user expansion when the composer moves to another tab', () => {
    const { store, sources } = setup();
    sources.streaming.set(true);
    store.expand();
    sources.focused.set(true);
    TestBed.tick();

    sources.scope.set('tab-2');
    sources.focused.set(false);
    TestBed.tick();
    expect(store.compact()).toBe(true);
  });

  it('ignores expand requests while not streaming', () => {
    const { store, sources } = setup();
    store.expand();
    sources.streaming.set(true);
    TestBed.tick();
    expect(store.compact()).toBe(true);
  });

  it('stays expanded while files hover longer than the refold delay', () => {
    const { store, sources } = setup();
    sources.streaming.set(true);
    store.expand();
    sources.dragging.set(true);
    TestBed.tick();

    jest.advanceTimersByTime(ComposerCompactStore.REFOLD_DELAY_MS * 3);
    expect(store.compact()).toBe(false);

    // The drag leaves without a drop: the normal refold delay applies.
    sources.dragging.set(false);
    TestBed.tick();
    jest.advanceTimersByTime(ComposerCompactStore.REFOLD_DELAY_MS);
    expect(store.compact()).toBe(true);
  });

  it('releases the clip at once under reduced motion', () => {
    mockReducedMotion(true);
    const { store, sources } = setup();
    sources.streaming.set(true);
    TestBed.tick();
    expect(store.unclipped()).toBe(false);

    store.expand();
    expect(store.unclipped()).toBe(true);
  });

  it('unclips the full composer only after its open animation', () => {
    mockReducedMotion(false);
    const { store, sources } = setup();
    expect(store.unclipped()).toBe(true);

    sources.streaming.set(true);
    TestBed.tick();
    expect(store.unclipped()).toBe(false);

    store.expand();
    TestBed.tick();
    expect(store.unclipped()).toBe(false);
    jest.advanceTimersByTime(ComposerCompactStore.UNCLIP_DELAY_MS);
    expect(store.unclipped()).toBe(true);
  });
});
