import { TestBed } from '@angular/core/testing';
import type { TabState } from '@ptah-extension/chat-types';
import { ConfirmationDialogService } from './confirmation-dialog.service';
import { CommandCenterRecordsService } from './command-center-records';
import { CommandCenterSendLockService } from './command-center-send-lock.service';
import { MODEL_REFRESH_CONTROL } from './model-refresh-control';
import { TabManagerService } from './tab-manager.service';
import { TabWorkspacePartitionService } from './tab-workspace-partition.service';

describe('TabManagerService Command Center lifecycle', () => {
  let tabs: TabManagerService;
  let records: CommandCenterRecordsService;
  let lock: CommandCenterSendLockService;
  let confirm: jest.Mock;

  beforeEach(() => {
    localStorage.clear();
    confirm = jest.fn().mockResolvedValue(true);
    TestBed.configureTestingModule({ providers: [
      TabManagerService,
      { provide: ConfirmationDialogService, useValue: { confirm } },
      { provide: MODEL_REFRESH_CONTROL, useValue: { refreshModels: jest.fn().mockResolvedValue(undefined) } },
      { provide: TabWorkspacePartitionService, useValue: {
        initialize: jest.fn(),
        activeWorkspacePath: '/workspace',
        getStorageKeyForWorkspace: (path: string) => `tabs.${path}`,
        registerSessionForWorkspace: jest.fn(),
        unregisterSession: jest.fn(),
        findTabByIdAcrossWorkspaces: (id: string, active: readonly TabState[]) => {
          const tab = active.find((item) => item.id === id);
          return tab ? { tab, workspacePath: '/workspace' } : null;
        },
        syncActiveWorkspaceState: jest.fn(),
        updateBackgroundTab: jest.fn(),
      } },
    ] });
    tabs = TestBed.inject(TabManagerService);
    records = TestBed.inject(CommandCenterRecordsService);
    lock = TestBed.inject(CommandCenterSendLockService);
  });

  it('marks and activates an ordinary tab, then rekeys the lock and records its resolved SDK ID', () => {
    const id = tabs.createCommandCenterTab('Command Center');
    expect(tabs.activeTabId()).toBe(id);
    expect(tabs.tabs().find((tab) => tab.id === id)?.commandCenterOrigin).toEqual({
      workspaceId: '/workspace', createdAt: expect.any(Number), version: 1,
    });
    expect(records.readActiveTabId('/workspace')).toBe(id);
    lock.engage(id, null, 'voice');
    tabs.attachSession(id, '11111111-1111-4111-8111-111111111111');
    expect(lock.isHeld('11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(records.readLastSession('/workspace')).toEqual({
      sdkSessionId: '11111111-1111-4111-8111-111111111111', tabId: id, updatedAt: expect.any(Number),
    });
  });

  it('warns on close, aborts its stream, and retains the last-session record', async () => {
    const id = tabs.createCommandCenterTab();
    tabs.attachSession(id, '22222222-2222-4222-8222-222222222222');
    const controller = tabs.createAbortController(id);
    confirm.mockResolvedValueOnce(false);
    await tabs.closeTab(id);
    expect(tabs.tabs().some((tab) => tab.id === id)).toBe(true);
    expect(controller.aborted).toBe(false);
    await tabs.closeTab(id);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(controller.aborted).toBe(true);
    expect(tabs.tabs().some((tab) => tab.id === id)).toBe(false);
    expect(records.readActiveTabId('/workspace')).toBeUndefined();
    expect(records.readLastSession('/workspace')?.sdkSessionId).toBe('22222222-2222-4222-8222-222222222222');
  });

  it('leaves an unmarked tab on the existing close path', async () => {
    const id = tabs.createTab();
    await tabs.closeTab(id);
    expect(confirm).not.toHaveBeenCalled();
    expect(records.readLastSession('/workspace')).toBeUndefined();
  });
});
