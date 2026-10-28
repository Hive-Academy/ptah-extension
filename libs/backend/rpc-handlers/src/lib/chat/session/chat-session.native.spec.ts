import 'reflect-metadata';
import { ChatSlashCommandRouterService } from './chat-slash-command-router.service';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PTAH_UI_HINT } from '@ptah-extension/agent-sdk';
import { createCodexChatHostPorts, type CodexChatHostPortsDeps } from '../codex-host/codex-chat-host-ports';
import { WorkspaceProviderProfileResolver } from '@ptah-extension/auth-providers';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
jest.mock('@ptah-extension/workspace-intelligence', () => ({
  ProjectType: {},
  Framework: {},
  MonorepoType: {},
  FileType: {},
  TreeSitterParserService: class TreeSitterParserServiceStub {},
  AstAnalysisService: class AstAnalysisServiceStub {},
  DependencyGraphService: class DependencyGraphServiceStub {},
  WorkspaceAnalyzerService: class WorkspaceAnalyzerServiceStub {},
  ContextService: class ContextServiceStub {},
  ContextOrchestrationService: class ContextOrchestrationServiceStub {},
  WorkspaceService: class WorkspaceServiceStub {},
  TokenCounterService: class TokenCounterServiceStub {},
  FileSystemService: class FileSystemServiceStub {},
  FileSystemError: class FileSystemErrorStub extends Error {},
  ProjectDetectorService: class ProjectDetectorServiceStub {},
  FrameworkDetectorService: class FrameworkDetectorServiceStub {},
  DependencyAnalyzerService: class DependencyAnalyzerServiceStub {},
  MonorepoDetectorService: class MonorepoDetectorServiceStub {},
  PatternMatcherService: class PatternMatcherServiceStub {},
  IgnorePatternResolverService: class IgnorePatternResolverServiceStub {},
  WorkspaceIndexerService: class WorkspaceIndexerServiceStub {},
  FileTypeClassifierService: class FileTypeClassifierServiceStub {},
  FileRelevanceScorerService: class FileRelevanceScorerServiceStub {},
  ContextSizeOptimizerService: class ContextSizeOptimizerServiceStub {},
  ContextEnrichmentService: class ContextEnrichmentServiceStub {},
}));

import type {
  AgentSessionResumeConfig,
  AgentSessionStartConfig,
  SessionId,
  SessionRuntimeIdentity,
} from '@ptah-extension/shared';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { classifyCodexChatOptions, CodexChatOptionError } from '../codex-host/codex-chat-profile-options';
import { ChatSessionService } from './chat-session.service';
import { ChatRuntimeProfileService, type ResolvedChatExecution } from './chat-runtime-profile.service';

const mockCodexChatAdapterError = class LocalCodexChatAdapterError extends Error {
  constructor(
    readonly code: import('@ptah-extension/agent-sdk').CodexChatAdapterErrorCode,
    readonly operation: string,
    options?: ErrorOptions,
  ) {
    super(`Codex chat ${operation}: ${code}`, options);
    this.name = 'CodexChatAdapterError';
  }
};

jest.mock('@ptah-extension/agent-sdk', () => ({
  ...jest.requireActual<typeof import('@ptah-extension/agent-sdk')>('@ptah-extension/agent-sdk'),
  isCodexChatAdapterError: (error: unknown) => error instanceof mockCodexChatAdapterError,
}));

const sessionId = 'native-session' as SessionId;
const identity: SessionRuntimeIdentity = {
  version: 1,
  sessionId,
  runtime: 'codex-app-server',
  providerId: 'openai-codex',
  workspaceId: '/original-workspace',
  codex: { normalizedHome: '/original-home' },
};
const execution: ResolvedChatExecution = {
  runtime: 'codex-app-server',
  seed: {
    providerId: 'openai-codex',
    consumer: 'chat',
    workspacePath: '/original-workspace',
    home: '/original-home',
    normalizedHome: '/original-home',
    model: 'gpt-5.4',
  },
  workspacePath: '/original-workspace',
  cwd: '/original-workspace',
  config: {},
  modelSubstitution: {
    requested: 'default',
    used: 'gpt-5.4',
    reason: 'not-in-catalog',
  },
};

