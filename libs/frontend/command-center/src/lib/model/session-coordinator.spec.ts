import { TestBed } from '@angular/core/testing';
import { ChatStore, MessageSenderService } from '@ptah-extension/chat';
import { CommandCenterRecordsService, CommandCenterSendLockService, TabManagerService } from '@ptah-extension/chat-state';
import { ClaudeRpcService } from '@ptah-extension/core';
import { CommandCenterStore } from './command-center.store';
import { CommandCenterSessionCoordinator } from './session-coordinator';

describe('CommandCenterSessionCoordinator', () => {
  const sdkId = '11111111-1111-4111-8111-111111111111';
  const rootId = '22222222-2222-4222-8222-222222222222';
  const otherId = '33333333-3333-4333-8333-333333333333';
  const root = { id: rootId, claudeSessionId: sdkId, commandCenterOrigin: { workspaceId: '/repo', createdAt: 1, version: 1 } };
  const other = { id: otherId, claudeSessionId: 'other', commandCenterOrigin: undefined };
  let tabs: { activeWorkspacePath: string; tabs: jest.Mock; switchTab: jest.Mock; createCommandCenterTab: jest.Mock; attachSession: jest.Mock; findTabByIdAcrossWorkspaces: jest.Mock };
  let records: { readActiveTabId: jest.Mock; readLastSession: jest.Mock };
  let rpc: { call: jest.Mock };
  let sender: { send: jest.Mock };
  let chat: { switchSession: jest.Mock; handleQuestionResponse: jest.Mock };
  let coordinator: CommandCenterSessionCoordinator;
  let store: CommandCenterStore;

  beforeEach(() => {
    tabs = {
      activeWorkspacePath: '/repo', tabs: jest.fn(() => [root, other]),
      switchTab: jest.fn(), createCommandCenterTab: jest.fn(() => rootId),
      attachSession: jest.fn(), findTabByIdAcrossWorkspaces: jest.fn((id: string) => ({ tab: id === rootId ? root : other })),
    };
    records = { readActiveTabId: jest.fn(() => rootId), readLastSession: jest.fn() };
    rpc = { call: jest.fn(async () => ({ success: true, data: { sessions: [{ id: sdkId }] } })) };
    sender = { send: jest.fn(async () => ({ success: true })) };
    chat = { switchSession: jest.fn(async () => undefined), handleQuestionResponse: jest.fn() };
    TestBed.configureTestingModule({ providers: [
      CommandCenterSessionCoordinator, CommandCenterStore, CommandCenterSendLockService,
      { provide: TabManagerService, useValue: tabs },
      { provide: CommandCenterRecordsService, useValue: records },
      { provide: ClaudeRpcService, useValue: rpc },
      { provide: MessageSenderService, useValue: sender },
      { provide: ChatStore, useValue: chat },
    ] });
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
    expect(chat.handleQuestionResponse).toHaveBeenCalledWith(expect.anything(), rootId);
  });

  it('validates and resumes the last recorded SDK session', async () => {
    records.readActiveTabId.mockReturnValue(undefined);
    records.readLastSession.mockReturnValue({ sdkSessionId: sdkId });
    expect(await coordinator.openOrResume()).toBe(rootId);
    expect(rpc.call).toHaveBeenCalledWith('session:list', { workspacePath: '/repo' }, expect.anything());
    expect(tabs.attachSession).toHaveBeenCalledWith(rootId, sdkId);
    expect(chat.switchSession).toHaveBeenCalledWith(sdkId);
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

  it('holds voice sends for nonowners and releases on mute and Stop', async () => {
    await coordinator.openOrResume();
    const lock = TestBed.inject(CommandCenterSendLockService);
    coordinator.startVoice();
    expect(lock.isHeld(rootId)).toBe(true);
    expect(lock.isHeld(otherId)).toBe(false);
    await coordinator.send('objective');
    expect(sender.send).toHaveBeenCalledWith('objective', expect.objectContaining({ tabId: rootId, ownerToken: expect.any(String) }));
    coordinator.mute();
    expect(lock.isHeld(rootId)).toBe(false);
    coordinator.startVoice();
    await coordinator.stop();
    expect(rpc.call).toHaveBeenCalledWith('chat:abort', { sessionId: sdkId });
    expect(lock.isHeld(rootId)).toBe(false);
  });

  it('prepends status context only for a status turn', async () => {
    await coordinator.openOrResume();
    coordinator.setStatusContextProvider(() => 'COMMAND_CENTER_STATUS_CONTEXT');
    await coordinator.send('normal');
    await coordinator.sendStatusTurn('status');
    expect(sender.send.mock.calls[0][0]).toBe('normal');
    expect(sender.send.mock.calls[1][0]).toBe('COMMAND_CENTER_STATUS_CONTEXT\n\nstatus');
  });
});
