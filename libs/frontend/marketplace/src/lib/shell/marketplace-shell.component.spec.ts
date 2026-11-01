/**
 * MarketplaceShellComponent specs (plan C6, Batch 12).
 *
 * The shell is mounted the way production mounts it: as a routed component
 * under `/marketplace`, with stub pages as children, through
 * `RouterTestingHarness`. Pages are stubs on purpose — each renders its own
 * `<h1>` (the page owns it) and, where it matters, a search field.
 *
 * The tier specs drive a stub `ResizeObserver` and then only AWAIT stability
 * with `autoDetectChanges()` on: there is no `detectChanges()` after a resize.
 * That is the proof that the observer callback → signal write → DOM path needs
 * no `NgZone.run` (Batch 3 decision, Batch 12 acceptance).
 */

import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { TestBed } from '@angular/core/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { ActivatedRoute, ActivationEnd, Router, RouterOutlet, provideRouter, type Routes } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import {
  AppStateManager,
  ClaudeRpcService,
  CommandDiscoveryFacade,
  PluginCatalogService,
  VSCodeService,
} from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { detailParamKey, MotionRouteStageDirective, MotionStageDirective } from '@ptah-extension/ui';
import { MarketplaceShellComponent } from './marketplace-shell.component';
import { MARKETPLACE_LEAVE_CLONE } from './marketplace-motion-key';

// ---------------------------------------------------------------------------
// Stub pages
// ---------------------------------------------------------------------------

@Component({
  selector: 'ptah-stub-overview-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'ptah-motion-panel p-6',
    'animate.enter': 'ptah-motion-enter',
    'animate.leave': 'ptah-motion-leave',
  },
  template: `
    <h1>Overview</h1>
    <input
      type="search"
      aria-label="Search providers"
      data-testid="page-search"
    />
    <textarea aria-label="Notes" data-testid="page-notes"></textarea>
    <select aria-label="Status" data-testid="page-select">
      <option>All</option>
    </select>
    <div contenteditable="true" data-testid="page-editable">
      <span data-testid="page-editable-child">text</span>
    </div>
    <button type="button" data-testid="page-button">Refresh</button>
  `,
})
class StubOverviewPageComponent {}

@Component({
  selector: 'ptah-stub-servers-page',
  standalone: true,
  imports: [RouterOutlet, MotionRouteStageDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'ptah-motion-panel p-6',
    'animate.enter': 'ptah-motion-enter',
    'animate.leave': 'ptah-motion-leave',
  },
  template: `<h1>MCP Servers</h1>
    <button type="button" data-testid="page-button">Add</button>
    <div ptahMotionRouteStage [motionRouteKey]="detailMotionKey">
      <router-outlet />
    </div>`,
})
class StubServersPageComponent {
  protected readonly detailMotionKey = detailParamKey(inject(ActivatedRoute), 'serverRef');
}

@Component({
  selector: 'ptah-stub-server-detail',
  standalone: true,
  template: `<p data-testid="server-ref">{{ ref().get('serverRef') }}</p>`,
})
class StubServerDetailComponent {
  protected readonly route = inject(ActivatedRoute);
  protected readonly ref = toSignal(this.route.paramMap, { initialValue: this.route.snapshot.paramMap });
}

@Component({
  selector: 'ptah-stub-source-page',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'ptah-motion-panel p-6',
    'animate.enter': 'ptah-motion-enter',
    'animate.leave': 'ptah-motion-leave',
  },
  template: `<h1>Smithery</h1>`,
})
class StubSourcePageComponent {}

const routes: Routes = [
  {
    path: 'marketplace',
    component: MarketplaceShellComponent,
    children: [
      { path: 'overview', component: StubOverviewPageComponent },
      {
        path: 'servers',
        children: [
          { path: 'smithery', component: StubSourcePageComponent },
          {
            path: '',
            component: StubServersPageComponent,
            children: [{ path: ':serverRef', component: StubServerDetailComponent }],
          },
        ],
      },
      { path: '', pathMatch: 'full', redirectTo: 'overview' },
    ],
  },
  { path: 'chat', children: [] },
];

