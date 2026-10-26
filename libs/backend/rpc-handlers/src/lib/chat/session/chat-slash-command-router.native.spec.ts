import 'reflect-metadata';
import type { SessionId, SessionRuntimeIdentity } from '@ptah-extension/shared';
import { ChatSlashCommandRouterService } from './chat-slash-command-router.service';
import type {
  ChatRuntimeProfileService,
  ResolvedChatExecution,
} from './chat-runtime-profile.service';

const sessionId = 'native-session' as SessionId;
const identity: SessionRuntimeIdentity = {
  version: 1,
  sessionId,
  runtime: 'codex-app-server',
  providerId: 'openai-codex',
  workspaceId: '/workspace',
  codex: { normalizedHome: '/codex-home' },
};
const native: ResolvedChatExecution = {
  runtime: 'codex-app-server',
  seed: {
    providerId: 'openai-codex',
    consumer: 'chat',
    workspacePath: '/workspace',
    home: '/codex-home',
    normalizedHome: '/codex-home',
    model: 'gpt-5.4',
  },
  workspacePath: '/workspace',
  cwd: '/workspace',
  config: {},
  modelSubstitution: {
    requested: 'default',
    used: 'gpt-5.4',
    reason: 'not-in-catalog',
  },
};

function harness(
  execution: ResolvedChatExecution = native,
  commandName = 'compact',
) {
  const prepare = jest
    .fn<
      ReturnType<ChatRuntimeProfileService['prepare']>,
      Parameters<ChatRuntimeProfileService['prepare']>
    >()
    .mockResolvedValue(execution);
  const publishModelSubstitution = jest.fn().mockResolvedValue(undefined);
  const compact = jest.fn().mockResolvedValue(undefined);
  const executeSlashCommand = jest.fn().mockResolvedValue([]);
  const resolveProviderProfileForWorkspace = jest.fn(() => {
    throw new Error('Old resolver must not run');
  });
  const releaseManualReservation = jest.fn();
  const admitManualCompact = jest.fn().mockReturnValue({
    decision: { action: 'send' },
    reservationId: 'reservation',
  });
  const service: ChatSlashCommandRouterService = Object.assign(
    Object.create(ChatSlashCommandRouterService.prototype),
    {
      logger: { info: jest.fn(), warn: jest.fn() },
      modelSettings: { selectedModel: { get: () => 'default' } },
      sdkAdapter: { executeSlashCommand },
      slashCommandInterceptor: {
        intercept: () => ({
          action: 'new-query',
          commandName,
          rawCommand: '/' + commandName,
        }),
      },
      sdkContext: {
        isMcpServerRunning: () => false,
        resolveEnhancedPromptsContent: async () => 'instructions',
      },
      streamBroadcaster: { streamEventsToWebview: jest.fn() },
      workspaceProviderProfileResolver: { resolveProviderProfileForWorkspace },
      metadata: { get: async () => ({ codexExecution: identity }) },
      runtimeProfile: { prepare, publishModelSubstitution },
      runtimeControls: { compact },
      manualCompactAdmission: {
        requestManualCompact: () => ({ action: 'send' }),
        admitManualCompact,
        releaseManualReservation,
      },
    },
  );
  const route = () =>
    service.routeFollowUpSlashCommand(
      '/' + commandName,
      sessionId,
      'tab',
      '/workspace',
      { prompt: '/' + commandName, sessionId, tabId: 'tab' },
    );
  return {
    service,
    route,
    prepare,
    publishModelSubstitution,
    compact,
    executeSlashCommand,
    resolveProviderProfileForWorkspace,
    admitManualCompact,
    releaseManualReservation,
  };
}

describe('native slash runtime routing', () => {
  it('compacts through controls, retaining identity and publishing substitution once', async () => {
    const h = harness();
    await expect(h.route()).resolves.toEqual({
      success: true,
      sessionId,
      settled: true,
    });
    expect(h.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath: '/workspace',
        enhancedPromptsContent: 'instructions',
      }),
      identity,
    );
    expect(h.compact).toHaveBeenCalledWith(sessionId);
    expect(h.executeSlashCommand).not.toHaveBeenCalled();
    expect(h.resolveProviderProfileForWorkspace).not.toHaveBeenCalled();
    expect(h.publishModelSubstitution).toHaveBeenCalledTimes(1);
    expect(h.releaseManualReservation).toHaveBeenCalledWith(
      sessionId,
      'reservation',
    );
  });

  it('keeps legacy compact on executeSlashCommand with the exact profile', async () => {
    const profile = { providerId: 'anthropic', model: 'sonnet', authEnv: {} };
    const h = harness({ runtime: 'claude-sdk', providerProfile: profile });
    await expect(h.route()).resolves.toEqual({ success: true, sessionId });
    expect(h.executeSlashCommand).toHaveBeenCalledWith(
      sessionId,
      '/compact',
      expect.objectContaining({ providerProfile: profile }),
    );
    expect(h.compact).not.toHaveBeenCalled();
    expect(h.publishModelSubstitution).not.toHaveBeenCalled();
  });

  it('prepares slash relaunch before calling the routing adapter', async () => {
    const h = harness(native, 'review');
    h.executeSlashCommand.mockImplementation(async () => {
      expect(h.prepare).toHaveBeenCalledTimes(1);
      expect(h.publishModelSubstitution).toHaveBeenCalledTimes(1);
      return [];
    });
    await expect(h.route()).resolves.toEqual({ success: true, sessionId });
    expect(h.executeSlashCommand).toHaveBeenCalledWith(
      sessionId,
      '/review',
      expect.objectContaining({
        sessionConfig: expect.objectContaining({ model: 'gpt-5.4' }),
      }),
    );
    expect(h.resolveProviderProfileForWorkspace).not.toHaveBeenCalled();
  });

  it('coalesces a claim acquired while preparation is pending', async () => {
    const h = harness();
    h.admitManualCompact.mockReturnValue({ decision: { action: 'coalesced' } });
    await expect(h.route()).resolves.toEqual({
      success: true,
      sessionId,
      settled: true,
    });
    expect(h.compact).not.toHaveBeenCalled();
    expect(h.executeSlashCommand).not.toHaveBeenCalled();
    expect(h.publishModelSubstitution).not.toHaveBeenCalled();
  });

  it('releases admission and returns a failure when native compact fails', async () => {
    const h = harness();
    h.compact.mockRejectedValue(new Error('Compact failed'));
    await expect(h.route()).resolves.toEqual({
      success: false,
      sessionId,
      error: 'Compact failed',
    });
    expect(h.releaseManualReservation).toHaveBeenCalledTimes(1);
    expect(h.executeSlashCommand).not.toHaveBeenCalled();
  });

  it('fails closed when native controls are missing', async () => {
    const h = harness();
    Object.assign(h.service, { runtimeControls: null });
    await expect(h.route()).resolves.toEqual({
      success: false,
      sessionId,
      error: 'Native session runtime controls are unavailable.',
    });
    expect(h.executeSlashCommand).not.toHaveBeenCalled();
  });

  it('does not launch when preparation rejects', async () => {
    const h = harness();
    h.prepare.mockRejectedValue(new Error('Workspace refused'));
    await expect(h.route()).resolves.toEqual({
      success: false,
      sessionId,
      error: 'Workspace refused',
    });
    expect(h.compact).not.toHaveBeenCalled();
    expect(h.executeSlashCommand).not.toHaveBeenCalled();
  });
});