function harness() {
  const prepare = jest.fn().mockResolvedValue(execution);
  const publishRuntimeNotices = jest.fn().mockResolvedValue(undefined);
  const startChatSession = jest.fn().mockResolvedValue([]);
  const resumeSession = jest.fn().mockResolvedValue([]);
  const resolveProviderProfileForWorkspace = jest.fn(() => {
    throw new Error('Legacy auth resolution forbidden');
  });
  const service: ChatSessionService = Object.assign(
    Object.create(ChatSessionService.prototype),
    {
      logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() },
      sentryService: { captureException: jest.fn() },
      modelSettings: { selectedModel: { get: () => 'default' } },
      sdkContext: {
        resolveEnhancedPromptsContent: async () => 'instructions',
        isMcpServerRunning: () => false,
      },
      runtimeProfile: { prepare, publishRuntimeNotices },
      sdkAdapter: {
        startChatSession,
        resumeSession,
        isSessionActive: () => false,
      },
      workspaceProviderProfileResolver: { resolveProviderProfileForWorkspace },
      sessionMetadataStore: { get: async () => ({ codexExecution: identity }) },
      historyRead: { resolveSessionFolder: async () => '/original-workspace' },
      workspaceProvider: { getConfiguration: () => false },
      codeExecutionMcp: { getPort: () => undefined },
      outputStyleActivation: {
        resolveSessionFields: async () => ({ outputStyleBody: 'style' }),
      },
      streamBroadcaster: { streamEventsToWebview: jest.fn() },
      buildMcpServersOverride: async () => undefined,
    },
  );
  return {
    service,
    prepare,
    publishRuntimeNotices,
    startChatSession,
    resumeSession,
    resolveProviderProfileForWorkspace,
  };
}

