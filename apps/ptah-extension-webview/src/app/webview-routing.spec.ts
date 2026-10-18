/**
 * The webview's routing composition, end to end.
 *
 * These are the acceptance gates of TASK_2026_524 batch 1, and they are
 * deliberately NOT unit tests of `SurfaceRouterService` (those live in
 * `libs/frontend/core/src/lib/routing/`). Everything here runs against the REAL
 * `appRoutes` and the REAL `MemoryPlatformLocation`, because the properties at
 * stake are properties of the composition:
 *
 *   1. The Router runs on the in-memory `PlatformLocation` and `window.history`
 *      is never called — the reason routing is possible in a `vscode-webview:`
 *      and a `file:` host at all.
 *   2. `MESSAGE_TYPES.SWITCH_VIEW` still changes the surface. The host commands
 *      view changes through it and `IPlatformCommands.focusChat()` depends on
 *      it; batch 1 changed only its receiver.
 *   3. `initialView: 'setup-wizard'` lands on that route. `ptah.setupAgents`
 *      opens a dedicated panel hardcoded to it, so this is a launch surface.
 *   4. An unknown or missing `initialView` falls back to `chat`.
 *
 * `appConfig.providers` is not used wholesale: it wires Monaco, the VS Code
 * bridge and ~25 message handlers that cannot be constructed in jsdom without
 * a host. The Router half of it is reproduced here with the same routes and the
 * same features, and `app-config-routing-wiring` below pins that reproduction
 * against the real file so the two cannot drift apart silently.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generationRouteTabValidator } from './app.config';

import { PlatformLocation } from '@angular/common';
import { ErrorHandler } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  PartialMatchRouteSnapshot,
  Route,
  Router,
  provideRouter,
  withComponentInputBinding,
  withDisabledInitialNavigation,
  type Routes,
} from '@angular/router';
import {
  ACCEPTED_INITIAL_VIEWS,
  AppStateManager,
  LEGACY_SURFACE_ALIASES,
  MESSAGE_HANDLERS,
  MemoryPlatformLocation,
  MessageRouterService,
  SURFACE_ROUTE_IDS,
  SurfaceRouterService,
  VSCodeService,
  isAcceptedInitialView,
  surfaceNavigationLanded,
  type SurfaceNavigationResult,
} from '@ptah-extension/core';
import { settleSurfaceNavigation as settle } from '@ptah-extension/core/testing';
import { MESSAGE_TYPES, WEBVIEW_ROUTE_STATE_KEY } from '@ptah-extension/shared';

import { appRoutes } from './app.routes';
import { electronOnlySurface } from './electron-only-surface.guard';
import { injectInitialNavigation } from './initial-navigation';

interface HostWindow {
  initialView?: string;
  ptahConfig?: { initialView?: string | null; panelId?: string };
  vscode?: {
    postMessage: (message: unknown) => void;
    getState: () => unknown;
    setState: (state: unknown) => void;
  };
}

/**
 * Surfaces whose lazy chunk cannot be dynamically imported under THIS
 * project's jest transform.
 *
 * `TribunalPageComponent` imports `gridstack/dist/angular`, which ships ESM
 * that `apps/ptah-extension-webview/jest.config.ts` does not put through a
 * transform, so `import('@ptah-extension/tribunal-panel')` throws
 * "Must use import to load ES Module" here. That is a limitation of this test
 * environment, not of the route: `@ptah-extension/tribunal-panel:test`
 * exercises the component under a config that does transform gridstack, and
 * `apps/ptah-electron-e2e/src/specs/tribunal/tribunal.spec.ts` proves the
 * route resolves in the real renderer. What is asserted here for these
 * surfaces is that the route exists and carries a `loadComponent` function.
 */
const JEST_UNRESOLVABLE_SURFACES: readonly string[] = ['tribunal'];

const JEST_RESOLVABLE_SURFACE_IDS = SURFACE_ROUTE_IDS.filter(
  (id) => !JEST_UNRESOLVABLE_SURFACES.includes(id),
);

/**
 * Surfaces whose route carries `canMatch: [electronOnlySurface]`.
 *
 * They are still in `SURFACE_ROUTE_IDS` — one list — so every loop below keeps
 * covering them, but only a host that reports `isElectron` can reach them. The
 * loops drive them on the Electron host; the VS Code refusal is pinned by its
 * own describe block, never by dropping them from a loop.
 */
const ELECTRON_ONLY_SURFACES: readonly string[] = ['apps'];

/**
 * Pin which host the renderer believes it is running in.
 *
 * The real `VSCodeService` stays in the graph; only its `isElectron` getter,
 * the single value `electronOnlySurface` reads, is overridden.
 */
function hostIsElectron(isElectron: boolean): void {
  jest
    .spyOn(TestBed.inject(VSCodeService), 'isElectron', 'get')
    .mockReturnValue(isElectron);
}

