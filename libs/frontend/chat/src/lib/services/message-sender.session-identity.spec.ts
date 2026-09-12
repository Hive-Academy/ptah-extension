import { TestBed } from '@angular/core/testing';
import {
  AuthStateService,
  ClaudeRpcService,
  EffortStateService,
  ModelStateService,
  PtahCliStateService,
  VSCodeService,
} from '@ptah-extension/core';
import {
  ConfirmationDialogService,
  ConversationRegistry,
  MODEL_REFRESH_CONTROL,
  TabManagerService,
  TabSessionBinding,
  TabWorkspacePartitionService,
  type ModelRefreshControl,
} from '@ptah-extension/chat-state';
import {
  SessionManager,
  StreamingHandlerService,
} from '@ptah-extension/chat-streaming';
import type { TabState } from '@ptah-extension/chat-types';
import { MessageSenderService } from './message-sender.service';
import { MessageValidationService } from './message-validation.service';

function legacyTab(name: string): TabState {
  return {
    id: 'legacy-tab',
    claudeSessionId: null,
    name,
    title: name,
    order: 0,
    status: 'fresh',
    isDirty: false,
    lastActivityAt: 0,
    messages: [],
    streamingState: null,
  } as TabState;
}

describe('MessageSenderService session identity integration', () => {
  const workspacePath = 'D:/session-identity-integration';
  let service: MessageSenderService;
  let tabManager: TabManagerService;
  let workspacePartition: TabWorkspacePartitionService;
  let rpcCall: jest.Mock;
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    localStorage.clear();
    rpcCall = jest.fn();
    consoleError = jest.spyOn(console, 'error').mockImplementation();
    const sessionManager = {
      setStatus: jest.fn(),
      setSessionId: jest.fn(),
      clearNodeMaps: jest.fn(),
      failSession: jest.fn(),
    };
    const modelRefresh: jest.Mocked<ModelRefreshControl> = {
      refreshModels: jest.fn().mockResolvedValue(undefined),
    };

    TestBed.configureTestingModule({
      providers: [
        MessageSenderService,
        TabManagerService,
        TabWorkspacePartitionService,
        ConversationRegistry,
        TabSessionBinding,
        ConfirmationDialogService,
        { provide: MODEL_REFRESH_CONTROL, useValue: modelRefresh },
        { provide: SessionManager, useValue: sessionManager },
        {
          provide: StreamingHandlerService,
          useValue: {
            recordUserPromptBoundary: jest.fn(),
            removeUserPromptBoundary: jest.fn(),
          },
        },
        {
          provide: MessageValidationService,
          useValue: {
            validate: jest.fn(() => ({ valid: true })),
            sanitize: jest.fn((content: string) => content.trim()),
          },
        },
        { provide: ClaudeRpcService, useValue: { call: rpcCall } },
        {
          provide: VSCodeService,
          useValue: {
            config: jest.fn(() => ({ workspaceRoot: workspacePath })),
            postMessage: jest.fn(),
          },
        },
        {
          provide: ModelStateService,
          useValue: {
            currentModel: jest.fn(() => 'claude-opus-4'),
            availableModels: jest.fn(() => [
              { id: 'claude-opus-4', name: 'Claude Opus 4', isSelected: true },
            ]),
          },
        },
        {
          provide: EffortStateService,
          useValue: {
            currentEffort: jest.fn(() => 'medium'),
            setEffort: jest.fn().mockResolvedValue(undefined),
          },
        },
        {
          provide: PtahCliStateService,
          useValue: { selectedAgentId: jest.fn(() => null) },
        },
        {
          provide: AuthStateService,
          useValue: { flagAuthRequired: jest.fn() },
        },
      ],
    });

    service = TestBed.inject(MessageSenderService);
    tabManager = TestBed.inject(TabManagerService);
    workspacePartition = TestBed.inject(TabWorkspacePartitionService);
  });

  afterEach(() => {
    consoleError.mockRestore();
    localStorage.clear();
    TestBed.resetTestingModule();
  });

  it('restores a persisted legacy custom draft and preserves its name through send', async () => {
    const persisted = legacyTab('Release investigation');
    localStorage.setItem(
      workspacePartition.getStorageKeyForWorkspace(workspacePath),
      JSON.stringify({
        tabs: [persisted],
        activeTabId: persisted.id,
        version: 2,
      }),
    );
    tabManager.switchWorkspace(workspacePath);
    expect(tabManager.activeTab()?.titleOrigin).toBe('history');
    rpcCall.mockResolvedValue({ success: true });

    await service.send('Do not replace the restored custom name');

    const startPayload = rpcCall.mock.calls.find(
      (call) => call[0] === 'chat:start',
    )?.[1] as { name: string };
    expect(startPayload.name).toBe('Release investigation');
    expect(tabManager.activeTab()).toMatchObject({
      name: 'Release investigation',
      title: 'Release investigation',
      titleOrigin: 'history',
    });
  });

  it('keeps the bounded first-message fallback consistent after failure and retry', async () => {
    tabManager.switchWorkspace(workspacePath);
    const tabId = tabManager.createTab();
    rpcCall
      .mockResolvedValueOnce({
        success: true,
        data: { success: false, error: 'START_REJECTED' },
      })
      .mockResolvedValueOnce({ success: true });

    await expect(service.send('***')).resolves.toMatchObject({
      success: false,
    });
    expect(tabManager.findTabByIdAcrossWorkspaces(tabId)?.tab).toMatchObject({
      name: '***',
      title: '***',
      titleOrigin: 'auto',
    });

    await expect(service.send('Useful retry')).resolves.toEqual({
      success: true,
    });

    const startNames = rpcCall.mock.calls
      .filter((call) => call[0] === 'chat:start')
      .map((call) => (call[1] as { name: string }).name);
    expect(startNames).toEqual(['***', '***']);
    expect(tabManager.findTabByIdAcrossWorkspaces(tabId)?.tab).toMatchObject({
      name: '***',
      title: '***',
      titleOrigin: 'auto',
    });
  });
});
