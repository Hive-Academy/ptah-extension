import 'reflect-metadata';
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

import type { SessionId, SessionRuntimeIdentity } from '@ptah-extension/shared';
import { ChatSessionService } from './chat-session.service';
import type { ResolvedChatExecution } from './chat-runtime-profile.service';

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
    );
    expect(h.startChatSession).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-5.4' }),
    );
    expect(h.startChatSession.mock.calls[0][0]).not.toHaveProperty(
      'providerProfile',
    );
    expect(h.resolveProviderProfileForWorkspace).not.toHaveBeenCalled();
    expect(h.publishModelSubstitution).toHaveBeenCalledTimes(1);
  });

  it('resumes with the stored identity after a workspace provider switch', async () => {
    const h = harness();
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
});
