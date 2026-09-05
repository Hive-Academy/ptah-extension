/**
 * TranscriptRenderWindow — the mount decision (TASK_2026_381 component 1).
 *
 * jsdom has no `IntersectionObserver`, so every test that exercises the
 * observer path installs a deterministic fake and drives it by hand. The one
 * test that does NOT install it pins the degradation contract: with no
 * `IntersectionObserver`, everything mounts.
 */

import {
  ALWAYS_MOUNTED_TAIL,
  PLACEHOLDER_FALLBACK_PX,
  RENDER_WINDOW_MARGIN_PX,
  TranscriptRenderWindow,
} from './transcript-render-window';

interface FakeEntry {
  readonly target: Element;
  readonly isIntersecting: boolean;
  readonly boundingClientRect: { readonly height: number };
}

class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];

  readonly observed = new Set<Element>();

  constructor(
    private readonly callback: IntersectionObserverCallback,
    readonly options?: IntersectionObserverInit,
  ) {
    FakeIntersectionObserver.instances.push(this);
  }

  observe(element: Element): void {
    this.observed.add(element);
  }
  unobserve(element: Element): void {
    this.observed.delete(element);
  }
  disconnect(): void {
    this.observed.clear();
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  emit(entries: readonly FakeEntry[]): void {
    this.callback(
      entries as unknown as IntersectionObserverEntry[],
      this as unknown as IntersectionObserver,
    );
  }
}

const globalWithIo = globalThis as unknown as {
  IntersectionObserver?: unknown;
};

function installFakeObserver(): void {
  FakeIntersectionObserver.instances = [];
  globalWithIo.IntersectionObserver = FakeIntersectionObserver;
}

function removeObserver(): void {
  delete globalWithIo.IntersectionObserver;
}

function entry(
  target: Element,
  isIntersecting: boolean,
  height: number,
): FakeEntry {
  return { target, isIntersecting, boundingClientRect: { height } };
}

