import 'reflect-metadata';

// ChatSessionService's CLI runtime import reaches a module using import.meta.url.
jest.mock('@ptah-extension/workspace-intelligence', () => ({
  ProjectType: {},
  Framework: {},
  MonorepoType: {},
  FileType: {},
}));

import type { ChatContinueParams, SessionId } from '@ptah-extension/shared';
import { ChatSessionService } from './chat-session.service';
import { ChatSlashCommandRouterService } from './chat-slash-command-router.service';

const sessionId = '11111111-1111-4111-8111-111111111111' as SessionId;
const tabId = '22222222-2222-4222-8222-222222222222';
const workspacePath = '/workspace';
const persona = 'Head of engineering persona';

function harness(live: boolean) {
  const executeSlashCommand = jest
    .fn()
    .mockResolvedValue((async function* () {})());
  const resumeSession = jest.fn();
  const interruptSession = jest.fn().mockResolvedValue(undefined);
  const sdkAdapter = {
    isSessionActive: jest.fn().mockReturnValue(live),
    executeSlashCommand,
    resumeSession,
    interruptSession,
  };
  const streamBroadcaster = {
    isStreaming: jest.fn().mockReturnValue(live),
    streamEventsToWebview: jest.fn(),
  };
  const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn() };
  const sdkContext = {
    isMcpServerRunning: jest.fn().mockReturnValue(false),
    resolveEnhancedPromptsContent: jest.fn().mockResolvedValue(undefined),
  };
  const webviewManager = {
    broadcastMessage: jest.fn().mockResolvedValue(undefined),
  };
  const router = Object.assign(
    Object.create(ChatSlashCommandRouterService.prototype),
    {
      logger,
      webviewManager,
      modelSettings: {
        selectedModel: { get: jest.fn().mockReturnValue('default') },
      },
      sdkAdapter,
      slashCommandInterceptor: {
        intercept: jest.fn((prompt: string) =>
          prompt === '/clear'
            ? { action: 'native', commandName: 'clear' }
            : { action: 'new-query', rawCommand: prompt },
        ),
      },
      sdkContext,
      streamBroadcaster,
      workspaceProviderProfileResolver: {
        resolveProviderProfileForWorkspace: jest
          .fn()
          .mockResolvedValue(undefined),
      },
    },
  ) as ChatSlashCommandRouterService;
  const service = Object.assign(Object.create(ChatSessionService.prototype), {
    logger,
    ptahCli: {
      handleContinue: jest
        .fn()
        .mockResolvedValue({ error: '__NOT_PTAH_CLI__' }),
    },
    historyRead: {
      resolveSessionFolder: jest.fn().mockResolvedValue(workspacePath),
    },
    sdkContext,
    sdkAdapter,
    streamBroadcaster,
    slashCommandRouter: router,
    sentryService: { captureException: jest.fn() },
  }) as ChatSessionService;
  return { service, executeSlashCommand, resumeSession, interruptSession };
}

function params(prompt: string, systemPrompt?: string): ChatContinueParams {
  return {
    sessionId,
    tabId,
    workspacePath,
    prompt,
    ...(systemPrompt !== undefined ? { systemPrompt } : {}),
  };
}

describe('slash command persona on chat:continue', () => {
  it.each([
    ['inactive session', false],
    ['active session', true],
  ])('keeps the exact persona for an %s', async (_state, live) => {
    const h = harness(live);
    expect(
      await h.service.continueSession(params('/compact', persona)),
    ).toEqual({ success: true, sessionId });
    expect(h.executeSlashCommand).toHaveBeenCalledTimes(1);
    expect(
      h.executeSlashCommand.mock.calls[0][2].sessionConfig.systemPrompt,
    ).toBe(persona);
    expect(h.resumeSession).not.toHaveBeenCalled();
    expect(h.interruptSession).not.toHaveBeenCalled();
  });

  it.each([
    ['absent', undefined],
    ['empty', ''],
  ])(
    'omits the systemPrompt key when it is %s',
    async (_state, systemPrompt) => {
      const h = harness(false);
      await h.service.continueSession(params('/compact', systemPrompt));
      expect(h.executeSlashCommand).toHaveBeenCalledTimes(1);
      expect(
        h.executeSlashCommand.mock.calls[0][2].sessionConfig,
      ).not.toHaveProperty('systemPrompt');
    },
  );

  it('keeps /clear native and never relaunches a query', async () => {
    const h = harness(false);
    expect(await h.service.continueSession(params('/clear', persona))).toEqual({
      success: true,
      sessionId,
    });
    expect(h.executeSlashCommand).not.toHaveBeenCalled();
    expect(h.resumeSession).not.toHaveBeenCalled();
  });
});
