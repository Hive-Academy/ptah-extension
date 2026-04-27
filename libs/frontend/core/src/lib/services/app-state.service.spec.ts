/**
 * AppStateManager specs — global webview state (view, workspace, connection,
 * license, layout mode, canvas-session signal bridge).
 *
 * Coverage:
 *   - Constructor `initializeState` reads `window.ptahConfig` (license,
 *     workspace, initialView) and `localStorage` (layout mode).
 *   - `normalizeView` maps legacy 'orchestra-canvas' → 'chat' + grid layout.
 *   - `setCurrentView` / `openView` / `closeView` mutate `openViews` set and
 *     respect the `canSwitchViews` guard.
 *   - `handleMessage(SWITCH_VIEW)` routes valid views to `handleViewSwitch`
 *     and warns for invalid payloads.
 *   - `setLoading` / `setStatusMessage` / `setWorkspaceInfo` / `setConnected`
 *     mutations.
 *   - `handleInitialData` / `handleError` aggregated updates.
 *   - `getStateSnapshot` returns a synchronous snapshot.
 *   - Layout mode persistence (setLayoutMode writes localStorage; toggle flips).
 *   - Canvas session request signal-bridge methods.
 *
 * Note: `initializeState` runs in the constructor, so each spec sets up
 * `window.ptahConfig` / `window.initialView` / `localStorage` BEFORE calling
 * `createService`.
 */

import { TestBed } from '@angular/core/testing';
import { MESSAGE_TYPES, type WorkspaceInfo } from '@ptah-extension/shared';
import {
  AppStateManager,
  type AppState,
  type CanvasSessionRequest,
  type LayoutMode,
  type ViewType,
} from './app-state.service';
import { makeSignalStoreHarness } from '../../testing';

interface AppStoreState {
  currentView: ViewType;
  isLoading: boolean;
  statusMessage: string;
  workspaceInfo: WorkspaceInfo | null;
  isConnected: boolean;
  isLicensed: boolean;
  openViews: readonly ViewType[];
  layoutMode: LayoutMode;
  canvasSessionRequest: CanvasSessionRequest | null;
  newCanvasSessionRequest: string | null;
  canSwitchViews: boolean;
  appTitle: string;
}

