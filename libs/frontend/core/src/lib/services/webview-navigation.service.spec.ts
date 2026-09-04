/**
 * WebviewNavigationService unit specs.
 *
 * Strategy: Provide a real AppStateManager (no external deps) alongside
 * WebviewNavigationService. Drive navigation through the public API and
 * assert signal state changes.
 */

import { TestBed } from '@angular/core/testing';
import { WebviewNavigationService } from './webview-navigation.service';
import { AppStateManager, ViewType } from './app-state.service';

describe('WebviewNavigationService', () => {
  let service: WebviewNavigationService;
  let appState: AppStateManager;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [WebviewNavigationService, AppStateManager],
    });
    service = TestBed.inject(WebviewNavigationService);
    appState = TestBed.inject(AppStateManager);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  // ── Initial state ─────────────────────────────────────────────────────────

  it('starts with isNavigating=false', () => {
    expect(service.isNavigating()).toBe(false);
  });

  it('currentView() matches appState.currentView() at initialization', () => {
    expect(service.currentView()).toBe(appState.currentView());
  });

  it('starts with navigationErrors=[]', () => {
    expect(service.navigationErrors()).toHaveLength(0);
  });

  // ── navigateToView — happy paths ──────────────────────────────────────────

  it('navigateToView() returns true and updates currentView when canNavigate is true', async () => {
    // canNavigate requires not loading and connected — default AppStateManager should satisfy
    const result = await service.navigateToView('analytics');
    expect(result).toBe(true);
    expect(service.currentView()).toBe('analytics');
  });

  it('navigateToView() returns true without pushing history when view is same as current', async () => {
    const currentView = service.currentView();
    const historyBefore = service.navigationHistory().length;

    const result = await service.navigateToView(currentView);

    expect(result).toBe(true);
    // History should not grow for same-view navigation
    expect(service.navigationHistory().length).toBe(historyBefore);
  });

  it('navigateToView() updates previousView to the old current view', async () => {
    const initialView = service.currentView();
    await service.navigateToView('settings');

    expect(service.previousView()).toBe(initialView);
  });

  it('navigateToView() appends new view to navigation history', async () => {
    const historyBefore = service.navigationHistory().length;
    await service.navigateToView('analytics');

    expect(service.navigationHistory().length).toBe(historyBefore + 1);
    expect(
      service.navigationHistory()[service.navigationHistory().length - 1],
    ).toBe('analytics');
  });

  it('navigateToView() updates AppStateManager currentView', async () => {
    await service.navigateToView('settings');
    expect(appState.currentView()).toBe('settings');
  });

  it('navigateToView() returns false when canNavigate is false (loading=true)', async () => {
    // Simulate loading state to block navigation
    (
      appState as unknown as { _isLoading: { set: (v: boolean) => void } }
    )._isLoading.set(true);

    const result = await service.navigateToView('analytics');
    expect(result).toBe(false);
    // View should not have changed
    expect(service.currentView()).toBe('chat');
  });

  // ── navigateBack ──────────────────────────────────────────────────────────

  it('navigateBack() returns false when there is no previousView', async () => {
    expect(service.previousView()).toBeNull();
    const result = await service.navigateBack();
    expect(result).toBe(false);
  });

  it('navigateBack() navigates to previousView when it exists', async () => {
    await service.navigateToView('analytics');
    const prevView = service.previousView();

    const result = await service.navigateBack();

    expect(result).toBe(true);
    expect(service.currentView()).toBe(prevView);
  });

  // ── getCurrentView ────────────────────────────────────────────────────────

  it('getCurrentView() returns the same value as currentView signal', async () => {
    await service.navigateToView('settings');
    expect(service.getCurrentView()).toBe(service.currentView());
    expect(service.getCurrentView()).toBe('settings');
  });

  // ── canNavigateToView ─────────────────────────────────────────────────────

  it('canNavigateToView() returns false for the current view', () => {
    const currentView = service.currentView();
    expect(service.canNavigateToView(currentView)).toBe(false);
  });

  it('canNavigateToView() returns true for a different view when canNavigate=true', () => {
    const differentView: ViewType =
      service.currentView() === 'chat' ? 'analytics' : 'chat';
    expect(service.canNavigateToView(differentView)).toBe(true);
  });

  it('canNavigateToView() returns false for different view when canNavigate=false', () => {
    (
      appState as unknown as { _isLoading: { set: (v: boolean) => void } }
    )._isLoading.set(true);
    const differentView: ViewType =
      service.currentView() === 'chat' ? 'analytics' : 'chat';
    expect(service.canNavigateToView(differentView)).toBe(false);
  });

  // ── getNavigationMetrics ──────────────────────────────────────────────────

  it('getNavigationMetrics() returns reliability=1.0 with zero errors', async () => {
    await service.navigateToView('analytics');

    const metrics = service.getNavigationMetrics();
    expect(metrics.totalNavigations).toBeGreaterThan(0);
    expect(metrics.overallReliability).toBe(1.0);
    expect(metrics.signalSuccessRate).toBe(1.0);
    expect(metrics.averageNavigationTime).toBe(1);
  });

  it('getNavigationMetrics() returns reliability=1.0 when total navigations=0', () => {
    // Force history to be empty
    (service as never)['_navigationHistory'].set([]);
    (service as never)['_navigationErrors'].set([]);

    const metrics = service.getNavigationMetrics();
    expect(metrics.overallReliability).toBe(1.0);
  });

  // ── navigationReliability computed ───────────────────────────────────────

  it('navigationReliability computed returns correct ratio when errors exist', () => {
    // Seed 5 navigations and 2 errors manually
    (service as never)['_navigationHistory'].set([
      'chat',
      'analytics',
      'settings',
      'chat',
      'analytics',
    ] as ViewType[]);
    (service as never)['_navigationErrors'].set(['err1', 'err2']);

    const reliability = service.navigationReliability();
    // (5 - 2) / 5 = 0.6
    expect(reliability).toBeCloseTo(0.6, 5);
  });

  // ── clearNavigationHistory ────────────────────────────────────────────────

  it('clearNavigationHistory() resets history to [currentView] and clears errors', async () => {
    await service.navigateToView('analytics');
    await service.navigateToView('settings');

    // Seed an error
    (service as never)['_navigationErrors'].set(['some error']);

    service.clearNavigationHistory();

    expect(service.navigationHistory()).toHaveLength(1);
    expect(service.navigationHistory()[0]).toBe(service.currentView());
    expect(service.navigationErrors()).toHaveLength(0);
  });

  // ── history size limit ────────────────────────────────────────────────────

  it('navigation history is trimmed to last 50 entries after 51 navigations', async () => {
    // Navigate back and forth to build up history
    const views: ViewType[] = [
      'analytics',
      'settings',
      'chat',
      'command-builder',
      'context-tree',
    ];
    for (let i = 0; i < 52; i++) {
      await service.navigateToView(views[i % views.length]);
    }

    // History should not exceed 50
    expect(service.navigationHistory().length).toBeLessThanOrEqual(50);
  });

  // ── single source of truth for "where am I" (TASK_2026_317) ───────────────
  //
  // Plenty of callers set the view straight on AppStateManager — every tab in
  // the Electron navbar, and the extension host's `switchView` message. This
  // service used to keep its own mirror of the current view and short-circuit
  // `navigateToView` against it, so once those two disagreed a navigation
  // button reported success and went nowhere. "Resume New Project" was that
  // button: visit the harness builder once, come back via the Setup tab, and
  // the mirror still said `harness-builder`.

  it('currentView() tracks a view set directly on AppStateManager', () => {
    appState.setCurrentView('setup-hub');
    expect(service.currentView()).toBe('setup-hub');
  });

  it('navigateToView() still navigates after app state moved underneath it', async () => {
    // 1. Go to the builder through this service (the mirror now says so too).
    await service.navigateToView('harness-builder');
    expect(appState.currentView()).toBe('harness-builder');

    // 2. Leave via a navbar tab, which bypasses this service entirely.
    appState.setCurrentView('setup-hub');

    // 3. "Resume New Project" — must actually go back to the builder.
    const result = await service.navigateToView('harness-builder');

    expect(result).toBe(true);
    expect(appState.currentView()).toBe('harness-builder');
    expect(service.currentView()).toBe('harness-builder');
  });

  it('canNavigateToView() reflects app state set elsewhere', () => {
    appState.setCurrentView('setup-hub');
    expect(service.canNavigateToView('setup-hub')).toBe(false);
    expect(service.canNavigateToView('harness-builder')).toBe(true);
  });

  it('previousView() is where the user actually was, not this service’s last hop', async () => {
    await service.navigateToView('harness-builder');
    appState.setCurrentView('setup-hub'); // navbar tab
    await service.navigateToView('harness-builder');

    expect(service.previousView()).toBe('setup-hub');
  });

  // Every card on the Setup Hub navigates through this service, and every one
  // of them was reachable from the navbar's Setup tab — so the stale mirror
  // broke all four the same way, not just Resume New Project. Table-driven so
  // a fifth card cannot be added without landing here.
  describe.each([
    ['Workspace Analysis', 'setup-wizard'],
    ['AI Team Builder', 'harness-builder'],
    ['Resume New Project', 'harness-builder'],
    ['Convene a Tribunal', 'tribunal'],
  ] as const)('Setup Hub card: %s → %s', (_card, target) => {
    it('navigates on the second visit, after returning via the navbar Setup tab', async () => {
      await service.navigateToView(target);
      expect(appState.currentView()).toBe(target);

      // The navbar tab — `appState.setCurrentView` with no navigation service.
      appState.setCurrentView('setup-hub');
      expect(service.currentView()).toBe('setup-hub');

      const result = await service.navigateToView(target);

      expect(result).toBe(true);
      expect(appState.currentView()).toBe(target);
    });

    it('navigates again after the extension host switched the view', async () => {
      await service.navigateToView(target);
      // `MESSAGE_TYPES.SWITCH_VIEW` → AppStateManager.handleMessage, which
      // also bypasses this service entirely.
      appState.handleMessage({
        type: 'switchView',
        payload: { view: 'setup-hub' },
      });
      expect(service.currentView()).toBe('setup-hub');

      await expect(service.navigateToView(target)).resolves.toBe(true);
      expect(appState.currentView()).toBe(target);
    });
  });

  // ── error handling in updateNavigationState ────────────────────────────────

  it('navigateToView() returns false and records error when updateNavigationState throws', async () => {
    const consoleSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);

    // Force an error by making appState.setCurrentView throw
    jest.spyOn(appState, 'setCurrentView').mockImplementationOnce(() => {
      throw new Error('state update failed');
    });

    const result = await service.navigateToView('analytics');

    expect(result).toBe(false);
    expect(service.navigationErrors().length).toBeGreaterThan(0);
    expect(service.navigationErrors()[0]).toContain('analytics');
    consoleSpy.mockRestore();
  });
});
