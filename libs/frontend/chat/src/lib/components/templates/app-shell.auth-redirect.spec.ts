/**
 * The startup auth redirect must not cancel a newer user navigation.
 *
 * `AppShellComponent`'s constructor effect calls `loadAuthStatus()` once on
 * chat and, if no credential is configured, sends the user to Settings. That
 * callback resolves 2-5 s later (TASK_2026_342), and `currentView()` follows
 * `NavigationEnd` — so it still reads `chat` for as long as a lazy route's
 * chunk is loading. Click Thoth, let auth resolve in that window, and the
 * redirect used to cancel the click and land the user on Settings
 * (TASK_2026_524 revision 1, F2).
 *
 * **How this is tested.** `TestBed.overrideComponent` replaces the 700-line
 * template with an empty one, so the REAL component class, its REAL
 * constructor effect and the REAL `AppStateManager` / Router run without
 * dragging in Monaco, the chat transcript or an RPC bridge. The condition
 * under test is the component's own, not a copy of it — which is the one thing
 * a hand-rolled reproduction of the callback could not give.
 */

import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  AppStateManager,
  AuthStateService,
  BootStatusService,
  ClaudeRpcService,
  SurfaceRouterService,
  VSCodeService,
} from '@ptah-extension/core';
import { provideSurfaceRouterTesting } from '@ptah-extension/core/testing';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import {
  ConfirmationDialogService,
  TabManagerService,
} from '@ptah-extension/chat-state';
import { signal } from '@angular/core';
import { AppShellComponent } from './app-shell.component';
import { ChatStore } from '../../services/chat.store';
import { KeyboardShortcutsService } from '../../services/keyboard-shortcuts.service';
import { SessionDisplayUtils } from '../../services/session-display-utils.service';

interface AuthStub {
  loadAuthStatus: jest.Mock<Promise<void>, []>;
  isLoaded: () => boolean;
  hasAnyAuth: () => boolean;
}

/** Resolves the auth promise by hand, so the race window is ours to choose. */
function createAuthStub(hasAnyAuth: boolean): AuthStub & {
  settle: () => void;
} {
  let release: (() => void) | undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    loadAuthStatus: jest.fn(() => pending),
    isLoaded: () => true,
    hasAnyAuth: () => hasAnyAuth,
    settle: () => release?.(),
  };
}

function configure(auth: AuthStub): void {
  TestBed.configureTestingModule({
    providers: [
      ...provideSurfaceRouterTesting(),
      AppStateManager,
      { provide: AuthStateService, useValue: auth },
      { provide: KeyboardShortcutsService, useValue: {} },
      { provide: SessionDisplayUtils, useValue: {} },
      { provide: ConfirmationDialogService, useValue: { confirm: jest.fn() } },
      { provide: ClaudeRpcService, useValue: { call: jest.fn() } },
      { provide: AgentMonitorStore, useValue: {} },
      { provide: TabManagerService, useValue: { activeTab: signal(null) } },
      { provide: ChatStore, useValue: { sessions: signal([]) } },
      {
        provide: BootStatusService,
        useValue: { isBooting: signal(false), phase: signal('ready') },
      },
      {
        provide: VSCodeService,
        useValue: { isElectron: false, getPtahIconUri: () => '' },
      },
    ],
  });
  // The class, its constructor effect and its DI are real; only the template
  // is stubbed out.
  TestBed.overrideComponent(AppShellComponent, {
    set: { template: '', imports: [], providers: [] },
  });
}

/**
 * Let navigations land and effects flush.
 *
 * `fixture.whenStable()`, NOT `settleSurfaceNavigation()`: this spec has a
 * component fixture, and the fixture owns change detection —
 * `TestBed.tick()` underneath it raises
 * `NG0101: ApplicationRef.tick is called recursively`. That is the rule
 * documented on `settleSurfaceNavigation`.
 */
async function settle(
  fixture: ComponentFixture<AppShellComponent>,
): Promise<void> {
  // The macrotask first: `whenStable()` waits on tasks that ALREADY exist, and
  // the auth callback that starts the redirect navigation is still a queued
  // microtask at the moment this is called.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await fixture.whenStable();
}

/**
 * Drain microtasks WITHOUT waiting for the Router.
 *
 * Needed once a deliberately-hanging lazy route is in flight:
 * `fixture.whenStable()` waits on the Router's pending navigation task, so it
 * would never resolve. The assertions that follow read computeds
 * (`currentView()`, `pendingSurface()`), which need no change-detection pass.
 */
function flushMicrotasks(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/** Replace `thoth` with a route whose chunk never arrives. */
function installHangingThothRoute(): void {
  TestBed.inject(Router).resetConfig([
    { path: 'chat', children: [] },
    { path: 'settings', children: [] },
    {
      path: 'thoth',
      loadComponent: () => new Promise<never>(() => undefined),
    },
    { path: '**', redirectTo: 'chat' },
  ]);
}

describe('AppShellComponent startup auth redirect', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    jest.restoreAllMocks();
  });

  it('does NOT redirect to settings when the user has already navigated away', async () => {
    const auth = createAuthStub(false);
    configure(auth);
    const fixture = TestBed.createComponent(AppShellComponent);
    const appState = TestBed.inject(AppStateManager);
    const surfaceRouter = TestBed.inject(SurfaceRouterService);
    fixture.detectChanges();
    await settle(fixture);
    installHangingThothRoute();
    await surfaceRouter.navigateToSurface('chat');
    await settle(fixture);
    expect(auth.loadAuthStatus).toHaveBeenCalled();

    // The user clicks Thoth. Its chunk never arrives, so `currentView()` still
    // reports chat — the exact window F2 lives in.
    appState.setCurrentView('thoth');
    await flushMicrotasks();
    expect(appState.currentView()).toBe('chat');
    expect(surfaceRouter.pendingSurface()).toBe('thoth');

    // Auth now resolves with no credentials.
    auth.settle();
    await flushMicrotasks();
    await flushMicrotasks();

    // Before the fix this read 'settings': the guard tested the SETTLED
    // surface, which was still chat.
    expect(appState.currentView()).not.toBe('settings');
    expect(surfaceRouter.pendingSurface()).toBe('thoth');
  });

  it('still redirects to settings when the user has not navigated anywhere', async () => {
    // The guard must suppress the redirect only when it would cancel
    // something. Without this case the fix could be "never redirect".
    const auth = createAuthStub(false);
    configure(auth);
    const fixture = TestBed.createComponent(AppShellComponent);
    const appState = TestBed.inject(AppStateManager);
    fixture.detectChanges();
    await settle(fixture);
    await TestBed.inject(SurfaceRouterService).navigateToSurface('chat');
    await settle(fixture);

    auth.settle();
    await settle(fixture);

    expect(appState.currentView()).toBe('settings');
  });

  it('does not redirect when a credential IS configured', async () => {
    const auth = createAuthStub(true);
    configure(auth);
    const fixture = TestBed.createComponent(AppShellComponent);
    const appState = TestBed.inject(AppStateManager);
    fixture.detectChanges();
    await settle(fixture);

    auth.settle();
    await settle(fixture);

    expect(appState.currentView()).toBe('chat');
  });
});
