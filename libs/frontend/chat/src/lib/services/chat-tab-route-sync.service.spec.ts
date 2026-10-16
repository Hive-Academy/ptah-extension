/**
 * ChatTabRouteSync — `/chat/:tabId` kept in step with the active tab
 * (TASK_2026_524 Batch 4c).
 *
 * Runs against the real Router over `surfaceTestRoutes()` (whose chat children
 * match production) and the real `MemoryPlatformLocation`, so "no history
 * push" is observed at the same seam production uses. `TabManagerService` is a
 * signal stub: the service under test only reads `tabs` / `activeTabId` /
 * `activeWorkspacePath$` and calls `switchTab`. `VSCodeService` is reduced to
 * its `isElectron` flag, the one value read.
 */
import { PlatformLocation } from '@angular/common';
import { signal, type WritableSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NavigationCancel, NavigationEnd, NavigationStart, Router } from '@angular/router';
import {
  SurfaceRouterService,
  SurfaceTransitionTracker,
  VSCodeService,
} from '@ptah-extension/core';
import {
  provideSurfaceRouterTesting,
  settleSurfaceNavigation,
} from '@ptah-extension/core/testing';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ChatTabRouteSync } from './chat-tab-route-sync.service';

const TAB_A = '11111111-1111-4111-8111-111111111111';
const TAB_B = '22222222-2222-4222-8222-222222222222';
const TAB_C = '33333333-3333-4333-8333-333333333333';
/** A well-formed TabId that names no open tab. */
const TAB_UNKNOWN = '99999999-9999-4999-8999-999999999999';

interface TabManagerStub {
  readonly tabs: WritableSignal<readonly { readonly id: string }[]>;
  readonly activeTabId: WritableSignal<string | null>;
  readonly activeWorkspacePath$: WritableSignal<string | null>;
  readonly switchTab: jest.Mock<void, [string]>;
  /** Mirrors `TabManagerService.switchWorkspace`: path, tabs and active tab in one synchronous call. */
  loadWorkspace(
    path: string,
    ids: readonly string[],
    active: string | null,
  ): void;
}

function createTabManager(
  ids: readonly string[],
  active: string | null,
  workspace: string | null,
): TabManagerStub {
  const tabs = signal<readonly { readonly id: string }[]>(
    ids.map((id) => ({ id })),
  );
  const activeTabId = signal<string | null>(active);
  const activeWorkspacePath$ = signal<string | null>(workspace);
  // Mirrors `TabManagerService.switchTab`: an unknown id is a no-op.
  const switchTab = jest.fn<void, [string]>((id: string) => {
    if (tabs().some((tab) => tab.id === id)) activeTabId.set(id);
  });
  return {
    tabs,
    activeTabId,
    activeWorkspacePath$,
    switchTab,
    loadWorkspace(path, nextIds, nextActive): void {
      activeWorkspacePath$.set(path);
      tabs.set(nextIds.map((id) => ({ id })));
      activeTabId.set(nextActive);
    },
  };
}

interface SetUpOptions {
  readonly workspace?: string | null;
  readonly isElectron?: boolean;
}

/**
 * Let a navigation and any corrective replace it causes settle. Two rounds:
 * the first settles the navigation and runs reaction 1; the second settles a
 * correction it may have started.
 */
async function settle(): Promise<void> {
  await settleSurfaceNavigation();
  await settleSurfaceNavigation();
}

/** Keep the tracker busy without changing how the Router navigates in these specs. */
function startTransition(): {
  finish: () => Promise<void>;
  reject: () => Promise<void>;
} {
  let resolveFinished: () => void = () => undefined;
  let rejectFinished: (reason: Error) => void = () => undefined;
  const finished = new Promise<void>((resolve, reject) => {
    resolveFinished = resolve;
    rejectFinished = reject;
  });
  TestBed.inject(SurfaceTransitionTracker).track({
    ready: Promise.resolve(),
    updateCallbackDone: Promise.resolve(),
    finished,
    types: new Set<string>(),
    skipTransition: () => undefined,
  });
  return {
    async finish(): Promise<void> {
      resolveFinished();
      await finished;
      await Promise.resolve();
    },
    async reject(): Promise<void> {
      rejectFinished(new Error('transition skipped'));
      await finished.catch(() => undefined);
      await Promise.resolve();
    },
  };
}

