import 'reflect-metadata';
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
import { classifyCodexChatOptions } from '../codex-host/codex-chat-profile-options';
import { ChatSessionService } from './chat-session.service';
import { ChatRuntimeProfileService, type ResolvedChatExecution } from './chat-runtime-profile.service';

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
  const publishModelSubstitution = jest.fn().mockResolvedValue(undefined);
  const startChatSession = jest.fn().mockResolvedValue([]);
  const resumeSession = jest.fn().mockResolvedValue([]);
  const resolveProviderProfileForWorkspace = jest.fn(() => {
    throw new Error('Legacy auth resolution forbidden');
  });
  const service: ChatSessionService = Object.assign(
    Object.create(ChatSessionService.prototype),
    {
      logger: { info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
      modelSettings: { selectedModel: { get: () => 'default' } },
      sdkContext: {
        resolveEnhancedPromptsContent: async () => 'instructions',
        isMcpServerRunning: () => false,
      },
      runtimeProfile: { prepare, publishModelSubstitution },
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
    publishModelSubstitution,
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

  it('accepts the real default start and resume configs with host MCP running', async () => {
    const h = harness();
    h.prepare.mockResolvedValue({
      ...execution,
      seed: { ...execution.seed, workspacePath: workspace },
      workspacePath: workspace,
      cwd: workspace,
    });
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

    // Mirrors message-sender.service.ts: Electron start request with no attachments,
    // effort override or persona. The session layer supplies MCP/workflow defaults.
    await expect(
      h.service.startSession({
        prompt: 'hello', tabId: 'tab', name: 'hello',
        workspacePath: workspace, ptahCliId: undefined,
        ptahUiFence: true, options: { model: 'default' },
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
    expect(started.mcpServersOverride).toBeUndefined();
    expect(started.thinking).toBeUndefined();
    expect(started.outputStyleName).toBeUndefined();
    expect(started.includePartialMessages).toBeUndefined();
    expect(started.files).toEqual([]);
    expect(started.images).toEqual([]);
    expect(started.effort).toBeUndefined();
    expect(started.systemPrompt).toBeUndefined();
    expect(classifyCodexChatOptions(started).rejected).toEqual([]);
    expect((await ports.profile(started)).profile.developerPrompt).toContain(PTAH_UI_HINT);

    await expect(
      h.service['autoResumeIfInactive'](sessionId, 'tab', 'continue', {
        sessionId,
        tabId: 'tab',
        ptahUiFence: true,
      }),
    ).resolves.toEqual({ justResumed: true });
    expect(h.resumeSession).toHaveBeenCalledTimes(1);
    const resumed = h.resumeSession.mock.calls[0][1] as AgentSessionResumeConfig;
    expect(resumed).toMatchObject({
      ptahUiFence: true,
      mcpServerRunning: true,
      workflowsDisabled: false,
    });
    expect(resumed.thinking).toBeUndefined();
    expect(resumed.outputStyleName).toBeUndefined();
    expect(classifyCodexChatOptions(resumed).rejected).toEqual([]);
    expect((await ports.profile(resumed)).profile.developerPrompt).toContain(PTAH_UI_HINT);
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
    expect(h.publishModelSubstitution).toHaveBeenCalledTimes(1);
  });

  it('resumes with the stored identity after a workspace provider switch', async () => {
    const h = harness();
    h.resumeSession.mockImplementationOnce(async () => {
      expect(h.publishModelSubstitution).not.toHaveBeenCalled();
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
    expect(h.publishModelSubstitution).toHaveBeenCalledTimes(1);
  });

  it('attaches the start stream when the model notice rejects', async () => {
    const h = harness();
    h.publishModelSubstitution.mockRejectedValue(new Error('private broadcast detail'));
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
    h.publishModelSubstitution.mockRejectedValue(new Error('private broadcast detail'));
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
    expect(h.publishModelSubstitution).not.toHaveBeenCalled();
  });
  it('publishes after success and publishes nothing for a second busy launch on the same tab', async () => {
    const h = harness();
    const input = {
      logLabel: 'chat:start', tabId: 'tab', workspaceId: '/original-workspace',
      projectPath: '/original-workspace', prompt: 'hello', mcpServerRunning: false,
      mcpServersOverride: undefined, surfaceMode: undefined,
    };
    h.startChatSession.mockImplementationOnce(async () => {
      expect(h.publishModelSubstitution).not.toHaveBeenCalled();
      return [];
    });
    await h.service['launchSdkSession'](input);
    expect(h.publishModelSubstitution).toHaveBeenCalledTimes(1);
    h.startChatSession.mockRejectedValueOnce(new Error('busy'));
    await expect(h.service['launchSdkSession'](input)).rejects.toThrow('busy');
    expect(h.publishModelSubstitution).toHaveBeenCalledTimes(1);
  });

  it('does not publish a notice when resume fails', async () => {
    const h = harness();
    h.resumeSession.mockRejectedValue(new Error('busy'));
    await h.service['autoResumeIfInactive'](sessionId, 'tab', 'hello', { sessionId, tabId: 'tab' });
    expect(h.publishModelSubstitution).not.toHaveBeenCalled();
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
