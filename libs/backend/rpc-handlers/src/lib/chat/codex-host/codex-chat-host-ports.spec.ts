import 'reflect-metadata';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import {
  PTAH_UI_HINT_CODEX,
  UNROUTABLE_PERMISSION_TIMEOUT_MS,
  buildSystemAbortPermissionMessage,
  type PermissionPromptLifecycleEvent,
  type SessionApprovalRouter,
} from '@ptah-extension/agent-sdk';
import type { ResolvedExecutionProfile } from '@ptah-extension/auth-providers';
import {
  buildCodexMcpConfigOverrides,
  type CodexApprovalRequest,
  type CodexThreadIdentity,
} from '@ptah-extension/codex-runtime';
import {
  SessionId,
  MESSAGE_TYPES,
  attentionRequestKey,
  parsePermissionRequest,
  UUID_REGEX,
  type FlatStreamEventUnion,
} from '@ptah-extension/shared';
import {
  createCodexChatHostPorts,
  createCodexRuntimeAdmission,
  CodexChatRoutingError,
  CodexChatMcpServerNameError,
  CodexChatMcpServerUrlError,
  type CodexChatHostPortsDeps,
} from './codex-chat-host-ports';
import { CodexChatOptionError } from './codex-chat-profile-options';
import { ChatRuntimeProfileService } from '../session/chat-runtime-profile.service';

jest.mock('@ptah-extension/agent-sdk', () => {
  const systemAbort = jest.requireActual<
    typeof import('../../../../../agent-sdk/src/lib/system-abort-permission-message')
  >('../../../../../agent-sdk/src/lib/system-abort-permission-message');
  return {
    presentCodexApproval: jest.requireActual<
      typeof import('../../../../../agent-sdk/src/lib/codex-app-server/codex-tool-presentation')
    >('../../../../../agent-sdk/src/lib/codex-app-server/codex-tool-presentation').presentCodexApproval,
    PTAH_UI_HINT_CODEX: jest.requireActual<
      typeof import('../../../../../agent-sdk/src/lib/prompt-harness/ptah-ui-hint')
    >('../../../../../agent-sdk/src/lib/prompt-harness/ptah-ui-hint').PTAH_UI_HINT_CODEX,
    SDK_TOKENS: { RUNTIME_HOST_CAPABILITIES: Symbol.for('caps') },
    PTAH_MCP_PORT: 51820,
    UNROUTABLE_PERMISSION_TIMEOUT_MS: systemAbort.UNROUTABLE_PERMISSION_TIMEOUT_MS,
    buildSystemAbortPermissionMessage: systemAbort.buildSystemAbortPermissionMessage,
  };
});
jest.mock('@ptah-extension/auth-providers', () => ({
  AUTH_PROVIDERS_TOKENS: {
    SDK_WORKSPACE_PROVIDER_PROFILE_RESOLVER: Symbol.for('profiles'),
  },
}));

