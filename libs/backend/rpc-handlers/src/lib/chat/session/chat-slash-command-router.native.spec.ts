import 'reflect-metadata';
import { resolve } from 'node:path';
import { WorkspaceProviderProfileResolver } from '@ptah-extension/auth-providers';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import type { SessionId, SessionRuntimeIdentity } from '@ptah-extension/shared';
import { ChatSlashCommandRouterService } from './chat-slash-command-router.service';
import {
  ChatRuntimeProfileService,
  type ResolvedChatExecution,
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
  const publishRuntimeNotices = jest.fn().mockResolvedValue(undefined);
  const compact = jest.fn().mockResolvedValue(undefined);
  const interruptSession = jest.fn().mockResolvedValue(undefined);
  const closeSession = jest.fn().mockResolvedValue(undefined);
  const broadcastMessage = jest.fn().mockResolvedValue(undefined);
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
      sdkAdapter: { executeSlashCommand, interruptSession, isSessionActive: () => true },
      nativeAdapter: { owns: () => true, closeSession },
      webviewManager: { broadcastMessage },
      slashCommandInterceptor: {
        intercept: () => commandName === 'clear'
          ? { action: 'native', commandName, rawCommand: '/clear', args: '' }
          : { action: 'new-query', commandName, rawCommand: '/' + commandName },
      },
      sdkContext: {
        isMcpServerRunning: () => false,
        resolveEnhancedPromptsContent: async () => 'instructions',
      },
      streamBroadcaster: { streamEventsToWebview: jest.fn() },
      workspaceProviderProfileResolver: { resolveProviderProfileForWorkspace },
      metadata: { get: async () => ({ codexExecution: identity }) },
      runtimeProfile: { prepare, publishRuntimeNotices },
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
    publishRuntimeNotices,
    compact,
    interruptSession,
    closeSession,
    broadcastMessage,
    executeSlashCommand,
    resolveProviderProfileForWorkspace,
    admitManualCompact,
    releaseManualReservation,
  };
}

