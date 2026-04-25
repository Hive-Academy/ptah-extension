/**
 * WorkspaceCoordinatorService specs — orchestrates workspace switching across
 * TabManager, SessionLoader, ConfirmationDialog and lazy-loaded editor services.
 *
 * Coverage:
 *   - switchWorkspace delegates to tabManager + sessionLoader
 *   - removeWorkspaceState delegates to tabManager + sessionLoader
 *   - getStreamingSessionIds filters streaming tabs with claudeSessionId
 *   - confirm passes options through to ConfirmationDialogService
 *   - Editor-service resolution fails gracefully when the lazy chunk is absent
 *     (the dynamic import() throws in test env because the alias is not
 *     registered in the module resolver — we swallow and continue).
 */

import { TestBed } from '@angular/core/testing';
import { WorkspaceCoordinatorService } from './workspace-coordinator.service';
import { TabManagerService } from './tab-manager.service';
import { ConfirmationDialogService } from './confirmation-dialog.service';
import { SessionLoaderService } from './chat-store/session-loader.service';
import type { TabState } from '@ptah-extension/chat-types';

type TabManagerSlice = Pick<
  TabManagerService,
  'switchWorkspace' | 'removeWorkspaceState' | 'getWorkspaceTabs'
>;
type SessionLoaderSlice = Pick<
  SessionLoaderService,
  'switchWorkspace' | 'removeWorkspaceCache'
>;
type ConfirmSlice = Pick<ConfirmationDialogService, 'confirm'>;

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

    consoleWarn = jest.spyOn(console, 'warn').mockImplementation();
    consoleError = jest.spyOn(console, 'error').mockImplementation();

    TestBed.configureTestingModule({
      providers: [
        WorkspaceCoordinatorService,
        { provide: TabManagerService, useValue: tabManager },
        { provide: SessionLoaderService, useValue: sessionLoader },
        { provide: ConfirmationDialogService, useValue: confirmDialog },
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

    it('resolves cleanly even when editor services are not yet loaded', async () => {
      // The dynamic import('@ptah-extension/editor/services') may resolve in
      // the Jest env (Nx registers path aliases) but the resulting services
      // are not provided in the TestBed, so Injector.get either returns null
      // or throws — either way the service must swallow and resolve.
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