describe('Codex chat host ports', () => {
  let workspace: string;
  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'ptah-codex-host-'));
  });
  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });
  const id = SessionId.from('22222222-2222-4222-8222-222222222222');
  const chatTab = '33333333-3333-4333-8333-333333333333';
  function harness() {
    const execution: ResolvedExecutionProfile = {
      runtime: 'codex-app-server',
      seed: {
        providerId: 'openai-codex',
        consumer: 'chat',
        workspacePath: workspace,
        home: workspace,
        normalizedHome: workspace,
        model: 'gpt-5',
      },
      modelSubstitution: {
        requested: 'sonnet',
        used: 'gpt-5',
        reason: 'not-in-catalog',
      },
    };
    const resolveExecutionProfile = jest.fn().mockResolvedValue(execution);
    const broadcastMessage = jest.fn().mockResolvedValue(undefined);
    const resolveAttention = jest.fn<void, [string, number]>();
    const publish = jest.fn<void, [PermissionPromptLifecycleEvent]>();
    const { Logger } = jest.createMockFromModule<
      typeof import('@ptah-extension/vscode-core')
    >('@ptah-extension/vscode-core');
    const logger = Logger.prototype;
    const respond = jest
      .fn<boolean, Parameters<SessionApprovalRouter['respond']>>()
      .mockReturnValue(true);
    const approvals: CodexChatHostPortsDeps['approvals'] = {
      register: jest.fn<
        () => void,
        Parameters<SessionApprovalRouter['register']>
      >(() => () => undefined),
      respond,
      cancelPrompt: jest.fn<
        void,
        Parameters<SessionApprovalRouter['cancelPrompt']>
      >(),
    };
    const readResumeIdentity = jest
      .fn<Promise<CodexThreadIdentity | undefined>, [SessionId]>()
      .mockResolvedValue(undefined);
    const readSavedPermissionLevel = jest
      .fn<ReturnType<CodexChatHostPortsDeps['readSavedPermissionLevel']>, [string]>()
      .mockReturnValue('ask');
    const drained: FlatStreamEventUnion[] = [];
    const streamEventsToWebview = jest.fn(
      async (_id: SessionId, stream: AsyncIterable<FlatStreamEventUnion>) => {
        for await (const event of stream) drained.push(event);
      },
    );
    const deps: CodexChatHostPortsDeps = {
      resolver: { resolveExecutionProfile },
      workspaceProvider: createMockWorkspaceProvider({ folders: [workspace] }),
      platformInfo: {
        extensionPath: join(tmpdir(), 'ptah-test-extension'),
        globalStoragePath: join(tmpdir(), 'ptah-test-storage'),
      },
      hostCapabilities: { nativeCodex: true },
      webviewManager: { broadcastMessage },
      hostAttention: { resolve: resolveAttention },
      logger,
      platform: { platform: process.platform, arch: process.arch },
      info: {
        id: 'codex-app-server',
        name: 'Codex',
        version: '1.0.0',
        description: 'Native Codex chat test provider',
        vendor: 'OpenAI',
        capabilities: {
          streaming: true,
          fileAttachments: true,
          contextManagement: true,
          sessionPersistence: true,
          multiTurn: true,
          codeGeneration: true,
          imageAnalysis: true,
          functionCalling: true,
        },
      },
      createScope: () => {
        throw new Error('No process in unit tests');
      },
      metadata: { save: jest.fn() },
      approvals,
      callbacks: () => ({
        result: jest.fn(),
        content: jest.fn(),
        live: jest.fn(),
        compaction: jest.fn(),
        error: jest.fn(),
      }),
      readResumeIdentity,
      readSavedPermissionLevel,
      broadcaster: { streamEventsToWebview },
      tabId: () => chatTab,
      promptLifecycle: { publish },
    };
    return {
      deps,
      ports: createCodexChatHostPorts(deps),
      logger,
      broadcastMessage,
      resolveAttention,
      resolveExecutionProfile,
      readResumeIdentity,
      readSavedPermissionLevel,
      respond,
      drained,
      streamEventsToWebview,
      publish,
    };
  }
  const config = () => ({
    tabId: 'tab',
    projectPath: workspace,
    workspaceId: workspace,
    model: 'sonnet',
  });
  const noTab = () => ({
    projectPath: workspace,
    workspaceId: workspace,
    model: 'sonnet',
  });

  it('checks live resume options without logging values or repeating notices', () => {
    const h = harness();
    expect(() => h.ports.checkOptions({
      ...config(), prompt: 'private prompt', effort: 'high',
      systemPrompt: 'private system prompt', enhancedPromptsContent: 'private instructions',
      ptahUiFence: true, mcpToolProfile: 'coding', mcpServerRunning: true,
      workflowsDisabled: false, includePartialMessages: true,
      thinking: { type: 'adaptive' }, outputStyleName: 'private style',
    })).not.toThrow();
    expect(h.logger.info).not.toHaveBeenCalled();
    expect(h.logger.debug).not.toHaveBeenCalled();
    expect(h.logger.warn).not.toHaveBeenCalled();
    expect(h.logger.error).not.toHaveBeenCalled();
    expect(h.broadcastMessage).not.toHaveBeenCalled();
    expect(h.resolveExecutionProfile).not.toHaveBeenCalled();
  });
  it.each([
    { key: 'temperature', options: { temperature: 0.5 } },
    { key: 'mcpToolProfile', options: { mcpToolProfile: 'apps' as const } },
  ])('throws the host coded option error for live resume $key', ({ key, options }) => {
    const h = harness();
    const input = { ...config(), ...options };
    expect(() => h.ports.checkOptions(input)).toThrow(new CodexChatOptionError(key));
    expect(() => h.ports.checkOptions(input)).toThrow(CodexChatOptionError);
    expect(h.logger.info).not.toHaveBeenCalled();
    expect(h.logger.debug).not.toHaveBeenCalled();
    expect(h.logger.warn).not.toHaveBeenCalled();
    expect(h.logger.error).not.toHaveBeenCalled();
    expect(h.broadcastMessage).not.toHaveBeenCalled();
  });
  it('builds a frozen validated profile without publishing a substitution notice', async () => {
    const h = harness();
    const { profile } = await h.ports.profile(config());
    expect(profile).toMatchObject({
      model: 'gpt-5',
      providerId: 'openai-codex',
      permissionLevel: 'ask',
    });
    expect(Object.isFrozen(profile)).toBe(true);
    expect(profile.profileFingerprint).toBeTruthy();
    expect(h.broadcastMessage).not.toHaveBeenCalled();
  });
  it.each([
    { mode: 'Manual', saved: 'ask' },
    { mode: 'Auto edit', saved: 'auto-edit' },
    { mode: 'Plan', saved: 'plan' },
    { mode: 'Yolo', saved: 'yolo' },
  ] as const)('uses the saved $mode permission level', async ({ saved }) => {
    const h = harness();
    h.readSavedPermissionLevel.mockReturnValue(saved);
    const { profile } = await h.ports.profile(config());
    expect(profile.permissionLevel).toBe(saved);
    expect(h.readSavedPermissionLevel).toHaveBeenCalledWith(workspace);
  });
  it('lets an explicit permission level win without reading the saved level', async () => {
    const h = harness();
    h.readSavedPermissionLevel.mockReturnValue('yolo');
    const { profile } = await h.ports.profile({ ...config(), permissionLevel: 'plan' });
    expect(profile.permissionLevel).toBe('plan');
    expect(h.readSavedPermissionLevel).not.toHaveBeenCalled();
  });
  it('reads the saved permission level when resuming without an explicit level', async () => {
    const h = harness();
    h.readSavedPermissionLevel.mockReturnValue('auto-edit');
    const { profile } = await h.ports.profile(config());
    const identity: CodexThreadIdentity = {
      threadId: id,
      contextId: profile.contextId,
      processGeneration: 1,
      normalizedHome: profile.normalizedHome,
      workspaceId: workspace,
      providerId: profile.providerId,
      profileFingerprint: profile.profileFingerprint,
    };
    h.readResumeIdentity.mockResolvedValue(identity);
    h.readSavedPermissionLevel.mockClear();
    const resumed = await h.ports.profile(config(), id);
    expect(resumed.profile.permissionLevel).toBe('auto-edit');
    expect(h.readSavedPermissionLevel).toHaveBeenCalledWith(workspace);
  });
  it('loads native resume identity and rejects immutable binding changes', async () => {
    const h = harness();
    const { profile } = await h.ports.profile(config());
    const identity: CodexThreadIdentity = {
      threadId: id,
      contextId: profile.contextId,
      processGeneration: 1,
      normalizedHome: profile.normalizedHome,
      workspaceId: workspace,
      providerId: profile.providerId,
      profileFingerprint: profile.profileFingerprint,
    };
    h.readResumeIdentity.mockResolvedValue(identity);
    expect((await h.ports.profile(config(), id)).resume).toBe(identity);
    expect(h.readResumeIdentity).toHaveBeenCalledWith(id);
    h.readResumeIdentity.mockResolvedValue({
      ...identity,
      normalizedHome: 'different-home',
    });
    await expect(h.ports.profile(config(), id)).rejects.toThrow(
      'identity mismatch',
    );
  });
  it('rejects unsupported options before resolving or logging secret MCP contents', async () => {
    const h = harness();
    await expect(
      h.ports.profile({ ...config(), temperature: 0.5 }),
    ).rejects.toThrow(new CodexChatOptionError('temperature'));
    expect(h.resolveExecutionProfile).not.toHaveBeenCalled();
    expect(h.logger.error).not.toHaveBeenCalled();
    expect(h.logger.info).not.toHaveBeenCalled();
  });
  it('strips ambient options before preparation and logs names without secret values', async () => {
    const h = harness();
    const prepare = jest.spyOn(ChatRuntimeProfileService.prototype, 'prepare');
    const mcpServersOverride = {
      smithery: { type: 'http' as const, url: 'https://example.invalid/mcp', headers: { Authorization: 'Bearer secret-token-x' } },
      oauth: { type: 'http' as const, url: 'https://example.invalid/oauth' },
    };
    try {
      await expect(h.ports.profile({
        ...config(),
        mcpServersOverride,
        thinking: { type: 'adaptive' },
        outputStyleName: 'Explanatory',
      })).resolves.toHaveProperty('profile');
      expect(prepare.mock.calls[0][0]).toEqual({ ...config(), mcpServersOverride });
      expect(h.logger.info).toHaveBeenCalledTimes(3);
      expect(h.logger.info).toHaveBeenCalledWith(
        'User MCP servers are configured for Codex chat.',
        { code: 'codex-user-mcp-configured', serverNames: ['oauth', 'smithery'], transports: ['http'] },
      );
      expect(h.logger.info).not.toHaveBeenCalledWith(
        'User MCP servers are attached to Codex chat.',
        expect.anything(),
      );
      expect(h.logger.info).toHaveBeenCalledWith(
        'Thinking is not applied to Codex chat; Codex uses native effort.',
        { code: 'codex-thinking-not-applied' },
      );
      expect(h.logger.info).toHaveBeenCalledWith(
        'Output style by name is not applied to Codex chat.',
        { code: 'codex-output-style-not-applied' },
      );
      const logs = JSON.stringify(jest.mocked(h.logger.info).mock.calls);
      for (const value of ['https://example.invalid', 'Authorization', 'Bearer', 'secret-token-x', 'adaptive', 'Explanatory']) {
        expect(logs).not.toContain(value);
      }
    } finally {
      prepare.mockRestore();
    }
  });
  it.each([undefined, 'coding'] as const)('maps the UI fence for tool profile %s', async (mcpToolProfile) => {
    const h = harness();
    const { profile } = await h.ports.profile({
      ...config(), ptahUiFence: true, mcpToolProfile,
      systemPrompt: 'system', enhancedPromptsContent: 'enhanced', outputStyleBody: 'style',
    });
    expect(profile.developerPrompt).toBe(PTAH_UI_HINT_CODEX);
    expect(profile.developerPrompt).not.toContain('ptah-surface-authoring');
    expect(profile.developerPrompt).not.toContain('skill');
    expect(profile).toMatchObject({ systemPrompt: 'system', enhancedPrompt: 'enhanced', outputStyle: 'style' });
  });
  it.each([false, undefined] as const)('omits the UI hint when the fence is %s', async (ptahUiFence) => {
    const { profile } = await harness().ports.profile({ ...config(), ptahUiFence });
    expect(profile.developerPrompt).toBeUndefined();
  });
  it('rejects a non-coding tool profile with the coded option error', async () => {
    const h = harness();
    const result = h.ports.profile({
      ...config(), ptahUiFence: true, mcpToolProfile: 'apps',
    });
    await expect(result).rejects.toBeInstanceOf(CodexChatOptionError);
    await expect(result).rejects.toMatchObject({
      code: 'unsupported-option',
      key: 'mcpToolProfile',
      message: 'Codex chat does not support the "mcpToolProfile" option.',
    });
    expect(h.resolveExecutionProfile).not.toHaveBeenCalled();
  });
  it.each([true, false])('strips host flags and keeps MCP keys (running %s)', async (mcpServerRunning) => {
    const h = harness();
    const input = {
      ...config(),
      mcpServerRunning,
      workflowsDisabled: false,
      includePartialMessages: true,
      mcpServersOverride: {},
    };
    const prepare = jest.spyOn(
      ChatRuntimeProfileService.prototype,
      'prepare',
    );
    try {
      const { profile } = await h.ports.profile(input);
      expect(profile.model).toBe('gpt-5');
      expect(prepare.mock.calls[0][0]).toEqual({
        ...config(), mcpServerRunning, mcpServersOverride: {},
      });
      if (mcpServerRunning) {
        expect(h.logger.info).toHaveBeenCalledTimes(1);
        expect(h.logger.info).toHaveBeenCalledWith(
          'Ptah MCP is attached to Codex chat.',
          expect.objectContaining({ code: 'ptah-mcp-attached' }),
        );
      } else {
        expect(h.logger.info).not.toHaveBeenCalled();
      }
      expect(profile.mcpServers.map((server) => server.name)).toEqual(
        mcpServerRunning ? ['ptah'] : [],
      );
      expect(input).toHaveProperty('mcpServerRunning', mcpServerRunning);
    } finally {
      prepare.mockRestore();
    }
  });
  it('attaches Ptah MCP natively for a new session routed by tab id', async () => {
    const { profile } = await harness().ports.profile({
      ...config(), tabId: 'tab-1', mcpServerRunning: true,
    });
    expect(profile.mcpServers).toEqual([
      {
        name: 'ptah',
        transport: 'http',
        url: `http://localhost:51820/session/tab-1/workspace/${encodeURIComponent(profile.cwd)}`,
        headerReferences: {},
        toolTimeoutSec: 960,
      },
    ]);
  });
  it.each([false, undefined] as const)('attaches no Ptah server when MCP running is %s', async (mcpServerRunning) => {
    const { profile } = await harness().ports.profile({ ...config(), mcpServerRunning });
    expect(profile.mcpServers).toEqual([]);
  });
  async function resumable(h: ReturnType<typeof harness>) {
    const { profile } = await h.ports.profile(config());
    h.readResumeIdentity.mockResolvedValue({
      threadId: id,
      contextId: profile.contextId,
      processGeneration: 1,
      normalizedHome: profile.normalizedHome,
      workspaceId: workspace,
      providerId: profile.providerId,
      profileFingerprint: profile.profileFingerprint,
    });
    return profile;
  }
  it('routes a resume without a tab id by the session id and still resumes', async () => {
    const h = harness();
    await resumable(h);
    const prepared = await h.ports.profile({ ...noTab(), mcpServerRunning: true }, id);
    expect(prepared.resume?.threadId).toBe(id);
    expect(prepared.profile.mcpServers).toHaveLength(1);
    expect(prepared.profile.mcpServers[0]).toMatchObject({
      name: 'ptah',
      url: `http://localhost:51820/session/${id}/workspace/${encodeURIComponent(prepared.profile.cwd)}`,
    });
  });
  it('logs each Ptah MCP attach with the URL path and no secrets', async () => {
    const h = harness();
    const secret = 'secret-token-x';
    const input = {
      ...config(),
      tabId: 'tab-1',
      mcpServerRunning: true,
      mcpServersOverride: {
        smithery: {
          type: 'http' as const,
          url: `https://example.invalid/mcp?token=${secret}`,
          headers: { Authorization: `Bearer ${secret}` },
        },
      },
    };
    const attachLogs = () =>
      jest.mocked(h.logger.info).mock.calls.filter((call) => {
        const detail = call[1];
        return (
          typeof detail === 'object' &&
          detail !== null &&
          'code' in detail &&
          detail.code === 'ptah-mcp-attached'
        );
      });
    await h.ports.profile(input);
    expect(attachLogs()).toHaveLength(1);
    const detail = attachLogs()[0]?.[1] as { readonly path: string };
    expect(detail.path).toMatch(/^\/session\/tab-1\/workspace\//);
    expect(detail.path).not.toContain('?');
    const serialized = JSON.stringify(attachLogs());
    for (const value of [
      secret,
      'Bearer',
      'Authorization',
      'localhost',
      '51820',
      'https://example.invalid',
      'http://',
    ]) {
      expect(serialized).not.toContain(value);
    }
    expect(h.logger.info).toHaveBeenCalledWith(
      'User MCP servers are configured for Codex chat.',
      expect.objectContaining({
        code: 'codex-user-mcp-configured',
        serverNames: ['smithery'],
      }),
    );
    await h.ports.profile(input);
    expect(attachLogs()).toHaveLength(2);
  });
  it('resumes under a new tab id because MCP servers are outside the fingerprint', async () => {
    const h = harness();
    const original = await resumable(h);
    const prepared = await h.ports.profile(
      { ...config(), tabId: 'tab-new', mcpServerRunning: true },
      id,
    );
    expect(prepared.resume?.threadId).toBe(id);
    expect(prepared.profile.profileFingerprint).toBe(original.profileFingerprint);
    expect(prepared.profile.mcpServers[0]).toMatchObject({
      url: `http://localhost:51820/session/tab-new/workspace/${encodeURIComponent(prepared.profile.cwd)}`,
    });
  });
  it('refuses to attach Ptah MCP without a routing id instead of omitting it', async () => {
    const h = harness();
    const result = h.ports.profile({ ...noTab(), mcpServerRunning: true });
    await expect(result).rejects.toBeInstanceOf(CodexChatRoutingError);
    await expect(result).rejects.toMatchObject({
      code: 'ptah-mcp-routing-id-missing',
    });
    expect(h.resolveExecutionProfile).not.toHaveBeenCalled();
  });
  describe('user MCP servers (D8)', () => {
    const token = 'secret-token-oauth';
    const configToken = 'secret-config-value';
    const apiKey = 'secret-api-key';
    const queryUrl = `https://server.smithery.ai/acme/mcp?config=${configToken}&api_key=${apiKey}`;
    const secretValues = [token, `Bearer ${token}`, configToken, apiKey, queryUrl];

    it('attaches an http server with headers as references and returns the values as secrets', async () => {
      const { profile, secrets } = await harness().ports.profile({
        ...config(),
        mcpServersOverride: {
          notion: {
            type: 'http',
            url: 'https://mcp.notion.com/mcp',
            headers: { Authorization: `Bearer ${token}`, 'X-Team': 'team-1' },
          },
        },
      });
      expect(profile.mcpServers).toEqual([
        {
          name: 'notion',
          transport: 'http',
          url: 'https://mcp.notion.com/mcp',
          headerReferences: {
            Authorization: 'mcp.notion.header.0',
            'X-Team': 'mcp.notion.header.1',
          },
        },
      ]);
      expect(profile.mcpServers[0]).not.toHaveProperty('toolTimeoutSec');
      expect(profile.mcpServers[0]).not.toHaveProperty('urlReference');
      expect(secrets).toEqual(new Map([
        ['mcp.notion.header.0', `Bearer ${token}`],
        ['mcp.notion.header.1', 'team-1'],
      ]));
      expect(JSON.stringify(profile)).not.toContain(token);
      expect(buildCodexMcpConfigOverrides(profile.mcpServers, secrets)).toEqual({
        'mcp_servers.notion': {
          url: 'https://mcp.notion.com/mcp',
          http_headers: { Authorization: `Bearer ${token}`, 'X-Team': 'team-1' },
        },
      });
    });

    it('moves a query URL into a url reference that the real config builder restores', async () => {
      const { profile, secrets } = await harness().ports.profile({
        ...config(),
        mcpServersOverride: { smithery: { type: 'http', url: queryUrl } },
      });
      expect(profile.mcpServers).toEqual([
        {
          name: 'smithery',
          transport: 'http',
          url: 'https://server.smithery.ai/acme/mcp',
          urlReference: 'mcp.smithery.url',
          headerReferences: {},
        },
      ]);
      expect(secrets).toEqual(new Map([['mcp.smithery.url', queryUrl]]));
      expect(JSON.stringify(profile)).not.toContain(configToken);
      expect(JSON.stringify(profile)).not.toContain(apiKey);
      expect(buildCodexMcpConfigOverrides(profile.mcpServers, secrets)).toEqual({
        'mcp_servers.smithery': { url: queryUrl },
      });
    });

    it('maps a dotted OAuth key to a safe Codex server name', async () => {
      const { profile, secrets } = await harness().ports.profile({
        ...config(),
        mcpServersOverride: {
          'oauth.mcp.linear.app': {
            type: 'http',
            url: 'https://mcp.linear.app/mcp',
            headers: { Authorization: `Bearer ${token}` },
          },
        },
      });
      expect(profile.mcpServers.map((server) => server.name)).toEqual(['oauth_mcp_linear_app']);
      expect(profile.mcpServers[0]).toMatchObject({
        headerReferences: { Authorization: 'mcp.oauth_mcp_linear_app.header.0' },
      });
      expect(secrets?.get('mcp.oauth_mcp_linear_app.header.0')).toBe(`Bearer ${token}`);
    });

    it('refuses two servers whose names collide after mapping, naming servers only', async () => {
      const h = harness();
      const result = h.ports.profile({
        ...config(),
        mcpServersOverride: {
          'a.b': { type: 'http', url: queryUrl, headers: { Authorization: `Bearer ${token}` } },
          a_b: { type: 'http', url: 'https://example.invalid/mcp' },
        },
      });
      await expect(result).rejects.toBeInstanceOf(CodexChatMcpServerNameError);
      const error = await result.catch((reason: unknown) => reason);
      expect(error).toMatchObject({
        code: 'codex-mcp-server-name-collision',
        serverNames: ['a.b', 'a_b'],
      });
      const message = error instanceof Error ? error.message : '';
      expect(message).toContain('"a.b"');
      expect(message).toContain('"a_b"');
      for (const value of [...secretValues, 'example.invalid']) {
        expect(message).not.toContain(value);
      }
      expect(h.resolveExecutionProfile).not.toHaveBeenCalled();
    });

    it.each([
      `not a url ${apiKey}`,
      `ftp://files.example.invalid/mcp?api_key=${apiKey}`,
    ])('refuses an invalid or non-http URL with a coded error naming the server only: %s', async (url) => {
      const h = harness();
      const result = h.ports.profile({
        ...config(),
        mcpServersOverride: { broken: { type: 'http', url } },
      });
      await expect(result).rejects.toBeInstanceOf(CodexChatMcpServerUrlError);
      await expect(result).rejects.toMatchObject({
        code: 'codex-mcp-server-url-invalid',
        serverName: 'broken',
      });
      const error = await result.catch((reason: unknown) => reason);
      expect(error instanceof Error ? error.message : '').not.toContain(apiKey);
      expect(h.resolveExecutionProfile).not.toHaveBeenCalled();
    });

    it('lets a user server named ptah replace the Ptah entry (caller wins)', async () => {
      const { profile, secrets } = await harness().ports.profile({
        ...config(),
        mcpServerRunning: true,
        mcpServersOverride: {
          ptah: { type: 'http', url: 'https://proxy.example.invalid/ptah', headers: { Authorization: `Bearer ${token}` } },
          other: { type: 'http', url: 'https://other.example.invalid/mcp' },
        },
      });
      expect(profile.mcpServers).toEqual([
        {
          name: 'ptah',
          transport: 'http',
          url: 'https://proxy.example.invalid/ptah',
          headerReferences: { Authorization: 'mcp.ptah.header.0' },
        },
        {
          name: 'other',
          transport: 'http',
          url: 'https://other.example.invalid/mcp',
          headerReferences: {},
        },
      ]);
      expect(secrets?.get('mcp.ptah.header.0')).toBe(`Bearer ${token}`);
    });

    it('returns no secrets when no user server needs one', async () => {
      const prepared = await harness().ports.profile({
        ...config(),
        mcpServerRunning: true,
        mcpServersOverride: { open: { type: 'http', url: 'https://open.example.invalid/mcp' } },
      });
      expect(prepared.secrets).toBeUndefined();
      expect(prepared.profile.mcpServers.map((server) => server.name)).toEqual(['ptah', 'open']);
    });

    it('keeps every secret value out of logs, profile, fingerprint, identity, metadata and notices', async () => {
      const h = harness();
      const original = await resumable(h);
      const prepared = await h.ports.profile({
        ...config(),
        mcpServerRunning: true,
        mcpServersOverride: {
          smithery: { type: 'http', url: queryUrl },
          'oauth.mcp.linear.app': {
            type: 'http',
            url: 'https://mcp.linear.app/mcp',
            headers: { Authorization: `Bearer ${token}` },
          },
        },
        thinking: { type: 'adaptive' },
        outputStyleName: 'Explanatory',
      }, id);
      expect(prepared.resume?.threadId).toBe(id);
      // MCP servers and their references stay outside the fingerprint.
      expect(prepared.profile.profileFingerprint).toBe(original.profileFingerprint);
      expect([...(prepared.secrets?.values() ?? [])]).toEqual(
        expect.arrayContaining([queryUrl, `Bearer ${token}`]),
      );
      const observed = JSON.stringify([
        jest.mocked(h.logger.info).mock.calls,
        jest.mocked(h.logger.warn).mock.calls,
        jest.mocked(h.logger.debug).mock.calls,
        jest.mocked(h.logger.error).mock.calls,
        prepared.profile,
        prepared.profile.profileFingerprint,
        prepared.resume,
        h.readResumeIdentity.mock.calls,
        jest.mocked(h.deps.metadata.save).mock.calls,
        h.broadcastMessage.mock.calls,
      ]);
      for (const value of secretValues) expect(observed).not.toContain(value);
    });
  });
  it('uses the same provider resolver for admission', async () => {
    const h = harness();
    const admission = createCodexRuntimeAdmission(h.deps);
    expect(await admission.servingProviderId(config())).toBe(
      (await h.ports.profile(config())).profile.providerId,
    );
    expect(h.resolveExecutionProfile.mock.calls[0]).toEqual(
      h.resolveExecutionProfile.mock.calls[1],
    );
  });
  function autoResolved(broadcastMessage: {
    mock: { calls: readonly (readonly unknown[])[] };
  }): readonly (readonly unknown[])[] {
    return broadcastMessage.mock.calls.filter(
      (call) => call[0] === MESSAGE_TYPES.PERMISSION_AUTO_RESOLVED,
    );
  }
  function request(expiresAt: number | 'absent' = 1_900_000_000_000): CodexApprovalRequest {
    return {
      contextId: 'context',
      processGeneration: 2,
      threadId: id,
      turnId: 'turn',
      requestId: 5,
      toolId: 'native-item-5',
      ...(expiresAt === 'absent' ? {} : { expiresAt }),
      kind: 'command',
      normalizedHome: workspace,
      workspaceId: workspace,
      providerId: 'openai-codex',
      message: 'Run command',
      details: { command: 'pwd' },
    };
  }
  it.each([false, true])('presents a renderer-valid approval (session fallback tab: %s)', (fallback) => {
    const h = harness();
    const tabId = '33333333-3333-4333-8333-333333333333';
    h.deps.tabId = () => fallback ? id : tabId;
    const approval = request();
    h.ports.presentation.present(id, approval, ['deny', 'allowOnce', 'allowWithInput', 'alwaysAllow']);
    const payload = h.broadcastMessage.mock.calls[0][1];
    expect(parsePermissionRequest(payload)).not.toBeNull();
    expect(payload.id).toMatch(UUID_REGEX);
    expect(payload).toMatchObject({
      sessionId: id,
      toolName: 'Bash',
      toolInput: { command: 'pwd' },
      toolUseId: approval.toolId,
      timeoutAt: approval.expiresAt,
      description: expect.stringContaining('pwd'),
    });
    expect(payload).not.toHaveProperty('allowedDecisions');
    if (fallback) expect(payload).not.toHaveProperty('tabId');
    else expect(payload.tabId).toBe(tabId);
  });
  it.each([
    ['allow', 'accept'],
    ['always_allow', 'acceptForSession'],
    ['deny_with_message', 'decline'],
    ['deny', 'cancel'],
  ] as const)('maps %s over the existing permission wire', (wire, decision) => {
    const h = harness();
    h.ports.presentation.present(id, request(), [
      'deny',
      'allowOnce',
      'allowWithInput',
      'alwaysAllow',
    ]);
    const payload = h.broadcastMessage.mock.calls[0][1];
    expect(payload).not.toHaveProperty('allowedDecisions');
    expect(
      h.ports.handlePermissionResponse({ id: payload.id, decision: wire }),
    ).toBe(true);
    expect(h.respond.mock.calls[0][1].response.decision).toBe(decision);
    expect(autoResolved(h.broadcastMessage)).toEqual([]);
  });
  it.each(['allow', 'deny'] as const)(
    'sends no auto-resolve when a user %s is delivered to the bridge',
    (decision) => {
      const h = harness();
      const approval = request();
      h.respond.mockImplementation(() => {
        h.ports.presentation.dismiss(id, approval);
        return true;
      });
      h.ports.presentation.present(id, approval, [
        'deny',
        'allowOnce',
        'allowWithInput',
        'alwaysAllow',
      ]);
      const payload = h.broadcastMessage.mock.calls[0][1];
      expect(
        h.ports.handlePermissionResponse({ id: payload.id, decision }),
      ).toBe(true);
      expect(autoResolved(h.broadcastMessage)).toEqual([]);
      expect(h.respond).toHaveBeenCalledTimes(1);
    },
  );
  it('sends exactly one auto-resolve when the prompt is dismissed without an answer', () => {
    const h = harness();
    const approval = request();
    h.ports.presentation.present(id, approval, [
      'deny',
      'allowOnce',
      'allowWithInput',
      'alwaysAllow',
    ]);
    const payload = h.broadcastMessage.mock.calls[0][1];
    h.ports.presentation.dismiss(id, approval);
    h.ports.presentation.dismiss(id, approval);
    expect(autoResolved(h.broadcastMessage)).toEqual([
      [
        MESSAGE_TYPES.PERMISSION_AUTO_RESOLVED,
        { id: payload.id, sessionId: id, toolName: 'command' },
      ],
    ]);
  });
  it.each(['rejected', 'throws'] as const)('settles the Codex approval without falling through when the sink %s', (failure) => {
    const h = harness();
    h.ports.presentation.present(id, request(), [
      'deny',
      'allowOnce',
      'allowWithInput',
      'alwaysAllow',
    ]);
    const approval = request();
    const wireId: string = h.broadcastMessage.mock.calls[0][1].id;
    if (failure === 'throws') {
      h.respond.mockImplementationOnce(() => {
        h.ports.presentation.dismiss(id, approval);
        throw new Error('private request');
      });
    } else {
      h.respond.mockImplementationOnce(() => {
        h.ports.presentation.dismiss(id, approval);
        return false;
      });
    }
    expect(h.ports.handlePermissionResponse({ id: wireId, decision: 'allow' })).toBe(true);
    expect(h.resolveAttention).toHaveBeenCalledWith(
      attentionRequestKey('permission', wireId),
      h.broadcastMessage.mock.calls[0][1].timestamp,
    );
    expect(autoResolved(h.broadcastMessage)).toEqual([
      [
        MESSAGE_TYPES.PERMISSION_AUTO_RESOLVED,
        { id: wireId, sessionId: id, toolName: 'command' },
      ],
    ]);
    expect(h.deps.logger.warn).toHaveBeenCalledWith(
      expect.any(String), { code: failure === 'throws' ? 'approval-response-failed' : 'approval-response-rejected' },
    );
    expect(h.ports.handlePermissionResponse({ id: wireId, decision: 'allow' })).toBe(false);
    expect(h.respond).toHaveBeenCalledTimes(1);
    expect(h.resolveAttention).toHaveBeenCalledTimes(1);
  });
  it('declines an undeliverable prompt and releases its pending entry', async () => {
    const h = harness();
    h.broadcastMessage.mockRejectedValueOnce(new Error('window closed'));
    h.ports.presentation.present(id, request(), [
      'deny',
      'allowOnce',
      'allowWithInput',
      'alwaysAllow',
    ]);
    const wireId: string = h.broadcastMessage.mock.calls[0][1].id;
    await Promise.resolve();
    await Promise.resolve();
    expect(h.respond).toHaveBeenCalledWith(
      { sessionId: id, threadId: id, requestId: '5' },
      expect.objectContaining({ kind: 'codex', response: expect.objectContaining({ decision: 'decline' }) }),
    );
    expect(h.resolveAttention).toHaveBeenCalledTimes(1);
    expect(h.resolveAttention).toHaveBeenCalledWith(
      attentionRequestKey('permission', wireId),
      h.broadcastMessage.mock.calls[0][1].timestamp,
    );
    expect(h.ports.handlePermissionResponse({ id: wireId, decision: 'allow' })).toBe(false);
  });
  it('does not decline a replacement when the previous delivery fails later', async () => {
    const h = harness();
    let rejectDelivery: ((reason: Error) => void) | undefined;
    h.broadcastMessage.mockReturnValueOnce(new Promise<void>((_resolve, reject) => {
      rejectDelivery = reject;
    }));
    const approval = request();
    h.ports.presentation.present(id, approval, ['deny', 'allowOnce', 'allowWithInput', 'alwaysAllow']);
    h.ports.presentation.present(id, approval, ['deny', 'allowOnce', 'allowWithInput', 'alwaysAllow']);
    const replacement = h.broadcastMessage.mock.calls[1][1];
    rejectDelivery?.(new Error('window closed'));
    await Promise.resolve();
    expect(h.respond).not.toHaveBeenCalled();
    expect(h.resolveAttention).toHaveBeenCalledTimes(1);
    expect(h.ports.handlePermissionResponse({ id: replacement.id, decision: 'allow' })).toBe(true);
    expect(h.respond).toHaveBeenCalledTimes(1);
    expect(h.resolveAttention).toHaveBeenCalledTimes(2);
  });
  it('accepts equivalent resume workspace spelling and preserves the caller path', async () => {
    const h = harness();
    const { profile } = await h.ports.profile(config());
    h.readResumeIdentity.mockResolvedValue({
      threadId: id, contextId: profile.contextId, processGeneration: 1,
      normalizedHome: profile.normalizedHome, providerId: profile.providerId,
      workspaceId: (process.platform === 'win32' ? workspace.toUpperCase() : workspace) + '/',
      profileFingerprint: profile.profileFingerprint,
    });
    expect((await h.ports.profile(config(), id)).profile.workspaceId).toBe(workspace);
  });
  it('cancels the correlated UI prompt and forgets its wire id', () => {
    const h = harness();
    h.ports.presentation.present(id, request(), [
      'deny',
      'allowOnce',
      'allowWithInput',
      'alwaysAllow',
    ]);
    const wireId: string = h.broadcastMessage.mock.calls[0][1].id;
    h.ports.presentation.cancelPrompt({
      sessionId: id,
      requestId: '5',
      reason: 'turn-ended',
    });
    expect(h.broadcastMessage).toHaveBeenLastCalledWith(
      MESSAGE_TYPES.PERMISSION_PROMPT_CANCELLED,
      { sessionId: id, requestId: wireId, reason: 'turn-ended' },
    );
    expect(h.respond).not.toHaveBeenCalled();
    expect(
      h.ports.handlePermissionResponse({ id: wireId, decision: 'allow' }),
    ).toBe(false);
  });
  describe('host attention release', () => {
    function presented() {
      const h = harness();
      h.ports.presentation.present(id, request(), [
        'deny',
        'allowOnce',
        'allowWithInput',
        'alwaysAllow',
      ]);
      const [type, payload] = h.broadcastMessage.mock.calls[0];
      expect(type).toBe(MESSAGE_TYPES.PERMISSION_REQUEST);
      expect(h.resolveAttention).not.toHaveBeenCalled();
      const noticeKey = attentionRequestKey('permission', payload.id);
      return {
        h,
        wireId: payload.id as string,
        noticeKey,
        timestamp: payload.timestamp as number,
      };
    }

    it('releases the observed notice once a decision is returned', () => {
      const { h, wireId, noticeKey, timestamp } = presented();
      h.ports.handlePermissionResponse({ id: wireId, decision: 'allow' });
      expect(h.resolveAttention).toHaveBeenCalledTimes(1);
      expect(h.resolveAttention).toHaveBeenCalledWith(noticeKey, timestamp);
      expect(
        h.ports.handlePermissionResponse({ id: wireId, decision: 'deny' }),
      ).toBe(false);
      expect(h.respond).toHaveBeenCalledTimes(1);
      h.ports.presentation.cancelPrompt({
        sessionId: id,
        requestId: '5',
        reason: 'turn-ended',
      });
      expect(h.broadcastMessage).toHaveBeenCalledTimes(1);
      h.ports.presentation.dismiss(id, request());
      expect(h.broadcastMessage).toHaveBeenCalledTimes(1);
      expect(h.resolveAttention).toHaveBeenCalledTimes(1);
    });

    it('releases the observed notice when the request is auto-resolved', () => {
      const { h, noticeKey, timestamp } = presented();
      h.ports.presentation.dismiss(id, request());
      expect(h.resolveAttention).toHaveBeenCalledWith(noticeKey, timestamp);
      h.ports.presentation.dismiss(id, request());
      expect(h.resolveAttention).toHaveBeenCalledTimes(1);
    });

    it.each(['turn-ended', 'disposed'] as const)('releases once for cancel then dismiss (%s)', (reason) => {
      const { h, wireId, noticeKey, timestamp } = presented();
      h.ports.presentation.cancelPrompt({
        sessionId: id,
        requestId: '5',
        reason,
      });
      h.ports.presentation.dismiss(id, request());
      expect(h.broadcastMessage).toHaveBeenCalledTimes(2);
      expect(h.broadcastMessage).toHaveBeenLastCalledWith(
        MESSAGE_TYPES.PERMISSION_PROMPT_CANCELLED,
        { sessionId: id, requestId: wireId, reason },
      );
      expect(h.resolveAttention).toHaveBeenCalledTimes(1);
      expect(h.resolveAttention).toHaveBeenCalledWith(noticeKey, timestamp);
      expect(h.ports.handlePermissionResponse({ id: wireId, decision: 'allow' })).toBe(false);
      expect(h.respond).not.toHaveBeenCalled();
    });

    it('replaces the wire identity and releases the previous presentation', () => {
      const { h, wireId, noticeKey, timestamp } = presented();
      h.ports.presentation.present(id, request(), ['deny', 'allowOnce', 'allowWithInput', 'alwaysAllow']);
      const replacement = h.broadcastMessage.mock.calls[1][1];
      expect(replacement.id).toMatch(UUID_REGEX);
      expect(replacement.id).not.toBe(wireId);
      expect(h.resolveAttention).toHaveBeenCalledWith(noticeKey, timestamp);
      expect(h.ports.handlePermissionResponse({ id: wireId, decision: 'allow' })).toBe(false);
      expect(h.respond).not.toHaveBeenCalled();
      h.ports.presentation.dismiss(id, request());
      expect(h.broadcastMessage).toHaveBeenLastCalledWith(
        MESSAGE_TYPES.PERMISSION_AUTO_RESOLVED,
        { id: replacement.id, sessionId: id, toolName: 'command' },
      );
      expect(h.resolveAttention).toHaveBeenCalledTimes(2);
      expect(h.resolveAttention).toHaveBeenLastCalledWith(
        attentionRequestKey('permission', replacement.id), replacement.timestamp,
      );
      expect(h.ports.handlePermissionResponse({ id: replacement.id, decision: 'allow' })).toBe(false);
    });

    it('releases nothing for an unknown response id', () => {
      const { h } = presented();
      expect(
        h.ports.handlePermissionResponse({ id: 'unknown', decision: 'allow' }),
      ).toBe(false);
      expect(h.resolveAttention).not.toHaveBeenCalled();
    });

    it('works without a host attention coordinator', () => {
      const h = harness();
      const ports = createCodexChatHostPorts({
        ...h.deps,
        hostAttention: undefined,
      });
      ports.presentation.present(id, request(), [
        'deny',
        'allowOnce',
        'allowWithInput',
        'alwaysAllow',
      ]);
      const wireId: string = h.broadcastMessage.mock.calls[0][1].id;
      expect(
        ports.handlePermissionResponse({ id: wireId, decision: 'deny' }),
      ).toBe(true);
    });
  });
  it('drains follow-up events through the broadcaster', async () => {
    const h = harness();
    const event: FlatStreamEventUnion = {
      id: 'event',
      messageId: 'message',
      sessionId: id,
      timestamp: 1,
      eventType: 'message_complete',
    };
    const stream = (async function* () {
      yield event;
    })();
    await h.ports.publish(id, stream);
    expect(h.drained).toEqual([event]);
    expect(h.streamEventsToWebview).toHaveBeenCalledWith(id, stream, chatTab);
  });

  it('defaults the execution-profile consumer to chat', async () => {
    const { profile } = await harness().ports.profile(config());
    expect(profile.consumer).toBe('chat');
  });

  it('carries a gateway consumer and the ptah MCP server on the gw- routing id', async () => {
    const h = harness();
    const routingId = 'gw-conversation';
    const { profile } = await h.ports.profile({
      ...config(),
      consumer: 'gateway',
      tabId: routingId,
      mcpServerRunning: true,
    });
    expect(profile.consumer).toBe('gateway');
    expect(profile.mcpServers).toEqual([
      {
        name: 'ptah',
        transport: 'http',
        url: `http://localhost:51820/session/${routingId}/workspace/${encodeURIComponent(profile.cwd)}`,
        headerReferences: {},
        toolTimeoutSec: 960,
      },
    ]);
    expect(h.resolveExecutionProfile).toHaveBeenCalledWith(
      expect.objectContaining({ consumer: 'gateway' }),
    );
  });

  it('does not reject the gateway consumer as a Codex thread option', () => {
    const h = harness();
    expect(() =>
      h.ports.checkOptions({ ...config(), consumer: 'gateway', prompt: 'hello' }),
    ).not.toThrow();
  });

  describe('unroutable prompts', () => {
    const gatewayTab = 'gw-conversation';
    const now = 1_700_000_000_000;
    const choices = [
      'deny',
      'allowOnce',
      'allowWithInput',
      'alwaysAllow',
    ] as const;

    afterEach(() => {
      jest.useRealTimers();
    });

    function systemAbort(toolName: string, timeoutMs: number): string {
      return buildSystemAbortPermissionMessage(
        toolName,
        `Permission request timed out after ${timeoutMs}ms with no answer from the UI — denying to prevent a permanent hang.`,
      );
    }

    function presentGateway(expiresAt?: number) {
      jest.useFakeTimers({ now });
      const h = harness();
      h.deps.tabId = () => gatewayTab;
      const approval = request(expiresAt ?? 'absent');
      h.ports.presentation.present(id, approval, [...choices]);
      const payload: {
        id: string;
        timeoutAt: number;
        timestamp: number;
        description: string;
      } = h.broadcastMessage.mock.calls[0][1];
      return { h, approval, payload };
    }

    it('keeps a UUID tab on today\'s card with no timer and no lifecycle', () => {
      jest.useFakeTimers({ now });
      const h = harness();
      const approval = request();
      h.ports.presentation.present(id, approval, [...choices]);
      const payload = h.broadcastMessage.mock.calls[0][1];
      expect(payload).toMatchObject({
        sessionId: id,
        tabId: chatTab,
        timeoutAt: approval.expiresAt,
      });
      jest.advanceTimersByTime(120_000);
      expect(h.respond).not.toHaveBeenCalled();
      expect(h.publish).not.toHaveBeenCalled();
    });

    it.each([
      ['absent', undefined, 60_000],
      ['shorter than 60s', 15_000, 15_000],
      ['longer than 60s', 120_000, 60_000],
    ] as const)(
      'presents Claude\'s unroutable card when the bridge expiry is %s',
      (_label, offset, timeoutMs) => {
        const { h, payload } = presentGateway(
          offset === undefined ? undefined : now + offset,
        );
        expect(parsePermissionRequest(payload)).not.toBeNull();
        expect(payload).toMatchObject({
          toolName: 'Bash',
          toolInput: { command: 'pwd' },
          toolUseId: 'native-item-5',
          timestamp: now,
          timeoutAt: now + timeoutMs,
          description: expect.stringContaining('pwd'),
        });
        expect(payload).not.toHaveProperty('sessionId');
        expect(payload).not.toHaveProperty('tabId');
        expect(h.publish).toHaveBeenCalledTimes(1);
        expect(h.publish).toHaveBeenCalledWith({
          phase: 'requested',
          requestId: payload.id,
          routingHint: gatewayTab,
          toolName: 'Bash',
          description: payload.description,
          routable: false,
          timeoutMs,
        });
        jest.advanceTimersByTime(timeoutMs - 1);
        expect(h.respond).not.toHaveBeenCalled();
        jest.advanceTimersByTime(1);
        expect(h.respond).toHaveBeenCalledTimes(1);
        expect(h.respond).toHaveBeenCalledWith(
          { sessionId: id, threadId: id, requestId: '5' },
          expect.objectContaining({
            kind: 'codex',
            response: expect.objectContaining({
              decision: 'decline',
              reason: systemAbort('Bash', timeoutMs),
            }),
          }),
        );
        expect(systemAbort('Bash', timeoutMs).startsWith(
          'SYSTEM ABORT — this was NOT a user decision.',
        )).toBe(true);
        expect(h.publish).toHaveBeenLastCalledWith({
          phase: 'resolved',
          requestId: payload.id,
          routingHint: gatewayTab,
          toolName: 'Bash',
          outcome: 'timed-out',
        });
        jest.advanceTimersByTime(60_000);
        expect(h.respond).toHaveBeenCalledTimes(1);
        expect(h.publish).toHaveBeenCalledTimes(2);
      },
    );

    it.each([
      ['allow', 'allowed'],
      ['always_allow', 'allowed'],
      ['deny', 'denied'],
      ['deny_with_message', 'denied'],
    ] as const)(
      'answers %s on the wire id and does not decline when the window ends',
      (decision, outcome) => {
        const { h, payload } = presentGateway();
        expect(
          h.ports.handlePermissionResponse({
            id: payload.id,
            decision,
            ...(decision === 'deny_with_message' ? { reason: 'stop' } : {}),
          }),
        ).toBe(true);
        jest.advanceTimersByTime(60_000);
        expect(h.respond).toHaveBeenCalledTimes(1);
        expect(h.publish).toHaveBeenLastCalledWith(
          expect.objectContaining({ phase: 'resolved', outcome, routingHint: gatewayTab }),
        );
        expect(h.ports.handlePermissionResponse({ id: payload.id, decision: 'allow' })).toBe(
          false,
        );
      },
    );

    it.each(['rejects', 'throws'] as const)(
      'publishes aborted when the approval router %s an allow response',
      (failure) => {
        const { h, payload } = presentGateway();
        if (failure === 'rejects') h.respond.mockReturnValue(false);
        else h.respond.mockImplementation(() => { throw new Error('router failed'); });

        expect(h.ports.handlePermissionResponse({ id: payload.id, decision: 'allow' }))
          .toBe(true);
        expect(h.broadcastMessage).toHaveBeenCalledWith(
          MESSAGE_TYPES.PERMISSION_AUTO_RESOLVED,
          expect.objectContaining({ id: payload.id, sessionId: id }),
        );
        expect(h.broadcastMessage.mock.calls.filter(
          ([type]) => type === MESSAGE_TYPES.PERMISSION_AUTO_RESOLVED,
        )).toHaveLength(1);
        expect(h.publish).toHaveBeenLastCalledWith({
          phase: 'resolved',
          requestId: payload.id,
          routingHint: gatewayTab,
          toolName: 'Bash',
          outcome: 'aborted',
        });
        jest.advanceTimersByTime(UNROUTABLE_PERMISSION_TIMEOUT_MS);
        expect(h.respond).toHaveBeenCalledTimes(1);
        expect(h.publish).toHaveBeenCalledTimes(2);
      },
    );

    it('clears the deny window when the turn ends first', () => {
      const { h, payload } = presentGateway();
      h.ports.presentation.cancelPrompt({
        sessionId: id,
        requestId: '5',
        reason: 'turn-ended',
      });
      jest.advanceTimersByTime(60_000);
      expect(h.respond).not.toHaveBeenCalled();
      expect(h.publish).toHaveBeenLastCalledWith(
        expect.objectContaining({
          phase: 'resolved',
          requestId: payload.id,
          outcome: 'aborted',
          routingHint: gatewayTab,
        }),
      );
    });

    it('clears the deny window when the prompt is dismissed without an answer', () => {
      const { h, approval, payload } = presentGateway();
      h.ports.presentation.dismiss(id, approval);
      h.ports.presentation.dismiss(id, approval);
      jest.advanceTimersByTime(60_000);
      expect(h.respond).not.toHaveBeenCalled();
      expect(h.publish).toHaveBeenCalledTimes(2);
      expect(h.publish).toHaveBeenLastCalledWith(
        expect.objectContaining({
          phase: 'resolved',
          requestId: payload.id,
          outcome: 'aborted',
          routingHint: gatewayTab,
        }),
      );
    });

    it('clears the deny window when delivery fails and does not time out afterwards', async () => {
      jest.useFakeTimers({ now });
      const h = harness();
      h.deps.tabId = () => gatewayTab;
      h.broadcastMessage.mockRejectedValueOnce(new Error('window closed'));
      h.ports.presentation.present(id, request('absent'), [...choices]);
      const delivered: { id: string } = h.broadcastMessage.mock.calls[0][1];
      await Promise.resolve();
      await Promise.resolve();
      expect(h.respond).toHaveBeenCalledTimes(1);
      expect(h.respond.mock.calls[0][1].response).not.toHaveProperty('reason');
      expect(h.publish).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: 'resolved',
          requestId: delivered.id,
          outcome: 'denied',
          routingHint: gatewayTab,
        }),
      );
      jest.advanceTimersByTime(60_000);
      expect(h.respond).toHaveBeenCalledTimes(1);
    });

    it('drops the previous deny window when the same approval is presented again', () => {
      const { h } = presentGateway();
      h.ports.presentation.present(id, request('absent'), [...choices]);
      jest.advanceTimersByTime(60_000);
      expect(h.respond).toHaveBeenCalledTimes(1);
      expect(h.publish).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ phase: 'resolved', outcome: 'aborted' }),
      );
      expect(h.publish).toHaveBeenLastCalledWith(
        expect.objectContaining({ phase: 'resolved', outcome: 'timed-out' }),
      );
    });

    it('still declines once when the lifecycle publisher throws', () => {
      jest.useFakeTimers({ now });
      const h = harness();
      h.deps.tabId = () => gatewayTab;
      const sequence: string[] = [];
      h.respond.mockImplementation(() => {
        sequence.push('native');
        return true;
      });
      h.publish.mockImplementation((event: PermissionPromptLifecycleEvent) => {
        sequence.push(event.phase);
        throw new Error('publisher failed');
      });
      h.ports.presentation.present(id, request('absent'), [...choices]);
      expect(h.broadcastMessage).toHaveBeenCalledWith(
        MESSAGE_TYPES.PERMISSION_REQUEST,
        expect.objectContaining({ toolName: 'Bash', timeoutAt: now + UNROUTABLE_PERMISSION_TIMEOUT_MS }),
      );
      expect(h.respond).not.toHaveBeenCalled();
      jest.advanceTimersByTime(UNROUTABLE_PERMISSION_TIMEOUT_MS);
      expect(sequence).toEqual(['requested', 'native', 'resolved']);
      expect(h.respond).toHaveBeenCalledTimes(1);
      expect(h.respond).toHaveBeenCalledWith(
        { sessionId: id, threadId: id, requestId: '5' },
        expect.objectContaining({
          kind: 'codex',
          response: expect.objectContaining({
            decision: 'decline',
            reason: systemAbort('Bash', UNROUTABLE_PERMISSION_TIMEOUT_MS),
          }),
        }),
      );
      expect(h.logger.warn).toHaveBeenCalledWith(
        'Codex prompt lifecycle listener threw.',
        expect.objectContaining({ code: 'prompt-lifecycle-listener-threw' }),
      );
      jest.advanceTimersByTime(UNROUTABLE_PERMISSION_TIMEOUT_MS);
      expect(h.respond).toHaveBeenCalledTimes(1);
      expect(sequence).toEqual(['requested', 'native', 'resolved']);
    });

    it('answers once when publication resolves the prompt reentrantly', () => {
      jest.useFakeTimers({ now });
      const h = harness();
      h.deps.tabId = () => gatewayTab;
      h.publish.mockImplementation((event: PermissionPromptLifecycleEvent) => {
        h.ports.handlePermissionResponse({
          id: event.requestId,
          decision: 'allow',
        });
      });
      h.ports.presentation.present(id, request('absent'), [...choices]);
      expect(h.respond).toHaveBeenCalledTimes(1);
      expect(h.respond.mock.calls[0][1].response.decision).toBe('accept');
      const resolved = h.publish.mock.calls.filter(
        (call) => call[0].phase === 'resolved',
      );
      expect(resolved).toHaveLength(1);
      const settledId = resolved[0]?.[0].requestId;
      expect(
        h.broadcastMessage.mock.calls.filter(
          (call) =>
            call[0] === MESSAGE_TYPES.PERMISSION_REQUEST &&
            call[1].id === settledId,
        ),
      ).toHaveLength(0);
      expect(resolved[0]?.[0]).toEqual({
        phase: 'resolved',
        requestId: expect.any(String),
        routingHint: gatewayTab,
        toolName: 'Bash',
        outcome: 'allowed',
      });
      jest.advanceTimersByTime(UNROUTABLE_PERMISSION_TIMEOUT_MS);
      expect(h.respond).toHaveBeenCalledTimes(1);
      expect(
        h.publish.mock.calls.filter((call) => call[0].phase === 'resolved'),
      ).toHaveLength(1);
      expect(
        h.broadcastMessage.mock.calls.filter(
          (call) =>
            call[0] === MESSAGE_TYPES.PERMISSION_REQUEST &&
            call[1].id === settledId,
        ),
      ).toHaveLength(0);
    });

    it('does not time out after session teardown dismisses a pending prompt', () => {
      const { h, approval } = presentGateway();
      expect(h.publish).toHaveBeenCalledTimes(1);
      h.ports.presentation.cancelPrompt({
        sessionId: id,
        requestId: '5',
        reason: 'disposed',
      });
      h.ports.presentation.dismiss(id, approval);
      expect(h.respond).not.toHaveBeenCalled();
      expect(h.publish).toHaveBeenCalledTimes(2);
      expect(h.publish).toHaveBeenLastCalledWith(
        expect.objectContaining({ phase: 'resolved', outcome: 'aborted' }),
      );
      jest.advanceTimersByTime(UNROUTABLE_PERMISSION_TIMEOUT_MS + 5_000);
      expect(h.respond).not.toHaveBeenCalled();
      expect(h.publish).toHaveBeenCalledTimes(2);
    });

    it('still declines on the deny window when no lifecycle publisher is bound', () => {
      jest.useFakeTimers({ now });
      const h = harness();
      const ports = createCodexChatHostPorts({
        ...h.deps,
        promptLifecycle: undefined,
        tabId: () => gatewayTab,
      });
      ports.presentation.present(id, request('absent'), [...choices]);
      jest.advanceTimersByTime(60_000);
      expect(h.respond).toHaveBeenCalledWith(
        { sessionId: id, threadId: id, requestId: '5' },
        expect.objectContaining({
          kind: 'codex',
          response: expect.objectContaining({
            decision: 'decline',
            reason: systemAbort('Bash', 60_000),
          }),
        }),
      );
    });
  });
});
