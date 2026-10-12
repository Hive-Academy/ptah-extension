import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TestBed } from '@angular/core/testing';
import { DefaultUrlSerializer, Router, type UrlTree } from '@angular/router';
import {
  AppStateManager,
  SurfaceRoutePersistence,
  SurfaceRouterService,
  VSCodeService,
  type SurfaceNavigationResult,
} from '@ptah-extension/core';
import { WEBVIEW_ROUTE_STATE_KEY } from '@ptah-extension/shared';

import { App } from './app';
import { injectInitialNavigation } from './initial-navigation';

describe('App', () => {
  // The original scaffolded spec imported `./nx-welcome`, which was removed
  // once the webview started rendering real chat/electron shells. Until a
  // proper harness that mocks AppStateManager / VSCodeService /
  // WebviewNavigationService is in place, keep a smoke assertion that the
  // bootstrap component is still exported. The real integration coverage
  // lives in the @ptah-extension/chat and @ptah-extension/core specs.
  it('exports the root App component', () => {
    expect(App).toBeDefined();
    expect(App.name).toBe('App');
  });
});

/**
 * The boot branches of `injectInitialNavigation`, which `App.handleInitialView`
 * delegates to, with every collaborator replaced. The real Router and route
 * table are exercised in `webview-routing.spec.ts` ("boot restore precedence").
 */
describe('injectInitialNavigation boot branches', () => {
  interface HostWindow {
    initialView?: string;
    ptahConfig?: { initialView?: string | null };
  }

  let getState: jest.Mock<unknown, [string]>;
  let navigateToUrl: jest.Mock<Promise<SurfaceNavigationResult>, [string]>;
  let navigateToSurface: jest.Mock<Promise<SurfaceNavigationResult>, [string]>;
  let start: jest.Mock<void, [string | null]>;
  let pendingSurface: jest.Mock<string | null, []>;
  /** The URL the Router stub reports as settled; each navigation moves it. */
  let routerUrl: string;

  function savedRoute(route: string, seed: string | null): unknown {
    return { v: 1, route, seed, panelId: 'electron-main' };
  }

  async function boot(): Promise<SurfaceNavigationResult> {
    return TestBed.runInInjectionContext(injectInitialNavigation)();
  }

  beforeEach(() => {
    routerUrl = '/';
    getState = jest.fn<unknown, [string]>();
    navigateToUrl = jest
      .fn<Promise<SurfaceNavigationResult>, [string]>()
      .mockImplementation(async (route) => {
        routerUrl = route;
        return 'navigated';
      });
    navigateToSurface = jest
      .fn<Promise<SurfaceNavigationResult>, [string]>()
      .mockImplementation(async (id) => {
        routerUrl = `/${id}`;
        return 'navigated';
      });
    start = jest.fn<void, [string | null]>();
    pendingSurface = jest.fn<string | null, []>().mockReturnValue(null);
    const urlSerializer = new DefaultUrlSerializer();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: AppStateManager,
          useValue: {
            // The real one validates against SURFACE_ROUTE_IDS; enough here.
            normalizeInitialView: (raw: string | undefined) =>
              raw === 'settings' || raw === 'analytics' ? raw : 'chat',
          },
        },
        { provide: VSCodeService, useValue: { getState } },
        {
          provide: SurfaceRouterService,
          useValue: { navigateToUrl, navigateToSurface, pendingSurface },
        },
        { provide: SurfaceRoutePersistence, useValue: { start } },
        {
          provide: Router,
          useValue: {
            get url(): string {
              return routerUrl;
            },
            parseUrl: (url: string): UrlTree => urlSerializer.parse(url),
          },
        },
      ],
    });
  });

  afterEach(() => {
    const hostWindow = window as unknown as HostWindow;
    delete hostWindow.initialView;
    delete hostWindow.ptahConfig;
    TestBed.resetTestingModule();
    jest.restoreAllMocks();
  });

  it('reads the saved record through the ptahRoute key', async () => {
    getState.mockReturnValue(savedRoute('/thoth/skills', 'chat'));
    (window as unknown as HostWindow).ptahConfig = { initialView: 'chat' };

    await boot();

    expect(getState).toHaveBeenCalledWith(WEBVIEW_ROUTE_STATE_KEY);
    expect(navigateToUrl).toHaveBeenCalledWith('/thoth/skills');
    expect(navigateToSurface).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledWith('chat');
  });

  it('starts persistence before the first navigation', async () => {
    getState.mockReturnValue(undefined);
    const order: string[] = [];
    start.mockImplementation(() => order.push('start'));
    navigateToSurface.mockImplementation(async () => {
      order.push('navigate');
      return 'navigated';
    });

    await boot();

    expect(order).toEqual(['start', 'navigate']);
  });

  it('seeds persistence with the new host deep link, not the saved seed', async () => {
    getState.mockReturnValue(savedRoute('/thoth/skills', 'chat'));
    (window as unknown as HostWindow).ptahConfig = { initialView: 'settings' };

    await boot();

    expect(navigateToSurface).toHaveBeenCalledWith('settings');
    expect(navigateToUrl).not.toHaveBeenCalled();
    expect(start).toHaveBeenCalledWith('settings');
  });

  it('falls back to chat when reading the saved state throws', async () => {
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    getState.mockImplementation(() => {
      throw new Error('ipc closed');
    });

    await boot();

    expect(navigateToSurface).toHaveBeenCalledWith('chat');
    expect(consoleWarn).toHaveBeenCalledWith(
      '[App] Could not read the saved route:',
      'ipc closed',
    );
  });

  it('falls back to the normalised host view when the restored route fails', async () => {
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    getState.mockReturnValue(savedRoute('/settings', 'analytics'));
    (window as unknown as HostWindow).ptahConfig = { initialView: 'analytics' };
    navigateToUrl.mockResolvedValue('failed');

    expect(await boot()).toBe('navigated');

    expect(navigateToSurface).toHaveBeenCalledWith('analytics');
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining('[App] Restored route /settings did not land'),
    );
  });

  it('falls back to chat when the host surface does not land', async () => {
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    getState.mockReturnValue(undefined);
    (window as unknown as HostWindow).ptahConfig = { initialView: 'settings' };
    navigateToSurface.mockResolvedValueOnce('failed');

    expect(await boot()).toBe('navigated');

    expect(navigateToSurface.mock.calls).toEqual([['settings'], ['chat']]);
    expect(consoleWarn).toHaveBeenCalledWith(
      'Initial navigation to settings did not land: failed',
    );
  });

  it('never rejects or retries: chat not landing either is warned and returned', async () => {
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    getState.mockReturnValue(undefined);
    (window as unknown as HostWindow).ptahConfig = { initialView: 'settings' };
    navigateToSurface.mockResolvedValue('failed');

    expect(await boot()).toBe('failed');

    expect(navigateToSurface.mock.calls).toEqual([['settings'], ['chat']]);
    expect(consoleWarn).toHaveBeenCalledWith(
      'Initial navigation to chat did not land: failed',
    );
  });

  it('does not fall back to chat when a newer navigation superseded the boot', async () => {
    jest.spyOn(console, 'warn').mockImplementation();
    getState.mockReturnValue(undefined);
    (window as unknown as HostWindow).ptahConfig = { initialView: 'settings' };
    navigateToSurface.mockResolvedValueOnce('cancelled');
    pendingSurface.mockReturnValue('analytics');

    expect(await boot()).toBe('cancelled');

    expect(navigateToSurface.mock.calls).toEqual([['settings']]);
  });

  it('does not fall back to the host view when a newer navigation superseded the restore', async () => {
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    getState.mockReturnValue(savedRoute('/settings', 'analytics'));
    (window as unknown as HostWindow).ptahConfig = { initialView: 'analytics' };
    navigateToUrl.mockResolvedValue('cancelled');
    pendingSurface.mockReturnValue('chat');

    expect(await boot()).toBe('cancelled');

    expect(navigateToSurface).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it('falls back to the host view when the restored route settles on another surface', async () => {
    const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    getState.mockReturnValue(savedRoute('/settings/obsolete', 'analytics'));
    (window as unknown as HostWindow).ptahConfig = { initialView: 'analytics' };
    // The app wildcard redirects the unknown child to chat.
    navigateToUrl.mockImplementation(async () => {
      routerUrl = '/chat';
      return 'navigated';
    });

    expect(await boot()).toBe('navigated');

    expect(navigateToSurface).toHaveBeenCalledWith('analytics');
    expect(consoleWarn).toHaveBeenCalledWith(
      '[App] Restored route /settings/obsolete settled on /chat; falling back to the host view.',
    );
  });

  it('keeps a restored route redirected inside its own surface', async () => {
    getState.mockReturnValue(savedRoute('/thoth', null));
    navigateToUrl.mockImplementation(async () => {
      routerUrl = '/thoth/memory?x=1#top';
      return 'navigated';
    });

    expect(await boot()).toBe('navigated');

    expect(navigateToSurface).not.toHaveBeenCalled();
  });
});

