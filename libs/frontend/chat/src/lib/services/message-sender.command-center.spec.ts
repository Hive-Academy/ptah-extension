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
  CommandCenterSendLockService,
  COMMAND_CENTER_PERSONA,
  ConversationRegistry,
  TabManagerService,
  TabSessionBinding,
} from '@ptah-extension/chat-state';
import {
  SessionManager,
  StreamingHandlerService,
} from '@ptah-extension/chat-streaming';
import { MessageValidationService } from './message-validation.service';
import { MessageSenderService } from './message-sender.service';
import { UltracodeStateService } from './ultracode-state.service';
import { SessionId } from '@ptah-extension/shared';

describe('Command Center sender', () => {
  const marked = {
    id: 'root',
    claudeSessionId: 'sdk',
    status: 'loaded',
    name: 'Root',
    messages: [],
    commandCenterOrigin: { workspaceId: '/repo', createdAt: 1, version: 1 },
  };
  const plain = {
    ...marked,
    id: 'plain',
    claudeSessionId: 'other',
    commandCenterOrigin: undefined,
  };
  const markedNew = { ...marked, id: 'new-root', claudeSessionId: null };
  const plainNew = { ...plain, id: 'new-plain', claudeSessionId: null };
  const tabs = [marked, plain, markedNew, plainNew];
  const call = jest.fn((method: string, _params: object) =>
    Promise.resolve(
      method === 'session:validate'
        ? { success: true, data: { exists: true } }
        : { success: true, data: { success: true } },
    ),
  );
  let sender: MessageSenderService;
  let lock: CommandCenterSendLockService;

  beforeEach(() => {
    call.mockClear();
    TestBed.configureTestingModule({
      providers: [
        MessageSenderService,
        CommandCenterSendLockService,
        { provide: ClaudeRpcService, useValue: { call } },
        {
          provide: VSCodeService,
          useValue: { config: () => ({ workspaceRoot: '/repo' }) },
        },
        {
          provide: TabManagerService,
          useValue: {
            activeTabId: () => 'root',
            activeTab: () => marked,
            activeWorkspacePath: '/repo',
            findTabByIdAcrossWorkspaces: (id: string) => ({
              tab: tabs.find((t) => t.id === id),
              workspacePath: '/repo',
            }),
            createAbortController: () => new AbortController().signal,
            getAbortSignal: () => undefined,
            setMessages: jest.fn(),
            markResuming: jest.fn(),
            markStreaming: jest.fn(),
            markLoaded: jest.fn(),
            markTabIdle: jest.fn(),
            markTabStreaming: jest.fn(),
            applyNewConversationStreaming: jest.fn(),
            appendUserMessageAndResetStreaming: jest.fn(),
            consumeFirstMessagePreamble: () => undefined,
          },
        },
        {
          provide: SessionManager,
          useValue: {
            setStatus: jest.fn(),
            clearNodeMaps: jest.fn(),
            setSessionId: jest.fn(),
          },
        },
        {
          provide: StreamingHandlerService,
          useValue: { recordUserPromptBoundary: jest.fn() },
        },
        {
          provide: MessageValidationService,
          useValue: {
            validate: () => ({ valid: true }),
            sanitize: (s: string) => s,
          },
        },
        {
          provide: ModelStateService,
          useValue: {
            currentModel: () => 'model',
            availableModels: () => [{ id: 'model', isSelected: true }],
          },
        },
        {
          provide: EffortStateService,
          useValue: { currentEffort: () => undefined },
        },
        {
          provide: PtahCliStateService,
          useValue: { selectedAgentId: () => null },
        },
        {
          provide: AuthStateService,
          useValue: { flagAuthRequired: jest.fn() },
        },
        {
          provide: UltracodeStateService,
          useValue: { applyKeyword: (s: string) => s },
        },
        { provide: ConversationRegistry, useValue: {} },
        { provide: TabSessionBinding, useValue: {} },
      ],
    });
    sender = TestBed.inject(MessageSenderService);
    lock = TestBed.inject(CommandCenterSendLockService);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('rejects direct and queued flush sends during a lock, then permits the owner', async () => {
    lock.engage('root', 'sdk', 'owner');
    expect((await sender.send('blocked', { tabId: 'root' })).success).toBe(
      false,
    );
    expect(
      (
        await sender.continueExistingSessionForQueueFlush(
          'blocked',
          SessionId.from('00000000-0000-4000-8000-000000000001'),
          { tabId: 'root' },
        )
      ).success,
    ).toBe(false);
    expect(call).not.toHaveBeenCalled();
    await sender.send('allowed', { tabId: 'root', ownerToken: 'owner' });
    expect(call).toHaveBeenCalledWith(
      'chat:continue',
      expect.objectContaining({ systemPrompt: COMMAND_CENTER_PERSONA }),
      expect.anything(),
    );
  });

  it('adds persona on a restored marked tab and omits the key on another tab', async () => {
    await sender.send('root text', { tabId: 'root' });
    await sender.send('plain text', { tabId: 'plain' });
    const params = call.mock.calls
      .filter(([method]) => method === 'chat:continue')
      .map(([, p]) => p);
    expect(params[0]).toEqual(
      expect.objectContaining({ systemPrompt: COMMAND_CENTER_PERSONA }),
    );
    expect(params[1]).not.toHaveProperty('systemPrompt');
  });

  it('uses the same persona on the first start of a marked tab', async () => {
    await sender.send('new objective', { tabId: 'new-root' });
    const start = call.mock.calls.find(([method]) => method === 'chat:start');
    expect(start?.[1]).toEqual(
      expect.objectContaining({
        options: expect.objectContaining({
          systemPrompt: COMMAND_CENTER_PERSONA,
        }),
      }),
    );
  });

  it('omits the system prompt key on an ordinary tab start', async () => {
    await sender.send('new objective', { tabId: 'new-plain' });
    const start = call.mock.calls.find(([method]) => method === 'chat:start');
    expect(
      (start?.[1] as { options?: object } | undefined)?.options,
    ).not.toHaveProperty('systemPrompt');
  });
});