describe('ChatTabRouteSync', () => {
  let tabManager: TabManagerStub;
  let router: Router;
  let location: PlatformLocation;
  let pushState: jest.SpyInstance;
  let replaceState: jest.SpyInstance;
  let settledUrls: string[];

  /**
   * Electron by default, with the workspace's tabs already loaded. Pass
   * `workspace: null` for the boot window before the first workspace switch.
   */
  function setUp(
    ids: readonly string[],
    active: string | null,
    { workspace = '/ws', isElectron = true }: SetUpOptions = {},
  ): void {
    tabManager = createTabManager(ids, active, workspace);
    TestBed.configureTestingModule({
      providers: [
        ...provideSurfaceRouterTesting(),
        { provide: TabManagerService, useValue: tabManager },
        { provide: VSCodeService, useValue: { isElectron } },
      ],
    });
    router = TestBed.inject(Router);
    location = TestBed.inject(PlatformLocation);
    pushState = jest.spyOn(location, 'pushState');
    replaceState = jest.spyOn(location, 'replaceState');
    settledUrls = [];
    router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) {
        settledUrls.push(event.urlAfterRedirects);
      }
    });
    TestBed.inject(ChatTabRouteSync).start();
  }

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.restoreAllMocks();
  });

  describe('URL → tab', () => {
    it('switches to an existing tab named by a deep link', async () => {
      setUp([TAB_A, TAB_B], TAB_A);

      await router.navigateByUrl(`/chat/${TAB_B}`);
      await settle();

      expect(tabManager.switchTab).toHaveBeenCalledTimes(1);
      expect(tabManager.switchTab).toHaveBeenCalledWith(TAB_B);
      expect(tabManager.activeTabId()).toBe(TAB_B);
      expect(router.url).toBe(`/chat/${TAB_B}`);
      // The URL already named the tab, so nothing was corrected.
      expect(settledUrls).toEqual([`/chat/${TAB_B}`]);
    });

    // An unknown but well-formed id, then a malformed one.
    it.each([TAB_UNKNOWN, 'not-a-tab-id'])(
      'corrects the tab id "%s" to the active tab with replaceUrl',
      async (id) => {
        setUp([TAB_A, TAB_B], TAB_A);

        await router.navigateByUrl(`/chat/${id}`);
        const pushesBeforeCorrection = pushState.mock.calls.length;
        await settle();

        expect(tabManager.switchTab).not.toHaveBeenCalled();
        expect(tabManager.activeTabId()).toBe(TAB_A);
        expect(router.url).toBe(`/chat/${TAB_A}`);
        expect(pushState.mock.calls).toHaveLength(pushesBeforeCorrection);
        expect(replaceState).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          `/chat/${TAB_A}`,
        );
      },
    );

    it('never switches to an invalid id even when a tab carries it', async () => {
      // A legacy, non-UUID tab id is honoured only while it is already active.
      setUp([TAB_A, 'legacy-tab'], TAB_A);

      await router.navigateByUrl('/chat/legacy-tab');
      await settle();

      expect(tabManager.switchTab).not.toHaveBeenCalled();
      expect(router.url).toBe(`/chat/${TAB_A}`);
    });

    it('corrects an unknown id to bare /chat when there is no active tab', async () => {
      setUp([], null);

      await router.navigateByUrl(`/chat/${TAB_UNKNOWN}`);
      await settle();

      expect(router.url).toBe('/chat');
      expect(tabManager.switchTab).not.toHaveBeenCalled();
    });

    it('completes a bare /chat to /chat/<active tab>', async () => {
      setUp([TAB_A], TAB_A);

      await router.navigateByUrl('/chat');
      const pushesBeforeCorrection = pushState.mock.calls.length;
      await settle();

      expect(router.url).toBe(`/chat/${TAB_A}`);
      expect(settledUrls).toEqual(['/chat', `/chat/${TAB_A}`]);
      expect(pushState.mock.calls).toHaveLength(pushesBeforeCorrection);
    });

    it('leaves a bare /chat alone when there is no active tab', async () => {
      setUp([], null);

      await router.navigateByUrl('/chat');
      await settle();

      expect(router.url).toBe('/chat');
      expect(settledUrls).toEqual(['/chat']);
    });

    it('ignores settles on other surfaces', async () => {
      setUp([TAB_A], TAB_A);

      await router.navigateByUrl('/settings');
      await settle();

      expect(router.url).toBe('/settings');
      expect(settledUrls).toEqual(['/settings']);
      expect(tabManager.switchTab).not.toHaveBeenCalled();
    });
  });

  describe('tab → URL', () => {
    it('replaces the URL on a tab switch, without a history push', async () => {
      setUp([TAB_A, TAB_B], TAB_A);
      await router.navigateByUrl(`/chat/${TAB_A}`);
      await settle();
      const pushesBefore = pushState.mock.calls.length;

      tabManager.activeTabId.set(TAB_B);
      await settle();

      expect(router.url).toBe(`/chat/${TAB_B}`);
      expect(pushState.mock.calls).toHaveLength(pushesBefore);
      expect(replaceState).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.anything(),
        `/chat/${TAB_B}`,
      );
    });

    it('writes bare /chat when the last tab closes', async () => {
      setUp([TAB_A], TAB_A);
      await router.navigateByUrl(`/chat/${TAB_A}`);
      await settle();

      tabManager.tabs.set([]);
      tabManager.activeTabId.set(null);
      await settle();

      expect(router.url).toBe('/chat');
    });

    it('follows the new active tab after a workspace switch', async () => {
      setUp([TAB_A, TAB_B], TAB_A);
      await router.navigateByUrl(`/chat/${TAB_A}`);
      await settle();

      // A workspace switch swaps the whole tab set and its active tab.
      tabManager.tabs.set([{ id: TAB_C }]);
      tabManager.activeTabId.set(TAB_C);
      await settle();

      expect(router.url).toBe(`/chat/${TAB_C}`);
      expect(tabManager.switchTab).not.toHaveBeenCalled();
    });

    it('does not write while a navigation is pending', async () => {
      setUp([TAB_A, TAB_B], TAB_A);
      await router.navigateByUrl(`/chat/${TAB_A}`);
      await settle();
      const settlesBefore = settledUrls.length;
      jest
        .spyOn(TestBed.inject(SurfaceRouterService), 'pendingSurface')
        .mockReturnValue('settings');

      tabManager.activeTabId.set(TAB_B);
      await settle();

      expect(router.url).toBe(`/chat/${TAB_A}`);
      expect(settledUrls).toHaveLength(settlesBefore);
    });

    it('does not write while another surface is showing, and catches up on return', async () => {
      setUp([TAB_A, TAB_B], TAB_A);
      await router.navigateByUrl(`/chat/${TAB_A}`);
      await settle();
      await router.navigateByUrl('/settings');
      await settle();

      tabManager.activeTabId.set(TAB_B);
      await settle();
      expect(router.url).toBe('/settings');

      // `AppStateManager.setCurrentView('chat')` lands on bare /chat.
      await TestBed.inject(SurfaceRouterService).navigateToSurface('chat');
      await settle();
      expect(router.url).toBe(`/chat/${TAB_B}`);
    });

    it('does not navigate before the first navigation has happened', async () => {
      // Under `withDisabledInitialNavigation()` the URL is `/` until the boot
      // navigation; writing /chat/<id> then would pre-empt a host deep link.
      setUp([TAB_A, TAB_B], TAB_A);

      tabManager.activeTabId.set(TAB_B);
      await settle();

      expect(settledUrls).toEqual([]);
      expect(router.navigated).toBe(false);
    });
  });

  describe('deferred URL correction during a page transition', () => {
    it('issues an idle correction in the same effect turn', async () => {
      setUp([TAB_A, TAB_B], TAB_A);
      await router.navigateByUrl(`/chat/${TAB_A}`);
      await settle();
      const navigate = jest.spyOn(TestBed.inject(SurfaceRouterService), 'navigateToSurface');

      tabManager.activeTabId.set(TAB_B);
      TestBed.tick();

      expect(navigate).toHaveBeenCalledWith('chat', [TAB_B], { replaceUrl: true });
      await settle();
    });

    it('waits for the transition and replaces once toward the latest tab', async () => {
      setUp([TAB_A, TAB_B, TAB_C], TAB_A);
      await router.navigateByUrl('/settings');
      const transition = startTransition();
      const navigate = jest.spyOn(TestBed.inject(SurfaceRouterService), 'navigateToSurface');

      await router.navigateByUrl('/chat');
      tabManager.activeTabId.set(TAB_B);
      TestBed.tick();
      tabManager.activeTabId.set(TAB_C);
      TestBed.tick();
      expect(navigate).not.toHaveBeenCalled();

      await transition.finish();
      await settle();
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith('chat', [TAB_C], { replaceUrl: true });
      expect(router.url).toBe(`/chat/${TAB_C}`);
    });

    it('discards a queued correction after chat to settings within 80 ms', async () => {
      setUp([TAB_A], TAB_A);
      await router.navigateByUrl('/settings');
      const transition = startTransition();
      const navigate = jest.spyOn(TestBed.inject(SurfaceRouterService), 'navigateToSurface');

      await router.navigateByUrl('/chat');
      expect(navigate).not.toHaveBeenCalled();
      expect(await router.navigateByUrl('/settings')).toBe(true);
      await transition.finish();
      await settle();

      expect(navigate).not.toHaveBeenCalled();
      expect(router.url).toBe('/settings');
      expect(router.navigated).toBe(true);
      expect(settledUrls).toEqual(['/settings', '/chat', '/settings']);
    });

    it('does not return to chat after a second transition to tasks', async () => {
      setUp([TAB_A], TAB_A);
      await router.navigateByUrl('/settings');
      const first = startTransition();
      const navigate = jest.spyOn(TestBed.inject(SurfaceRouterService), 'navigateToSurface');

      await router.navigateByUrl('/chat');
      const second = startTransition();
      expect(await router.navigateByUrl('/tasks')).toBe(true);
      await first.finish();
      expect(navigate).not.toHaveBeenCalled();
      await second.finish();
      await settle();

      expect(navigate).not.toHaveBeenCalled();
      expect(router.url).toBe('/tasks');
    });

    it('does not overwrite a newer chat navigation', async () => {
      setUp([TAB_A, TAB_B], TAB_A);
      await router.navigateByUrl('/settings');
      const transition = startTransition();
      const navigate = jest.spyOn(TestBed.inject(SurfaceRouterService), 'navigateToSurface');

      await router.navigateByUrl('/chat');
      expect(await router.navigateByUrl(`/chat/${TAB_B}`)).toBe(true);
      await transition.finish();
      await settle();

      expect(navigate).not.toHaveBeenCalled();
      expect(router.url).toBe(`/chat/${TAB_B}`);
      expect(tabManager.activeTabId()).toBe(TAB_B);
    });

    it.each(['cancel', 'error'] as const)(
      'reconciles a dropped correction after a navigation %s',
      async (outcome) => {
        setUp([TAB_A], TAB_A);
        await router.navigateByUrl('/settings');
        const transition = startTransition();
        await router.navigateByUrl('/chat');
        router.resetConfig(router.config.map((route) => route.path === 'settings'
          ? { ...route, canActivate: [() => outcome === 'cancel' ? false : Promise.reject(new Error('guard failed'))] }
          : route));

        if (outcome === 'cancel') {
          expect(await router.navigateByUrl('/settings')).toBe(false);
        } else {
          await expect(router.navigateByUrl('/settings')).rejects.toThrow('guard failed');
        }
        await transition.finish();
        await settle();

        expect(router.url).toBe(`/chat/${TAB_A}`);
        expect(replaceState).toHaveBeenCalledWith(
          expect.anything(), expect.anything(), `/chat/${TAB_A}`,
        );
      },
    );

    it('retries a dropped correction after the pending surface clears in the next microtask', async () => {
      setUp([TAB_A], TAB_A);
      await router.navigateByUrl('/settings');
      const transition = startTransition();
      await router.navigateByUrl('/chat');
      router.resetConfig(router.config.map((route) => route.path === 'settings'
        ? { ...route, canActivate: [() => false] }
        : route));
      const sync = TestBed.inject(ChatTabRouteSync) as unknown as { reconcileDroppedCorrection: () => void };
      const reconcile = jest.spyOn(sync, 'reconcileDroppedCorrection');
      const pending = jest.spyOn(TestBed.inject(SurfaceRouterService), 'pendingSurface');
      router.events.subscribe((event) => {
        if (event instanceof NavigationCancel) {
          pending.mockReturnValue('settings');
          queueMicrotask(() => pending.mockReturnValue(null));
        }
      });

      expect(await router.navigateByUrl('/settings')).toBe(false);
      expect(reconcile).toHaveBeenCalledTimes(2);
      await transition.finish();
      await settle();

      expect(router.url).toBe(`/chat/${TAB_A}`);
      expect(replaceState).toHaveBeenCalledWith(
        expect.anything(), expect.anything(), `/chat/${TAB_A}`,
      );
    });

    it('does not issue a correction while another surface is pending', async () => {
      setUp([TAB_A], TAB_A);
      await router.navigateByUrl('/settings');
      const transition = startTransition();
      const surfaceRouter = TestBed.inject(SurfaceRouterService);
      const navigate = jest.spyOn(surfaceRouter, 'navigateToSurface');

      await router.navigateByUrl('/chat');
      jest.spyOn(surfaceRouter, 'pendingSurface').mockReturnValue('settings');
      await transition.finish();

      expect(navigate).not.toHaveBeenCalled();
    });

    it('flushes a correction when the transition finishes with rejection', async () => {
      setUp([TAB_A], TAB_A);
      await router.navigateByUrl('/settings');
      const transition = startTransition();
      const navigate = jest.spyOn(TestBed.inject(SurfaceRouterService), 'navigateToSurface');

      await router.navigateByUrl('/chat');
      await transition.reject();
      await settle();

      expect(navigate).toHaveBeenCalledTimes(1);
      expect(router.url).toBe(`/chat/${TAB_A}`);
    });
  });

  describe('boot: a restored URL settles before the workspace tabs load', () => {
    it('holds the tab id, then selects it once the workspace tabs contain it', async () => {
      // The legacy panel tabs are loaded; the workspace's are not, yet.
      setUp([TAB_A], TAB_A, { workspace: null });

      await router.navigateByUrl(`/chat/${TAB_B}`);
      await settle();
      expect(router.url).toBe(`/chat/${TAB_B}`);
      expect(tabManager.switchTab).not.toHaveBeenCalled();

      // The first `switchWorkspace`, whose stored active tab is A.
      tabManager.loadWorkspace('/ws', [TAB_A, TAB_B], TAB_A);
      await settle();

      expect(tabManager.switchTab).toHaveBeenCalledTimes(1);
      expect(tabManager.switchTab).toHaveBeenCalledWith(TAB_B);
      expect(tabManager.activeTabId()).toBe(TAB_B);
      expect(router.url).toBe(`/chat/${TAB_B}`);
      // Nothing else ever settled, so persistence never wrote a correction.
      expect(settledUrls).toEqual([`/chat/${TAB_B}`]);
    });

    it('corrects the held id when the loaded workspace does not have it', async () => {
      setUp([TAB_A], TAB_A, { workspace: null });
      await router.navigateByUrl(`/chat/${TAB_B}`);
      await settle();

      tabManager.loadWorkspace('/ws', [TAB_A, TAB_C], TAB_C);
      await settle();

      expect(tabManager.switchTab).not.toHaveBeenCalled();
      expect(tabManager.activeTabId()).toBe(TAB_C);
      expect(router.url).toBe(`/chat/${TAB_C}`);
    });

    it('holds an id the legacy tabs already have active, against a load that activates another', async () => {
      setUp([TAB_A], TAB_A, { workspace: null });
      await router.navigateByUrl(`/chat/${TAB_A}`);
      await settle();

      // The workspace keeps A but its stored active tab is B.
      tabManager.loadWorkspace('/ws', [TAB_A, TAB_B], TAB_B);
      await settle();

      expect(tabManager.switchTab).toHaveBeenLastCalledWith(TAB_A);
      expect(tabManager.activeTabId()).toBe(TAB_A);
      expect(router.url).toBe(`/chat/${TAB_A}`);
      expect(settledUrls).toEqual([`/chat/${TAB_A}`]);
    });

    it('shows a legacy tab the URL names at once, and still holds it across the load', async () => {
      setUp([TAB_A, TAB_C], TAB_A, { workspace: null });
      await router.navigateByUrl(`/chat/${TAB_C}`);
      await settle();
      expect(tabManager.activeTabId()).toBe(TAB_C);

      tabManager.loadWorkspace('/ws', [TAB_B, TAB_C], TAB_B);
      await settle();

      expect(tabManager.activeTabId()).toBe(TAB_C);
      expect(router.url).toBe(`/chat/${TAB_C}`);
      expect(settledUrls).toEqual([`/chat/${TAB_C}`]);
    });

    it('corrects a malformed id at once, without waiting for the tabs', async () => {
      setUp([TAB_A], TAB_A, { workspace: null });

      await router.navigateByUrl('/chat/not-a-tab-id');
      await settle();

      expect(router.url).toBe(`/chat/${TAB_A}`);
    });

    it('drops the held id when the user picks a tab before the tabs load', async () => {
      setUp([TAB_A, TAB_C], TAB_A, { workspace: null });
      await router.navigateByUrl(`/chat/${TAB_B}`);
      await settle();

      tabManager.switchTab(TAB_C);
      await settle();
      expect(router.url).toBe(`/chat/${TAB_C}`);

      tabManager.loadWorkspace('/ws', [TAB_A, TAB_B, TAB_C], TAB_C);
      await settle();

      expect(tabManager.activeTabId()).toBe(TAB_C);
      expect(router.url).toBe(`/chat/${TAB_C}`);
      expect(tabManager.switchTab).not.toHaveBeenCalledWith(TAB_B);
    });

    it('does not wait on VS Code, where the panel tabs are final from the start', async () => {
      // VS Code never calls `switchWorkspace`, so `activeWorkspacePath$` stays
      // null for the page's lifetime.
      setUp([TAB_A], TAB_A, { workspace: null, isElectron: false });

      await router.navigateByUrl(`/chat/${TAB_UNKNOWN}`);
      await settle();

      expect(router.url).toBe(`/chat/${TAB_A}`);
    });
  });

  describe('race: the active tab changes while a correction is in flight', () => {
    /** Switch to `tabId` the moment the Router starts navigating to `url`. */
    function switchTabWhenNavigationStarts(
      url: string,
      tabId: string,
      flushEffects: boolean,
    ): void {
      let done = false;
      router.events.subscribe((event) => {
        if (done || !(event instanceof NavigationStart) || event.url !== url) {
          return;
        }
        done = true;
        tabManager.switchTab(tabId);
        // Runs reaction 2 while the correction is still pending.
        if (flushEffects) TestBed.tick();
      });
    }

    it('does not switch back when its own correction lands late', async () => {
      setUp([TAB_A, TAB_B], TAB_A);
      switchTabWhenNavigationStarts(`/chat/${TAB_A}`, TAB_B, false);

      await router.navigateByUrl('/chat');
      await settle();
      await settle();

      expect(tabManager.switchTab.mock.calls).toEqual([[TAB_B]]);
      expect(tabManager.activeTabId()).toBe(TAB_B);
      expect(router.url).toBe(`/chat/${TAB_B}`);
    });

    it('carries a switch the effect skipped while pending into the landing', async () => {
      setUp([TAB_A, TAB_B], TAB_A);
      switchTabWhenNavigationStarts(`/chat/${TAB_A}`, TAB_B, true);

      await router.navigateByUrl('/chat');
      await settle();
      await settle();

      expect(tabManager.switchTab.mock.calls).toEqual([[TAB_B]]);
      expect(tabManager.activeTabId()).toBe(TAB_B);
      expect(router.url).toBe(`/chat/${TAB_B}`);
    });
  });

  it('never loops: each change settles in a bounded number of navigations', async () => {
    setUp([TAB_A, TAB_B, TAB_C], TAB_A);

    await router.navigateByUrl('/chat');
    await settle();
    tabManager.activeTabId.set(TAB_B);
    await settle();
    await router.navigateByUrl(`/chat/${TAB_C}`);
    await settle();
    await router.navigateByUrl(`/chat/${TAB_UNKNOWN}`);
    await settle();
    await settle();

    expect(settledUrls).toEqual([
      '/chat',
      `/chat/${TAB_A}`, // completion of the bare URL
      `/chat/${TAB_B}`, // tab switch written
      `/chat/${TAB_C}`, // deep link honoured, no correction
      `/chat/${TAB_UNKNOWN}`,
      `/chat/${TAB_C}`, // one correction, then quiet
    ]);
    expect(tabManager.activeTabId()).toBe(TAB_C);
  });

  it('is idempotent: a second start installs nothing more', async () => {
    setUp([TAB_A, TAB_B], TAB_A);
    TestBed.inject(ChatTabRouteSync).start();

    await router.navigateByUrl(`/chat/${TAB_B}`);
    await settle();

    expect(tabManager.switchTab).toHaveBeenCalledTimes(1);
  });
});
