/**
 * WorkspaceCoordinatorService specs â€” orchestrates workspace switching across
 * TabManager, SessionLoader, ConfirmationDialog and lazy-loaded editor services.
 *
 * Coverage:
 *   - switchWorkspace delegates to tabManager + sessionLoader
 *   - removeWorkspaceState delegates to tabManager + sessionLoader
 *   - getStreamingSessionIds filters streaming tabs with claudeSessionId
 *   - confirm passes options through to ConfirmationDialogService
 *   - Editor-service resolution fails gracefully when the lazy chunk is absent
 *     (the dynamic import() throws in test env because the alias is not
 *     registered in the module resolver â€” we swallow and continue).
 *   - switchWorkspace swaps AppStateManager's view slice, so the previous
 *     workspace's view does not survive the switch (TASK_2026_195), and
 *     neither does its Thoth tab or marketplace provider (TASK_2026_228).
 *   - The captured switchGeneration is re-checked after the awaited editor
 *     resolution, so a superseded switch cannot apply last (TASK_2026_195).
 */

import { TestBed } from '@angular/core/testing';
import { WorkspaceCoordinatorService } from './workspace-coordinator.service';
import {
  ConfirmationDialogService,
  TabManagerService,
} from '@ptah-extension/chat-state';
import {
  AgentDiscoveryFacade,
  AppStateManager,
  AuthStateService,
  CommandDiscoveryFacade,
  EffortStateService,
  ModelStateService,
} from '@ptah-extension/core';
import { SessionLoaderService } from './chat-store/session-loader.service';
import { FilePickerService } from './file-picker.service';
import type { TabState } from '@ptah-extension/chat-types';

type AuthStateSlice = Pick<AuthStateService, 'refreshAuthStatus'>;
type ModelStateSlice = Pick<ModelStateService, 'refreshModels'>;
type EffortStateSlice = Pick<EffortStateService, 'refreshEffort'>;

type TabManagerSlice = Pick<
  TabManagerService,
  'switchWorkspace' | 'removeWorkspaceState' | 'getWorkspaceTabs'
>;
type SessionLoaderSlice = Pick<
  SessionLoaderService,
  'switchWorkspace' | 'removeWorkspaceCache'
>;
type ConfirmSlice = Pick<ConfirmationDialogService, 'confirm'>;
type FilePickerSlice = Pick<FilePickerService, 'switchWorkspace'>;
type AgentDiscoverySlice = Pick<AgentDiscoveryFacade, 'clearCache'>;
type CommandDiscoverySlice = Pick<CommandDiscoveryFacade, 'clearCache'>;

/**
 * Flush pending microtasks. The auth/model/effort re-resolution is fired
 * non-blocking from switchWorkspace (F3, TASK_2026_154) with auth awaited
 * before models+effort, so a few microtask turns are needed for all three to
 * run after the switch resolves.
 */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

function makeTab(overrides: Partial<TabState> = {}): TabState {
  return {
    id: 't',
    title: 'Tab',
    name: 'Tab',
    status: 'loaded',
    messages: [],
    streamingState: null,
    currentMessageId: null,
    claudeSessionId: null,
    ...overrides,
  } as TabState;
}

/**
 * Structural view of a lazily-resolved editor service, mirroring the private
 * `WorkspaceAwareService` interface in the service under test.
 */
interface EditorServiceStub {
  switchWorkspace: jest.Mock<void, [string]>;
  removeWorkspaceState: jest.Mock<void, [string]>;
}

/**
 * Handle onto the one private the stale-generation specs need: the awaited
 * editor-chunk resolution is the only suspension point in `switchWorkspace`,
 * so it is the only place a superseded switch can regain control.
 */
interface CoordinatorInternals {
  resolveEditorServices(): Promise<EditorServiceStub[]>;
}