/** A genuine window MessageEvent, exactly as the host posts it. */
function post(view: unknown): void {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { type: MESSAGE_TYPES.SWITCH_VIEW, payload: { view } },
    }),
  );
}

function routeFor(path: string): Route {
  const route = appRoutes.find((candidate) => candidate.path === path);
  if (!route) throw new Error(`No route for "${path}"`);
  return route;
}

/** The History API methods that must never be reached. */
function spyOnHistory(): Record<string, jest.SpyInstance> {
  return {
    pushState: jest.spyOn(window.history, 'pushState').mockImplementation(),
    replaceState: jest
      .spyOn(window.history, 'replaceState')
      .mockImplementation(),
    back: jest.spyOn(window.history, 'back').mockImplementation(),
    forward: jest.spyOn(window.history, 'forward').mockImplementation(),
    go: jest.spyOn(window.history, 'go').mockImplementation(),
  };
}

function configure(): void {
  TestBed.configureTestingModule({
    providers: [
      { provide: PlatformLocation, useClass: MemoryPlatformLocation },
      provideRouter(
        appRoutes,
        withComponentInputBinding(),
        withDisabledInitialNavigation(),
      ),
      AppStateManager,
      MessageRouterService,
      { provide: MESSAGE_HANDLERS, useExisting: AppStateManager, multi: true },
      { provide: ErrorHandler, useValue: { handleError: jest.fn() } },
    ],
  });
}

/**
 * Run the production boot navigation (`injectInitialNavigation`, which
 * `App.handleInitialView` delegates to) against the real route table.
 *
 * The component itself is not created here: `app.html` renders the whole chat
 * or Electron shell, which needs Monaco, the VS Code bridge and a live RPC
 * channel.
 */
async function runBoot(): Promise<SurfaceNavigationResult> {
  const run = TestBed.runInInjectionContext(injectInitialNavigation);
  const result = await run();
  await settle();
  return result;
}

/** Boot with no saved route; `raw` is the host value the boot will see. */
async function bootWithInitialView(raw: string | undefined): Promise<void> {
  const hostWindow = window as unknown as HostWindow;
  const rawInitialView =
    hostWindow.initialView ?? hostWindow.ptahConfig?.initialView;
  expect(rawInitialView).toBe(raw);

  // The boot warns only when the navigation did not land, so a spec that
  // boots must assert the same thing it does.
  expect(surfaceNavigationLanded(await runBoot())).toBe(true);
}

/**
 * Install a host API whose saved state is `saved`, plus the host config. Must
 * run before anything injects `VSCodeService`, which reads both once.
 */
function installHost(
  saved: Record<string, unknown>,
  initialView: string | null,
): { setState: jest.Mock<void, [unknown]> } {
  const hostWindow = window as unknown as HostWindow;
  let state: unknown = saved;
  const setState = jest.fn<void, [unknown]>((next) => {
    state = next;
  });
  hostWindow.vscode = {
    postMessage: jest.fn(),
    getState: () => state,
    setState,
  };
  hostWindow.ptahConfig = { initialView, panelId: 'ptah.panel.restore-1' };
  return { setState };
}

/** A saved `ptahRoute` record, as `SurfaceRoutePersistence` writes it. */
function savedRoute(
  route: string,
  seed: string | null,
): Record<string, unknown> {
  return {
    [WEBVIEW_ROUTE_STATE_KEY]: {
      v: 1,
      route,
      seed,
      panelId: 'ptah.panel.restore-1',
    },
  };
}

