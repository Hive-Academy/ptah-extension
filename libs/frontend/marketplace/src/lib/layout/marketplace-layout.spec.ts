/**
 * TASK_2026_533 Task 3.3 — Marketplace container tiers (implementation plan
 * D3), and the A1 probe.
 *
 * A1: a `RouterOutlet` re-created inside a `@switch` branch re-activates the
 * current child route. The server and skill lists place their detail in an
 * overlay drawer or a docked inspector depending on the tier, each branch with
 * its own outlet, and selection lives only in the URL. If a fresh outlet did
 * not pick up the active child, a tier flip would silently drop the open
 * detail. The probe at the bottom of this file pins that it does not.
 */

import {
  Component,
  DestroyRef,
  ElementRef,
  EnvironmentInjector,
  createEnvironmentInjector,
  inject,
  input,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  Router,
  RouterOutlet,
  provideRouter,
  withComponentInputBinding,
} from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  MARKETPLACE_REGULAR_MIN_WIDTH,
  MARKETPLACE_WIDE_MIN_WIDTH,
  MarketplaceLayout,
  marketplaceTierForWidth,
  type MarketplaceTier,
} from './marketplace-layout';

// ---------------------------------------------------------------------------
// ResizeObserver stub
// ---------------------------------------------------------------------------

class StubResizeObserver {
  public static instances: StubResizeObserver[] = [];

  public readonly observed: Element[] = [];
  public disconnected = false;

  public constructor(private readonly callback: ResizeObserverCallback) {
    StubResizeObserver.instances.push(this);
  }

  public observe(target: Element): void {
    this.observed.push(target);
  }

  public unobserve(): void {
    // Not used by MarketplaceLayout.
  }

  public disconnect(): void {
    this.disconnected = true;
  }

  /** Deliver one resize report for every observed element. */
  public report(width: number, targetWidth = 0): void {
    const entries = this.observed.map((target) => {
      Object.defineProperty(target, 'clientWidth', {
        configurable: true,
        value: targetWidth,
      });
      return {
        contentRect: { width },
        target,
      } as unknown as ResizeObserverEntry;
    });
    this.callback(entries, this as unknown as ResizeObserver);
  }
}

type GlobalWithObserver = { ResizeObserver?: typeof ResizeObserver };

function installStubObserver(): void {
  StubResizeObserver.instances = [];
  (globalThis as GlobalWithObserver).ResizeObserver =
    StubResizeObserver as unknown as typeof ResizeObserver;
}

function removeObserver(): void {
  delete (globalThis as GlobalWithObserver).ResizeObserver;
}

function latestObserver(): StubResizeObserver {
  const observer = StubResizeObserver.instances.at(-1);
  if (!observer) throw new Error('no ResizeObserver was created');
  return observer;
}

function elementOfWidth(width: number): HTMLElement {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', {
    configurable: true,
    value: width,
  });
  return el;
}

/** A layout owned by a destroyable injector, as the shell will own it. */
function createLayout(): {
  layout: MarketplaceLayout;
  destroy: () => void;
} {
  const injector = createEnvironmentInjector(
    [],
    TestBed.inject(EnvironmentInjector),
  );
  const layout = new MarketplaceLayout(injector.get(DestroyRef));
  return { layout, destroy: () => injector.destroy() };
}

const originalObserver = (globalThis as GlobalWithObserver).ResizeObserver;

afterEach(() => {
  if (originalObserver) {
    (globalThis as GlobalWithObserver).ResizeObserver = originalObserver;
  } else {
    removeObserver();
  }
});

// ---------------------------------------------------------------------------
// marketplaceTierForWidth
// ---------------------------------------------------------------------------

