import { TestBed } from '@angular/core/testing';
import type { TabState } from '@ptah-extension/chat-types';
import { ConfirmationDialogService } from './confirmation-dialog.service';
import { CommandCenterRecordsService } from './command-center-records';
import { CommandCenterSendLockService } from './command-center-send-lock.service';
import { MODEL_REFRESH_CONTROL } from './model-refresh-control';
import { TabManagerService } from './tab-manager.service';
import { TabWorkspacePartitionService } from './tab-workspace-partition.service';

const run = (rootTabId: string, runId: string) => ({
  runId,
  rootTabId,
  rootSdkId: 'sdk',
  move: 'council' as const,
  specTaskId: 'task',
  lanes: [{ laneId: 'lane' }],
  rounds: 1,
  startedAt: 1,
});

describe('TabManagerService Command Center lifecycle', () => {
  let tabs: TabManagerService;
  let records: CommandCenterRecordsService;
  let lock: CommandCenterSendLockService;
  let confirm: jest.Mock;
  let switchWorkspace: jest.Mock;

  beforeEach(() => {
    localStorage.clear();
    confirm = jest.fn().mockResolvedValue(true);
    switchWorkspace = jest
      .fn()
      .mockReturnValue({ tabs: [], activeTabId: null });
    TestBed.configureTestingModule({
      providers: [
        TabManagerService,
        { provide: ConfirmationDialogService, useValue: { confirm } },
        {
          provide: MODEL_REFRESH_CONTROL,
          useValue: { refreshModels: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: TabWorkspacePartitionService,
          useValue: {
            initialize: jest.fn(),
            switchWorkspace,
            activeWorkspacePath: '/workspace',
            getStorageKeyForWorkspace: (path: string) => `tabs.${path}`,
            registerSessionForWorkspace: jest.fn(),
            unregisterSession: jest.fn(),
            findTabByIdAcrossWorkspaces: (
              id: string,
              active: readonly TabState[],
            ) => {
              const tab = active.find((item) => item.id === id);
              return tab ? { tab, workspacePath: '/workspace' } : null;
            },
            syncActiveWorkspaceState: jest.fn(),
            updateBackgroundTab: jest.fn(),
          },
        },
      ],
    });
    tabs = TestBed.inject(TabManagerService);
    records = TestBed.inject(CommandCenterRecordsService);
    lock = TestBed.inject(CommandCenterSendLockService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('marks and activates an ordinary tab, then rekeys the lock and records its resolved SDK ID', () => {
    const id = tabs.createCommandCenterTab('Command Center');
    expect(tabs.activeTabId()).toBe(id);
    expect(
      tabs.tabs().find((tab) => tab.id === id)?.commandCenterOrigin,
    ).toEqual({
      workspaceId: '/workspace',
      createdAt: expect.any(Number),
      version: 1,
    });
    expect(records.readActiveTabId('/workspace')).toBe(id);
    lock.engage(id, null, 'voice');
    tabs.attachSession(id, '11111111-1111-4111-8111-111111111111');
    expect(lock.isHeld('11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(records.readLastSession('/workspace')).toEqual({
      sdkSessionId: '11111111-1111-4111-8111-111111111111',
      tabId: id,
      updatedAt: expect.any(Number),
    });
  });

  it('warns on close, aborts its stream, and retains the last-session record', async () => {
    const other = tabs.createCommandCenterTab();
    const id = tabs.createCommandCenterTab();
    const firstRun = run(id, 'b5fa2ef3-a71c-4e13-8f33-b861f65e7744');
    const secondRun = run(id, 'ca22a5f9-0871-4a9c-a68d-2a0c0774a14d');
    const otherRun = run(other, '64d98ce1-8ab0-45dc-9dfb-56f519ac5328');
    records.writeRunManifest('/workspace', firstRun);
    records.writeRunManifest('/workspace', secondRun);
    records.writeRunManifest('/workspace', otherRun);
    tabs.attachSession(id, '22222222-2222-4222-8222-222222222222');
    const controller = tabs.createAbortController(id);
    lock.engage(id, '22222222-2222-4222-8222-222222222222', 'voice');
    confirm.mockResolvedValueOnce(false);
    await tabs.closeTab(id);
    expect(tabs.tabs().some((tab) => tab.id === id)).toBe(true);
    expect(controller.aborted).toBe(false);
    expect(lock.isHeld(id)).toBe(true);
    expect(records.readRunManifests('/workspace', id)).toEqual([
      firstRun,
      secondRun,
    ]);
    await tabs.closeTab(id);
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(controller.aborted).toBe(true);
    expect(tabs.tabs().some((tab) => tab.id === id)).toBe(false);
    expect(lock.isHeld(id)).toBe(false);
    expect(lock.isHeld('22222222-2222-4222-8222-222222222222')).toBe(false);
    expect(records.readActiveTabId('/workspace')).toBeUndefined();
    expect(records.readRunManifests('/workspace', id)).toEqual([]);
    expect(records.readRunManifests('/workspace', other)).toEqual([otherRun]);
    expect(records.readLastSession('/workspace')?.sdkSessionId).toBe(
      '22222222-2222-4222-8222-222222222222',
    );
  });

  it('keeps a different root locked when a marked tab closes', async () => {
    const root = tabs.createCommandCenterTab();
    const other = tabs.createCommandCenterTab();
    lock.engage(root, null, 'voice');
    await tabs.closeTab(other);
    expect(lock.isHeld(root)).toBe(true);
  });

  it('keeps the lock when a tab is parked during the close confirmation', async () => {
    const id = tabs.createCommandCenterTab();
    const manifest = run(id, 'b5fa2ef3-a71c-4e13-8f33-b861f65e7744');
    records.writeRunManifest('/workspace', manifest);
    lock.engage(id, null, 'voice');
    confirm.mockImplementationOnce(async () => {
      tabs.switchWorkspace('/other');
      return true;
    });
    await tabs.closeTab(id);
    expect(switchWorkspace).toHaveBeenCalled();
    expect(lock.isHeld(id)).toBe(true);
    expect(records.readActiveTabId('/workspace')).toBe(id);
    expect(records.readRunManifests('/workspace', id)).toEqual([manifest]);
  });

  it('surfaces a failed bind write and clears the notice on a successful write', () => {
    const id = tabs.createCommandCenterTab();
    const warning = jest.spyOn(console, 'warn').mockImplementation();
    const setItem = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('storage failure must stay private');
      });
    tabs.attachSession(id, '11111111-1111-4111-8111-111111111111');
    expect(tabs.tabs().find((tab) => tab.id === id)?.claudeSessionId).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(tabs.commandCenterRecordWriteFailure()).toEqual({
      workspacePath: '/workspace',
      record: 'lastSession',
    });
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining(
        'lastSession record write failed for workspace /workspace',
      ),
    );
    expect(warning.mock.calls.flat().join(' ')).not.toContain(
      'storage failure must stay private',
    );
    setItem.mockRestore();
    tabs.attachSession(id, '22222222-2222-4222-8222-222222222222');
    expect(tabs.commandCenterRecordWriteFailure()).toBeNull();
  });

  it('surfaces a failed create write while the tab is still created', () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation();
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage failure must stay private');
    });
    const created = tabs.createCommandCenterTab();
    expect(tabs.activeTabId()).toBe(created);
    expect(tabs.commandCenterRecordWriteFailure()).toEqual({
      workspacePath: '/workspace',
      record: 'activeTabId',
    });
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining(
        'activeTabId record write failed for workspace /workspace',
      ),
    );
    expect(warning.mock.calls.flat().join(' ')).not.toContain(
      'storage failure must stay private',
    );
  });

  it('surfaces a failed manifest removal while the tab still closes', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation();
    const id = tabs.createCommandCenterTab();
    records.writeRunManifest(
      '/workspace',
      run(id, 'b5fa2ef3-a71c-4e13-8f33-b861f65e7744'),
    );
    expect(tabs.commandCenterRecordWriteFailure()).toBeNull();
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage failure must stay private');
    });
    await tabs.closeTab(id);
    expect(tabs.tabs().some((tab) => tab.id === id)).toBe(false);
    expect(tabs.commandCenterRecordWriteFailure()).toEqual({
      workspacePath: '/workspace',
      record: 'runManifest',
    });
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining(
        'runManifest record write failed for workspace /workspace',
      ),
    );
    expect(warning.mock.calls.flat().join(' ')).not.toContain(
      'storage failure must stay private',
    );
  });

  it('leaves an unmarked tab on the existing close path', async () => {
    const warning = jest.spyOn(console, 'warn').mockImplementation();
    const setItem = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('storage failure must stay private');
      });
    tabs.createCommandCenterTab();
    const failure = tabs.commandCenterRecordWriteFailure();
    const warningCount = warning.mock.calls.length;
    const id = tabs.createTab();
    const remove = jest.spyOn(records, 'removeRunManifests');
    await tabs.closeTab(id);
    expect(remove).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(records.readLastSession('/workspace')).toBeUndefined();
    expect(tabs.commandCenterRecordWriteFailure()).toEqual(failure);
    expect(warning).toHaveBeenCalledTimes(warningCount);
    setItem.mockRestore();
  });
});