describe('WorkspaceCoordinatorService', () => {
  let service: WorkspaceCoordinatorService;
  let appState: AppStateManager;
  let tabManager: jest.Mocked<TabManagerSlice>;
  let sessionLoader: jest.Mocked<SessionLoaderSlice>;
  let confirmDialog: jest.Mocked<ConfirmSlice>;
  let filePicker: jest.Mocked<FilePickerSlice>;
  let agentDiscovery: jest.Mocked<AgentDiscoverySlice>;
  let commandDiscovery: jest.Mocked<CommandDiscoverySlice>;
  /** Records the order of the synchronous switch fan-out. */
  let fanOutOrder: string[];
  let authState: jest.Mocked<AuthStateSlice>;
  let modelState: jest.Mocked<ModelStateSlice>;
  let effortState: jest.Mocked<EffortStateSlice>;
  let consoleWarn: jest.SpyInstance;
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    fanOutOrder = [];

    tabManager = {
      switchWorkspace: jest.fn(() => {
        fanOutOrder.push('tabManager');
      }),
      removeWorkspaceState: jest.fn(),
      getWorkspaceTabs: jest.fn(() => []),
    } as unknown as jest.Mocked<TabManagerSlice>;

    sessionLoader = {
      switchWorkspace: jest.fn(() => {
        fanOutOrder.push('sessionLoader');
      }),
      removeWorkspaceCache: jest.fn(),
    } as unknown as jest.Mocked<SessionLoaderSlice>;

    filePicker = {
      switchWorkspace: jest.fn(() => {
        fanOutOrder.push('filePicker');
      }),
    } as unknown as jest.Mocked<FilePickerSlice>;

    agentDiscovery = {
      clearCache: jest.fn(() => {
        fanOutOrder.push('agentDiscovery');
      }),
    } as unknown as jest.Mocked<AgentDiscoverySlice>;

    commandDiscovery = {
      clearCache: jest.fn(() => {
        fanOutOrder.push('commandDiscovery');
      }),
    } as unknown as jest.Mocked<CommandDiscoverySlice>;

    confirmDialog = {
      confirm: jest.fn(),
    } as unknown as jest.Mocked<ConfirmSlice>;

    authState = {
      refreshAuthStatus: jest.fn(async () => undefined),
    } as jest.Mocked<AuthStateSlice>;
    modelState = {
      refreshModels: jest.fn(async () => undefined),
    } as jest.Mocked<ModelStateSlice>;
    effortState = {
      refreshEffort: jest.fn(async () => undefined),
    } as jest.Mocked<EffortStateSlice>;

    consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    consoleError = jest.spyOn(console, 'error').mockImplementation();

    TestBed.configureTestingModule({
      providers: [
        WorkspaceCoordinatorService,
        { provide: TabManagerService, useValue: tabManager },
        { provide: SessionLoaderService, useValue: sessionLoader },
        { provide: ConfirmationDialogService, useValue: confirmDialog },
        { provide: FilePickerService, useValue: filePicker },
        { provide: AgentDiscoveryFacade, useValue: agentDiscovery },
        { provide: CommandDiscoveryFacade, useValue: commandDiscovery },
        { provide: AuthStateService, useValue: authState },
        { provide: ModelStateService, useValue: modelState },
        { provide: EffortStateService, useValue: effortState },
        AppStateManager,
      ],
    });
    service = TestBed.inject(WorkspaceCoordinatorService);

    // AppStateManager is exercised for real (it has no collaborators — only
    // `window` and `localStorage`) so these specs assert the view actually
    // swaps, not merely that a method was called. The spy wraps rather than
    // replaces it, purely to record fan-out position.
    appState = TestBed.inject(AppStateManager);
    const realAppStateSwitch = appState.switchWorkspace.bind(appState);
    jest
      .spyOn(appState, 'switchWorkspace')
      .mockImplementation((path: string) => {
        fanOutOrder.push('appState');
        realAppStateSwitch(path);
      });
  });

  afterEach(() => {
    consoleWarn.mockRestore();
    consoleError.mockRestore();
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  describe('switchWorkspace', () => {
    it('delegates to tabManager.switchWorkspace and sessionLoader.switchWorkspace', async () => {
      await service.switchWorkspace('D:/repo/foo');
      expect(tabManager.switchWorkspace).toHaveBeenCalledWith('D:/repo/foo');
      expect(sessionLoader.switchWorkspace).toHaveBeenCalledWith('D:/repo/foo');
    });

    it('invalidates the @ file picker cache (TASK_2026_200, criterion 11)', async () => {
      await service.switchWorkspace('D:/repo/foo');
      expect(filePicker.switchWorkspace).toHaveBeenCalledWith('D:/repo/foo');
      expect(filePicker.switchWorkspace).toHaveBeenCalledTimes(1);
    });

    it('invalidates the / picker agent and command caches', async () => {
      await service.switchWorkspace('D:/repo/foo');
      expect(agentDiscovery.clearCache).toHaveBeenCalledTimes(1);
      expect(commandDiscovery.clearCache).toHaveBeenCalledTimes(1);
    });

    it('invalidates every picker cache in the same synchronous fan-out', () => {
      // Deliberately NOT awaited: the pickers must be clean the instant the
      // switch is dispatched, not after the dynamic editor import settles.
      // Anything less leaves a window in which the @ or / dropdown can still be
      // opened against the previous workspace's cached list.
      void service.switchWorkspace('D:/repo/foo');
      expect(fanOutOrder).toEqual([
        'tabManager',
        'sessionLoader',
        'filePicker',
        'agentDiscovery',
        'commandDiscovery',
        // Last on purpose: the visible surface only flips once the tab,
        // session and picker state behind it is already the new workspace's.
        'appState',
      ]);
    });

    it('invalidates the pickers even when the editor chunk is unavailable', async () => {
      await service.switchWorkspace('D:/repo/foo');
      expect(filePicker.switchWorkspace).toHaveBeenCalledWith('D:/repo/foo');
      expect(agentDiscovery.clearCache).toHaveBeenCalled();
      expect(commandDiscovery.clearCache).toHaveBeenCalled();
    });

    it('leaves the picker holding the newest switch on rapid A→B→A', async () => {
      await service.switchWorkspace('D:/repo/A');
      await service.switchWorkspace('D:/repo/B');
      await service.switchWorkspace('D:/repo/A');

      // Each switch is a synchronous reset with no await between the
      // switchGeneration bump and the call, so a superseded switch cannot
      // interleave its reset after a newer one's.
      expect(filePicker.switchWorkspace).toHaveBeenCalledTimes(3);
      expect(filePicker.switchWorkspace).toHaveBeenNthCalledWith(
        1,
        'D:/repo/A',
      );
      expect(filePicker.switchWorkspace).toHaveBeenNthCalledWith(
        2,
        'D:/repo/B',
      );
      expect(filePicker.switchWorkspace).toHaveBeenNthCalledWith(
        3,
        'D:/repo/A',
      );
      expect(agentDiscovery.clearCache).toHaveBeenCalledTimes(3);
      expect(commandDiscovery.clearCache).toHaveBeenCalledTimes(3);
    });

    it('re-resolves auth/model/effort after the fan-out (non-blocking)', async () => {
      await service.switchWorkspace('D:/repo/foo');
      // Auth is kicked off synchronously (before the first await) so it is
      // already called by the time the switch resolves...
      expect(authState.refreshAuthStatus).toHaveBeenCalledTimes(1);
      // ...models + effort run after auth resolves, on later microtasks.
      await flushMicrotasks();
      expect(modelState.refreshModels).toHaveBeenCalledTimes(1);
      expect(effortState.refreshEffort).toHaveBeenCalledTimes(1);
    });

    it('does not block the switch on the provider re-resolution', async () => {
      // A slow auth refresh must not delay switchWorkspace resolving — the
      // provider re-resolution is fired detached.
      let releaseAuth: (() => void) | undefined;
      authState.refreshAuthStatus.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            releaseAuth = resolve;
          }),
      );

      await expect(
        service.switchWorkspace('D:/repo/slow'),
      ).resolves.toBeUndefined();
      // Switch resolved even though auth is still pending.
      expect(modelState.refreshModels).not.toHaveBeenCalled();

      releaseAuth?.();
      await flushMicrotasks();
      expect(modelState.refreshModels).toHaveBeenCalledTimes(1);
      expect(effortState.refreshEffort).toHaveBeenCalledTimes(1);
    });

    it("drops a superseded switch's provider refresh (rapid A→B→A, B resolves last)", async () => {
      // Each refreshAuthStatus call parks on its own deferred so we control the
      // resolve order independently of call order. This simulates the rapid
      // A→B→A race where B's auth round-trip resolves AFTER the final A switch.
      const authResolvers: Array<() => void> = [];
      authState.refreshAuthStatus.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            authResolvers.push(() => resolve());
          }),
      );

      await service.switchWorkspace('D:/repo/A'); // generation 1
      await service.switchWorkspace('D:/repo/B'); // generation 2
      await service.switchWorkspace('D:/repo/A'); // generation 3 (current)

      // All three switches kicked off their auth refresh (before the gate).
      expect(authState.refreshAuthStatus).toHaveBeenCalledTimes(3);
      expect(modelState.refreshModels).not.toHaveBeenCalled();

      // The winning (latest) switch resolves first and proceeds to models+effort.
      authResolvers[2]();
      await flushMicrotasks();
      expect(modelState.refreshModels).toHaveBeenCalledTimes(1);
      expect(effortState.refreshEffort).toHaveBeenCalledTimes(1);

      // B's stale refresh (generation 2) resolves LAST — its continuation must
      // be dropped, NOT clobber the current workspace's model/effort state.
      authResolvers[1]();
      await flushMicrotasks();
      expect(modelState.refreshModels).toHaveBeenCalledTimes(1);
      expect(effortState.refreshEffort).toHaveBeenCalledTimes(1);

      // A's original (generation 1) refresh resolving late is likewise dropped.
      authResolvers[0]();
      await flushMicrotasks();
      expect(modelState.refreshModels).toHaveBeenCalledTimes(1);
      expect(effortState.refreshEffort).toHaveBeenCalledTimes(1);
    });

    it('still re-resolves auth/model/effort even when editor services fail', async () => {
      await expect(service.switchWorkspace('D:/x')).resolves.toBeUndefined();
      await flushMicrotasks();
      expect(authState.refreshAuthStatus).toHaveBeenCalledTimes(1);
      expect(modelState.refreshModels).toHaveBeenCalledTimes(1);
      expect(effortState.refreshEffort).toHaveBeenCalledTimes(1);
    });

    it('resolves cleanly even when editor services are not yet loaded', async () => {
      // The dynamic import('@ptah-extension/editor/services') may resolve in
      // the Jest env (Nx registers path aliases) but the resulting services
      // are not provided in the TestBed, so Injector.get either returns null
      // or throws â€” either way the service must swallow and resolve.
      await expect(service.switchWorkspace('D:/x')).resolves.toBeUndefined();
      expect(tabManager.switchWorkspace).toHaveBeenCalledWith('D:/x');
    });
  });

  describe('view state does not survive a workspace switch (TASK_2026_195)', () => {
    it("replaces the previous workspace's view instead of leaving it on screen", async () => {
      await service.switchWorkspace('D:/repo/A');
      appState.setCurrentView('tribunal');
      expect(appState.currentView()).toBe('tribunal');

      await service.switchWorkspace('D:/repo/B');

      // The reported symptom: B used to render A's tribunal surface, backed by
      // B's (empty) tribunal slice.
      expect(appState.currentView()).toBe('chat');
      expect(appState.openViews()).toEqual(['chat']);
    });

    it('restores each workspace view on return (A→B→A)', async () => {
      await service.switchWorkspace('D:/repo/A');
      appState.setCurrentView('tribunal');
      await service.switchWorkspace('D:/repo/B');
      appState.setCurrentView('tasks');
      await service.switchWorkspace('D:/repo/A');

      expect(appState.currentView()).toBe('tribunal');

      await service.switchWorkspace('D:/repo/B');
      expect(appState.currentView()).toBe('tasks');
    });

    it('drops the view slice of a workspace that is closed', async () => {
      await service.switchWorkspace('D:/repo/A');
      appState.setCurrentView('tasks');
      await service.switchWorkspace('D:/repo/B');

      await service.removeWorkspaceState('D:/repo/A');
      await service.switchWorkspace('D:/repo/A');

      expect(appState.currentView()).toBe('chat');
    });

    it("replaces the previous workspace's Thoth tab and marketplace provider too (TASK_2026_228)", async () => {
      await service.switchWorkspace('D:/repo/A');
      appState.setCurrentView('thoth');
      appState.setThothActiveTab('gateway');
      appState.setMarketplaceActiveProvider('skills-sh');

      await service.switchWorkspace('D:/repo/B');

      // B's Thoth pillars and installed content are its own; A's selections
      // used to survive the switch and point at the wrong workspace's state.
      expect(appState.thothActiveTab()).toBe('memory');
      expect(appState.marketplaceActiveProvider()).toBeNull();
    });

    it('restores each workspace Thoth tab and provider on return (TASK_2026_228)', async () => {
      await service.switchWorkspace('D:/repo/A');
      appState.setThothActiveTab('skills');
      appState.setMarketplaceActiveProvider('official-mcp');

      await service.switchWorkspace('D:/repo/B');
      appState.setThothActiveTab('cron');

      await service.switchWorkspace('D:/repo/A');
      expect(appState.thothActiveTab()).toBe('skills');
      expect(appState.marketplaceActiveProvider()).toBe('official-mcp');

      await service.switchWorkspace('D:/repo/B');
      expect(appState.thothActiveTab()).toBe('cron');
      expect(appState.marketplaceActiveProvider()).toBeNull();
    });
  });

  describe('stale-generation guard on the editor fan-out (TASK_2026_195)', () => {
    let editorService: EditorServiceStub;
    let releaseResolution: Array<() => void>;

    beforeEach(() => {
      editorService = {
        switchWorkspace: jest.fn(),
        removeWorkspaceState: jest.fn(),
      };
      releaseResolution = [];
      const internals = service as unknown as CoordinatorInternals;
      jest.spyOn(internals, 'resolveEditorServices').mockImplementation(
        () =>
          new Promise<EditorServiceStub[]>((resolve) => {
            releaseResolution.push(() => resolve([editorService]));
          }),
      );
    });

    it('does not apply a superseded switch to the editor services when it resolves last', async () => {
      void service.switchWorkspace('D:/repo/A'); // generation 1
      void service.switchWorkspace('D:/repo/B'); // generation 2 (current)

      // B's editor chunk resolves first and applies.
      releaseResolution[1]();
      await flushMicrotasks();
      expect(editorService.switchWorkspace).toHaveBeenCalledTimes(1);
      expect(editorService.switchWorkspace).toHaveBeenCalledWith('D:/repo/B');

      // A's resolution lands afterwards. Without the generation re-check it
      // would apply LAST and strand the editor on the workspace the user
      // already navigated away from.
      releaseResolution[0]();
      await flushMicrotasks();
      expect(editorService.switchWorkspace).toHaveBeenCalledTimes(1);
      expect(editorService.switchWorkspace).not.toHaveBeenCalledWith(
        'D:/repo/A',
      );
    });

    it("skips the superseded switch's provider refresh too (the newer switch owns it)", async () => {
      void service.switchWorkspace('D:/repo/A'); // generation 1
      void service.switchWorkspace('D:/repo/B'); // generation 2 (current)

      releaseResolution[1]();
      await flushMicrotasks();
      releaseResolution[0]();
      await flushMicrotasks();

      // Only generation 2 got past the guard, so only one refresh was fired.
      expect(authState.refreshAuthStatus).toHaveBeenCalledTimes(1);
      expect(modelState.refreshModels).toHaveBeenCalledTimes(1);
    });

    it('applies the switch normally when no newer switch supersedes it', async () => {
      const pending = service.switchWorkspace('D:/repo/solo');
      releaseResolution[0]();
      await pending;

      expect(editorService.switchWorkspace).toHaveBeenCalledTimes(1);
      expect(editorService.switchWorkspace).toHaveBeenCalledWith(
        'D:/repo/solo',
      );
    });
  });

  describe('removeWorkspaceState', () => {
    it('delegates to tabManager.removeWorkspaceState and sessionLoader.removeWorkspaceCache', async () => {
      await service.removeWorkspaceState('D:/repo/foo');
      expect(tabManager.removeWorkspaceState).toHaveBeenCalledWith(
        'D:/repo/foo',
      );
      expect(sessionLoader.removeWorkspaceCache).toHaveBeenCalledWith(
        'D:/repo/foo',
      );
    });
  });

  describe('getStreamingSessionIds', () => {
    it('returns [] when the workspace has no tabs', () => {
      tabManager.getWorkspaceTabs.mockReturnValue([]);
      expect(service.getStreamingSessionIds('D:/repo/empty')).toEqual([]);
    });

    it('returns only streaming tabs that have a claudeSessionId', () => {
      tabManager.getWorkspaceTabs.mockReturnValue([
        makeTab({ id: 't1', status: 'streaming', claudeSessionId: 'sess-A' }),
        makeTab({ id: 't2', status: 'loaded', claudeSessionId: 'sess-B' }),
        makeTab({ id: 't3', status: 'streaming', claudeSessionId: null }),
        makeTab({ id: 't4', status: 'streaming', claudeSessionId: 'sess-C' }),
      ]);

      const ids = service.getStreamingSessionIds('D:/repo/mixed');
      expect(ids).toEqual(['sess-A', 'sess-C']);
    });
  });

  describe('confirm', () => {
    it('passes options to ConfirmationDialogService and returns the user choice', async () => {
      confirmDialog.confirm.mockResolvedValue(true);
      const result = await service.confirm({
        title: 'Delete?',
        message: 'Are you sure?',
      });

      expect(confirmDialog.confirm).toHaveBeenCalledWith({
        title: 'Delete?',
        message: 'Are you sure?',
      });
      expect(result).toBe(true);
    });

    it('returns false when the user cancels', async () => {
      confirmDialog.confirm.mockResolvedValue(false);
      const result = await service.confirm({
        title: 'Quit',
        message: 'Unsaved work',
      });
      expect(result).toBe(false);
    });
  });
});