describe('chat native session preparation', () => {
  let workspace: string;
  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'ptah-codex-session-'));
  });
  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  it.each([false, true])('accepts real start and resume configs with ambient user options %s', async (ambient) => {
    const h = harness();
    Object.assign(h.service, {
      sdkContext: {
        resolveEnhancedPromptsContent: async () => undefined,
        isMcpServerRunning: () => true,
      },
      workspaceProvider: createMockWorkspaceProvider({
        folders: [workspace],
      }),
      historyRead: { resolveSessionFolder: async () => workspace },
      sessionMetadataStore: {
        get: async () => ({ codexExecution: { ...identity, workspaceId: workspace } }),
      },
      platformInfo: {
        extensionPath: resolve('/codex-options-app'),
        globalStoragePath: resolve('/codex-options-storage'),
      },
      codeExecutionMcp: {
        getPort: () => 12345,
        ensureRegisteredForSubagents: async () => ({ registered: true }),
      },
      slashCommandInterceptor: { intercept: () => ({ action: 'passthrough' }) },
      outputStyleActivation: { resolveSessionFields: async () => ({}) },
    });

    const { Logger } = jest.createMockFromModule<
      typeof import('@ptah-extension/vscode-core')
    >('@ptah-extension/vscode-core');
    const deps: CodexChatHostPortsDeps = {
      resolver: { resolveExecutionProfile: jest.fn().mockResolvedValue({
        runtime: 'codex-app-server',
        seed: { ...execution.seed, workspacePath: workspace, home: workspace, normalizedHome: workspace },
      }) },
      workspaceProvider: createMockWorkspaceProvider({ folders: [workspace] }),
      platformInfo: { extensionPath: resolve('/codex-options-app'), globalStoragePath: resolve('/codex-options-storage') },
      hostCapabilities: { nativeCodex: true },
      webviewManager: { broadcastMessage: jest.fn().mockResolvedValue(undefined) },
      logger: Logger.prototype,
      platform: { platform: process.platform, arch: process.arch },
      info: {
        id: 'codex-app-server', name: 'Codex', version: '1.0.0',
        description: 'Native Codex chat test provider', vendor: 'OpenAI',
        capabilities: {
          streaming: true, fileAttachments: true, contextManagement: true,
          sessionPersistence: true, multiTurn: true, codeGeneration: true,
          imageAnalysis: true, functionCalling: true,
        },
      },
      createScope: () => { throw new Error('No process in unit tests'); },
      metadata: { save: jest.fn() },
      approvals: {
        register: jest.fn(() => () => undefined), respond: jest.fn(() => true), cancelPrompt: jest.fn(),
      },
      callbacks: () => ({ result: jest.fn(), content: jest.fn(), live: jest.fn(), compaction: jest.fn(), error: jest.fn() }),
      readResumeIdentity: async () => undefined,
      broadcaster: { streamEventsToWebview: jest.fn() },
      tabId: () => 'tab',
    };
    const ports = createCodexChatHostPorts(deps);
    const broadcastMessage = jest.mocked(deps.webviewManager.broadcastMessage);
    Object.assign(h.service, {
      runtimeProfile: new ChatRuntimeProfileService(
        deps.resolver, deps.workspaceProvider, deps.platformInfo,
        deps.webviewManager, deps.hostCapabilities,
      ),
    });
    const expectNotice = (text: string) => {
      expect(broadcastMessage).toHaveBeenCalledTimes(ambient ? 3 : 0);
      if (ambient) {
        expect(broadcastMessage).toHaveBeenNthCalledWith(2, MESSAGE_TYPES.CHAT_CHUNK,
          expect.objectContaining({ event: expect.objectContaining({ eventType: 'text_delta', delta: text }) }),
        );
        for (const [type] of broadcastMessage.mock.calls) {
          expect(type).toBe(MESSAGE_TYPES.CHAT_CHUNK);
        }
      }
      const serialized = JSON.stringify([
        broadcastMessage.mock.calls,
        ...[deps.logger, h.service['logger']].flatMap((logger) => [
          jest.mocked(logger.info).mock.calls, jest.mocked(logger.warn).mock.calls,
          jest.mocked(logger.debug).mock.calls, jest.mocked(logger.error).mock.calls,
        ]),
      ]);
      for (const value of ['https://example.invalid', 'Authorization', 'Bearer', 'secret-token-x', 'secret-token-y', 'secret-config-z', 'secret-key-z']) {
        expect(serialized).not.toContain(value);
      }
    };
    const thinking = ambient ? { type: 'adaptive' as const } : undefined;
    // Legacy Smithery URLs carry `config` and `api_key` in the query.
    const smitheryUrl = 'https://example.invalid/mcp?config=secret-config-z&api_key=secret-key-z';
    const smitheryOverrides = {
      smithery: { type: 'http' as const, url: smitheryUrl, headers: { Authorization: 'Bearer secret-token-x' } },
    };
    const oauthOverrides = {
      oauth: { type: 'http' as const, url: 'https://example.invalid/oauth', headers: { Authorization: 'Bearer secret-token-y' } },
    };
    const buildSmitheryOverrides = jest.fn().mockResolvedValue(smitheryOverrides);
    const buildOAuthOverrides = jest.fn().mockResolvedValue(oauthOverrides);
    if (ambient) {
      Object.assign(h.service, {
        buildMcpServersOverride: ChatSessionService.prototype['buildMcpServersOverride'],
        getSmitheryOverrideResolver: () => ({ buildOverrides: buildSmitheryOverrides }),
        getOAuthOverrideResolver: () => ({ buildOverrides: buildOAuthOverrides }),
        outputStyleActivation: {
          resolveSessionFields: jest.fn().mockResolvedValue({ outputStyleName: 'Explanatory' }),
        },
      });
    }

    // Mirrors message-sender.service.ts: Electron start request with no attachments,
    // effort override or persona. The session layer supplies MCP/workflow defaults.
    await expect(
      h.service.startSession({
        prompt: 'hello', tabId: 'tab', name: 'hello',
        workspacePath: workspace, ptahCliId: undefined,
        ptahUiFence: true, options: { model: 'default', ...(ambient ? { thinking } : {}) },
      }),
    ).resolves.toEqual({ success: true });
    expect(h.startChatSession).toHaveBeenCalledTimes(1);
    const started = h.startChatSession.mock.calls[0][0] as AgentSessionStartConfig;
    expect(started).toMatchObject({
      mcpServerRunning: true,
      workflowsDisabled: false,
      runtime: 'codex-app-server',
      ptahUiFence: true,
      name: 'hello',
      prompt: 'hello',
    });
    if (ambient) {
      expect(buildSmitheryOverrides).toHaveBeenCalledTimes(1);
      expect(buildOAuthOverrides).toHaveBeenCalledTimes(1);
      expect(started.mcpServersOverride).toEqual({ ...smitheryOverrides, ...oauthOverrides });
      const { stripped, supported } = classifyCodexChatOptions(started);
      expect(stripped).toEqual(expect.arrayContaining(['thinking', 'outputStyleName']));
      expect(stripped).not.toContain('mcpServersOverride');
      expect(stripped).not.toContain('mcpServerRunning');
      expect(supported).toMatchObject({ mcpServerRunning: true, mcpServersOverride: started.mcpServersOverride });
    } else {
      expect(started.mcpServersOverride).toBeUndefined();
    }
    expect(started.thinking).toEqual(thinking);
    expect(started.outputStyleName).toBe(ambient ? 'Explanatory' : undefined);
    expect(started.includePartialMessages).toBeUndefined();
    expect(started.files).toEqual([]);
    expect(started.images).toEqual([]);
    expect(started.effort).toBeUndefined();
    expect(started.systemPrompt).toBeUndefined();
    expect(classifyCodexChatOptions(started).rejected).toEqual([]);
    const startedProfile = await ports.profile(started);
    expect(startedProfile.profile.developerPrompt).toContain(PTAH_UI_HINT);
    // D8: the Smithery and OAuth servers the session layer resolved attach natively,
    // beside Ptah MCP; the profile keeps references and the values travel as secrets.
    expect(startedProfile.profile.mcpServers).toEqual([
      expect.objectContaining({ name: 'ptah', transport: 'http' }),
      ...(ambient
        ? [
            {
              name: 'smithery',
              transport: 'http',
              url: 'https://example.invalid/mcp',
              urlReference: 'mcp.smithery.url',
              headerReferences: { Authorization: 'mcp.smithery.header.0' },
            },
            {
              name: 'oauth',
              transport: 'http',
              url: 'https://example.invalid/oauth',
              headerReferences: { Authorization: 'mcp.oauth.header.0' },
            },
          ]
        : []),
    ]);
    if (ambient) {
      expect(startedProfile.secrets).toEqual(new Map([
        ['mcp.smithery.url', smitheryUrl],
        ['mcp.smithery.header.0', 'Bearer secret-token-x'],
        ['mcp.oauth.header.0', 'Bearer secret-token-y'],
      ]));
      const profileJson = JSON.stringify(startedProfile.profile);
      for (const value of ['secret-token-x', 'secret-token-y', 'secret-config-z', 'secret-key-z']) {
        expect(profileJson).not.toContain(value);
        expect(startedProfile.profile.profileFingerprint).not.toContain(value);
      }
      expect(deps.logger.info).toHaveBeenCalledWith(
        'User MCP servers are attached to Codex chat.',
        { code: 'codex-user-mcp-attached', serverNames: ['oauth', 'smithery'], transports: ['http'] },
      );
    } else {
      expect(startedProfile.secrets).toBeUndefined();
    }
    // No MCP notice line any more: only the output-style line remains.
    expectNotice("Codex chat: output style 'Explanatory' is not applied");
    broadcastMessage.mockClear();

    await expect(
      h.service['autoResumeIfInactive'](sessionId, 'tab', 'continue', {
        sessionId,
        tabId: 'tab',
        ptahUiFence: true,
        ...(ambient ? { thinking } : {}),
      }),
    ).resolves.toEqual({ justResumed: true });
    expect(h.resumeSession).toHaveBeenCalledTimes(1);
    const resumed = h.resumeSession.mock.calls[0][1] as AgentSessionResumeConfig;
    expect(resumed).toMatchObject({
      ptahUiFence: true,
      mcpServerRunning: true,
      workflowsDisabled: false,
    });
    expect(resumed.thinking).toEqual(thinking);
    expect(resumed.outputStyleName).toBe(ambient ? 'Explanatory' : undefined);
    if (ambient) {
      expect(classifyCodexChatOptions(resumed).stripped).toEqual(
        expect.arrayContaining(['thinking', 'outputStyleName']),
      );
    }
    expect(classifyCodexChatOptions(resumed).rejected).toEqual([]);
    const resumedProfile = await ports.profile(resumed);
    expect(resumedProfile.profile.developerPrompt).toContain(PTAH_UI_HINT);
    // Resume config carries the style but does not assemble user MCP overrides
    // (Claude resume parity); Ptah MCP still attaches.
    expect(resumedProfile.profile.mcpServers.map((server) => server.name)).toEqual(['ptah']);
    expectNotice("Codex chat: output style 'Explanatory' is not applied");
    if (ambient) {
      expect(deps.logger.info).not.toHaveBeenCalledWith(
        'User MCP servers are not attached to Codex chat.',
        expect.anything(),
      );
      const logs = JSON.stringify(jest.mocked(deps.logger.info).mock.calls);
      for (const value of ['https://example.invalid', 'Authorization', 'Bearer', 'secret-token-x', 'secret-token-y', 'secret-config-z', 'secret-key-z', 'adaptive', 'Explanatory']) {
        expect(logs).not.toContain(value);
      }
    }
  });

  it('prepares complete start inputs and launches through the injected adapter without legacy auth', async () => {
    const h = harness();
    await h.service['launchSdkSession']({
      logLabel: 'chat:start',
      tabId: 'tab',
      workspaceId: '/original-workspace',
      projectPath: '/original-workspace',
      prompt: 'hello',
      mcpServerRunning: false,
      mcpServersOverride: undefined,
      surfaceMode: undefined,
      options: { model: 'default', files: ['file.ts'], systemPrompt: 'system' },
    });
    expect(h.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'hello',
        files: ['file.ts'],
        systemPrompt: 'system',
        enhancedPromptsContent: 'instructions',
        outputStyleBody: 'style',
      }),
      undefined,
      false,
    );
    expect(h.startChatSession).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-5.4', runtime: 'codex-app-server' }),
    );
    expect(h.startChatSession.mock.calls[0][0]).not.toHaveProperty(
      'providerProfile',
    );
    expect(h.resolveProviderProfileForWorkspace).not.toHaveBeenCalled();
    expect(h.publishRuntimeNotices).toHaveBeenCalledTimes(1);
  });

  it('resumes with the stored identity after a workspace provider switch', async () => {
    const h = harness();
    h.resumeSession.mockImplementationOnce(async () => {
      expect(h.publishRuntimeNotices).not.toHaveBeenCalled();
      return [];
    });
    await expect(
      h.service['autoResumeIfInactive'](sessionId, 'tab', 'continue', {
        sessionId,
        tabId: 'tab',
      }),
    ).resolves.toEqual({ justResumed: true });
    expect(h.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        projectPath: '/original-workspace',
        prompt: 'continue',
      }),
      identity,
      true,
    );
    expect(h.resumeSession).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({ model: 'gpt-5.4' }),
    );
    expect(h.resumeSession.mock.calls[0][1]).not.toHaveProperty(
      'providerProfile',
    );
    expect(h.resolveProviderProfileForWorkspace).not.toHaveBeenCalled();
    expect(h.publishRuntimeNotices).toHaveBeenCalledTimes(1);
  });

  it('attaches the start stream when the model notice rejects', async () => {
    const h = harness();
    h.publishRuntimeNotices.mockRejectedValue(new Error('private broadcast detail'));
    await expect(h.service['launchSdkSession']({
      logLabel: 'chat:start', tabId: 'tab', workspaceId: '/original-workspace',
      projectPath: '/original-workspace', prompt: 'hello', mcpServerRunning: false,
      mcpServersOverride: undefined, surfaceMode: undefined,
    })).resolves.toBeUndefined();
    expect(h.service['streamBroadcaster'].streamEventsToWebview).toHaveBeenCalledWith(
      'tab', await h.startChatSession.mock.results[0].value, 'tab', undefined,
    );
    expect(h.service['logger'].warn).toHaveBeenCalledWith(
      '[RPC] Model substitution notice failed; continuing session stream',
    );
  });

  it('attaches the resumed stream when the model notice rejects', async () => {
    const h = harness();
    h.publishRuntimeNotices.mockRejectedValue(new Error('private broadcast detail'));
    await expect(h.service['autoResumeIfInactive'](sessionId, 'tab', 'continue', {
      sessionId, tabId: 'tab',
    })).resolves.toEqual({ justResumed: true });
    expect(h.service['streamBroadcaster'].streamEventsToWebview).toHaveBeenCalledWith(
      sessionId, await h.resumeSession.mock.results[0].value, 'tab', undefined,
    );
    expect(h.service['logger'].warn).toHaveBeenCalledWith(
      '[RPC] Model substitution notice failed; continuing session stream',
    );
  });

  it('never starts an adapter after a preparation refusal', async () => {
    const h = harness();
    h.prepare.mockRejectedValue(new Error('Workspace refused'));
    await expect(
      h.service['launchSdkSession']({
        logLabel: 'chat:start',
        tabId: 'tab',
        workspaceId: '/original-workspace',
        projectPath: '/original-workspace',
        prompt: 'hello',
        mcpServerRunning: false,
        mcpServersOverride: undefined,
        surfaceMode: undefined,
      }),
    ).rejects.toThrow('Workspace refused');
    expect(h.startChatSession).not.toHaveBeenCalled();
    expect(h.publishRuntimeNotices).not.toHaveBeenCalled();
  });
  it('publishes after success and publishes nothing for a second busy launch on the same tab', async () => {
    const h = harness();
    const input = {
      logLabel: 'chat:start', tabId: 'tab', workspaceId: '/original-workspace',
      projectPath: '/original-workspace', prompt: 'hello', mcpServerRunning: false,
      mcpServersOverride: undefined, surfaceMode: undefined,
    };
    h.startChatSession.mockImplementationOnce(async () => {
      expect(h.publishRuntimeNotices).not.toHaveBeenCalled();
      return [];
    });
    await h.service['launchSdkSession'](input);
    expect(h.publishRuntimeNotices).toHaveBeenCalledTimes(1);
    h.startChatSession.mockRejectedValueOnce(new Error('busy'));
    await expect(h.service['launchSdkSession'](input)).rejects.toThrow('busy');
    expect(h.publishRuntimeNotices).toHaveBeenCalledTimes(1);
  });

  it('does not publish a notice when resume fails', async () => {
    const h = harness();
    h.resumeSession.mockRejectedValue(new Error('busy'));
    await h.service['autoResumeIfInactive'](sessionId, 'tab', 'hello', { sessionId, tabId: 'tab' });
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
    const h = harness();
    Object.assign(h.service, {
      runtimeProfile,
      modelSettings: { selectedModel: { get: () => 'claude-sonnet' } },
      sessionMetadataStore: { get: async () => ({ workspaceId: workspace, providerId: 'anthropic' }) },
      historyRead: { resolveSessionFolder: async () => workspace },
    });
    await expect(h.service['autoResumeIfInactive'](sessionId, 'tab', 'hello', {
      sessionId, tabId: 'tab',
    })).resolves.toEqual({ justResumed: true });
    expect(h.resumeSession).toHaveBeenCalledWith(sessionId, expect.objectContaining({
      model: 'claude-sonnet', providerProfile: profile,
    }));
    expect(prepare).toHaveBeenCalledWith(expect.any(Object), {
      version: 1, sessionId, runtime: 'claude-sdk', providerId: 'anthropic', workspaceId: workspace,
    }, true);
    expect(resolveProviderProfileForWorkspace).toHaveBeenCalledWith(workspace, 'claude-sonnet');
    expect(broadcastMessage).not.toHaveBeenCalled();
  });

});