describe('webview routing composition', () => {
  it('falls back from a restored workflow route until its workspace is active', () => {
    const tabs = {
      activeWorkspacePath: null as string | null,
      findTabByIdAcrossWorkspaces: jest.fn().mockReturnValue({
        workspacePath: '/ws',
        tab: { workflow: 'setup-agent-generation' },
      }),
    };
    const valid = generationRouteTabValidator(tabs);
    expect(valid('restored', 'setup-agent-generation')).toBe(false);
    expect(valid('restored', 'setup-project-prompt')).toBe(false);
    tabs.activeWorkspacePath = '/ws';
    expect(valid('restored', 'setup-agent-generation')).toBe(true);
    tabs.activeWorkspacePath = '/other';
    expect(valid('restored', 'setup-agent-generation')).toBe(false);
    tabs.findTabByIdAcrossWorkspaces.mockReturnValue(null);
    expect(valid('missing', 'setup-agent-generation')).toBe(false);
  });
  let history: Record<string, jest.SpyInstance>;

  beforeEach(() => {
    configure();
    history = spyOnHistory();
  });

  afterEach(() => {
    const hostWindow = window as unknown as HostWindow;
    delete hostWindow.initialView;
    delete hostWindow.ptahConfig;
    delete hostWindow.vscode;
    localStorage.clear();
    TestBed.resetTestingModule();
    jest.restoreAllMocks();
  });

  describe('host seam (acceptance criterion 1)', () => {
    it('provides the in-memory PlatformLocation, not the browser one', () => {
      expect(TestBed.inject(PlatformLocation)).toBeInstanceOf(
        MemoryPlatformLocation,
      );
    });

    // A cold Jest run (--no-cache --detectOpenHandles) measured 6.79s here,
    // 6.70s resolving lazy routes. Allow CI headroom for those real imports
    // without changing the project's timeout or reducing surface coverage.
    //
    // Driven on the Electron host so the Electron-only surfaces (the last one,
    // `apps`, included) are really navigated to rather than redirected. The
    // `file:` document of the Electron renderer is also the host that rejects
    // `history.pushState`, so it is the one this property matters most on.
    it('never calls window.history while navigating every surface', async () => {
      hostIsElectron(true);
      const surfaceRouter = TestBed.inject(SurfaceRouterService);

      for (const id of JEST_RESOLVABLE_SURFACE_IDS) {
        await surfaceRouter.navigateToSurface(id);
      }
      await settle();

      // The last surface in SURFACE_ROUTE_IDS; `apps` was appended after
      // `tasks` by TASK_2026_494.
      expect(surfaceRouter.currentSurface()).toBe('apps');
      for (const [name, spy] of Object.entries(history)) {
        expect(spy).not.toHaveBeenCalled();
        expect(name).toBeTruthy();
      }
    }, 30_000);

    it('never calls window.history on VS Code either, where Electron-only surfaces redirect', async () => {
      hostIsElectron(false);
      const surfaceRouter = TestBed.inject(SurfaceRouterService);

      for (const id of JEST_RESOLVABLE_SURFACE_IDS) {
        await surfaceRouter.navigateToSurface(id);
      }
      await settle();

      // The last surface is Electron-only, so the `**` fallback put the user
      // back on chat — through the Router, not through the History API.
      expect(ELECTRON_ONLY_SURFACES).toContain(
        JEST_RESOLVABLE_SURFACE_IDS.at(-1),
      );
      expect(surfaceRouter.currentSurface()).toBe('chat');
      expect(TestBed.inject(Router).url).toBe('/chat');
      for (const spy of Object.values(history)) {
        expect(spy).not.toHaveBeenCalled();
      }
    }, 30_000);
  });

  describe('MESSAGE_TYPES.SWITCH_VIEW (acceptance: the host can still command a view)', () => {
    beforeEach(() => {
      // Constructing the router is what attaches the window listener.
      TestBed.inject(MessageRouterService);
      TestBed.inject(AppStateManager);
    });

    it('changes the surface for a routable view', async () => {
      post('settings');
      await settle();

      expect(TestBed.inject(AppStateManager).currentView()).toBe('settings');
      expect(TestBed.inject(Router).url).toBe('/settings');
      expect(history['pushState']).not.toHaveBeenCalled();
    });

    it('brings the user back to chat, which is what focusChat() relies on', async () => {
      post('settings');
      await settle();
      post('chat');
      await settle();

      expect(TestBed.inject(AppStateManager).currentView()).toBe('chat');
    });

    it('still maps the legacy "orchestra-canvas" value onto chat + grid', async () => {
      const appState = TestBed.inject(AppStateManager);
      appState.setLayoutMode('single');

      post('orchestra-canvas');
      await settle();

      expect(appState.currentView()).toBe('chat');
      expect(appState.layoutMode()).toBe('grid');
    });

    it.each(['command-builder', 'context-tree', 'not-a-view', undefined])(
      'warns and leaves the surface alone for "%s"',
      async (view) => {
        const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
        const appState = TestBed.inject(AppStateManager);
        await TestBed.inject(SurfaceRouterService).navigateToSurface(
          'settings',
        );
        await settle();

        post(view);
        await settle();

        expect(appState.currentView()).toBe('settings');
        expect(consoleWarn).toHaveBeenCalled();
      },
    );
  });

  describe('initial navigation from the host deep link', () => {
    it('lands a setup-wizard panel on the setup-wizard route', async () => {
      // `ptah.setupAgents` opens a dedicated panel whose HTML hardcodes this
      // (webview-lifecycle.service.ts:153). The user is already waiting on it,
      // which is why its route is eager.
      (window as unknown as HostWindow).ptahConfig = {
        initialView: 'setup-wizard',
      };

      await bootWithInitialView('setup-wizard');

      expect(TestBed.inject(Router).url).toBe('/setup-wizard');
      expect(TestBed.inject(AppStateManager).currentView()).toBe(
        'setup-wizard',
      );
      expect(history['pushState']).not.toHaveBeenCalled();
    });

    it.each([...JEST_RESOLVABLE_SURFACE_IDS])(
      'lands a %s deep link on its route',
      async (id) => {
        // An Electron-only surface is only a deep link on the host that can
        // show it; its VS Code refusal is pinned in the describe below.
        if (ELECTRON_ONLY_SURFACES.includes(id)) hostIsElectron(true);
        (window as unknown as HostWindow).ptahConfig = { initialView: id };

        await bootWithInitialView(id);

        // The bare Marketplace and Thoth URLs are restore redirects, which land
        // on the Overview (`MARKETPLACE_ROUTES`) and the Memory tab
        // (`THOTH_ROUTES`) when nothing is remembered.
        const restoredLanding: Partial<Record<string, string>> = {
          marketplace: '/marketplace/overview',
          thoth: '/thoth/memory',
        };
        expect(TestBed.inject(Router).url).toBe(
          restoredLanding[id] ?? `/${id}`,
        );
      },
    );

    it('falls back to chat for an unknown initialView, with a warning', async () => {
      const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
      (window as unknown as HostWindow).ptahConfig = {
        initialView: 'command-builder',
      };

      await bootWithInitialView('command-builder');

      expect(TestBed.inject(Router).url).toBe('/chat');
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('command-builder'),
      );
    });

    it('falls back to chat when the host sends no initialView at all', async () => {
      const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();

      await bootWithInitialView(undefined);

      expect(TestBed.inject(Router).url).toBe('/chat');
      // No deep link is the normal case, not a defect.
      expect(consoleWarn).not.toHaveBeenCalled();
    });

    it('round-trips /chat/<tabId> as the chat surface with nothing in the outlet', async () => {
      const tabId = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';
      const router = TestBed.inject(Router);
      const surfaceRouter = TestBed.inject(SurfaceRouterService);

      const result = await surfaceRouter.navigateToUrl(`/chat/${tabId}`);
      await settle();

      expect(surfaceNavigationLanded(result)).toBe(true);
      expect(router.url).toBe(`/chat/${tabId}`);
      // `surfaceOf` reads the first segment only, so the tab never changes
      // which surface is showing.
      expect(TestBed.inject(AppStateManager).currentView()).toBe('chat');
      expect(surfaceRouter.currentSurface()).toBe('chat');

      // Neither the chat route nor its `:tabId` child carries a component, so
      // the primary outlet stays empty and the retained chrome shows.
      const chatSnapshot = router.routerState.snapshot.root.firstChild;
      expect(chatSnapshot?.routeConfig?.path).toBe('chat');
      expect(chatSnapshot?.component ?? null).toBeNull();
      expect(chatSnapshot?.firstChild?.routeConfig?.path).toBe(':tabId');
      expect(chatSnapshot?.firstChild?.paramMap.get('tabId')).toBe(tabId);
      expect(chatSnapshot?.firstChild?.component ?? null).toBeNull();

      // And back out: the bare surface root still lands on its empty child.
      expect(
        surfaceNavigationLanded(await surfaceRouter.navigateToSurface('chat')),
      ).toBe(true);
      await settle();
      expect(router.url).toBe('/chat');
      const bareChild = router.routerState.snapshot.root.firstChild?.firstChild;
      expect(bareChild?.routeConfig?.path).toBe('');
      expect(history['pushState']).not.toHaveBeenCalled();
    });

    it('prefers window.initialView, the DevTools override, over ptahConfig', async () => {
      const hostWindow = window as unknown as HostWindow;
      hostWindow.ptahConfig = { initialView: 'settings' };
      hostWindow.initialView = 'analytics';

      await bootWithInitialView('analytics');

      expect(TestBed.inject(Router).url).toBe('/analytics');
    });
  });

  /**
   * TASK_2026_524 Batch 4d, decision D5: the saved `ptahRoute` record against
   * the host deep link and the DevTools override, through the production boot.
   */
  describe('boot restore precedence (D5)', () => {
    const tabId = '3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e';

    function persisted(): unknown {
      return TestBed.inject(VSCodeService).getState(WEBVIEW_ROUTE_STATE_KEY);
    }

    it('restores a saved /chat/<tabId> when the host sends no deep link', async () => {
      installHost(savedRoute(`/chat/${tabId}`, null), null);

      expect(surfaceNavigationLanded(await runBoot())).toBe(true);

      expect(TestBed.inject(Router).url).toBe(`/chat/${tabId}`);
      expect(TestBed.inject(AppStateManager).currentView()).toBe('chat');
      // The boot's own NavigationEnd is persisted, carrying the null seed.
      expect(persisted()).toEqual({
        v: 1,
        route: `/chat/${tabId}`,
        seed: null,
        panelId: 'ptah.panel.restore-1',
      });
      expect(history['pushState']).not.toHaveBeenCalled();
    });

    it('restores a saved /thoth/skills when the host repeats the saved seed', async () => {
      // Electron always sends 'chat'; a value equal to the seed was consumed.
      installHost(savedRoute('/thoth/skills', 'chat'), 'chat');

      await runBoot();

      expect(TestBed.inject(Router).url).toBe('/thoth/skills');
      expect(TestBed.inject(AppStateManager).currentView()).toBe('thoth');
      expect(persisted()).toEqual(
        expect.objectContaining({ route: '/thoth/skills', seed: 'chat' }),
      );
    }, 30_000);

    it('lets a new host deep link win over the saved route, and seeds it', async () => {
      installHost(savedRoute('/thoth/skills', 'chat'), 'settings');

      await runBoot();

      expect(TestBed.inject(Router).url).toBe('/settings');
      expect(persisted()).toEqual(
        expect.objectContaining({ route: '/settings', seed: 'settings' }),
      );
    });

    it('lets the host win when the saved seed is null', async () => {
      installHost(savedRoute(`/chat/${tabId}`, null), 'analytics');

      await runBoot();

      expect(TestBed.inject(Router).url).toBe('/analytics');
    });

    it('lets the DevTools override win over the saved route', async () => {
      installHost(savedRoute('/thoth/skills', 'chat'), 'chat');
      (window as unknown as HostWindow).initialView = 'settings';

      await runBoot();

      expect(TestBed.inject(Router).url).toBe('/settings');
    });

    it.each([
      [
        'a route with a scheme',
        { v: 1, route: 'javascript:alert(1)', seed: null, panelId: '' },
      ],
      [
        'an unknown version',
        { v: 2, route: '/settings', seed: null, panelId: '' },
      ],
      ['a non-object entry', '/settings'],
    ])(
      'ignores an invalid saved record (%s) and falls back to chat',
      async (_label, entry) => {
        const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
        installHost({ [WEBVIEW_ROUTE_STATE_KEY]: entry }, null);

        expect(surfaceNavigationLanded(await runBoot())).toBe(true);

        expect(TestBed.inject(Router).url).toBe('/chat');
        expect(consoleWarn).not.toHaveBeenCalledWith(
          expect.stringContaining('[App] Restored route'),
        );
      },
    );

    it('falls back to the host view when a saved route does not land', async () => {
      const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
      // Valid by the shared contract, but not a surface the Router knows.
      installHost(savedRoute('/command-builder', null), null);

      expect(surfaceNavigationLanded(await runBoot())).toBe(true);

      expect(TestBed.inject(Router).url).toBe('/chat');
      expect(consoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('[App] Restored route /command-builder'),
      );
    });

    it('falls back to the host view when a saved route settles on another surface', async () => {
      const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
      // A real surface, so navigateToUrl navigates; the wildcard then sends the
      // unknown child to /chat, which is not where the host panel belongs.
      installHost(savedRoute('/settings/obsolete', 'analytics'), 'analytics');

      expect(surfaceNavigationLanded(await runBoot())).toBe(true);

      expect(TestBed.inject(Router).url).toBe('/analytics');
      expect(TestBed.inject(AppStateManager).currentView()).toBe('analytics');
      expect(persisted()).toEqual(
        expect.objectContaining({ route: '/analytics', seed: 'analytics' }),
      );
      expect(consoleWarn).toHaveBeenCalledWith(
        '[App] Restored route /settings/obsolete settled on /chat; falling back to the host view.',
      );
    });

    it('keeps a saved route the Router redirects inside its own surface', async () => {
      const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
      installHost(savedRoute('/thoth/bogus', null), null);

      expect(surfaceNavigationLanded(await runBoot())).toBe(true);

      expect(TestBed.inject(Router).url).toBe('/thoth/memory');
      expect(TestBed.inject(AppStateManager).currentView()).toBe('thoth');
      expect(consoleWarn).not.toHaveBeenCalledWith(
        expect.stringContaining('[App] Restored route'),
      );
    }, 30_000);
  });

  /**
   * TASK_2026_524 Batch 4e2: `/thoth` is the real `THOTH_ROUTES` tree, loaded
   * through `loadChildren`. No outlet is rendered here, so the shell is never
   * constructed — what is pinned is where the real table settles.
   */
  describe('thoth tab routes (THOTH_ROUTES via loadChildren)', () => {
    it('redirects a bare /thoth to memory when nothing is remembered', async () => {
      const surfaceRouter = TestBed.inject(SurfaceRouterService);

      const result = await surfaceRouter.navigateToSurface('thoth');
      await settle();

      expect(surfaceNavigationLanded(result)).toBe(true);
      expect(TestBed.inject(Router).url).toBe('/thoth/memory');
      expect(TestBed.inject(AppStateManager).currentView()).toBe('thoth');
    }, 30_000);

    it('redirects a bare /thoth to the remembered tab', async () => {
      const appState = TestBed.inject(AppStateManager);
      appState.setThothActiveTab('cron');

      await TestBed.inject(SurfaceRouterService).navigateToSurface('thoth');
      await settle();

      expect(TestBed.inject(Router).url).toBe('/thoth/cron');
      expect(appState.currentView()).toBe('thoth');
    }, 30_000);

    it('lands a deep link on its tab', async () => {
      await TestBed.inject(SurfaceRouterService).navigateToSurface('thoth', [
        'skills',
      ]);
      await settle();

      expect(TestBed.inject(Router).url).toBe('/thoth/skills');
      expect(TestBed.inject(AppStateManager).currentView()).toBe('thoth');
    }, 30_000);

    it('sends an unknown tab to /thoth/memory and stays on thoth', async () => {
      const result =
        await TestBed.inject(SurfaceRouterService).navigateToUrl(
          '/thoth/bogus',
        );
      await settle();

      expect(surfaceNavigationLanded(result)).toBe(true);
      expect(TestBed.inject(Router).url).toBe('/thoth/memory');
      expect(TestBed.inject(AppStateManager).currentView()).toBe('thoth');
    }, 30_000);
  });

  describe('Electron-only surfaces (canMatch: electronOnlySurface)', () => {
    let loadApps: jest.SpyInstance;

    beforeEach(() => {
      // Installed before anything injects the Router, so the Router's copy of
      // the route table carries the spy. The Electron cases below assert it IS
      // called, which is what keeps the "never called" assertions honest.
      loadApps = jest.spyOn(routeFor('apps'), 'loadComponent');
      TestBed.inject(MessageRouterService);
      TestBed.inject(AppStateManager);
    });

    describe('on VS Code (isElectron=false)', () => {
      beforeEach(() => hostIsElectron(false));

      it('lands initialView "apps" on chat without loading the chunk', async () => {
        (window as unknown as HostWindow).ptahConfig = { initialView: 'apps' };

        // `bootWithInitialView` also asserts the navigation "landed": the
        // redirected navigation to /chat succeeds, so the boot does not warn.
        await bootWithInitialView('apps');

        expect(TestBed.inject(Router).url).toBe('/chat');
        expect(TestBed.inject(AppStateManager).currentView()).toBe('chat');
        expect(loadApps).not.toHaveBeenCalled();
        expect(history['pushState']).not.toHaveBeenCalled();
      });

      it('lands SWITCH_VIEW "apps" on chat without loading the chunk', async () => {
        const appState = TestBed.inject(AppStateManager);
        await TestBed.inject(SurfaceRouterService).navigateToSurface(
          'settings',
        );
        await settle();

        post('apps');
        await settle();

        expect(TestBed.inject(Router).url).toBe('/chat');
        expect(appState.currentView()).toBe('chat');
        expect(loadApps).not.toHaveBeenCalled();
      });

      it('lands SWITCH_VIEW "apps" on chat when chat is already showing', async () => {
        await TestBed.inject(SurfaceRouterService).navigateToSurface('chat');
        await settle();

        post('apps');
        await settle();

        expect(TestBed.inject(Router).url).toBe('/chat');
        expect(TestBed.inject(AppStateManager).currentView()).toBe('chat');
        expect(loadApps).not.toHaveBeenCalled();
      });

      it('refuses on every attempt, not just the first', async () => {
        const surfaceRouter = TestBed.inject(SurfaceRouterService);

        for (const from of ['settings', 'tasks'] as const) {
          await surfaceRouter.navigateToSurface(from);
          await settle();
          post('apps');
          await settle();

          expect(TestBed.inject(Router).url).toBe('/chat');
        }
        expect(loadApps).not.toHaveBeenCalled();
      }, 30_000);

      it('reports the refusal through no error channel', async () => {
        const consoleError = jest.spyOn(console, 'error').mockImplementation();
        const errorHandler = TestBed.inject(ErrorHandler);

        const result =
          await TestBed.inject(SurfaceRouterService).navigateToSurface('apps');
        await settle();

        // A refused match is the designed outcome on this host, not a failure.
        expect(surfaceNavigationLanded(result)).toBe(true);
        expect(consoleError).not.toHaveBeenCalled();
        expect(errorHandler.handleError).not.toHaveBeenCalled();
      });
    });

    describe('on Electron (isElectron=true)', () => {
      beforeEach(() => hostIsElectron(true));

      it('lands initialView "apps" on the apps route', async () => {
        (window as unknown as HostWindow).ptahConfig = { initialView: 'apps' };

        await bootWithInitialView('apps');

        expect(TestBed.inject(Router).url).toBe('/apps');
        expect(TestBed.inject(AppStateManager).currentView()).toBe('apps');
        expect(loadApps).toHaveBeenCalledTimes(1);
      }, 30_000);

      it('lands SWITCH_VIEW "apps" on the apps route', async () => {
        await TestBed.inject(SurfaceRouterService).navigateToSurface(
          'settings',
        );
        await settle();

        post('apps');
        await settle();

        expect(TestBed.inject(Router).url).toBe('/apps');
        expect(TestBed.inject(AppStateManager).currentView()).toBe('apps');
        expect(loadApps).toHaveBeenCalledTimes(1);
      }, 30_000);
    });
  });
});

