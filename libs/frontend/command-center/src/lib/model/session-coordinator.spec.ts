import { TestBed } from '@angular/core/testing';
import { ChatStore, MessageSenderService } from '@ptah-extension/chat';
import {
  CommandCenterRecordsService,
  CommandCenterSendLockService,
  TabManagerService,
} from '@ptah-extension/chat-state';
import { ClaudeRpcService } from '@ptah-extension/core';
import { CommandCenterStore } from './command-center.store';
import { CommandCenterSessionCoordinator } from './session-coordinator';

describe('CommandCenterSessionCoordinator', () => {
  const sdkId = '11111111-1111-4111-8111-111111111111';
  const rootId = '22222222-2222-4222-8222-222222222222';
  const otherId = '33333333-3333-4333-8333-333333333333';
  const root = {
    id: rootId,
    status: 'loaded',
    claudeSessionId: sdkId,
    messages: [{}],
    hasLiveSession: false,
    commandCenterOrigin: { workspaceId: '/repo', createdAt: 1, version: 1 },
  };
  const other = {
    id: otherId,
    claudeSessionId: 'other',
    commandCenterOrigin: undefined,
  };
  let tabs: {
    activeWorkspacePath: string;
    tabs: jest.Mock;
    switchTab: jest.Mock;
    createCommandCenterTab: jest.Mock;
    attachSession: jest.Mock;
    findTabBySessionId: jest.Mock;
    findTabByIdAcrossWorkspaces: jest.Mock;
  };
  let records: { readActiveTabId: jest.Mock; readLastSession: jest.Mock };
  let rpc: { call: jest.Mock };
  let sender: { send: jest.Mock };
  let chat: { switchSession: jest.Mock; handleQuestionResponse: jest.Mock };
  let coordinator: CommandCenterSessionCoordinator;
  let store: CommandCenterStore;

  beforeEach(() => {
    tabs = {
      activeWorkspacePath: '/repo',
      tabs: jest.fn(() => [root, other]),
      switchTab: jest.fn(),
      createCommandCenterTab: jest.fn(() => rootId),
      attachSession: jest.fn(),
      findTabBySessionId: jest.fn(() => null),
      findTabByIdAcrossWorkspaces: jest.fn((id: string) => ({
        tab: id === rootId ? root : other,
      })),
    };
    records = {
      readActiveTabId: jest.fn(() => rootId),
      readLastSession: jest.fn(),
    };
    rpc = {
      call: jest.fn(async () => ({
        success: true,
        data: { sessions: [{ id: sdkId }] },
      })),
    };
    sender = { send: jest.fn(async () => ({ success: true })) };
    chat = {
      switchSession: jest.fn(async () => undefined),
      handleQuestionResponse: jest.fn(),
    };
    TestBed.configureTestingModule({
      providers: [
        CommandCenterSessionCoordinator,
        CommandCenterStore,
        CommandCenterSendLockService,
        { provide: TabManagerService, useValue: tabs },
        { provide: CommandCenterRecordsService, useValue: records },
        { provide: ClaudeRpcService, useValue: rpc },
        { provide: MessageSenderService, useValue: sender },
        { provide: ChatStore, useValue: chat },
      ],
    });
    coordinator = TestBed.inject(CommandCenterSessionCoordinator);
    store = TestBed.inject(CommandCenterStore);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('reuses only the marked root when another tab has interleaved activity', async () => {
    expect(await coordinator.openOrResume()).toBe(rootId);
    expect(store.markedTabId()).toBe(rootId);
    expect(store.sessionId()).toBe(sdkId);
    expect(tabs.switchTab).toHaveBeenCalledWith(rootId);
    expect(rpc.call).not.toHaveBeenCalled();
    coordinator.answerQuestion({ id: 'question', answers: {} });
    expect(chat.handleQuestionResponse).toHaveBeenCalledWith(
      expect.anything(),
      rootId,
    );
  });

  it('validates and resumes the last recorded SDK session', async () => {
    records.readActiveTabId.mockReturnValue(undefined);
    records.readLastSession.mockReturnValue({ sdkSessionId: sdkId });
    expect(await coordinator.openOrResume()).toBe(rootId);
    expect(rpc.call).toHaveBeenCalledWith(
      'session:list',
      { workspacePath: '/repo' },
      expect.anything(),
    );
    expect(tabs.attachSession).toHaveBeenCalledWith(rootId, sdkId);
    expect(chat.switchSession).toHaveBeenCalledWith(sdkId, {
      targetTabId: rootId,
    });
  });

  it('retries an unfinished marked-tab restore before reporting idle', async () => {
    const unfinished = { ...root, messages: [], hasLiveSession: false };
    tabs.tabs.mockReturnValue([unfinished, other]);
    chat.switchSession.mockRejectedValueOnce(new Error('restore failed'));

    expect(await coordinator.openOrResume()).toBeNull();
    expect(store.sessionStatus()).toBe('error');
    expect(chat.switchSession).toHaveBeenCalledWith(sdkId, {
      targetTabId: rootId,
    });

    expect(await coordinator.openOrResume()).toBe(rootId);
    expect(chat.switchSession).toHaveBeenCalledTimes(2);
    expect(store.sessionStatus()).toBe('idle');
  });

  it('resumes an idle marked tab as idle', async () => {
    expect(await coordinator.openOrResume()).toBe(rootId);
    expect(store.sessionStatus()).toBe('idle');
  });

  it('refuses to resume an SDK session already open in another tab', async () => {
    records.readActiveTabId.mockReturnValue(undefined);
    records.readLastSession.mockReturnValue({ sdkSessionId: sdkId });
    tabs.findTabBySessionId.mockReturnValue(other);

    expect(await coordinator.openOrResume()).toBeNull();
    expect(tabs.switchTab).toHaveBeenCalledWith(otherId);
    expect(tabs.createCommandCenterTab).not.toHaveBeenCalled();
    expect(tabs.attachSession).not.toHaveBeenCalled();
    expect(chat.switchSession).not.toHaveBeenCalled();
    expect(store.toast()?.message).toBe(
      'This session is already open in another tab. Close it there to resume it in Command Center.',
    );
  });

  it('creates a new marked tab when there is no prior session', async () => {
    records.readActiveTabId.mockReturnValue(undefined);
    expect(await coordinator.openOrResume()).toBe(rootId);
    expect(tabs.createCommandCenterTab).toHaveBeenCalledWith('Command Center');
    expect(store.sessionId()).toBeNull();
  });

  it('preserves the saved session when the list read fails', async () => {
    records.readActiveTabId.mockReturnValue(undefined);
    records.readLastSession.mockReturnValue({ sdkSessionId: sdkId });
    rpc.call.mockResolvedValue({ success: false });
    expect(await coordinator.openOrResume()).toBeNull();
    expect(rpc.call).toHaveBeenCalledTimes(3);
    expect(tabs.createCommandCenterTab).not.toHaveBeenCalled();
    expect(store.sessionStatus()).toBe('error');
  });

  it('preserves the saved session when the successful list has no sessions array', async () => {
    records.readActiveTabId.mockReturnValue(undefined);
    records.readLastSession.mockReturnValue({ sdkSessionId: sdkId });
    rpc.call.mockResolvedValue({ success: true, data: {} });

    expect(await coordinator.openOrResume()).toBeNull();
    expect(rpc.call).toHaveBeenCalledTimes(3);
    expect(tabs.createCommandCenterTab).not.toHaveBeenCalled();
    expect(store.sessionStatus()).toBe('error');
  });

  it('releases voice and resets meters when starting a new Command Center', async () => {
    await coordinator.openOrResume();
    const lock = TestBed.inject(CommandCenterSendLockService);
    coordinator.startVoice();
    store.updateLevels(0.8, 0.8);

    expect(coordinator.newCommandCenter()).toBe(rootId);
    expect(lock.isHeld(rootId)).toBe(false);
    expect(store.voiceState()).toBe('idle');
    expect([store.inputLevel(), store.outputLevel()]).toEqual([0, 0]);
  });

  it('holds voice sends for nonowners and releases on mute and Stop', async () => {
    await coordinator.openOrResume();
    const lock = TestBed.inject(CommandCenterSendLockService);
    coordinator.startVoice();
    expect(lock.isHeld(rootId)).toBe(true);
    expect(lock.isHeld(otherId)).toBe(false);
    await coordinator.send('objective');
    expect(sender.send).toHaveBeenCalledWith(
      'objective',
      expect.objectContaining({
        tabId: rootId,
        ownerToken: expect.any(String),
      }),
    );
    store.updateLevels(0.8, 0.8);
    coordinator.mute();
    expect(lock.isHeld(rootId)).toBe(false);
    expect(store.voiceState()).toBe('muted');
    expect([store.inputLevel(), store.outputLevel()]).toEqual([0, 0]);
    coordinator.startVoice();
    store.updateLevels(0.4, 0.6);
    await coordinator.stop();
    expect(rpc.call).toHaveBeenCalledWith('chat:abort', { sessionId: sdkId });
    expect(lock.isHeld(rootId)).toBe(false);
    expect(store.voiceState()).toBe('stopped');
    expect([store.inputLevel(), store.outputLevel()]).toEqual([0, 0]);
  });

  it('prepends status context only for a status turn', async () => {
    await coordinator.openOrResume();
    coordinator.setStatusContextProvider(() => 'COMMAND_CENTER_STATUS_CONTEXT');
    await coordinator.send('normal');
    await coordinator.sendStatusTurn('status');
    expect(sender.send.mock.calls[0][0]).toBe('normal');
    expect(sender.send.mock.calls[1][0]).toBe(
      'COMMAND_CENTER_STATUS_CONTEXT\n\nstatus',
    );
  });

  it.each([
    [
      'send',
      (subject: CommandCenterSessionCoordinator) => subject.send('turn'),
    ],
    [
      'sendStatusTurn',
      (subject: CommandCenterSessionCoordinator) =>
        subject.sendStatusTurn('status'),
    ],
    [
      'sendLaunchTurn',
      (subject: CommandCenterSessionCoordinator) =>
        subject.sendLaunchTurn('launch'),
    ],
  ])(
    'refuses %s while the marked tab belongs to another workspace',
    async (_name, send) => {
      store.setSession(rootId, sdkId, '/repo');
      store.setSessionStatus('running');
      tabs.activeWorkspacePath = '/other';

      expect(await send(coordinator)).toBe(false);
      expect(sender.send).not.toHaveBeenCalled();
      expect(store.sessionStatus()).toBe('running');
      expect(store.toast()).toEqual({
        message:
          'Command Center is switching to the selected workspace. Send again when it is ready.',
        tone: 'error',
      });
    },
  );

  it.each([
    [
      'send',
      (subject: CommandCenterSessionCoordinator) => subject.send('turn'),
    ],
    [
      'sendStatusTurn',
      (subject: CommandCenterSessionCoordinator) =>
        subject.sendStatusTurn('status'),
    ],
    [
      'sendLaunchTurn',
      (subject: CommandCenterSessionCoordinator) =>
        subject.sendLaunchTurn('launch'),
    ],
  ])(
    'sends %s when the marked tab matches the workspace',
    async (_name, send) => {
      store.setSession(rootId, sdkId, '/repo');

      expect(await send(coordinator)).toBe(true);
      expect(sender.send).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ tabId: rootId }),
      );
      expect(store.sessionStatus()).toBe('running');
    },
  );

  it('reports a send rejection with safe text and an error status', async () => {
    await coordinator.openOrResume();
    sender.send.mockResolvedValueOnce({
      success: false,
      error: 'private path',
    });
    expect(await coordinator.send('turn')).toBe(false);
    expect(store.sessionStatus()).toBe('error');
    expect(store.toast()).toEqual({
      message: 'Could not send the Command Center message.',
      tone: 'error',
    });
  });

  it.each([
    ['success', { success: true }, true],
    ['failure', { success: false }, false],
  ])(
    'leaves a newer binding untouched after an in-flight %s',
    async (_name, result, expected) => {
      store.setSession(rootId, sdkId, '/repo');
      let resolveSend!: (value: { success: boolean }) => void;
      sender.send.mockReturnValueOnce(
        new Promise<{ success: boolean }>((resolve) => {
          resolveSend = resolve;
        }),
      );
      const pending = coordinator.send('turn');
      store.setSession(otherId, 'new-session', '/other');
      store.setSessionStatus('idle');
      resolveSend(result);
      expect(await pending).toBe(expected);
      expect(store.markedTabId()).toBe(otherId);
      expect(store.workspace()).toBe('/other');
      expect(store.sessionId()).toBe('new-session');
      expect(store.sessionStatus()).toBe('idle');
      expect(store.toast()).toBeNull();
    },
  );

  it('does not show a send exception on a newer binding', async () => {
    store.setSession(rootId, sdkId, '/repo');
    let rejectSend!: (error: Error) => void;
    sender.send.mockReturnValueOnce(
      new Promise((_, reject) => {
        rejectSend = reject;
      }),
    );
    const pending = coordinator.send('turn');
    store.setSession(otherId, 'new-session', '/other');
    store.setSessionStatus('idle');
    rejectSend(new Error('private path'));
    expect(await pending).toBe(false);
    expect(store.markedTabId()).toBe(otherId);
    expect(store.workspace()).toBe('/other');
    expect(store.sessionStatus()).toBe('idle');
    expect(store.toast()).toBeNull();
  });

  it('sets the current session and running status after a successful send', async () => {
    store.setSession(rootId, null, '/repo');
    expect(await coordinator.send('turn')).toBe(true);
    expect(store.sessionId()).toBe(sdkId);
    expect(store.sessionStatus()).toBe('running');
  });

  it('refuses a send if the workspace changes while opening a tab', async () => {
    let resolveOpen!: (tabId: string) => void;
    jest.spyOn(coordinator, 'openOrResume').mockReturnValueOnce(
      new Promise<string>((resolve) => {
        resolveOpen = resolve;
      }),
    );
    const pending = coordinator.send('turn');
    tabs.activeWorkspacePath = '/other';
    resolveOpen(rootId);
    expect(await pending).toBe(false);
    expect(sender.send).not.toHaveBeenCalled();
    expect(store.toast()).toEqual({
      message:
        'Command Center is switching to the selected workspace. Send again when it is ready.',
      tone: 'error',
    });
  });
});
