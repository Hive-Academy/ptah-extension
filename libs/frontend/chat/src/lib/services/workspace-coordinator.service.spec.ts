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
 */

import { TestBed } from '@angular/core/testing';
import { WorkspaceCoordinatorService } from './workspace-coordinator.service';
import {
  ConfirmationDialogService,
  TabManagerService,
} from '@ptah-extension/chat-state';
import {
  AuthStateService,
  EffortStateService,
  ModelStateService,
} from '@ptah-extension/core';
import { SessionLoaderService } from './chat-store/session-loader.service';
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

describe('WorkspaceCoordinatorService', () => {
  let service: WorkspaceCoordinatorService;
  let tabManager: jest.Mocked<TabManagerSlice>;
  let sessionLoader: jest.Mocked<SessionLoaderSlice>;
  let confirmDialog: jest.Mocked<ConfirmSlice>;
  let authState: jest.Mocked<AuthStateSlice>;
  let modelState: jest.Mocked<ModelStateSlice>;
  let effortState: jest.Mocked<EffortStateSlice>;
  let consoleWarn: jest.SpyInstance;
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    tabManager = {
      switchWorkspace: jest.fn(),
      removeWorkspaceState: jest.fn(),
      getWorkspaceTabs: jest.fn(() => []),
    } as unknown as jest.Mocked<TabManagerSlice>;

    sessionLoader = {
      switchWorkspace: jest.fn(),
      removeWorkspaceCache: jest.fn(),
    } as jest.Mocked<SessionLoaderSlice>;

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
        { provide: AuthStateService, useValue: authState },
        { provide: ModelStateService, useValue: modelState },
        { provide: EffortStateService, useValue: effortState },
      ],
    });
    service = TestBed.inject(WorkspaceCoordinatorService);
  });

  afterEach(() => {
    consoleWarn.mockRestore();
    consoleError.mockRestore();
    TestBed.resetTestingModule();
  });

  describe('switchWorkspace', () => {
    it('delegates to tabManager.switchWorkspace and sessionLoader.switchWorkspace', async () => {
      await service.switchWorkspace('D:/repo/foo');
      expect(tabManager.switchWorkspace).toHaveBeenCalledWith('D:/repo/foo');
      expect(sessionLoader.switchWorkspace).toHaveBeenCalledWith('D:/repo/foo');
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