describe('electronOnlySurface', () => {
  /** The guard reads only the host; the match inputs are irrelevant to it. */
  function matchApps(): ReturnType<typeof electronOnlySurface> {
    const route = routeFor('apps');
    return TestBed.runInInjectionContext(() =>
      electronOnlySurface(route, [], {
        routeConfig: route,
      } as PartialMatchRouteSnapshot),
    );
  }

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.restoreAllMocks();
  });

  it.each([
    [true, true],
    [false, false],
  ])('matches when isElectron is %s -> %s', (isElectron, expected) => {
    hostIsElectron(isElectron);

    expect(matchApps()).toBe(expected);
  });

  it('refuses under the real VSCodeService default, which is not Electron', () => {
    // No host globals in jsdom: the service keeps its `isElectron: false`
    // default, so an un-configured renderer is treated as VS Code.
    const matched = matchApps();

    expect(matched).toBe(false);
  });
});

/**
 * Structural gates. The route table and the id list must not drift apart —
 * TASK_2026_492_0bcc remaps these surfaces and the point of the constant is
 * that the remap is one edit.
 */
describe('app.routes', () => {
  const allPaths = appRoutes
    .map((route) => route.path)
    .filter((path): path is string => path !== '' && path !== '**');
  // Parameter routes (e.g. `harness-builder/:mode/:tabId`) are deep links
  // into an existing surface, not surfaces of their own.
  const paths = allPaths.filter((path) => !path.includes('/:'));

  it('declares exactly the surfaces in SURFACE_ROUTE_IDS, in the same order', () => {
    expect(paths).toEqual([...SURFACE_ROUTE_IDS]);
  });

  it('roots every parameter route in a declared surface', () => {
    const paramRoutes = allPaths.filter((path) => path.includes('/:'));
    expect(paramRoutes).toEqual([
      'setup-wizard/generation/:workflow/:tabId',
      'harness-builder/:mode/:tabId',
    ]);
    for (const path of paramRoutes) {
      expect(SURFACE_ROUTE_IDS).toContain(path.split('/')[0]);
    }
  });

  it('cannot drift from the HOST allow-list (F4)', () => {
    // `WebviewHtmlGenerator` validates `initialView` against
    // `ACCEPTED_INITIAL_VIEWS` from `@ptah-extension/shared`. This is the gate
    // that stops the two from disagreeing again: the host must accept exactly
    // this route table plus the legacy aliases the renderer rewrites, and
    // nothing else. Before revision 1 the host list was six ids, four of them
    // not routes and two of them not surfaces at all.
    expect([...ACCEPTED_INITIAL_VIEWS].sort()).toEqual(
      [...paths, ...LEGACY_SURFACE_ALIASES].sort(),
    );

    // Each alias must be something the renderer can actually resolve, or the
    // host would accept a value that lands nowhere.
    for (const alias of LEGACY_SURFACE_ALIASES) {
      expect(paths).not.toContain(alias);
      expect(isAcceptedInitialView(alias)).toBe(true);
    }
  });

  it('ends with the two fallbacks, both pointing at chat', () => {
    expect(appRoutes.at(-2)).toEqual({
      path: '',
      pathMatch: 'full',
      redirectTo: 'chat',
    });
    expect(appRoutes.at(-1)).toEqual({ path: '**', redirectTo: 'chat' });
  });

  it('keeps chat component-less, so the outlet renders nothing on chat', () => {
    // The chat and canvas content area is NOT routed: `AppShellComponent`
    // retains it with `*ptahRetainWhile` (detached, never destroyed) so
    // `CanvasStore` survives navigation.
    // Its only children are the bare root and the optional `:tabId`, both
    // component-less too (TASK_2026_524 Batch 4c).
    const chat = appRoutes.find((route) => route.path === 'chat');
    expect(chat?.children).toEqual([
      { path: '', children: [] },
      { path: ':tabId', children: [] },
    ]);
    expect(chat?.providers).toHaveLength(1);
    expect(chat?.component).toBeUndefined();
    expect(chat?.loadComponent).toBeUndefined();
    expect(chat?.loadChildren).toBeUndefined();
  });

  it.each(['setup-wizard', 'settings', 'analytics'])(
    'keeps the startup-reachable surface %s eager',
    (path) => {
      const route = appRoutes.find((candidate) => candidate.path === path);
      expect(route?.component).toBeDefined();
      expect(route?.loadComponent).toBeUndefined();
    },
  );

  it.each(['harness-builder', 'setup-hub', 'tribunal', 'tasks', 'apps'])(
    'defers %s with loadComponent',
    (path) => {
      const route = appRoutes.find((candidate) => candidate.path === path);
      expect(typeof route?.loadComponent).toBe('function');
      expect(route?.component).toBeUndefined();
    },
  );

  it('defers thoth as a lazily loaded route tree that resolves THOTH_ROUTES', async () => {
    // Pins the `THOTH_ROUTES` barrel export (TASK_2026_524 Batch 4e2): a
    // rename would otherwise only surface as a dead surface at runtime. The
    // `SURFACE_ACTIVE` provider stays on the surface route.
    const route = routeFor('thoth');
    expect(route.component).toBeUndefined();
    expect(route.loadComponent).toBeUndefined();
    expect(route.providers).toHaveLength(1);

    const loaded = await (route.loadChildren as () => Promise<Routes>)();
    const module = await import('@ptah-extension/thoth-shell');

    expect(loaded).toBe(module.THOTH_ROUTES);
    expect(loaded[0]?.component).toBe(module.ThothShellComponent);
  }, 30_000);

  it('defers marketplace as a lazily loaded route tree', async () => {
    // Pins the `MARKETPLACE_ROUTES` barrel export: a rename would otherwise
    // only surface as a dead surface at runtime.
    const route = appRoutes.find(
      (candidate) => candidate.path === 'marketplace',
    );
    expect(route?.component).toBeUndefined();
    expect(route?.loadComponent).toBeUndefined();

    const loaded = await (route?.loadChildren as () => Promise<Routes>)();

    expect(Array.isArray(loaded)).toBe(true);
    expect(typeof loaded[0]?.component).toBe('function');
  }, 30_000);

  it('guards exactly the Electron-only surfaces with electronOnlySurface', () => {
    const guarded = appRoutes
      .filter((route) => route.canMatch !== undefined)
      .map((route) => route.path);

    expect(guarded).toEqual([...ELECTRON_ONLY_SURFACES]);
    for (const path of ELECTRON_ONLY_SURFACES) {
      expect(routeFor(path).canMatch).toEqual([electronOnlySurface]);
    }
  });

  it('places apps after tasks and before the fallbacks', () => {
    const order = appRoutes.map((route) => route.path);
    expect(order.indexOf('apps')).toBe(order.indexOf('tasks') + 1);
    expect(order.indexOf('apps')).toBe(appRoutes.length - 3);
  });

  it.each(['harness-builder', 'setup-hub', 'tasks', 'apps'])(
    'resolves %s to a real component class',
    async (path) => {
      // Pins the barrel export each `loadComponent` names. A rename would
      // otherwise only surface as a dead surface at runtime.
      // 'tribunal' is absent — see JEST_UNRESOLVABLE_SURFACES.
      const route = appRoutes.find((candidate) => candidate.path === path);
      const loaded = await (route?.loadComponent as () => Promise<unknown>)();
      expect(typeof loaded).toBe('function');
    },
    30_000,
  );

  it('resolves apps to the Apps lib AppsPageComponent', async () => {
    // A1: the Apps lib is reachable ONLY through this dynamic import (R8), so
    // this is the one place its barrel export is pinned in the webview.
    const loaded = await (
      routeFor('apps').loadComponent as () => Promise<unknown>
    )();
    const module = await import('@ptah-extension/mcp-apps-page');

    expect(loaded).toBe(module.AppsPageComponent);
  }, 30_000);

  it('serves harness-builder and setup-hub from the SAME module', async () => {
    // Both resolve out of `@ptah-extension/harness-builder`, so ONE chunk
    // serves both views. That is expected — do not restructure to force two.
    const load = (path: string) =>
      (
        appRoutes.find((route) => route.path === path)
          ?.loadComponent as () => Promise<unknown>
      )();
    const [builder, hub] = await Promise.all([
      load('harness-builder'),
      load('setup-hub'),
    ]);
    const module = await import('@ptah-extension/harness-builder');

    expect(builder).toBe(module.HarnessBuilderViewComponent);
    expect(hub).toBe(module.SetupHubComponent);
  }, 30_000);
});