interface PtahTestWindow {
  ptahConfig?: {
    isLicensed?: boolean;
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
  TestBed.configureTestingModule({ providers: [AppStateManager] });
  return TestBed.inject(AppStateManager);
}

describe('AppStateManager', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    teardownGlobals();
  });

  describe('initializeState from window.ptahConfig', () => {
    it('defaults to view="chat", licensed=true, layoutMode="grid" when no globals are injected', () => {
      const service = createService();
      const harness = makeSignalStoreHarness<AppStoreState>(service);

      expect(harness.read()).toMatchObject({
        currentView: 'chat',
        isLicensed: true,
        layoutMode: 'grid',
        workspaceInfo: null,
      });
    });

    it('reads license status and workspace info from window.ptahConfig', () => {
      setupGlobals({
        ptahConfig: {
          isLicensed: false,
          workspaceRoot: '/tmp/demo',
          workspaceName: 'demo',
          initialView: 'analytics',
        },
      });

      const service = createService();
      const harness = makeSignalStoreHarness<AppStoreState>(service);

      expect(harness.signal('isLicensed')).toBe(false);
      expect(harness.signal('workspaceInfo')).toEqual({
        name: 'demo',
        path: '/tmp/demo',
        type: 'workspace',
      });
      expect(harness.signal('currentView')).toBe('analytics');
      expect(harness.signal('openViews')).toEqual(
        expect.arrayContaining(['chat', 'analytics']),
      );
    });

    it('ignores workspaceRoot values of "undefined" (string) and empty', () => {
      setupGlobals({
        ptahConfig: { workspaceRoot: 'undefined', workspaceName: 'undefined' },
      });
      const service = createService();
      expect(service.workspaceInfo()).toBeNull();
    });

    it('normalises legacy "orchestra-canvas" view → "chat" + grid layout', () => {
      setupGlobals({
        ptahConfig: { initialView: 'orchestra-canvas' },
      });
      const service = createService();
      expect(service.currentView()).toBe('chat');
      expect(service.layoutMode()).toBe('grid');
    });

    it('restores layoutMode from localStorage', () => {
      setupGlobals({ savedLayoutMode: 'single' });
      const service = createService();
      expect(service.layoutMode()).toBe('single');
    });

    it('orchestra-canvas initialView overrides the saved "single" layout → grid', () => {
      setupGlobals({
        ptahConfig: { initialView: 'orchestra-canvas' },
        savedLayoutMode: 'single',
      });
      const service = createService();
      expect(service.layoutMode()).toBe('grid');
    });
  });

  describe('view navigation', () => {
    it('setCurrentView opens the view and adds it to openViews', () => {
      const service = createService();
      const harness = makeSignalStoreHarness<AppStoreState>(service);

      service.setCurrentView('settings');

      expect(harness.signal('currentView')).toBe('settings');
      expect(harness.signal('openViews')).toEqual(
        expect.arrayContaining(['chat', 'settings']),
      );
    });

    it('closeView removes the view tab and falls back to chat when closing the active view', () => {
      const service = createService();
      service.setCurrentView('analytics');
      expect(service.currentView()).toBe('analytics');

      service.closeView('analytics');

      expect(service.currentView()).toBe('chat');
      expect(service.openViews()).not.toContain('analytics');
    });

    it('closeView is a no-op for "chat" (chat tab is permanent)', () => {
      const service = createService();
      service.closeView('chat');
      expect(service.openViews()).toContain('chat');
    });

    it('blocks view switches when on "welcome" (license-gate enforcement)', () => {
      setupGlobals({ ptahConfig: { initialView: 'welcome' } });
      const service = createService();
      expect(service.canSwitchViews()).toBe(false);

      service.setCurrentView('settings');
      expect(service.currentView()).toBe('welcome');
    });

    it('blocks view switches while loading', () => {
      const service = createService();
      service.setLoading(true);
      expect(service.canSwitchViews()).toBe(false);
      service.setCurrentView('settings');
      expect(service.currentView()).toBe('chat');
    });

    it('blocks view switches when disconnected', () => {
      const service = createService();
      service.setConnected(false);
      expect(service.canSwitchViews()).toBe(false);
      service.setCurrentView('settings');
      expect(service.currentView()).toBe('chat');
    });

    it('openViews computed excludes the "welcome" view', () => {
      setupGlobals({ ptahConfig: { initialView: 'welcome' } });
      const service = createService();
      expect(service.openViews()).not.toContain('welcome');
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
    it('handleInitialData applies workspace + view + connected', () => {
      const service = createService();
      service.handleInitialData({
        workspaceInfo: { name: 'w', path: '/w', type: 'workspace' },
        currentView: 'analytics',
      });

      expect(service.workspaceInfo()?.path).toBe('/w');
      expect(service.currentView()).toBe('analytics');
      expect(service.isConnected()).toBe(true);
    });

    it('handleError formats the status message', () => {
      const service = createService();
      service.handleError('oops');
      expect(service.statusMessage()).toBe('Error: oops');
    });

    it('getStateSnapshot returns a synchronous snapshot', () => {
      const service = createService();
      service.setCurrentView('settings');
      service.setLoading(true);
      service.setStatusMessage('hello');

      const snap: AppState = service.getStateSnapshot();
      expect(snap).toEqual({
        currentView: 'settings',
        isLoading: true,
        statusMessage: 'hello',
        workspaceInfo: null,
        isConnected: true,
        isLicensed: true,
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

  describe('canvas session request signal bridge', () => {
    it('requestCanvasSession / clearCanvasSessionRequest flip the signal', () => {
      const service = createService();
      service.requestCanvasSession('sess-1', 'Session One');
      expect(service.canvasSessionRequest()).toEqual({
        sessionId: 'sess-1',
        name: 'Session One',
      });

      service.clearCanvasSessionRequest();
      expect(service.canvasSessionRequest()).toBeNull();
    });

    it('requestNewCanvasSession / clearNewCanvasSessionRequest flip the signal', () => {
      const service = createService();
      service.requestNewCanvasSession('Fresh Tile');
      expect(service.newCanvasSessionRequest()).toBe('Fresh Tile');

      service.clearNewCanvasSessionRequest();
      expect(service.newCanvasSessionRequest()).toBeNull();
    });
  });
});