describe('marketplaceTierForWidth', () => {
  it.each<[number, MarketplaceTier]>([
    [0, 'compact'],
    [400, 'compact'],
    [720, 'compact'],
    [899, 'compact'],
    [899.5, 'compact'],
    [900, 'regular'],
    [1100, 'regular'],
    [1399, 'regular'],
    [1400, 'wide'],
    [1750, 'wide'],
    [-1, 'compact'],
    [Number.NaN, 'compact'],
    [Number.POSITIVE_INFINITY, 'compact'],
  ])('%p → %s', (width, tier) => {
    expect(marketplaceTierForWidth(width)).toBe(tier);
  });

  it('puts the breakpoints at 900 and 1400', () => {
    expect(MARKETPLACE_REGULAR_MIN_WIDTH).toBe(900);
    expect(MARKETPLACE_WIDE_MIN_WIDTH).toBe(1400);
  });
});

// ---------------------------------------------------------------------------
// MarketplaceLayout with a ResizeObserver
// ---------------------------------------------------------------------------

describe('MarketplaceLayout — with ResizeObserver', () => {
  beforeEach(() => installStubObserver());

  it('starts at width 0 and compact before anything is observed', () => {
    const { layout } = createLayout();
    expect(layout.width()).toBe(0);
    expect(layout.tier()).toBe('compact');
  });

  it('seeds the width synchronously from the element', () => {
    const { layout } = createLayout();
    layout.observe(elementOfWidth(1100));

    expect(layout.width()).toBe(1100);
    expect(layout.tier()).toBe('regular');
  });

  it('observes the element it is handed', () => {
    const { layout } = createLayout();
    const el = elementOfWidth(0);
    layout.observe(el);

    expect(latestObserver().observed).toEqual([el]);
  });

  it('follows resize reports across all three tiers', () => {
    const { layout } = createLayout();
    layout.observe(elementOfWidth(0));
    const observer = latestObserver();

    observer.report(720);
    expect(layout.tier()).toBe('compact');
    observer.report(1100);
    expect(layout.tier()).toBe('regular');
    observer.report(1750);
    expect(layout.width()).toBe(1750);
    expect(layout.tier()).toBe('wide');
  });

  it('falls back to the target clientWidth when contentRect reports 0', () => {
    const { layout } = createLayout();
    layout.observe(elementOfWidth(0));

    latestObserver().report(0, 1500);

    expect(layout.width()).toBe(1500);
    expect(layout.tier()).toBe('wide');
  });

  it('ignores a zero-width report and keeps the last tier', () => {
    const { layout } = createLayout();
    layout.observe(elementOfWidth(1500));

    latestObserver().report(0, 0);

    expect(layout.width()).toBe(1500);
    expect(layout.tier()).toBe('wide');
  });

  it('disconnects the previous observer when re-pointed at another element', () => {
    const { layout } = createLayout();
    layout.observe(elementOfWidth(0));
    const first = latestObserver();
    const second = elementOfWidth(0);
    layout.observe(second);

    expect(first.disconnected).toBe(true);
    expect(latestObserver()).not.toBe(first);
    expect(latestObserver().observed).toEqual([second]);
  });

  it('disconnects when its owner is destroyed', () => {
    const { layout, destroy } = createLayout();
    layout.observe(elementOfWidth(0));
    const observer = latestObserver();

    destroy();

    expect(observer.disconnected).toBe(true);
  });

  it('disconnect() is idempotent and keeps the last tier', () => {
    const { layout } = createLayout();
    layout.observe(elementOfWidth(1500));

    layout.disconnect();
    layout.disconnect();

    expect(latestObserver().disconnected).toBe(true);
    expect(layout.tier()).toBe('wide');
  });
});

// ---------------------------------------------------------------------------
// MarketplaceLayout without a ResizeObserver (jsdom default)
// ---------------------------------------------------------------------------

