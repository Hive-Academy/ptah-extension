import 'reflect-metadata';
import { resolve, parse } from 'node:path';
import type {
  ResolvedExecutionProfile,
  WorkspaceProviderProfileResolver,
} from '@ptah-extension/auth-providers';
import type { SessionId, SessionRuntimeIdentity } from '@ptah-extension/shared';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import {
  ChatRuntimeProfileService,
  type ChatRuntimeConfig,
} from './chat-runtime-profile.service';

jest.mock('@ptah-extension/agent-sdk', () => ({
  SDK_TOKENS: {
    RUNTIME_HOST_CAPABILITIES: Symbol.for('RuntimeHostCapabilities'),
  },
}));
jest.mock('@ptah-extension/auth-providers', () => ({
  AUTH_PROVIDERS_TOKENS: {
    SDK_WORKSPACE_PROVIDER_PROFILE_RESOLVER: Symbol.for(
      'WorkspaceProviderProfileResolver',
    ),
  },
}));

const workspace = resolve('/projects/session');
const focused = resolve('/projects/focused');
const home = resolve('/codex-home');
const sessionId = 'stored-session' as SessionId;
const identity: SessionRuntimeIdentity = {
  version: 1,
  runtime: 'codex-app-server',
  sessionId,
  workspaceId: workspace,
  providerId: 'openai-codex',
  codex: { normalizedHome: home },
};
const native: ResolvedExecutionProfile = {
  runtime: 'codex-app-server',
  seed: {
    providerId: 'openai-codex',
    consumer: 'chat',
    workspacePath: workspace,
    home,
    normalizedHome: home,
    model: 'gpt-5',
  },
};

function harness(
  result: ResolvedExecutionProfile = native,
  nativeCodex = true,
) {
  const resolveExecutionProfile = jest
    .fn<
      ReturnType<WorkspaceProviderProfileResolver['resolveExecutionProfile']>,
      Parameters<WorkspaceProviderProfileResolver['resolveExecutionProfile']>
    >()
    .mockResolvedValue(result);
  const workspaceProvider = createMockWorkspaceProvider({
    folders: [focused, workspace],
  });
  const broadcastMessage = jest
    .fn<Promise<void>, [string, unknown]>()
    .mockResolvedValue(undefined);
  const service = new ChatRuntimeProfileService(
    { resolveExecutionProfile },
    workspaceProvider,
    {
      extensionPath: resolve('/application'),
      globalStoragePath: resolve('/storage'),
    },
    { broadcastMessage },
    { nativeCodex },
  );
  return {
    service,
    resolveExecutionProfile,
    workspaceProvider,
    broadcastMessage,
  };
}

