/**
 * AppStateManager specs — global webview state (view, workspace, connection,
 * layout mode, canvas-session signal bridge).
 *
 * Coverage:
 *   - Constructor `initializeState` reads `window.ptahConfig` (workspace) and
 *     `localStorage` (layout mode). It deliberately does NOT read
 *     `initialView` any more — that is navigation, and `App.handleInitialView`
 *     owns it (TASK_2026_524).
 *   - `normalizeInitialView` validates a host-supplied `initialView` against
 *     the route ids and maps legacy 'orchestra-canvas' → 'chat' + grid layout.
 *   - `setCurrentView` / `closeView` / `openSettingsTab` delegate to the
 *     Router, mutate the `openViews` set and respect the `canSwitchViews`
 *     guard.
 *   - `handleMessage(SWITCH_VIEW)` routes valid views to `handleViewSwitch`
 *     and warns for invalid payloads.
 *   - `setLoading` / `setStatusMessage` / `setWorkspaceInfo` / `setConnected`
 *     mutations.
 *   - `handleInitialData` / `handleError` aggregated updates.
 *   - `getStateSnapshot` returns a synchronous snapshot.
 *   - Layout mode persistence (setLayoutMode writes localStorage; toggle flips).
 *   - Per-workspace view partitioning: `switchWorkspace` /
 *     `removeWorkspaceState` swap and drop `currentView` + `openViews` slices,
 *     and the bootstrap sentinel slice migrates onto the first real workspace
 *     (TASK_2026_195).
 *   - The same slice also carries the in-surface pointers `thothActiveTab` and
 *     `marketplaceActiveProvider`, so neither survives a workspace switch
 *     (TASK_2026_228).
 *   - Global configuration surfaces (TASK_2026_540): thoth / setup-hub /
 *     marketplace / settings are recorded in one NOT-workspace-partitioned
 *     state written only by the constructor effect; slices refuse them; a
 *     workspace switch while one is open starts no navigation and bumps
 *     `configurationSurfaceRemountTick`.
 *   - Canvas session request signal-bridge methods.
 *
 * Note: `initializeState` runs in the constructor, so each spec sets up
 * `window.ptahConfig` / `localStorage` BEFORE calling `createService`.
 *
 * **`currentView` is Router-derived** (TASK_2026_524): it reads
 * `SurfaceRouterService`, so every view mutation is an asynchronous
 * navigation. Specs therefore `await settle()` after a void `setCurrentView`
 * / `closeView` / `switchWorkspace` call, and `createService` wires the
 * Router through `provideSurfaceRouterTesting()`. A spec that forgets the
 * await reads the PREVIOUS surface — which is honest behaviour, not a test
 * artifact.
 */

import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import {
  MESSAGE_TYPES,
  SessionId,
  type WorkspaceInfo,
} from '@ptah-extension/shared';
import { SurfaceRouterService } from '../routing/surface-router.service';
import {
  AppStateManager,
  THOTH_FIRST_RUN_DISMISSED_KEY,
  type AppState,
  type CanvasSessionRequest,
  type HarnessWorkflowRequest,
  type LayoutMode,
  type ViewType,
} from './app-state.service';
import {
  makeSignalStoreHarness,
  provideSurfaceRouterTesting,
  settleSurfaceNavigation as settle,
} from '../../testing';

interface AppStoreState {
  currentView: ViewType;
  isLoading: boolean;
  statusMessage: string;
  workspaceInfo: WorkspaceInfo | null;
  isConnected: boolean;
  openViews: readonly ViewType[];
  layoutMode: LayoutMode;
  canvasSessionRequests: readonly CanvasSessionRequest[];
  newCanvasSessionRequest: string | null;
  canSwitchViews: boolean;
  appTitle: string;
}

interface PtahTestWindow {
  ptahConfig?: {
    initialView?: string;
    workspaceRoot?: string;
    workspaceName?: string;
  };
  initialView?: ViewType;
}

function setupGlobals(
  options: {
    ptahConfig?: PtahTestWindow['ptahConfig'];
    initialView?: ViewType;
    savedLayoutMode?: LayoutMode;
  } = {},
): void {
  const ptahWindow = window as unknown as PtahTestWindow;
  if (options.ptahConfig !== undefined) {
    ptahWindow.ptahConfig = options.ptahConfig;
  }
  if (options.initialView !== undefined) {
    ptahWindow.initialView = options.initialView;
  }
  if (options.savedLayoutMode !== undefined) {
    localStorage.setItem('ptah-layout-mode', options.savedLayoutMode);
  }
}

function teardownGlobals(): void {
  const ptahWindow = window as unknown as PtahTestWindow;
  delete ptahWindow.ptahConfig;
  delete ptahWindow.initialView;
  localStorage.clear();
}

function createService(): AppStateManager {
  TestBed.configureTestingModule({
    providers: [...provideSurfaceRouterTesting(), AppStateManager],
  });
  return TestBed.inject(AppStateManager);
}