describe('MarketplaceLayout — no ResizeObserver', () => {
  beforeEach(() => removeObserver());

  it('falls back to the window width when the element reports 0', () => {
    const { layout } = createLayout();
    layout.observe(elementOfWidth(0));

    expect(layout.width()).toBe(window.innerWidth);
    expect(layout.tier()).toBe(marketplaceTierForWidth(window.innerWidth));
  });

  it('keeps a measured element width over the window width', () => {
    const { layout } = createLayout();
    layout.observe(elementOfWidth(640));

    expect(layout.width()).toBe(640);
    expect(layout.tier()).toBe('compact');
  });

  it('never throws on disconnect or destroy', () => {
    const { layout, destroy } = createLayout();
    layout.observe(elementOfWidth(0));

    expect(() => {
      layout.disconnect();
      destroy();
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// A1 probe — an outlet re-created by a tier flip re-activates the child route
// ---------------------------------------------------------------------------

@Component({
  selector: 'ptah-a1-server-detail',
  template: `<p data-testid="detail">{{ serverRef() }}</p>`,
})
class ServerDetailStubComponent {
  public readonly serverRef = input.required<string>();
}

/**
 * Stands in for the list page: one outlet per detail placement, exactly as the
 * drawer/docked split in implementation plan C7 will render them.
 */
@Component({
  selector: 'ptah-a1-list-host',
  imports: [RouterOutlet],
  template: `
    @switch (layout.tier()) {
      @case ('wide') {
        <aside data-testid="docked"><router-outlet /></aside>
      }
      @default {
        <div data-testid="drawer"><router-outlet /></div>
      }
    }
  `,
})
class ListHostStubComponent {
  protected readonly layout = new MarketplaceLayout(inject(DestroyRef));

  public constructor() {
    this.layout.observe(inject(ElementRef<HTMLElement>).nativeElement);
  }
}

describe('A1 probe — tier flip re-activates the routed detail', () => {
  const ref = 'claude-user:sentry';
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    installStubObserver();
    TestBed.configureTestingModule({
      providers: [
        provideRouter(
          [
            {
              path: 'marketplace',
              children: [
                {
                  path: 'servers',
                  children: [
                    {
                      path: '',
                      component: ListHostStubComponent,
                      children: [
                        {
                          path: ':serverRef',
                          component: ServerDetailStubComponent,
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
          withComponentInputBinding(),
        ),
      ],
    });
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(`/marketplace/servers/${ref}`);
  });

  function root(): HTMLElement {
    return harness.fixture.nativeElement as HTMLElement;
  }

  function detailIn(branch: 'drawer' | 'docked'): string | null {
    return (
      root().querySelector(`[data-testid="${branch}"] [data-testid="detail"]`)
        ?.textContent ?? null
    );
  }

  function flipTo(width: number): void {
    latestObserver().report(width);
    harness.detectChanges();
  }

  it('renders the detail in the compact (drawer) branch first', () => {
    expect(root().querySelector('[data-testid="docked"]')).toBeNull();
    expect(detailIn('drawer')).toBe(ref);
  });

  it('shows the same detail in the docked branch after compact → wide', () => {
    flipTo(1750);

    expect(root().querySelector('[data-testid="drawer"]')).toBeNull();
    expect(detailIn('docked')).toBe(ref);
    expect(TestBed.inject(Router).url).toBe(`/marketplace/servers/${ref}`);
  });

  it('survives a round trip wide → regular → wide', () => {
    flipTo(1750);
    flipTo(1100);
    expect(detailIn('drawer')).toBe(ref);

    flipTo(1400);
    expect(detailIn('docked')).toBe(ref);
  });

  it('follows a new selection made after the flip', async () => {
    flipTo(1750);
    await harness.navigateByUrl('/marketplace/servers/oauth:linear');

    expect(detailIn('docked')).toBe('oauth:linear');

    flipTo(720);
    expect(detailIn('drawer')).toBe('oauth:linear');
  });

  it('renders no detail in either branch when the list route has no child', async () => {
    await harness.navigateByUrl('/marketplace/servers');
    expect(detailIn('drawer')).toBeNull();

    flipTo(1750);
    expect(root().querySelector('[data-testid="docked"]')).not.toBeNull();
    expect(detailIn('docked')).toBeNull();
  });
});