describe('ChatRuntimeProfileService', () => {
  it('preserves the legacy result and exact resolver inputs', async () => {
    const legacy: ResolvedExecutionProfile = {
      runtime: 'claude-sdk',
      model: 'sonnet',
      providerProfile: undefined,
    };
    const h = harness(legacy, false);
    const config = {
      workspaceId: workspace,
      projectPath: workspace,
      model: 'sonnet',
      tabId: 'tab',
    };
    expect(await h.service.prepare(config)).toBe(legacy);
    expect(h.resolveExecutionProfile.mock.calls).toEqual([
      [
        {
          workspacePath: workspace,
          requestedModel: 'sonnet',
          requestedModelIsStored: false,
          existingIdentity: undefined,
          consumer: 'chat',
          hostCapabilities: { nativeCodex: false },
        },
      ],
    ]);
    expect(config).toEqual({
      workspaceId: workspace,
      projectPath: workspace,
      model: 'sonnet',
      tabId: 'tab',
    });
    expect(h.broadcastMessage).not.toHaveBeenCalled();
  });

  it('retains complete native inputs without acquiring proxy or configuring authentication', async () => {
    const h = harness();
    const config: ChatRuntimeConfig = {
      workspaceId: workspace,
      projectPath: resolve(workspace, 'child'),
      tabId: 'tab',
      model: 'gpt-5',
      systemPrompt: 'system',
      enhancedPromptsContent: 'enhanced',
      permissionLevel: 'plan',
      files: ['context.ts'],
      images: [{ data: 'image', mediaType: 'image/png' }],
      mcpServersOverride: {
        local: { type: 'http', url: 'http://localhost:3000/mcp' },
      },
    };
    const before = { ...process.env };
    const result = await h.service.prepare(config);
    expect(result).toEqual({
      ...native,
      config,
      workspacePath: workspace,
      cwd: config.projectPath,
    });
    expect(h.resolveExecutionProfile).toHaveBeenCalledTimes(1);
    expect(h.workspaceProvider.getWorkspaceRoot).not.toHaveBeenCalled();
    expect(process.env).toEqual(before);
    // The service has only the credential-free resolver seam; no proxy/auth port.
    expect(Object.keys(result)).not.toContain('providerProfile');
  });

  it.each([undefined, '', 'relative', resolve('/closed')])(
    'refuses invalid workspace %s before invoking the potentially spawning resolver',
    async (workspaceId) => {
      const h = harness();
      await expect(h.service.prepare({ workspaceId })).rejects.toThrow(
        'Access denied',
      );
      expect(h.resolveExecutionProfile).not.toHaveBeenCalled();
    },
  );

  it('rejects an unsafe cwd before resolution even if it is open', async () => {
    const h = harness();
    const root = parse(workspace).root;
    h.workspaceProvider.__state.setFolders([root]);
    await expect(h.service.prepare({ workspaceId: root })).rejects.toThrow(
      'unsafe',
    );
    expect(h.resolveExecutionProfile).not.toHaveBeenCalled();
  });

  it('passes persisted identity unchanged after a provider switch and never reads focus', async () => {
    const h = harness();
    await h.service.prepare({ model: 'gpt-5' }, identity);
    expect(h.resolveExecutionProfile).toHaveBeenCalledWith({
      workspacePath: workspace,
      requestedModel: 'gpt-5',
      requestedModelIsStored: false,
      existingIdentity: identity,
      consumer: 'chat',
      hostCapabilities: { nativeCodex: true },
    });
    expect(h.resolveExecutionProfile.mock.calls[0][0].existingIdentity).toBe(
      identity,
    );
    expect(h.workspaceProvider.getWorkspaceRoot).not.toHaveBeenCalled();
  });

  it('marks a stored model so only the Claude branch checks it', async () => {
    const h = harness();
    await h.service.prepare({ model: 'gpt-5' }, identity, true);
    expect(h.resolveExecutionProfile).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedModel: 'gpt-5',
        requestedModelIsStored: true,
      }),
    );
  });

  it('propagates failed resolution without falling back to global credentials', async () => {
    const h = harness();
    h.resolveExecutionProfile.mockRejectedValue(
      new Error('workspace auth unavailable'),
    );
    await expect(h.service.prepare({ workspaceId: workspace })).rejects.toThrow(
      'workspace auth unavailable',
    );
    expect(h.resolveExecutionProfile).toHaveBeenCalledTimes(1);
    expect(h.broadcastMessage).not.toHaveBeenCalled();
  });

  it('publishes exactly one complete notice with both model names in the target session', async () => {
    const h = harness({
      ...native,
      modelSubstitution: {
        requested: 'unknown-model',
        used: 'gpt-5',
        reason: 'not-in-catalog',
      },
    });
    const result = await h.service.prepare({ workspaceId: workspace });
    await h.service.publishRuntimeNotices(result, {
      tabId: 'tab',
      sessionId,
    });
    expect(h.broadcastMessage.mock.calls).toEqual([
      [
        'chat:chunk',
        expect.objectContaining({
          tabId: 'tab',
          sessionId,
          event: expect.objectContaining({ eventType: 'message_start' }),
        }),
      ],
      [
        'chat:chunk',
        expect.objectContaining({
          tabId: 'tab',
          sessionId,
          event: expect.objectContaining({
            eventType: 'text_delta',
            delta: 'Model notice: requested "unknown-model"; using "gpt-5".',
          }),
        }),
      ],
      [
        'chat:chunk',
        expect.objectContaining({
          tabId: 'tab',
          sessionId,
          event: expect.objectContaining({ eventType: 'message_complete' }),
        }),
      ],
    ]);
  });

  it.each([
    { mcp: false, style: true, text: "Codex chat: output style 'Explanatory' is not applied" },
    // User MCP servers are attached natively (D8): they never add a notice line.
    { mcp: true, style: true, text: "Codex chat: output style 'Explanatory' is not applied" },
  ])('publishes ambient notices once: $text', async ({ mcp, style, text }) => {
    const h = harness();
    const result = await h.service.prepare({
      workspaceId: workspace,
      ...(mcp ? { mcpServersOverride: {
        smithery: { type: 'http' as const, url: 'https://example.invalid/mcp', headers: { Authorization: 'Bearer secret-token-x' } },
        oauth: { type: 'http' as const, url: 'https://example.invalid/oauth' },
      } } : {}),
      ...(style ? { outputStyleName: 'Explanatory' } : {}),
    });
    await h.service.publishRuntimeNotices(result, { tabId: 'tab' });
    expect(h.broadcastMessage).toHaveBeenCalledTimes(3);
    expect(h.broadcastMessage).toHaveBeenNthCalledWith(2, 'chat:chunk',
      expect.objectContaining({ event: expect.objectContaining({ eventType: 'text_delta', delta: text }) }),
    );
    for (const [type] of h.broadcastMessage.mock.calls) expect(type).toBe('chat:chunk');
    const serialized = JSON.stringify(h.broadcastMessage.mock.calls);
    for (const value of ['https://example.invalid', 'Authorization', 'Bearer', 'secret-token-x']) {
      expect(serialized).not.toContain(value);
    }
    await h.service.publishRuntimeNotices(result, { tabId: 'tab' });
    expect(h.broadcastMessage).toHaveBeenCalledTimes(3);
  });

  it('does not publish notices for Claude even with ambient options', async () => {
    const h = harness({ runtime: 'claude-sdk', model: 'sonnet', providerProfile: undefined });
    const result = await h.service.prepare({
      workspaceId: workspace,
      outputStyleName: 'Explanatory',
      mcpServersOverride: { smithery: { type: 'http', url: 'https://example.invalid/mcp' } },
    });
    await h.service.publishRuntimeNotices(result, { tabId: 'tab' });
    expect(h.broadcastMessage).not.toHaveBeenCalled();
  });

  it('combines model substitution and ambient lines in one notice', async () => {
    const h = harness({
      ...native,
      modelSubstitution: { requested: 'unknown-model', used: 'gpt-5', reason: 'not-in-catalog' },
    });
    const result = await h.service.prepare({
      workspaceId: workspace,
      outputStyleName: 'Explanatory',
      mcpServersOverride: { smithery: { type: 'http', url: 'https://example.invalid/mcp' } },
    });
    await h.service.publishRuntimeNotices(result, { tabId: 'tab' });
    expect(h.broadcastMessage).toHaveBeenCalledTimes(3);
    expect(h.broadcastMessage).toHaveBeenNthCalledWith(2, 'chat:chunk',
      expect.objectContaining({ event: expect.objectContaining({
        eventType: 'text_delta',
        delta: 'Model notice: requested "unknown-model"; using "gpt-5".\nCodex chat: output style \'Explanatory\' is not applied',
      }) }),
    );
  });

  it('publishes no notice for user MCP servers alone (attached natively)', async () => {
    const h = harness();
    const result = await h.service.prepare({
      workspaceId: workspace,
      mcpServersOverride: {
        smithery: { type: 'http', url: 'https://example.invalid/mcp', headers: { Authorization: 'Bearer secret-token-x' } },
      },
    });
    await h.service.publishRuntimeNotices(result, { tabId: 'tab' });
    expect(h.broadcastMessage).not.toHaveBeenCalled();
  });

  it('does not publish notices without applicable lines', async () => {
    const h = harness();
    await h.service.publishRuntimeNotices(
      await h.service.prepare({ workspaceId: workspace, mcpServersOverride: {}, outputStyleName: '' }),
      { tabId: 'tab' },
    );
    expect(h.broadcastMessage).not.toHaveBeenCalled();
  });
  it.each(['default', '', '   ', 'gpt-5'])(
    'does not announce a default, empty, or unchanged request: %s',
    async (requested) => {
      const h = harness({
        ...native,
        modelSubstitution: { requested, used: 'gpt-5', reason: 'not-in-catalog' },
      });
      const result = await h.service.prepare({ workspaceId: workspace, model: requested });
      await h.service.publishRuntimeNotices(result, { tabId: 'tab' });
      expect(h.broadcastMessage).not.toHaveBeenCalled();
    },
  );

  it('publishes a prepared substitution only once, including concurrent calls', async () => {
    const h = harness({
      ...native,
      modelSubstitution: { requested: 'claude-opus', used: 'gpt-5', reason: 'not-in-catalog' },
    });
    const result = await h.service.prepare({ workspaceId: workspace, model: 'claude-opus' });
    await Promise.all([
      h.service.publishRuntimeNotices(result, { tabId: 'tab' }),
      h.service.publishRuntimeNotices(result, { tabId: 'tab' }),
    ]);
    expect(h.broadcastMessage).toHaveBeenCalledTimes(3);
    await h.service.publishRuntimeNotices(result, { tabId: 'tab' });
    expect(h.broadcastMessage).toHaveBeenCalledTimes(3);
  });

});