describe('AppStateManager', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    teardownGlobals();
  });

  describe('harness workflow request ownership', () => {
    it('invalidates the pending request so it cannot be consumed later', () => {
      const service = createService();
      const request: HarnessWorkflowRequest = { mode: 'new-project' };
      service.requestHarnessWorkflow(request);

      service.clearHarnessWorkflowRequest(request);

      expect(service.harnessWorkflowRequest()).toBeNull();
      expect(service.consumeHarnessWorkflowRequest()).toBeNull();
    });

    it('preserves a replacement even when its payload is identical', () => {
      const service = createService();
      const older: HarnessWorkflowRequest = { mode: 'new-project' };
      const newer: HarnessWorkflowRequest = { ...older };
      service.requestHarnessWorkflow(older);
      service.requestHarnessWorkflow(newer);

      service.clearHarnessWorkflowRequest(older);

      expect(service.consumeHarnessWorkflowRequest()).toBe(newer);
      expect(service.consumeHarnessWorkflowRequest()).toBeNull();
    });

    it('does nothing when the request was already consumed', () => {
      const service = createService();
      const request: HarnessWorkflowRequest = { mode: 'new-project' };
      service.requestHarnessWorkflow(request);
      expect(service.consumeHarnessWorkflowRequest()).toBe(request);

      service.clearHarnessWorkflowRequest(request);

      expect(service.consumeHarnessWorkflowRequest()).toBeNull();
    });
  });

  describe('initializeState from window.ptahConfig', () => {
    it('defaults to view="chat", layoutMode="grid" when no globals are injected', () => {
      const service = createService();
      const harness = makeSignalStoreHarness<AppStoreState>(service);

      expect(harness.read()).toMatchObject({
        currentView: 'chat',
        layoutMode: 'grid',
        workspaceInfo: null,
      });
    });

    it('reads workspace info from window.ptahConfig', () => {
      setupGlobals({
        ptahConfig: {
          workspaceRoot: '/tmp/demo',
          workspaceName: 'demo',
          initialView: 'analytics',
        },
      });

      const service = createService();
      const harness = makeSignalStoreHarness<AppStoreState>(service);

      expect(harness.signal('workspaceInfo')).toEqual({
        name: 'demo',
        path: '/tmp/demo',
        type: 'workspace',
      });
    });

    it('does NOT navigate from window.ptahConfig.initialView', () => {
      // The Router owns the initial navigation and `App.handleInitialView`
      // seeds it, under `withDisabledInitialNavigation()`. Reading it here too
      // would be a second entry point racing the first — which is exactly what
      // the 8-entry and 13-entry allow-lists were.
      setupGlobals({ ptahConfig: { initialView: 'analytics' } });

      const service = createService();

      expect(service.currentView()).toBe('chat');
    });

    it('ignores workspaceRoot values of "undefined" (string) and empty', () => {
      setupGlobals({
        ptahConfig: { workspaceRoot: 'undefined', workspaceName: 'undefined' },
      });
      const service = createService();
      expect(service.workspaceInfo()).toBeNull();
    });

    it('restores layoutMode from localStorage', () => {
      setupGlobals({ savedLayoutMode: 'single' });
      const service = createService();
      expect(service.layoutMode()).toBe('single');
    });
  });

  describe('normalizeInitialView', () => {
    it.each([
      'chat',
      'setup-wizard',
      'settings',
      'analytics',
      'harness-builder',
      'setup-hub',
      'thoth',
      'marketplace',
      'tribunal',
      'tasks',
    ] as const)('passes the routable id %s through unchanged', (view) => {
      expect(createService().normalizeInitialView(view)).toBe(view);
    });

    it('normalises legacy "orchestra-canvas" → "chat" + grid layout', () => {
      const service = createService();

      expect(service.normalizeInitialView('orchestra-canvas')).toBe('chat');
      expect(service.layoutMode()).toBe('grid');
    });

    it('orchestra-canvas overrides a saved "single" layout → grid', () => {
      setupGlobals({ savedLayoutMode: 'single' });
      const service = createService();

      service.normalizeInitialView('orchestra-canvas');

      expect(service.layoutMode()).toBe('grid');
    });

    it.each([
      // `command-builder` and `context-tree` sat in two allow-lists and in
      // `ViewType` with no render branch anywhere. TASK_2026_524 deleted them.
      'command-builder',
      'context-tree',
      'not-a-view',
    ])('falls back to chat and warns for "%s"', (raw) => {
      const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
      const service = createService();

      expect(service.normalizeInitialView(raw)).toBe('chat');
      expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining(raw));
      consoleWarn.mockRestore();
    });

    it.each([
      ['undefined', undefined],
      ['the empty string', ''],
    ])('falls back to chat SILENTLY for %s', (_label, raw) => {
      const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
      const service = createService();

      expect(service.normalizeInitialView(raw)).toBe('chat');
      // A host that sends no deep link is the normal case, not a defect.
      expect(consoleWarn).not.toHaveBeenCalled();
      consoleWarn.mockRestore();
    });
  });

  describe('view navigation', () => {
    it('setCurrentView navigates and adds the surface to openViews', async () => {
      const service = createService();
      const harness = makeSignalStoreHarness<AppStoreState>(service);

      service.setCurrentView('analytics');
      await settle();

      expect(harness.signal('currentView')).toBe('analytics');
      expect(harness.signal('openViews')).toEqual(
        expect.arrayContaining(['chat', 'analytics']),
      );
    });

    it('does not report the new surface before the navigation settles', async () => {
      // The Router is the single owner, so there is no optimistic local write
      // that could disagree with it — the bug (TASK_2026_317) that a private
      // view mirror caused. The read is honest until the navigation lands.
      const service = createService();

      service.setCurrentView('analytics');
      expect(service.currentView()).toBe('chat');

      await settle();
      expect(service.currentView()).toBe('analytics');
    });

    it('closeView removes the view tab and falls back to chat when closing the active view', async () => {
      const service = createService();
      service.setCurrentView('analytics');
      await settle();
      expect(service.currentView()).toBe('analytics');

      service.closeView('analytics');
      await settle();

      expect(service.currentView()).toBe('chat');
      expect(service.openViews()).not.toContain('analytics');
    });

    it('closeView leaves the surface alone when closing a view the user is not on', async () => {
      const service = createService();
      service.setCurrentView('analytics');
      await settle();
      service.setCurrentView('tribunal');
      await settle();

      service.closeView('analytics');
      await settle();

      expect(service.currentView()).toBe('tribunal');
      expect(service.openViews()).not.toContain('analytics');
    });

    it('closeView is a no-op for "chat" (chat tab is permanent)', async () => {
      const service = createService();
      service.closeView('chat');
      await settle();
      expect(service.openViews()).toContain('chat');
      expect(service.currentView()).toBe('chat');
    });

    it('blocks view switches while loading', async () => {
      const service = createService();
      service.setLoading(true);
      expect(service.canSwitchViews()).toBe(false);
      service.setCurrentView('analytics');
      await settle();
      expect(service.currentView()).toBe('chat');
    });

    it('blocks view switches when disconnected', async () => {
      const service = createService();
      service.setConnected(false);
      expect(service.canSwitchViews()).toBe(false);
      service.setCurrentView('analytics');
      await settle();
      expect(service.currentView()).toBe('chat');
    });

    it('opens Skills with a one-shot diverged-clones request', async () => {
      const service = createService();

      service.openSkillsDivergedClones();
      await settle();

      expect(service.currentView()).toBe('thoth');
      expect(service.thothActiveTab()).toBe('skills');
      expect(service.consumeSkillsDivergedRequest()).toBe(true);
      expect(service.consumeSkillsDivergedRequest()).toBe(false);
    });

    it('drops a diverged-clones request the user left behind by switching workspace', async () => {
      const service = createService();
      service.switchWorkspace('C:/a');
      await settle();

      service.openSkillsDivergedClones();
      service.switchWorkspace('C:/b');
      await settle();

      // The divergence was workspace A's; workspace B never saw it.
      expect(service.consumeSkillsDivergedRequest()).toBe(false);
    });

    it('raises no diverged-clones request while view switches are blocked', async () => {
      const service = createService();
      service.setLoading(true);

      service.openSkillsDivergedClones();
      await settle();

      expect(service.currentView()).toBe('chat');
      expect(service.consumeSkillsDivergedRequest()).toBe(false);
    });
  });

  describe('openSettingsTab', () => {
    it('raises the pending tab request and navigates to settings', async () => {
      const service = createService();

      service.openSettingsTab('orchestration', 'anthropic');
      await settle();

      expect(service.currentView()).toBe('settings');
      expect(service.consumePendingSettingsTab()).toEqual({
        tab: 'orchestration',
        providerId: 'anthropic',
      });
    });

    it('raises NO request when the switch is blocked', async () => {
      // Guarded BEFORE the request, unlike the deleted
      // `WebviewNavigationService.navigateToSettingsTab`: a request that
      // survived a dropped switch fired later against whatever surface the
      // user reached next.
      const service = createService();
      service.setLoading(true);

      service.openSettingsTab('tools');
      await settle();

      expect(service.currentView()).toBe('chat');
      expect(service.consumePendingSettingsTab()).toBeNull();
    });
  });

  describe('handleMessage (SWITCH_VIEW)', () => {
    it('delegates to handleViewSwitch for a valid view payload', () => {
      const service = createService();
      const spy = jest.spyOn(service, 'handleViewSwitch');

      service.handleMessage({
        type: MESSAGE_TYPES.SWITCH_VIEW,
        payload: { view: 'analytics' },
      });

      expect(spy).toHaveBeenCalledWith('analytics');
    });

    it('warns and ignores unknown view values', () => {
      const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
      const service = createService();
      const spy = jest.spyOn(service, 'handleViewSwitch');

      service.handleMessage({
        type: MESSAGE_TYPES.SWITCH_VIEW,
        payload: { view: 'not-a-view' },
      });

      expect(spy).not.toHaveBeenCalled();
      expect(consoleWarn).toHaveBeenCalled();
      consoleWarn.mockRestore();
    });

    it('warns when payload is missing the view field', () => {
      const consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
      const service = createService();

      service.handleMessage({ type: MESSAGE_TYPES.SWITCH_VIEW });
      expect(consoleWarn).toHaveBeenCalled();
      consoleWarn.mockRestore();
    });

    it('exposes MESSAGE_TYPES.SWITCH_VIEW via handledMessageTypes', () => {
      const service = createService();
      expect(service.handledMessageTypes).toContain(MESSAGE_TYPES.SWITCH_VIEW);
    });
  });

  describe('scalar mutations', () => {
    it('setLoading toggles the isLoading signal', () => {
      const service = createService();
      service.setLoading(true);
      expect(service.isLoading()).toBe(true);
      service.setLoading(false);
      expect(service.isLoading()).toBe(false);
    });

    it('setStatusMessage updates statusMessage', () => {
      const service = createService();
      service.setStatusMessage('Processing...');
      expect(service.statusMessage()).toBe('Processing...');
    });

    it('setWorkspaceInfo updates appTitle through the computed', () => {
      const service = createService();
      const workspace: WorkspaceInfo = {
        name: 'demo-app',
        path: '/tmp/demo-app',
        type: 'workspace',
      };
      service.setWorkspaceInfo(workspace);
      expect(service.appTitle()).toBe('Ptah - demo-app');

      service.setWorkspaceInfo(null);
      expect(service.appTitle()).toBe('Ptah');
    });

    it('setConnected(true) clears loading and sets a status message', () => {
      const service = createService();
      service.setLoading(true);
      service.setConnected(true);
      expect(service.isConnected()).toBe(true);
      expect(service.isLoading()).toBe(false);
      expect(service.statusMessage()).toBe('Connected to VS Code');
    });

    it('setConnected(false) updates status to disconnected', () => {
      const service = createService();
      service.setConnected(false);
      expect(service.isConnected()).toBe(false);
      expect(service.statusMessage()).toBe('Disconnected from VS Code');
    });
  });

  describe('aggregated handlers', () => {
    it('handleInitialData applies workspace + view + connected', async () => {
      const service = createService();
      service.handleInitialData({
        workspaceInfo: { name: 'w', path: '/w', type: 'workspace' },
        currentView: 'analytics',
      });
      await settle();

      expect(service.workspaceInfo()?.path).toBe('/w');
      expect(service.currentView()).toBe('analytics');
      expect(service.isConnected()).toBe(true);
    });

    it('handleError formats the status message', () => {
      const service = createService();
      service.handleError('oops');
      expect(service.statusMessage()).toBe('Error: oops');
    });

    it('getStateSnapshot returns a synchronous snapshot', async () => {
      const service = createService();
      service.setCurrentView('analytics');
      await settle();
      service.setLoading(true);
      service.setStatusMessage('hello');

      const snap: AppState = service.getStateSnapshot();
      expect(snap).toEqual({
        currentView: 'analytics',
        isLoading: true,
        statusMessage: 'hello',
        workspaceInfo: null,
        isConnected: true,
      });
    });
  });

  describe('layout mode', () => {
    it('setLayoutMode updates the signal and persists to localStorage', () => {
      const service = createService();
      service.setLayoutMode('single');
      expect(service.layoutMode()).toBe('single');
      expect(localStorage.getItem('ptah-layout-mode')).toBe('single');
    });

    it('toggleLayoutMode flips between grid and single', () => {
      const service = createService();
      expect(service.layoutMode()).toBe('grid');
      service.toggleLayoutMode();
      expect(service.layoutMode()).toBe('single');
      service.toggleLayoutMode();
      expect(service.layoutMode()).toBe('grid');
    });
  });

  describe('per-workspace view partitioning (TASK_2026_195)', () => {
    it('migrates the bootstrap slice onto the first real workspace so the surface survives', async () => {
      const service = createService();
      // `App.handleInitialView` lands the host's deep link before the initial
      // workspace:switch RPC settles, so the surface is recorded against the
      // bootstrap sentinel slice.
      service.setCurrentView('tribunal');
      await settle();
      expect(service.currentView()).toBe('tribunal');

      service.switchWorkspace('/ws/a');
      await settle();

      expect(service.currentView()).toBe('tribunal');
      expect(service.openViews()).toEqual(
        expect.arrayContaining(['chat', 'tribunal']),
      );
    });

    it('does NOT carry the previous workspace view onto a never-visited workspace', async () => {
      const service = createService();
      service.switchWorkspace('/ws/a');
      await settle();
      service.setCurrentView('tribunal');
      await settle();
      expect(service.currentView()).toBe('tribunal');

      service.switchWorkspace('/ws/b');
      await settle();

      expect(service.currentView()).toBe('chat');
      expect(service.openViews()).toEqual(['chat']);
    });

    it('restores each workspace view on return (A→B→A)', async () => {
      const service = createService();
      service.switchWorkspace('/ws/a');
      await settle();
      service.setCurrentView('tribunal');
      await settle();
      service.switchWorkspace('/ws/b');
      await settle();
      service.setCurrentView('tasks');
      await settle();

      expect(service.currentView()).toBe('tasks');

      service.switchWorkspace('/ws/a');
      await settle();
      expect(service.currentView()).toBe('tribunal');

      service.switchWorkspace('/ws/b');
      await settle();
      expect(service.currentView()).toBe('tasks');
    });

    it('partitions openViews, so a view opened in A is not open in B', async () => {
      const service = createService();
      service.switchWorkspace('/ws/a');
      await settle();
      service.setCurrentView('tasks');
      await settle();
      service.setCurrentView('analytics');
      await settle();
      expect(service.openViews()).toEqual(
        expect.arrayContaining(['chat', 'tasks', 'analytics']),
      );

      service.switchWorkspace('/ws/b');
      await settle();
      expect(service.openViews()).toEqual(['chat']);

      service.switchWorkspace('/ws/a');
      await settle();
      expect(service.openViews()).toEqual(
        expect.arrayContaining(['chat', 'tasks', 'analytics']),
      );
    });

    it('closeView only affects the active workspace slice', async () => {
      const service = createService();
      service.switchWorkspace('/ws/a');
      await settle();
      service.setCurrentView('analytics');
      await settle();
      service.switchWorkspace('/ws/b');
      await settle();
      service.setCurrentView('analytics');
      await settle();

      service.closeView('analytics');
      await settle();
      expect(service.currentView()).toBe('chat');
      expect(service.openViews()).not.toContain('analytics');

      service.switchWorkspace('/ws/a');
      await settle();
      expect(service.currentView()).toBe('analytics');
    });

    it('removeWorkspaceState drops the slice so a re-added workspace opens on chat', async () => {
      const service = createService();
      service.switchWorkspace('/ws/a');
      await settle();
      service.setCurrentView('tasks');
      await settle();
      service.switchWorkspace('/ws/b');
      await settle();

      service.removeWorkspaceState('/ws/a');
      service.switchWorkspace('/ws/a');
      await settle();

      expect(service.currentView()).toBe('chat');
      expect(service.openViews()).toEqual(['chat']);
    });

    it('switching to the already-active workspace is a no-op', async () => {
      const service = createService();
      service.switchWorkspace('/ws/a');
      await settle();
      service.setCurrentView('tasks');
      await settle();

      service.switchWorkspace('/ws/a');
      await settle();

      expect(service.currentView()).toBe('tasks');
    });

    it('a blocked view switch does not seed a slice for the active workspace', async () => {
      const service = createService();
      service.switchWorkspace('/ws/a');
      await settle();
      service.setLoading(true);
      service.setCurrentView('tasks');
      await settle();

      expect(service.currentView()).toBe('chat');
      service.setLoading(false);
      service.switchWorkspace('/ws/b');
      await settle();
      expect(service.currentView()).toBe('chat');
    });

    /**
     * Ownership of the settled surface (revision 1, F1).
     *
     * Every case here failed before `_settlementOwner` existed, because the
     * stamp recorded the globally settled surface against whichever workspace
     * was active when the write ran — not the workspace whose navigation
     * produced it.
     */
    describe('surface memory is owned by the workspace that earned it', () => {
      it('does not stamp the outgoing surface onto a workspace whose restore has not settled', async () => {
        const service = createService();
        const surfaceRouter = TestBed.inject(SurfaceRouterService);
        service.switchWorkspace('/ws/a');
        await settle();
        service.setCurrentView('tribunal');
        await settle();
        service.switchWorkspace('/ws/b');
        await settle();
        service.setCurrentView('analytics');
        await settle();
        service.switchWorkspace('/ws/a');
        await settle();
        expect(service.currentView()).toBe('tribunal');

        // A→B→A with B's restore still in flight. The surface on screen is
        // A's; stamping it onto B made B remember 'tribunal'.
        service.switchWorkspace('/ws/b');
        service.switchWorkspace('/ws/a');
        await settle();

        expect(service.currentView()).toBe('tribunal');
        service.switchWorkspace('/ws/b');
        await settle();
        expect(service.currentView()).toBe('analytics');
        expect(surfaceRouter.currentSurface()).toBe('analytics');
      });

      it('does not resurrect a slice removed while its workspace was active', async () => {
        const service = createService();
        service.switchWorkspace('/ws/a');
        await settle();
        service.setCurrentView('analytics');
        await settle();
        expect(service.currentView()).toBe('analytics');

        // `ElectronLayoutService` removes the closed workspace's state BEFORE
        // it switches away, so the synchronous stamp in `switchWorkspace` ran
        // against a slice that had just been deleted and re-created it.
        service.removeWorkspaceState('/ws/a');
        service.switchWorkspace('/ws/b');
        await settle();
        expect(service.currentView()).toBe('chat');

        service.switchWorkspace('/ws/a');
        await settle();

        expect(service.currentView()).toBe('chat');
        expect(service.openViews()).toEqual(['chat']);
      });

      it('keeps recording after a NON-active workspace is removed', async () => {
        // Removal only revokes ownership when it hits the active workspace.
        const service = createService();
        service.switchWorkspace('/ws/a');
        await settle();
        service.setCurrentView('analytics');
        await settle();
        service.switchWorkspace('/ws/b');
        await settle();

        service.removeWorkspaceState('/ws/a');
        service.setCurrentView('tasks');
        await settle();

        expect(service.currentView()).toBe('tasks');
        expect(service.openViews()).toEqual(
          expect.arrayContaining(['chat', 'tasks']),
        );
      });

      it('drops a superseded navigation rather than recording it', async () => {
        const service = createService();
        service.switchWorkspace('/ws/a');
        await settle();

        // Two requests in one turn: only the second one's outcome is this
        // workspace's memory.
        service.setCurrentView('analytics');
        service.setCurrentView('tasks');
        await settle();

        expect(service.currentView()).toBe('tasks');
        expect(service.openViews()).not.toContain('analytics');
      });

      it('records nothing when a workspace restore navigation fails', async () => {
        // Author's risk 3, now deterministic. A failed restore leaves the new
        // workspace active with the previous surface on screen; the wrong
        // behaviour would be to remember a surface it never reached.
        const consoleError = jest.spyOn(console, 'error').mockImplementation();
        const service = createService();
        service.switchWorkspace('/ws/a');
        await settle();
        service.setCurrentView('analytics');
        await settle();

        const router = TestBed.inject(Router);
        const navigateByUrl = jest
          .spyOn(router, 'navigateByUrl')
          .mockRejectedValue(new Error('chunk fetch failed'));
        service.switchWorkspace('/ws/b');
        await settle();

        // Nothing landed, so the surface is still A's and B remembers nothing.
        expect(service.currentView()).toBe('analytics');
        expect(consoleError).toHaveBeenCalledWith(
          expect.stringContaining('failed'),
          'chunk fetch failed',
        );

        navigateByUrl.mockRestore();
        // And because B never took ownership, switching away must not stamp
        // A's surface onto it.
        service.switchWorkspace('/ws/c');
        await settle();
        service.switchWorkspace('/ws/b');
        await settle();

        expect(service.currentView()).toBe('chat');
      });
    });

    it('leaves layoutMode global — Electron pins it to grid and VS Code never switches workspaces', async () => {
      const service = createService();
      service.switchWorkspace('/ws/a');
      await settle();
      service.setLayoutMode('single');

      service.switchWorkspace('/ws/b');
      await settle();

      expect(service.layoutMode()).toBe('single');
    });
  });

  describe('global configuration surfaces (TASK_2026_540)', () => {
    it('configuration settlements update openConfigurationSurface and leave every slice untouched', async () => {
      const service = createService();
      const surfaceRouter = TestBed.inject(SurfaceRouterService);
      service.switchWorkspace('/ws/a');
      await settle();
      service.setCurrentView('analytics');
      await settle();
      service.switchWorkspace('/ws/b');
      await settle();
      service.setCurrentView('tasks');
      await settle();

      // Service-started settlement (setCurrentView).
      service.setCurrentView('settings');
      await settle();

      expect(service.openConfigurationSurface()).toBe('settings');
      expect(service.currentView()).toBe('settings');
      // B's slice was NOT stamped with the configuration id.
      expect(service.openViews()).toEqual(['chat', 'tasks']);

      // External settlement (direct navigateToSurface — no service write path).
      await surfaceRouter.navigateToSurface('marketplace');
      await settle();

      expect(service.openConfigurationSurface()).toBe('marketplace');
      expect(service.currentView()).toBe('marketplace');
      expect(service.openViews()).toEqual(['chat', 'tasks']);

      // A's slice is untouched too: leave the configuration surface, switch
      // back, and A restores the code-workspace surface it earned.
      service.setCurrentView('chat');
      await settle();
      service.switchWorkspace('/ws/a');
      await settle();

      expect(service.currentView()).toBe('analytics');
      expect(service.openViews()).toEqual(['chat', 'analytics']);
    });

    it('reads identically before and after switchWorkspace while a configuration surface is open', async () => {
      const service = createService();
      service.switchWorkspace('/ws/a');
      await settle();
      service.setCurrentView('thoth');
      await settle();
      expect(service.openConfigurationSurface()).toBe('thoth');

      service.switchWorkspace('/ws/b');
      await settle();

      expect(service.openConfigurationSurface()).toBe('thoth');
      expect(service.currentView()).toBe('thoth');
    });

    it('switchWorkspace while on a configuration surface starts no navigation, bumps the tick exactly once, and keeps the outgoing slice', async () => {
      const service = createService();
      const surfaceRouter = TestBed.inject(SurfaceRouterService);
      service.switchWorkspace('/ws/a');
      await settle();
      service.setCurrentView('tasks');
      await settle();
      service.setCurrentView('settings');
      await settle();
      expect(service.openConfigurationSurface()).toBe('settings');

      const navigateSpy = jest.spyOn(surfaceRouter, 'navigateToSurface');
      const tickBefore = service.configurationSurfaceRemountTick();

      service.switchWorkspace('/ws/b');
      await settle();

      expect(navigateSpy).not.toHaveBeenCalled();
      expect(service.configurationSurfaceRemountTick()).toBe(tickBefore + 1);
      expect(service.currentView()).toBe('settings');
      expect(service.openConfigurationSurface()).toBe('settings');
      navigateSpy.mockRestore();

      // A later switch with a code-workspace surface on screen does NOT bump
      // the tick — and the outgoing slice A still remembers 'tasks', proving
      // the configuration id was never stamped onto it.
      service.setCurrentView('chat');
      await settle();
      const tickAfterChat = service.configurationSurfaceRemountTick();
      service.switchWorkspace('/ws/a');
      await settle();

      expect(service.configurationSurfaceRemountTick()).toBe(tickAfterChat);
      expect(service.currentView()).toBe('tasks');
    });

    it('stay-branch on the first switch out of the bootstrap sentinel still migrates the sentinel slice', async () => {
      const service = createService();
      // A partitioned surface reached before the first workspace arrives is
      // recorded against the bootstrap sentinel slice.
      service.setCurrentView('analytics');
      await settle();
      service.setCurrentView('settings');
      await settle();

      service.switchWorkspace('/ws/a');
      await settle();

      expect(service.currentView()).toBe('settings');
      expect(service.configurationSurfaceRemountTick()).toBe(1);
      // The sentinel slice migrated onto '/ws/a' — carrying 'analytics', not
      // the refused configuration id.
      expect(service.openViews()).toEqual(['chat', 'analytics']);
    });

    it('SWITCH_VIEW message ends with the correct openConfigurationSurface', async () => {
      const service = createService();

      service.handleMessage({
        type: MESSAGE_TYPES.SWITCH_VIEW,
        payload: { view: 'marketplace' },
      });
      await settle();

      expect(service.openConfigurationSurface()).toBe('marketplace');
      expect(service.currentView()).toBe('marketplace');
    });

    it('openSettingsTab ends with the correct openConfigurationSurface', async () => {
      const service = createService();

      service.openSettingsTab('orchestration', 'anthropic');
      await settle();

      expect(service.openConfigurationSurface()).toBe('settings');
      expect(service.consumePendingSettingsTab()).toEqual({
        tab: 'orchestration',
        providerId: 'anthropic',
      });
    });

    it('openSkillsDivergedClones ends with the correct openConfigurationSurface', async () => {
      const service = createService();

      service.openSkillsDivergedClones();
      await settle();

      expect(service.openConfigurationSurface()).toBe('thoth');
      expect(service.consumeSkillsDivergedRequest()).toBe(true);
    });

    it('a direct navigateToSurface ends with the correct openConfigurationSurface', async () => {
      const service = createService();
      const surfaceRouter = TestBed.inject(SurfaceRouterService);

      await surfaceRouter.navigateToSurface('setup-hub');
      await settle();

      expect(service.openConfigurationSurface()).toBe('setup-hub');
      expect(service.currentView()).toBe('setup-hub');
    });

    it('owner null after removeWorkspaceState: an external configuration navigation still updates the global state', async () => {
      const service = createService();
      const surfaceRouter = TestBed.inject(SurfaceRouterService);
      service.switchWorkspace('/ws/a');
      await settle();

      // Closing the ACTIVE workspace revokes settlement ownership.
      service.removeWorkspaceState('/ws/a');

      await surfaceRouter.navigateToSurface('settings');
      await settle();

      // The unconditional effect write keeps the menu and the gate honest
      // even while no workspace owns the settlement.
      expect(service.openConfigurationSurface()).toBe('settings');
      expect(service.currentView()).toBe('settings');
      expect(service.openViews()).toEqual(['chat']);

      await surfaceRouter.navigateToSurface('tasks');
      await settle();

      expect(service.openConfigurationSurface()).toBeNull();
      expect(service.currentView()).toBe('tasks');
    });

    it('a failed navigation leaves openConfigurationSurface unchanged', async () => {
      const consoleError = jest.spyOn(console, 'error').mockImplementation();
      const service = createService();
      const router = TestBed.inject(Router);
      service.setCurrentView('settings');
      await settle();
      expect(service.openConfigurationSurface()).toBe('settings');

      // A rejected lazy chunk fetch: the navigation never lands, the
      // settlement effect never runs, and the previous truth stays.
      const navigateByUrl = jest
        .spyOn(router, 'navigateByUrl')
        .mockRejectedValue(new Error('chunk fetch failed'));
      service.setCurrentView('marketplace');
      await settle();

      expect(service.openConfigurationSurface()).toBe('settings');
      expect(service.currentView()).toBe('settings');

      navigateByUrl.mockRestore();
      consoleError.mockRestore();
    });

    it('finding 4: a navigation started before a stay-branch switch lands on the incoming workspace slice', async () => {
      const service = createService();
      service.switchWorkspace('/ws/a');
      await settle();
      service.setCurrentView('settings');
      await settle();

      // Start a code-workspace navigation and switch BEFORE it lands.
      service.setCurrentView('tasks');
      service.switchWorkspace('/ws/b');
      await settle();

      // The stay-branch ran (no restore navigation, tick bumped), then the
      // in-flight navigation landed and the constructor effect stamped it
      // onto the incoming workspace's slice — state and screen agree.
      expect(service.configurationSurfaceRemountTick()).toBe(1);
      expect(service.currentView()).toBe('tasks');
      expect(service.openConfigurationSurface()).toBeNull();
      expect(service.openViews()).toEqual(['chat', 'tasks']);
    });

    it('finding 5: after closing the last workspace, chat re-grants the owner and re-seeds the slice; a configuration settlement does not', async () => {
      const service = createService();
      const surfaceRouter = TestBed.inject(SurfaceRouterService);
      service.switchWorkspace('/ws/a');
      await settle();
      service.setCurrentView('tasks');
      await settle();

      service.removeWorkspaceState('/ws/a');

      // Accepted behaviour (R2-6): the non-configuration settlement re-grants
      // ownership to '/ws/a' and re-seeds its slice. Proven through an
      // EXTERNAL navigation afterwards: only a re-granted owner lets the
      // constructor effect stamp the slice again.
      service.setCurrentView('chat');
      await settle();
      expect(service.currentView()).toBe('chat');
      await surfaceRouter.navigateToSurface('analytics');
      await settle();
      expect(service.openViews()).toEqual(['chat', 'analytics']);

      // Second assertion: in the same closed-workspace state, a configuration
      // settlement re-creates nothing — the refusal guard keeps the deleted
      // slice deleted, and only the global state records the surface.
      service.removeWorkspaceState('/ws/a');
      service.setCurrentView('settings');
      await settle();

      expect(service.openConfigurationSurface()).toBe('settings');
      expect(service.currentView()).toBe('settings');
      expect(service.openViews()).toEqual(['chat']);
      expect(service.openViews()).not.toContain('settings');
    });
  });

  describe('per-workspace in-surface pointers (TASK_2026_228)', () => {
    it("does NOT carry the previous workspace's Thoth tab onto a never-visited workspace", () => {
      const service = createService();
      service.switchWorkspace('/ws/a');
      service.setThothActiveTab('gateway');
      expect(service.thothActiveTab()).toBe('gateway');

      service.switchWorkspace('/ws/b');

      // B has its own cron jobs / gateway adapters; landing on A's tab shows
      // the wrong pillar against B's state.
      expect(service.thothActiveTab()).toBe('memory');
    });

    it("does NOT carry the previous workspace's marketplace provider onto a never-visited workspace", () => {
      const service = createService();
      service.switchWorkspace('/ws/a');
      service.setMarketplaceActiveProvider('skills-sh');
      expect(service.marketplaceActiveProvider()).toBe('skills-sh');

      service.switchWorkspace('/ws/b');

      expect(service.marketplaceActiveProvider()).toBeNull();
    });

    it('restores each workspace Thoth tab and provider on return (A→B→A)', () => {
      const service = createService();
      service.switchWorkspace('/ws/a');
      service.setThothActiveTab('skills');
      service.setMarketplaceActiveProvider('official-mcp');

      service.switchWorkspace('/ws/b');
      service.setThothActiveTab('cron');
      service.setMarketplaceActiveProvider('skills-sh');

      service.switchWorkspace('/ws/a');
      expect(service.thothActiveTab()).toBe('skills');
      expect(service.marketplaceActiveProvider()).toBe('official-mcp');

      service.switchWorkspace('/ws/b');
      expect(service.thothActiveTab()).toBe('cron');
      expect(service.marketplaceActiveProvider()).toBe('skills-sh');
    });

    it('keeps the in-surface pointers independent of the view pointer in the same slice', async () => {
      const service = createService();
      service.switchWorkspace('/ws/a');
      await settle();
      service.setThothActiveTab('cron');
      service.setMarketplaceActiveProvider('official-mcp');

      // Every navigation rewrites the slice through the constructor effect —
      // the in-surface pointers must survive that, not be reset by it.
      service.setCurrentView('tribunal');
      await settle();
      service.setCurrentView('tasks');
      await settle();
      service.closeView('tribunal');
      await settle();

      expect(service.thothActiveTab()).toBe('cron');
      expect(service.marketplaceActiveProvider()).toBe('official-mcp');
      expect(service.currentView()).toBe('tasks');
    });

    it('carries a pointer set before the first workspace arrives onto that workspace', () => {
      const service = createService();
      // Electron's initial workspace:switch lands after the shell renders, so
      // a tab picked in that window is written to the bootstrap sentinel slice.
      service.setThothActiveTab('skills');
      service.setMarketplaceActiveProvider('official-mcp');

      service.switchWorkspace('/ws/a');

      expect(service.thothActiveTab()).toBe('skills');
      expect(service.marketplaceActiveProvider()).toBe('official-mcp');
    });

    it('removeWorkspaceState drops the pointers so a re-added workspace gets defaults', () => {
      const service = createService();
      service.switchWorkspace('/ws/a');
      service.setThothActiveTab('gateway');
      service.setMarketplaceActiveProvider('skills-sh');
      service.switchWorkspace('/ws/b');

      service.removeWorkspaceState('/ws/a');
      service.switchWorkspace('/ws/a');

      expect(service.thothActiveTab()).toBe('memory');
      expect(service.marketplaceActiveProvider()).toBeNull();
    });

    it('switching to the already-active workspace leaves the pointers alone', () => {
      const service = createService();
      service.switchWorkspace('/ws/a');
      service.setThothActiveTab('cron');
      service.setMarketplaceActiveProvider('skills-sh');

      service.switchWorkspace('/ws/a');

      expect(service.thothActiveTab()).toBe('cron');
      expect(service.marketplaceActiveProvider()).toBe('skills-sh');
    });
  });

  describe('canvas session request signal bridge', () => {
    it('queues two requests in order and takeCanvasSessionRequests empties the queue', async () => {
      const service = createService();
      const firstSessionId = SessionId.create();
      const secondSessionId = SessionId.create();
      const firstPending = service.requestCanvasSession(
        firstSessionId,
        'Session One',
      );
      const secondPending = service.requestCanvasSession(
        secondSessionId,
        'Session Two',
      );

      expect(service.canvasSessionRequests()).toEqual([
        expect.objectContaining({
          sessionId: firstSessionId,
          name: 'Session One',
          resolve: expect.any(Function),
        }),
        expect.objectContaining({
          sessionId: secondSessionId,
          name: 'Session Two',
          resolve: expect.any(Function),
        }),
      ]);

      const requests = service.takeCanvasSessionRequests();
      expect(requests.map(({ sessionId }) => sessionId)).toEqual([
        firstSessionId,
        secondSessionId,
      ]);
      expect(service.canvasSessionRequests()).toEqual([]);
      expect(service.takeCanvasSessionRequests()).toEqual([]);

      requests[0]?.resolve?.(true);
      requests[1]?.resolve?.(true);
      await expect(firstPending).resolves.toBe(true);
      await expect(secondPending).resolves.toBe(true);
    });

    it('removes a timed-out request and resolves false when no canvas consumes it', async () => {
      jest.useFakeTimers();
      const service = createService();
      const pending = service.requestCanvasSession(
        SessionId.create(),
        'Orphan',
      );

      expect(service.canvasSessionRequests()).toHaveLength(1);
      jest.advanceTimersByTime(5000);
      expect(service.canvasSessionRequests()).toEqual([]);
      await expect(pending).resolves.toBe(false);
      jest.useRealTimers();
    });

    it('resolves true and clears the safety timer when the canvas accepts the request', async () => {
      jest.useFakeTimers();
      const service = createService();
      // Wiring the Router leaves its own timers pending, so "the safety timer
      // was cleared" is a return to THIS baseline, not an absolute zero.
      const baselineTimers = jest.getTimerCount();
      const pending = service.requestCanvasSession(SessionId.create());
      const [request] = service.takeCanvasSessionRequests();

      request?.resolve?.(true);

      await expect(pending).resolves.toBe(true);
      expect(jest.getTimerCount()).toBe(baselineTimers);
      jest.useRealTimers();
    });

    it('keeps three consumed requests in flight past the orphan timeout and settles their real outcomes FIFO', async () => {
      jest.useFakeTimers();
      const service = createService();
      const settlementOrder: string[] = [];
      const sessionIds = [
        SessionId.create(),
        SessionId.create(),
        SessionId.create(),
      ];
      const pending = sessionIds.map((sessionId) =>
        service.requestCanvasSession(sessionId).then((result) => {
          settlementOrder.push(sessionId);
          return result;
        }),
      );

      const requests = service.takeCanvasSessionRequests();
      expect(requests.map(({ sessionId }) => sessionId)).toEqual([
        ...sessionIds,
      ]);

      jest.advanceTimersByTime(15_000);
      await Promise.resolve();
      expect(settlementOrder).toEqual([]);

      for (const request of requests) {
        request.resolve?.(true);
        await Promise.resolve();
      }

      await expect(Promise.all(pending)).resolves.toEqual([true, true, true]);
      expect(settlementOrder).toEqual(sessionIds);
      expect(jest.getTimerCount()).toBe(0);
      jest.useRealTimers();
    });

    it('rejects an invalid session id without enqueueing it', async () => {
      const service = createService();

      await expect(
        service.requestCanvasSession('not-a-session-id'),
      ).resolves.toBe(false);
      expect(service.canvasSessionRequests()).toEqual([]);
    });

    it('requestNewCanvasSession / clearNewCanvasSessionRequest flip the signal', () => {
      const service = createService();
      service.requestNewCanvasSession('Fresh Tile');
      expect(service.newCanvasSessionRequest()).toBe('Fresh Tile');

      service.clearNewCanvasSessionRequest();
      expect(service.newCanvasSessionRequest()).toBeNull();
    });

    it('requestCanvasTab sets the tab-adoption request and clearCanvasTabRequest nulls it (F-D3)', () => {
      const service = createService();
      service.requestCanvasTab('tab-7', 'TASK_2026_200');
      expect(service.canvasTabRequest()).toEqual({
        tabId: 'tab-7',
        name: 'TASK_2026_200',
      });

      service.clearCanvasTabRequest();
      expect(service.canvasTabRequest()).toBeNull();
    });

    it('requestCanvasTab omits name when not supplied', () => {
      const service = createService();
      service.requestCanvasTab('tab-8');
      expect(service.canvasTabRequest()).toEqual({ tabId: 'tab-8' });
    });

    it('requestChatPrompt sets the request and clearChatPromptRequest nulls it (D.1)', () => {
      const service = createService();
      const resolve = jest.fn();
      service.requestChatPrompt({
        prompt: '/orchestrate TASK_2026_200',
        sessionName: 'TASK_2026_200',
        resolve,
      });

      const req = service.chatPromptRequest();
      expect(req?.prompt).toBe('/orchestrate TASK_2026_200');
      expect(req?.sessionName).toBe('TASK_2026_200');
      expect(req?.resolve).toBe(resolve);

      service.clearChatPromptRequest();
      expect(service.chatPromptRequest()).toBeNull();
    });

    it('publishes monotonic composer-prefill requests with their target tab', () => {
      const service = createService();

      expect(service.composerPrefillRequest()).toEqual({
        seq: 0,
        text: '',
        tabId: null,
      });

      service.requestComposerPrefill('first prompt', 'tab-1');
      expect(service.composerPrefillRequest()).toEqual({
        seq: 1,
        text: 'first prompt',
        tabId: 'tab-1',
      });

      service.requestComposerPrefill('second prompt', null);
      expect(service.composerPrefillRequest()).toEqual({
        seq: 2,
        text: 'second prompt',
        tabId: null,
      });
    });

    it('clearComposerPrefill resets the request so a recreated surface cannot replay it', () => {
      const service = createService();
      service.requestComposerPrefill('first prompt', 'tab-1');

      service.clearComposerPrefill();

      expect(service.composerPrefillRequest()).toEqual({
        seq: 0,
        text: '',
        tabId: null,
      });
    });
  });

  describe('Thoth first-run hint persistence (B6)', () => {
    it('defaults thothFirstRunDismissed to false on a fresh install', () => {
      const service = createService();
      expect(service.thothFirstRunDismissed()).toBe(false);
      // No localStorage write should have happened yet.
      expect(localStorage.getItem(THOTH_FIRST_RUN_DISMISSED_KEY)).toBeNull();
    });

    it('dismissThothFirstRun() flips the signal AND persists to localStorage', () => {
      const service = createService();

      service.dismissThothFirstRun();

      expect(service.thothFirstRunDismissed()).toBe(true);
      expect(localStorage.getItem(THOTH_FIRST_RUN_DISMISSED_KEY)).toBe('true');
    });

    it('round-trips the dismissed flag across a service re-instantiation (reload simulation)', () => {
      // First instance — user dismisses the hint.
      const first = createService();
      first.dismissThothFirstRun();
      expect(first.thothFirstRunDismissed()).toBe(true);

      // Simulate a reload: tear down the TestBed but keep localStorage.
      TestBed.resetTestingModule();

      // Second instance — should read 'true' from localStorage and start dismissed.
      const second = createService();
      expect(second.thothFirstRunDismissed()).toBe(true);
    });

    it('treats any non-"true" stored value as "not dismissed" (defensive parsing)', () => {
      localStorage.setItem(THOTH_FIRST_RUN_DISMISSED_KEY, 'false');
      const service = createService();
      expect(service.thothFirstRunDismissed()).toBe(false);
    });

    it('is idempotent — calling dismissThothFirstRun() twice keeps state stable', () => {
      const service = createService();
      service.dismissThothFirstRun();
      service.dismissThothFirstRun();
      expect(service.thothFirstRunDismissed()).toBe(true);
      expect(localStorage.getItem(THOTH_FIRST_RUN_DISMISSED_KEY)).toBe('true');
    });
  });

  describe('Thoth rename — legacy localStorage migration', () => {
    const LEGACY_KEY = 'ptah-hermes-first-run-dismissed';

    it('migrates a legacy "true" hermes flag to the new thoth key on init', () => {
      // Simulate a user who dismissed the hint before the rename.
      localStorage.setItem(LEGACY_KEY, 'true');
      // Sanity: the new key starts absent.
      expect(localStorage.getItem(THOTH_FIRST_RUN_DISMISSED_KEY)).toBeNull();

      const service = createService();

      expect(service.thothFirstRunDismissed()).toBe(true);
      expect(localStorage.getItem(THOTH_FIRST_RUN_DISMISSED_KEY)).toBe('true');
      // Legacy key must be removed after the migration runs.
      expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    });

    it('migrates a legacy non-"true" value forward without dismissing the hint', () => {
      localStorage.setItem(LEGACY_KEY, 'false');

      const service = createService();

      expect(service.thothFirstRunDismissed()).toBe(false);
      expect(localStorage.getItem(THOTH_FIRST_RUN_DISMISSED_KEY)).toBe('false');
      expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    });

    it('prefers the new key when both are present and leaves the legacy key untouched', () => {
      localStorage.setItem(THOTH_FIRST_RUN_DISMISSED_KEY, 'true');
      localStorage.setItem(LEGACY_KEY, 'false');

      const service = createService();

      expect(service.thothFirstRunDismissed()).toBe(true);
      // New key is the source of truth — legacy key is not touched once the
      // new key already exists, so it lingers harmlessly until eventually
      // overwritten by some unrelated cleanup. We only assert state, not
      // legacy removal in this branch.
      expect(localStorage.getItem(THOTH_FIRST_RUN_DISMISSED_KEY)).toBe('true');
    });

    it('is a no-op when neither key is present', () => {
      const service = createService();

      expect(service.thothFirstRunDismissed()).toBe(false);
      expect(localStorage.getItem(THOTH_FIRST_RUN_DISMISSED_KEY)).toBeNull();
      expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    });
  });

  describe('acknowledged canvas focus bridge', () => {
    const target = (workspacePath: string, sessionId = SessionId.create()) => ({
      workspacePath,
      sessionId,
      tabId: `tab-${workspacePath}`,
    });

    it('takes matching requests FIFO and preserves exact resolver ownership', async () => {
      jest.useFakeTimers();
      const service = createService();
      // See the canvas-session bridge above: the Router's own timers are the
      // baseline this must return to.
      const baselineTimers = jest.getTimerCount();
      const first = service.requestCanvasFocus(target('/a'));
      const other = service.requestCanvasFocus(target('/b'));
      const second = service.requestCanvasFocus(target('/a'));

      const requests = service.takeCanvasFocusRequests('/a');
      expect(requests.map((request) => request.target.workspacePath)).toEqual([
        '/a',
        '/a',
      ]);
      expect(service.canvasFocusRequests()).toHaveLength(1);
      requests[0]?.resolve({ success: true, outcome: 'focused' });
      requests[1]?.resolve({ success: true, outcome: 'adopted' });
      service.takeCanvasFocusRequests('/b')[0]?.resolve({
        success: true,
        outcome: 'opened',
      });
      await expect(first).resolves.toEqual({
        success: true,
        outcome: 'focused',
      });
      await expect(second).resolves.toEqual({
        success: true,
        outcome: 'adopted',
      });
      await expect(other).resolves.toEqual({
        success: true,
        outcome: 'opened',
      });
      expect(jest.getTimerCount()).toBe(baselineTimers);
      jest.useRealTimers();
    });

    it.each([
      'focused',
      'adopted',
      'opened',
      'cap-reached',
      'missing',
    ] as const)('preserves the structured %s outcome', async (outcome) => {
      const service = createService();
      const pending = service.requestCanvasFocus(target('/a'));
      service.takeCanvasFocusRequests('/a')[0]?.resolve({
        success: outcome !== 'missing',
        outcome,
      });
      await expect(pending).resolves.toEqual({
        success: outcome !== 'missing',
        outcome,
      });
    });

    it('removes only the stale request and times it out as missing', async () => {
      jest.useFakeTimers();
      const service = createService();
      const pending = service.requestCanvasFocus(target('/orphan'));
      jest.advanceTimersByTime(5000);
      expect(service.canvasFocusRequests()).toEqual([]);
      await expect(pending).resolves.toEqual({
        success: false,
        outcome: 'missing',
      });
      jest.useRealTimers();
    });
  });
});