/**
 * The three top-level states of `app.html` must be ONE exclusive chain.
 *
 * TASK_2026_380's logic review found F-2: as three independent sibling `@if`s,
 * a `boot:readinessChanged` push carrying `readiness: 'failed'` that lands
 * while `ngOnInit`'s `handleInitialView()` await is still pending makes
 * `isInitializing()` and `hasError()` true at the same instant, and the user
 * gets a spinner and an "Initialization Error" alert stacked in one `<main>`.
 *
 * No await ordering can fix that, because `hasError()` reads a signal the host
 * flips asynchronously — only mutual exclusion can. This is a source sweep for
 * the same reason `no-alpha-base-content.spec.ts` is one: the defect lives in
 * the template's STRUCTURE, and jsdom renders a stacked pair as happily as it
 * renders a correct one.
 */
describe('app.html top-level branch exclusivity (F-2)', () => {
  const template = readFileSync(join(__dirname, 'app.html'), 'utf-8');

  /** Index of each branch head, in the order they must appear. */
  const errorAt = template.indexOf('@if (hasError())');
  const loadingAt = template.indexOf('@else if (appState.isLoading()');
  const shellAt = template.indexOf('@else if (isReady())');

  it('opens the chain with the error branch', () => {
    expect(errorAt).toBeGreaterThanOrEqual(0);
  });

  it('continues with loading and shell as @else if, never as new @ifs', () => {
    expect(loadingAt).toBeGreaterThan(errorAt);
    expect(shellAt).toBeGreaterThan(loadingAt);
  });

  it('has exactly one top-level @if — a second one would break exclusivity', () => {
    // Every other `@if` in this template is nested inside a branch and is
    // indented; a top-level one starts at the beginning of a line.
    const topLevelIfs = template.match(/^\s{2}@if \(/gm) ?? [];
    expect(topLevelIfs).toHaveLength(1);
  });

  it('no longer needs the defensive !isLoading / !isBlockingBoot guards on the shell branch', () => {
    // Those guards existed only because the branches were independent. Leaving
    // them behind an @else if would be dead conditions that read as if the
    // overlap were still possible.
    expect(template).not.toContain('isReady() && !appState.isLoading()');
  });

  it('renders the boot screen only for the blocking phases', () => {
    expect(template).toContain('bootStatus.isBlockingBoot()');
    expect(template).toContain('<ptah-boot-progress');
  });
});