// ---------------------------------------------------------------------------
// ResizeObserver stub
// ---------------------------------------------------------------------------

class StubResizeObserver {
  public static instances: StubResizeObserver[] = [];
  public readonly observed: Element[] = [];

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
    this.observed.length = 0;
  }

  /** Deliver one resize report, as the browser would, from outside Angular. */
  public report(width: number): void {
    const entries = this.observed.map(
      (target) =>
        ({ contentRect: { width }, target }) as unknown as ResizeObserverEntry,
    );
    this.callback(entries, this as unknown as ResizeObserver);
  }
}

type GlobalWithObserver = { ResizeObserver?: typeof ResizeObserver };
const originalObserver = (globalThis as GlobalWithObserver).ResizeObserver;

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

describe('MarketplaceShellComponent', () => {
  let rpcCall: jest.Mock;
  let catalog: { ensureLoaded: jest.Mock; refresh: jest.Mock };
  let appState: {
    setCurrentView: jest.Mock;
    rememberMarketplaceRoute: jest.Mock;
  };
  let harness: RouterTestingHarness;

  const configure = (isElectron: boolean): void => {
    rpcCall = jest.fn();
    catalog = { ensureLoaded: jest.fn(), refresh: jest.fn() };
    appState = {
      setCurrentView: jest.fn(),
      rememberMarketplaceRoute: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideLocationMocks(),
        { provide: ClaudeRpcService, useValue: { call: rpcCall } },
        {
          provide: PluginCatalogService,
          useValue: {
            ...catalog,
            enabledPlugins: signal([]).asReadonly(),
            error: signal<string | null>(null).asReadonly(),
          },
        },
        {
          provide: CommandDiscoveryFacade,
          useValue: { clearCache: jest.fn() },
        },
        { provide: AppStateManager, useValue: appState },
        { provide: VSCodeService, useValue: { isElectron } },
        // The shell provides the real inventory store, which scopes the
        // session picture to these tabs; the real service needs
        // `MODEL_REFRESH_CONTROL`, which has no default provider.
        { provide: TabManagerService, useValue: { tabs: signal([]) } },
      ],
    });
  };

  const mount = async (url = '/marketplace/overview'): Promise<HTMLElement> => {
    harness = await RouterTestingHarness.create(url);
    return shellElement();
  };

  const shellElement = (): HTMLElement => {
    const el = (
      harness.fixture.nativeElement as HTMLElement
    ).querySelector<HTMLElement>('ptah-marketplace-shell');
    if (!el) throw new Error('shell not rendered');
    return el;
  };

  const query = <T extends Element = HTMLElement>(selector: string): T | null =>
    shellElement().querySelector<T>(selector);

  /** The observer the shell's layout created for its own host. */
  const shellObserver = (): StubResizeObserver => {
    const host = shellElement();
    const observer = StubResizeObserver.instances.find((o) =>
      o.observed.includes(host),
    );
    if (!observer) throw new Error('the shell host is not observed');
    return observer;
  };

  /** Resize and let the app settle — NO manual change detection. */
  const resizeTo = async (width: number): Promise<void> => {
    shellObserver().report(width);
    await harness.fixture.whenStable();
  };

  const navVariant = (): string | null =>
    query('[data-testid="marketplace-nav"]')?.getAttribute('data-variant') ??
    null;

  const navigate = async (url: string): Promise<void> => {
    await harness.navigateByUrl(url);
    await harness.fixture.whenStable();
  };

  it('starts a new page at scroll top while anchoring its leaving panel', async () => {
    configure(false);
    await mount('/marketplace/overview');
    const main = query<HTMLElement>('main[data-testid="marketplace-content"]');
    const stage = query<HTMLElement>('main > .ptah-motion-stage');
    if (!main || !stage) throw new Error('Marketplace scroll stage missing');
    const leaving = document.createElement('div');
    leaving.className = 'ptah-motion-leave';
    stage.appendChild(leaving);
    main.scrollTop = 355;

    await navigate('/marketplace/servers');

    expect(main.scrollTop).toBe(0);
    expect(leaving.style.top).toBe('-355px');

    main.scrollTop = 180;
    await navigate('/marketplace/servers/claude-user:first');
    expect(main.scrollTop).toBe(180);
  });

  it('keeps one panel and sets direction for real page switches', async () => {
    configure(false);
    await mount('/marketplace/servers/smithery');
    const stage = query<HTMLElement>('main > .ptah-motion-stage');
    expect(stage?.querySelector(':scope > router-outlet')).not.toBeNull();
    expect(stage?.classList.contains('p-6')).toBe(false);
    expect(stage?.classList.contains('h-full')).toBe(true);
    expect(stage?.classList.contains('min-h-0')).toBe(true);
    expect(stage?.querySelectorAll('.ptah-motion-panel')).toHaveLength(1);
    const directions: string[] = [];
    const subscription = TestBed.inject(Router).events.subscribe((event) => {
      if (event instanceof ActivationEnd) directions.push(stage?.dataset['motionDir'] ?? '');
    });
    await navigate('/marketplace/overview');
    expect(stage?.querySelectorAll('.ptah-motion-panel')).toHaveLength(1);
    expect(stage?.querySelector('.ptah-motion-panel')?.classList.contains('p-6')).toBe(true);
    expect(directions.length).toBeGreaterThan(0);
    expect(directions).toEqual(Array(directions.length).fill('back'));
    expect(stage?.dataset['motionDir']).toBe('back');

    directions.length = 0;
    await navigate('/marketplace/servers/smithery');
    subscription.unsubscribe();
    expect(stage?.querySelectorAll('.ptah-motion-panel')).toHaveLength(1);
    expect(directions.length).toBeGreaterThan(0);
    expect(directions).toEqual(Array(directions.length).fill('forward'));
    expect(stage?.dataset['motionDir']).toBe('forward');
  });

  it('replays exactly once for a detail parameter switch and clears it on return to the list', async () => {
    configure(false);
    await mount('/marketplace/servers');
    const stage = query<HTMLElement>('ptah-stub-servers-page > .ptah-motion-stage');
    const replay = jest.spyOn(MotionStageDirective.prototype, 'replay');
    await navigate('/marketplace/servers/claude-user:first');
    expect(replay).toHaveBeenCalledTimes(0);
    await navigate('/marketplace/servers/claude-user:second');
    expect(replay).toHaveBeenCalledTimes(1);
    expect(stage?.querySelector('[data-testid="server-ref"]')?.textContent).toContain('second');
    await navigate('/marketplace/servers');
    expect(stage?.querySelector('.ptah-motion-enter')).toBeNull();
    expect(stage?.querySelector('[data-motion-clone]')).toBeNull();
    replay.mockRestore();
  });

  it('clears pending route motion when navigation is superseded', async () => {
    configure(false);
    await mount('/marketplace/servers/smithery');
    const router = TestBed.inject(Router);
    await Promise.allSettled([
      router.navigateByUrl('/marketplace/overview'),
      router.navigateByUrl('/marketplace/servers/smithery'),
    ]);
    harness.fixture.detectChanges();
    await harness.fixture.whenStable();
    const stage = query<HTMLElement>('main > .ptah-motion-stage');
    expect(router.url).toBe('/marketplace/servers/smithery');
    expect(stage?.querySelectorAll(':scope > .ptah-motion-panel')).toHaveLength(1);
    expect(stage?.querySelector('[data-motion-clone]')).toBeNull();
  });

  it('uses the clone fallback when its shell provider is true', async () => {
    configure(false);
    TestBed.overrideComponent(MarketplaceShellComponent, {
      add: { providers: [{ provide: MARKETPLACE_LEAVE_CLONE, useValue: true }] },
    });
    await mount('/marketplace/servers/smithery');
    const stage = query<HTMLElement>('main > .ptah-motion-stage');
    const panel = stage?.querySelector<HTMLElement>(':scope > .ptah-motion-panel');
    if (!panel) throw new Error('route panel missing');
    const clone = jest.spyOn(panel, 'cloneNode');
    await navigate('/marketplace/overview');
    expect(clone).toHaveBeenCalledWith(true);
    const leavingClone = stage?.querySelector<HTMLElement>('[data-motion-clone]');
    expect(leavingClone?.dataset['motionClone']).toBe('running');
    const animationEnd = new Event('animationend');
    Object.defineProperty(animationEnd, 'animationName', { value: 'ptahMotionLeave' });
    leavingClone?.dispatchEvent(animationEnd);
    expect(stage?.querySelector('[data-motion-clone]')).toBeNull();
    clone.mockRestore();
  });

  beforeEach(() => {
    StubResizeObserver.instances = [];
    (globalThis as GlobalWithObserver).ResizeObserver =
      StubResizeObserver as unknown as typeof ResizeObserver;
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    if (originalObserver) {
      (globalThis as GlobalWithObserver).ResizeObserver = originalObserver;
    } else {
      delete (globalThis as GlobalWithObserver).ResizeObserver;
    }
  });

  // ── Tier ───────────────────────────────────────────────────────────────────

  describe('layout tier', () => {
    beforeEach(() => configure(false));

    it('observes its own host element', async () => {
      await mount();
      expect(shellObserver().observed).toEqual([shellElement()]);
    });

    it('flips rail ↔ sidebar at 900 and regular ↔ wide at 1400 from ResizeObserver reports alone', async () => {
      await mount();
      harness.fixture.autoDetectChanges();

      await resizeTo(720);
      expect(shellElement().getAttribute('data-tier')).toBe('compact');
      expect(navVariant()).toBe('rail');
      expect(query('ptah-marketplace-status-bar')).toBeNull();

      await resizeTo(900);
      expect(shellElement().getAttribute('data-tier')).toBe('regular');
      expect(navVariant()).toBe('sidebar');
      expect(query('ptah-marketplace-status-bar')).not.toBeNull();

      await resizeTo(1399);
      expect(shellElement().getAttribute('data-tier')).toBe('regular');

      await resizeTo(1400);
      expect(shellElement().getAttribute('data-tier')).toBe('wide');
      expect(navVariant()).toBe('sidebar');

      await resizeTo(1399);
      expect(shellElement().getAttribute('data-tier')).toBe('regular');

      await resizeTo(899);
      expect(shellElement().getAttribute('data-tier')).toBe('compact');
      expect(navVariant()).toBe('rail');
      expect(query('ptah-marketplace-status-bar')).toBeNull();
    });

    it('keeps the routed page mounted across a tier flip', async () => {
      await mount('/marketplace/overview');
      harness.fixture.autoDetectChanges();
      const page = query('ptah-stub-overview-page');

      await resizeTo(1500);
      await resizeTo(600);

      expect(query('ptah-stub-overview-page')).toBe(page);
    });

    it('stops observing when the shell is destroyed', async () => {
      await mount();
      const observer = shellObserver();

      await navigate('/chat');

      expect(
        (harness.fixture.nativeElement as HTMLElement).querySelector(
          'ptah-marketplace-shell',
        ),
      ).toBeNull();
      expect(observer.observed).toEqual([]);
    });
  });

  // ── 400px compact render ───────────────────────────────────────────────────

  describe('compact at 400px', () => {
    beforeEach(() => configure(false));

    /** Tailwind fixed-width classes → px (`w-14` = 56, `w-[240px]` = 240). */
    const fixedWidthPx = (token: string): number | null => {
      const scale = /^(?:min-)?w-(\d+(?:\.\d+)?)$/.exec(token);
      if (scale) return Number(scale[1]) * 4;
      const arbitrary = /^(?:min-)?w-\[(\d+)px\]$/.exec(token);
      return arbitrary ? Number(arbitrary[1]) : null;
    };

    it('renders the rail layout with nothing wider than the rail and every row shrinkable', async () => {
      await mount();
      const host = shellElement();
      host.style.width = '400px';
      Object.defineProperty(host, 'clientWidth', {
        configurable: true,
        value: 400,
      });
      harness.fixture.autoDetectChanges();
      await resizeTo(1000);
      expect(navVariant()).toBe('sidebar');
      await resizeTo(400);

      expect(host.getAttribute('data-tier')).toBe('compact');
      expect(navVariant()).toBe('rail');
      expect(query('ptah-marketplace-status-bar')).toBeNull();

      // jsdom has no layout engine, so overflow is proven structurally: no
      // element in the shell's own chrome asks for a fixed width beyond the
      // 56px rail, and every flexible row can shrink below its content.
      const widest = Array.from(host.querySelectorAll<HTMLElement>('*'))
        .filter((el) => !el.closest('ptah-stub-overview-page'))
        .flatMap((el) => Array.from(el.classList))
        .map(fixedWidthPx)
        .filter((px): px is number => px !== null);
      expect(Math.max(...widest)).toBeLessThanOrEqual(56);

      const main = query('[data-testid="marketplace-content"]');
      expect(main?.classList).toContain('min-w-0');
      expect(main?.classList).toContain('overflow-x-hidden');
      expect(query('[data-testid="marketplace-header"]')?.classList).toContain(
        'min-w-0',
      );
      expect(
        query('[data-testid="marketplace-breadcrumb"]')?.classList,
      ).toContain('min-w-0');
      expect(host.classList).toContain('min-w-0');
      expect(host.classList).toContain('overflow-hidden');
      // No horizontal scroll container anywhere in the chrome.
      expect(
        host.querySelector('.overflow-x-auto, .overflow-x-scroll'),
      ).toBeNull();
    });
  });

  // ── Header per host ────────────────────────────────────────────────────────

  describe('header in VS Code', () => {
    beforeEach(() => configure(false));

    it('renders the header WITH a back-to-chat button that returns to chat', async () => {
      await mount();

      expect(query('[data-testid="marketplace-header"]')).not.toBeNull();
      const back = query<HTMLButtonElement>(
        'button[aria-label="Back to chat"]',
      );
      expect(back).not.toBeNull();

      back?.click();

      expect(appState.setCurrentView).toHaveBeenCalledWith('chat');
    });

    it('keeps the Marketplace name in a breadcrumb and renders no <h1> of its own', async () => {
      await mount('/marketplace/overview');

      const breadcrumb = query('nav[aria-label="Breadcrumb"]');
      const crumbs = Array.from(
        breadcrumb?.querySelectorAll('a, [aria-current="page"]') ?? [],
      ).map((crumb) => crumb.textContent?.trim());
      expect(crumbs).toEqual(['Marketplace', 'Overview']);
      expect(
        breadcrumb?.querySelector('[aria-hidden="true"]')?.textContent?.trim(),
      ).toBe('/');
      expect(
        breadcrumb?.querySelector('[aria-current="page"]')?.textContent?.trim(),
      ).toBe('Overview');
      // Exactly one h1 on the page, and it is the page's.
      const headings = shellElement().querySelectorAll('h1');
      expect(headings).toHaveLength(1);
      expect(headings[0].closest('ptah-stub-overview-page')).not.toBeNull();
      expect(query('[data-testid="marketplace-header"] h1')).toBeNull();
    });

    it('names the source page in the breadcrumb', async () => {
      await mount('/marketplace/servers/smithery');

      expect(
        query(
          'nav[aria-label="Breadcrumb"] [aria-current="page"]',
        )?.textContent?.trim(),
      ).toBe('Smithery');
    });
  });

  describe('header in Electron', () => {
    beforeEach(() => configure(true));

    it('renders the header WITHOUT a back button, as one slim row with the breadcrumb', async () => {
      await mount();

      const header = query('[data-testid="marketplace-header"]');
      expect(header).not.toBeNull();
      expect(header?.classList).toContain('h-10');
      expect(query('button[aria-label="Back to chat"]')).toBeNull();
      expect(query('nav[aria-label="Breadcrumb"]')).not.toBeNull();
      expect(shellElement().querySelectorAll('h1')).toHaveLength(1);
    });
  });

  // ── Zero RPC ───────────────────────────────────────────────────────────────

  describe('zero-RPC rule', () => {
    beforeEach(() => configure(false));

    it('fires no RPC and no catalogue read when the shell mounts alone, at any tier', async () => {
      await mount();
      harness.fixture.autoDetectChanges();
      await resizeTo(1000);
      await resizeTo(1500);
      await resizeTo(500);

      expect(rpcCall).not.toHaveBeenCalled();
      expect(catalog.ensureLoaded).not.toHaveBeenCalled();
      expect(catalog.refresh).not.toHaveBeenCalled();
    });
  });

  // ── Route memory ───────────────────────────────────────────────────────────

  describe('remembered route', () => {
    beforeEach(() => configure(false));

    it('records the page of the navigation that opened the Marketplace', async () => {
      await mount('/marketplace/overview');

      expect(appState.rememberMarketplaceRoute).toHaveBeenCalledWith({
        page: 'overview',
      });
    });

    it('records the settled page after a redirect', async () => {
      await mount('/marketplace');

      expect(appState.rememberMarketplaceRoute).toHaveBeenLastCalledWith({
        page: 'overview',
      });
    });

    it('records source pages, and the list (not the detail) for a detail route', async () => {
      await mount();

      await navigate('/marketplace/servers/smithery');
      expect(appState.rememberMarketplaceRoute).toHaveBeenLastCalledWith({
        page: 'servers',
        source: 'smithery',
      });

      await navigate('/marketplace/servers/claude-user:sentry');
      expect(appState.rememberMarketplaceRoute).toHaveBeenLastCalledWith({
        page: 'servers',
      });
    });

    it('records nothing for a navigation that leaves the Marketplace', async () => {
      await mount();
      appState.rememberMarketplaceRoute.mockClear();

      await navigate('/chat');

      expect(appState.rememberMarketplaceRoute).not.toHaveBeenCalled();
    });
  });

  // ── Keyboard ───────────────────────────────────────────────────────────────

  describe('"/" shortcut', () => {
    beforeEach(() => configure(false));

    const pressSlash = (
      target: Element,
      init: KeyboardEventInit = {},
    ): KeyboardEvent => {
      const event = new KeyboardEvent('keydown', {
        key: '/',
        bubbles: true,
        cancelable: true,
        ...init,
      });
      target.dispatchEvent(event);
      return event;
    };

    const byTestId = (id: string): HTMLElement => {
      const el = query(`[data-testid="${id}"]`);
      if (!el) throw new Error(`missing ${id}`);
      return el;
    };

    it('focuses the active page search from a non-editable element', async () => {
      await mount();
      const button = byTestId('page-button');
      button.focus();

      const event = pressSlash(button);

      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(byTestId('page-search'));
    });

    it.each([
      ['an input', 'page-search'],
      ['a textarea', 'page-notes'],
      ['a select', 'page-select'],
      ['a contenteditable region', 'page-editable-child'],
    ])('never fires while typing in %s', async (_kind, id) => {
      await mount();
      const field = byTestId(id);

      const event = pressSlash(field);

      expect(event.defaultPrevented).toBe(false);
    });

    it('does not steal focus from a textarea', async () => {
      await mount();
      const notes = byTestId('page-notes');
      notes.focus();

      pressSlash(notes);

      expect(document.activeElement).toBe(notes);
    });

    it('ignores "/" with a modifier', async () => {
      await mount();

      const event = pressSlash(byTestId('page-button'), { ctrlKey: true });

      expect(event.defaultPrevented).toBe(false);
    });

    it('leaves the key alone on a page without a search field', async () => {
      await mount('/marketplace/servers');

      const event = pressSlash(byTestId('page-button'));

      expect(event.defaultPrevented).toBe(false);
    });
  });
});