describe('native slash runtime routing', () => {
  it('awaits native /clear close while idle so the tab can start a new thread', async () => {
    const h = harness(native, 'clear');
    let finishClose: (() => void) | undefined;
    const closing = new Promise<void>((resolve) => { finishClose = resolve; });
    h.closeSession.mockReturnValue(closing);
    const route = h.route();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(h.interruptSession).toHaveBeenCalledWith(sessionId);
    expect(h.closeSession).toHaveBeenCalledWith(sessionId);
    expect(h.broadcastMessage).not.toHaveBeenCalled();
    finishClose?.();
    await expect(route).resolves.toEqual({ success: true, sessionId });
    expect(h.broadcastMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sessionId, command: 'clear' }),
    );
    expect(h.executeSlashCommand).not.toHaveBeenCalled();
  });

  it('interrupts a busy native turn before closing it for /clear', async () => {
    const h = harness(native, 'clear');
    const order: string[] = [];
    h.interruptSession.mockImplementation(async () => { order.push('interrupt'); });
    h.closeSession.mockImplementation(async () => { order.push('close'); });
    await expect(h.route()).resolves.toEqual({ success: true, sessionId });
    expect(order).toEqual(['interrupt', 'close']);
    expect(h.broadcastMessage).toHaveBeenCalledTimes(1);
  });

  it('keeps Claude /clear on its existing interrupt path', async () => {
    const h = harness(native, 'clear');
    Object.assign(h.service, { nativeAdapter: { owns: () => false, closeSession: h.closeSession } });
    await expect(h.route()).resolves.toEqual({ success: true, sessionId });
    expect(h.interruptSession).toHaveBeenCalledWith(sessionId);
    expect(h.closeSession).not.toHaveBeenCalled();
    expect(h.broadcastMessage).toHaveBeenCalledTimes(1);
  });

  it('resumes a closed thread before compact without starting a turn', async () => {
    const h = harness();
    let active = false;
    const order: string[] = [];
    const resumeSession = jest.fn(async () => {
      order.push('resume');
      active = true;
      return (async function* () { /* Opening alone starts no turn. */ })();
    });
    Object.assign(h.service, {
      sdkAdapter: {
        isSessionActive: () => active,
        resumeSession,
      },
    });
    h.compact.mockImplementation(async () => {
      expect(active).toBe(true);
      order.push('compact');
    });
    await expect(h.route()).resolves.toEqual({ success: true, sessionId, settled: true });
    expect(order).toEqual(['resume', 'compact']);
    expect(resumeSession).toHaveBeenCalledWith(sessionId, expect.objectContaining({ prompt: '' }));
    expect(h.executeSlashCommand).not.toHaveBeenCalled();
  });

  it('compacts through controls, retaining identity without a model notice', async () => {
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
      true,
    );
    expect(h.compact).toHaveBeenCalledWith(sessionId);
    expect(h.executeSlashCommand).not.toHaveBeenCalled();
    expect(h.resolveProviderProfileForWorkspace).not.toHaveBeenCalled();
    expect(h.publishRuntimeNotices).not.toHaveBeenCalled();
    expect(h.releaseManualReservation).toHaveBeenCalledWith(
      sessionId,
      'reservation',
    );
  });

  it('keeps legacy compact on executeSlashCommand with the exact profile', async () => {
    const profile = { providerId: 'anthropic', model: 'sonnet', authEnv: {} };
    const h = harness({
      runtime: 'claude-sdk',
      model: 'sonnet',
      providerProfile: profile,
    });
    await expect(h.route()).resolves.toEqual({ success: true, sessionId });
    expect(h.executeSlashCommand).toHaveBeenCalledWith(
      sessionId,
      '/compact',
      expect.objectContaining({ providerProfile: profile }),
    );
    expect(h.compact).not.toHaveBeenCalled();
    expect(h.publishRuntimeNotices).not.toHaveBeenCalled();
  });

  it('prepares slash relaunch before calling the routing adapter', async () => {
    const h = harness(native, 'review');
    h.executeSlashCommand.mockImplementation(async () => {
      expect(h.prepare).toHaveBeenCalledTimes(1);
      expect(h.publishRuntimeNotices).not.toHaveBeenCalled();
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
    expect(h.publishRuntimeNotices).toHaveBeenCalledTimes(1);
  });

  it('attaches the slash stream and succeeds when the model notice rejects', async () => {
    const h = harness(native, 'review');
    h.publishRuntimeNotices.mockRejectedValue(new Error('private broadcast detail'));
    await expect(h.route()).resolves.toEqual({ success: true, sessionId });
    expect(h.service['streamBroadcaster'].streamEventsToWebview).toHaveBeenCalledWith(
      sessionId, await h.executeSlashCommand.mock.results[0].value, 'tab',
    );
    expect(h.service['logger'].warn).toHaveBeenCalledWith(
      '[RPC] Model substitution notice failed; continuing session stream',
    );
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
    expect(h.publishRuntimeNotices).not.toHaveBeenCalled();
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
  it('does not publish when a slash relaunch is rejected as busy', async () => {
    const h = harness(native, 'review');
    h.executeSlashCommand.mockRejectedValue(new Error('busy'));
    await expect(h.route()).resolves.toMatchObject({ success: false, error: 'busy' });
    expect(h.publishRuntimeNotices).not.toHaveBeenCalled();
  });

  it('uses an explicit Claude identity when the metadata service is absent', async () => {
    const h = harness(
      { runtime: 'claude-sdk', model: 'sonnet', providerProfile: undefined },
      'review',
    );
    Object.assign(h.service, { metadata: undefined });
    await h.route();
    expect(h.prepare).toHaveBeenCalledWith(expect.any(Object), {
      version: 1, sessionId, runtime: 'claude-sdk', providerId: 'claude-cli',
      workspaceId: '/workspace',
    }, true);
    expect(h.publishRuntimeNotices).not.toHaveBeenCalled();
  });

  it('keeps a Claude session model and provider profile after switching the workspace to Codex', async () => {
    const workspace = resolve('/original-workspace');
    const profile = { providerId: 'anthropic', model: 'claude-sonnet', authEnv: {} };
    const resolveProviderProfileForWorkspace = jest.fn().mockResolvedValue(profile);
    const resolver: WorkspaceProviderProfileResolver = Object.assign(
      Object.create(WorkspaceProviderProfileResolver.prototype),
      {
        activeProviderResolver: {
          resolveActiveAuthForPath: () => ({ providerId: 'openai-codex' }),
        },
        resolveProviderProfileForWorkspace,
      },
    );
    const broadcastMessage = jest.fn().mockResolvedValue(undefined);
    const runtimeProfile = new ChatRuntimeProfileService(
      resolver,
      createMockWorkspaceProvider({ folders: [workspace] }),
      { extensionPath: resolve('/application'), globalStoragePath: resolve('/storage') },
      { broadcastMessage },
      { nativeCodex: true },
    );
    const prepare = jest.spyOn(runtimeProfile, 'prepare');
    const h = harness(native, 'review');
    Object.assign(h.service, {
      runtimeProfile,
      modelSettings: { selectedModel: { get: () => 'claude-sonnet' } },
      metadata: { get: async () => ({ workspaceId: workspace, providerId: 'anthropic' }) },
    });
    await expect(h.service.routeFollowUpSlashCommand('/review', sessionId, 'tab', workspace, {
      prompt: '/review', sessionId, tabId: 'tab',
    })).resolves.toEqual({ success: true, sessionId });
    expect(h.executeSlashCommand).toHaveBeenCalledWith(sessionId, '/review', expect.objectContaining({
      sessionConfig: expect.objectContaining({ model: 'claude-sonnet' }), providerProfile: profile,
    }));
    expect(prepare).toHaveBeenCalledWith(expect.any(Object), {
      version: 1, sessionId, runtime: 'claude-sdk', providerId: 'anthropic', workspaceId: workspace,
    }, true);
    expect(resolveProviderProfileForWorkspace).toHaveBeenCalledWith(workspace, 'claude-sonnet');
    expect(broadcastMessage).not.toHaveBeenCalled();
  });

});