describe('typed Codex RPC failures', () => {
  let workspace: string;
  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'ptah-codex-errors-'));
  });
  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true });
  });

  function errorHarness(error: Error) {
    const h = harness();
    h.startChatSession.mockRejectedValue(error);
    h.resumeSession.mockRejectedValue(error);
    Object.assign(h.service, {
      workspaceProvider: createMockWorkspaceProvider({ folders: [workspace] }),
      platformInfo: { extensionPath: resolve('/codex-app'), globalStoragePath: resolve('/codex-storage') },
      slashCommandInterceptor: { intercept: () => ({ action: 'passthrough' }) },
      historyRead: {
        resolveSessionFolder: async () => workspace,
        readForResume: async () => ({ resolvedWorkspacePath: workspace, events: [], stats: null }),
      },
      subagentRegistry: {
        restoreResumableBySession: () => 0,
        registerFromHistoryEvents: () => 0,
        getResumableBySession: () => [],
      },
      ptahCli: { handleContinue: async () => ({ error: '__NOT_PTAH_CLI__' }) },
    });
    return h;
  }

  const failures = [
    { error: new mockCodexChatAdapterError('busy', 'open'), code: 'CODEX_BUSY' },
    { error: new CodexChatOptionError('temperature'), code: 'CODEX_UNSUPPORTED_OPTION', key: 'temperature' },
    { error: new mockCodexChatAdapterError('runtime-failed', 'open', { cause: new CodexChatOptionError('temperature') }), code: 'CODEX_UNSUPPORTED_OPTION', key: 'temperature' },
    { error: new mockCodexChatAdapterError('runtime-failed', 'open', { cause: new Error('SECRET-runtime-value') }), code: 'CODEX_RUNTIME_FAILED' },
    { error: new mockCodexChatAdapterError('unavailable', 'open'), code: 'CODEX_UNAVAILABLE' },
  ];

  it.each(failures)('classifies chat:start $code ($key)', async ({ error, code, key }) => {
    const h = errorHarness(error);
    const result = await h.service.startSession({ prompt: 'hello', tabId: 'tab', workspacePath: workspace });
    expect(h.startChatSession).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ success: false, errorCode: code });
    if (key) expect(result.error).toContain(`"${key}"`);
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  it.each(failures)('classifies activated chat:resume $code ($key)', async ({ error, code, key }) => {
    const h = errorHarness(error);
    const result = await h.service.resumeSession({ sessionId, tabId: 'tab', activate: true });
    expect(h.resumeSession).toHaveBeenCalledTimes(1);
    // History remains usable when runtime activation fails.
    expect(result).toMatchObject({ success: true, activated: false, activationErrorCode: code });
    if (key) expect(result.activationError).toContain(`"${key}"`);
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  it.each(failures)('classifies chat:continue auto-resume $code ($key)', async ({ error, code, key }) => {
    const h = errorHarness(error);
    const result = await h.service.continueSession({ sessionId, tabId: 'tab', prompt: 'continue' });
    expect(h.resumeSession).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ success: false, errorCode: code });
    if (key) expect(result.error).toContain(`"${key}"`);
    expect(JSON.stringify(result)).not.toContain('SECRET');
  });

  it.each(['start', 'resume', 'continue'] as const)('returns quiet cancellation from chat:%s', async (method) => {
    const h = errorHarness(new mockCodexChatAdapterError('cancelled', 'open'));
    const result = method === 'start'
      ? await h.service.startSession({ prompt: 'hello', tabId: 'tab', workspacePath: workspace })
      : method === 'resume'
        ? await h.service.resumeSession({ sessionId, tabId: 'tab', activate: true })
        : await h.service.continueSession({ sessionId, tabId: 'tab', prompt: 'continue' });
    expect(result).toEqual({ success: false, cancelled: true });
    expect(h.service['logger'].error).not.toHaveBeenCalled();
    expect(h.service['logger'].warn).not.toHaveBeenCalled();
    expect(h.service['sentryService'].captureException).not.toHaveBeenCalled();
  });

  function compactRouter(error: Error) {
    const compact = jest.fn().mockRejectedValue(error);
    const router: ChatSlashCommandRouterService = Object.assign(
      Object.create(ChatSlashCommandRouterService.prototype),
      {
        logger: { info: jest.fn(), warn: jest.fn() },
        slashCommandInterceptor: { intercept: () => ({ action: 'new-query', commandName: 'compact', rawCommand: '/compact' }) },
        sdkContext: { isMcpServerRunning: () => false, resolveEnhancedPromptsContent: async () => undefined },
        modelSettings: { selectedModel: { get: () => 'default' } },
        runtimeProfile: { prepare: async () => execution },
        runtimeControls: { compact },
      },
    );
    return { router, compact };
  }

  it('marks a broadcast compact failure settled instead of returning a duplicate message', async () => {
    const { router, compact } = compactRouter(new mockCodexChatAdapterError('runtime-failed', 'compact'));
    await expect(router.routeFollowUpSlashCommand('/compact', sessionId, 'tab', workspace, {
      sessionId, tabId: 'tab', prompt: '/compact',
    })).resolves.toEqual({ success: false, sessionId, settled: true, errorCode: 'CODEX_RUNTIME_FAILED' });
    expect(compact).toHaveBeenCalledTimes(1);
  });

  it('leaves compact busy admission visible to the outer typed RPC handler', async () => {
    const error = new mockCodexChatAdapterError('busy', 'compact');
    const { router } = compactRouter(error);
    await expect(router.routeFollowUpSlashCommand('/compact', sessionId, 'tab', workspace, {
      sessionId, tabId: 'tab', prompt: '/compact',
    })).rejects.toBe(error);
  });
});