function ids(count: number, prefix = 'm'): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}${i}`);
}

/** Attached window + one registered element per id. */
function makeAttached(messageIds: readonly string[], finalizedCount: number) {
  const win = new TranscriptRenderWindow();
  const root = document.createElement('div');
  win.attach(root);
  const observer = FakeIntersectionObserver.instances[0];

  const elements = new Map<string, HTMLElement>();
  for (const id of messageIds) {
    const el = document.createElement('div');
    elements.set(id, el);
    win.register(id, el);
  }
  win.setActive(true);
  win.syncMessages(messageIds, finalizedCount);
  return { win, root, observer, elements };
}

describe('TranscriptRenderWindow', () => {
  afterEach(() => {
    removeObserver();
    FakeIntersectionObserver.instances = [];
  });

  describe('without IntersectionObserver', () => {
    it('degrades to everything mounted', () => {
      removeObserver();
      const win = new TranscriptRenderWindow();
      win.setActive(true);
      win.syncMessages(ids(40), 40);

      expect(win.supported).toBe(false);
      expect(win.isMounted('m0')).toBe(true);
      expect(win.isMounted('m39')).toBe(true);
      // Even an id it has never seen — a blank transcript is never acceptable.
      expect(win.isMounted('never-seen')).toBe(true);
    });

    it('creates no observer on attach', () => {
      removeObserver();
      const win = new TranscriptRenderWindow();
      win.attach(document.createElement('div'));
      expect(FakeIntersectionObserver.instances).toHaveLength(0);
    });
  });

  describe('with a fake IntersectionObserver', () => {
    beforeEach(installFakeObserver);

    it('roots the observer on the scroll container with the vertical margin', () => {
      const win = new TranscriptRenderWindow();
      const root = document.createElement('div');
      win.attach(root);

      const observer = FakeIntersectionObserver.instances[0];
      expect(observer.options?.root).toBe(root);
      expect(observer.options?.rootMargin).toBe(
        `${RENDER_WINDOW_MARGIN_PX}px 0px`,
      );
    });

    it('observes elements registered before attach', () => {
      const win = new TranscriptRenderWindow();
      const early = document.createElement('div');
      win.register('m0', early);
      win.attach(document.createElement('div'));

      expect(FakeIntersectionObserver.instances[0].observed.has(early)).toBe(
        true,
      );
    });

    it('mounts only the trailing tail before the observer has reported', () => {
      const list = ids(20);
      const { win } = makeAttached(list, list.length);

      for (let i = 0; i < 20 - ALWAYS_MOUNTED_TAIL; i++) {
        expect(win.isMounted(list[i])).toBe(false);
      }
      for (let i = 20 - ALWAYS_MOUNTED_TAIL; i < 20; i++) {
        expect(win.isMounted(list[i])).toBe(true);
      }
    });

    it('mounts a message the observer reports as intersecting', () => {
      const list = ids(20);
      const { win, observer, elements } = makeAttached(list, list.length);
      expect(win.isMounted('m0')).toBe(false);

      observer.emit([entry(elements.get('m0') as Element, true, 0)]);

      expect(win.isMounted('m0')).toBe(true);
    });

    it('unmounts a message the observer reports as leaving', () => {
      const list = ids(20);
      const { win, observer, elements } = makeAttached(list, list.length);
      const el = elements.get('m0') as Element;

      observer.emit([entry(el, true, 0)]);
      expect(win.isMounted('m0')).toBe(true);

      observer.emit([entry(el, false, 540)]);
      expect(win.isMounted('m0')).toBe(false);
    });

    it('never unmounts a streaming message, whatever the observer says', () => {
      // finalizedCount 0 → every id is streaming, none may unmount.
      const list = ids(20);
      const { win, observer, elements } = makeAttached(list, 0);

      observer.emit(
        list.map((id) => entry(elements.get(id) as Element, false, 300)),
      );

      for (const id of list) expect(win.isMounted(id)).toBe(true);
    });

    it('keeps a streaming message mounted while it grows past the tail', () => {
      // 20 messages, the last 3 streaming — beyond ALWAYS_MOUNTED_TAIL they
      // are still exempt by id.
      const list = ids(20);
      const { win, observer, elements } = makeAttached(list, 17);

      observer.emit([
        entry(elements.get('m17') as Element, false, 4000),
        entry(elements.get('m18') as Element, false, 4000),
        entry(elements.get('m19') as Element, false, 4000),
      ]);

      expect(win.isMounted('m17')).toBe(true);
      expect(win.isMounted('m18')).toBe(true);
      expect(win.isMounted('m19')).toBe(true);
    });

    it('processes no callback while frozen', () => {
      const list = ids(20);
      const { win, observer, elements } = makeAttached(list, list.length);
      observer.emit([entry(elements.get('m0') as Element, true, 400)]);
      expect(win.isMounted('m0')).toBe(true);

      win.setActive(false);
      // Under display:none every element reports non-intersecting.
      observer.emit(
        list.map((id) => entry(elements.get(id) as Element, false, 0)),
      );

      expect(win.isMounted('m0')).toBe(true);
      expect(win.placeholderHeight('m0')).toBe(PLACEHOLDER_FALLBACK_PX);
    });

    it('records the height measured on the leaving edge, not the entering one', () => {
      const list = ids(20);
      const { win, observer, elements } = makeAttached(list, list.length);
      const el = elements.get('m0') as Element;

      // Entering: the slot still holds the 120px placeholder. That height must
      // NOT become the remembered one.
      observer.emit([entry(el, true, PLACEHOLDER_FALLBACK_PX)]);
      // Leaving: boundingClientRect still describes the mounted bubble.
      observer.emit([entry(el, false, 640)]);

      expect(win.isMounted('m0')).toBe(false);
      expect(win.placeholderHeight('m0')).toBe(640);
    });

    it('falls back to 120px for a message never measured', () => {
      const list = ids(20);
      const { win } = makeAttached(list, list.length);
      expect(win.placeholderHeight('m0')).toBe(PLACEHOLDER_FALLBACK_PX);
    });

    it('never reports a zero-height placeholder', () => {
      const list = ids(20);
      const { win, observer, elements } = makeAttached(list, list.length);
      const el = elements.get('m0') as Element;

      observer.emit([entry(el, true, 400)]);
      observer.emit([entry(el, false, 0)]);

      expect(win.placeholderHeight('m0')).toBeGreaterThan(0);
    });

    it('evicts height records for ids that leave the message list', () => {
      const list = ids(20);
      const { win, observer, elements } = makeAttached(list, list.length);
      const el = elements.get('m0') as Element;
      observer.emit([entry(el, true, 400)]);
      observer.emit([entry(el, false, 400)]);
      expect(win.placeholderHeight('m0')).toBe(400);

      win.syncMessages(list.slice(1), list.length - 1);

      expect(win.placeholderHeight('m0')).toBe(PLACEHOLDER_FALLBACK_PX);
      expect(win.isMounted('m0')).toBe(false);
    });

    it('re-observes when a slot element is re-keyed to a new id', () => {
      const win = new TranscriptRenderWindow();
      win.attach(document.createElement('div'));
      const observer = FakeIntersectionObserver.instances[0];
      const el = document.createElement('div');

      win.register('m0', el);
      win.register('m0', el); // idempotent
      expect(observer.observed.size).toBe(1);

      win.register('m1', el);
      win.setActive(true);
      win.syncMessages(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'm1'], 8);
      observer.emit([entry(el, false, 700)]);

      expect(win.placeholderHeight('m1')).toBe(700);
      expect(win.placeholderHeight('m0')).toBe(PLACEHOLDER_FALLBACK_PX);
    });

    it('stops reporting for an unregistered element', () => {
      const list = ids(20);
      const { win, observer, elements } = makeAttached(list, list.length);
      const el = elements.get('m0') as HTMLElement;

      win.unregister(el);
      expect(observer.observed.has(el)).toBe(false);
      observer.emit([entry(el, true, 400)]);

      expect(win.isMounted('m0')).toBe(false);
    });
  });
});