/**
 * `app.config.ts` source gates.
 *
 * Both properties are structural and neither can be asserted by instantiating
 * the config in jsdom (it wires Monaco, the VS Code bridge and ~25 message
 * handlers). They are checked the same way `app.spec.ts` checks `app.html`'s
 * branch exclusivity: against the source, because the defect would live in the
 * file's SHAPE.
 */
describe('app.config routing wiring', () => {
  const source = readFileSync(join(__dirname, 'app.config.ts'), 'utf-8');

  it('binds PlatformLocation to MemoryPlatformLocation', () => {
    // Without this the Router reaches `history.pushState`, which the Electron
    // renderer rejects for a `file:` document.
    expect(source).toContain(
      '{ provide: PlatformLocation, useClass: MemoryPlatformLocation }',
    );
  });

  it('disables the Router"s own initial navigation', () => {
    // Otherwise the Router resolves the empty URL before
    // `App.handleInitialView` has read the host's deep link.
    expect(source).toContain('withDisabledInitialNavigation()');
    expect(source).toContain('withComponentInputBinding()');
    expect(source).toContain('provideRouter(');
  });

  it('no longer provides the lazy-view tokens the route table replaced', () => {
    for (const token of [
      'HARNESS_BUILDER_COMPONENT',
      'SETUP_HUB_COMPONENT',
      'MARKETPLACE_COMPONENT',
      'TRIBUNAL_COMPONENT',
      'TASKS_VIEW_COMPONENT',
      'WIZARD_VIEW_COMPONENT',
    ]) {
      expect(source).not.toContain(`provide: ${token}`);
    }
  });
});
