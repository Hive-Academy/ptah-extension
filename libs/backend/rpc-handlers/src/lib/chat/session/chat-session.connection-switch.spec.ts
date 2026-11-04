import 'reflect-metadata';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { WorkspaceProviderProfileResolver } from '@ptah-extension/auth-providers';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import type { SessionId } from '@ptah-extension/shared';
import { ConnectionSettingsMethods } from '../../handlers/auth/connection-settings-methods';
import { ChatRuntimeProfileService } from './chat-runtime-profile.service';
import { ChatSessionService } from './chat-session.service';

jest.mock('@ptah-extension/workspace-intelligence', () => ({
  ProjectType: {}, Framework: {}, MonorepoType: {}, FileType: {},
  TreeSitterParserService: class {}, AstAnalysisService: class {},
  DependencyGraphService: class {}, WorkspaceAnalyzerService: class {},
  ContextService: class {}, ContextOrchestrationService: class {},
  WorkspaceService: class {}, TokenCounterService: class {},
  FileSystemService: class {}, FileSystemError: class extends Error {},
  ProjectDetectorService: class {}, FrameworkDetectorService: class {},
  DependencyAnalyzerService: class {}, MonorepoDetectorService: class {},
  PatternMatcherService: class {}, IgnorePatternResolver: class {},
  WorkspaceIndexerService: class {}, FileTypeClassifierService: class {},
  FileRelevanceScorerService: class {}, ContextSizeOptimizerService: class {},
  ContextEnrichmentService: class {},
}));

const workspace = mkdtempSync(join(tmpdir(), 'ptah-connection-switch-'));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));
const sessionId = 'before-switch' as SessionId;

describe('chat host routing after a connection switch', () => {
  it.each(['global', 'workspace'] as const)('%s settings keep a stored Claude session on its original provider', async (applyTo) => {
    const store: { authMethod: 'claudeCli' | 'thirdParty'; anthropicProviderId: string } = {
      authMethod: 'claudeCli', anthropicProviderId: 'anthropic',
    };
    const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn(), error: jest.fn() };
    const reset = jest.fn().mockResolvedValue(undefined);
    const applyWorkspaceAuthChange = jest.fn(async (_path: string, write: () => Promise<void>) => write());
    const startChatSession = jest.fn().mockResolvedValue([]);
    const resumeSession = jest.fn().mockResolvedValue([]);
    const withCodexStartLineage = jest.fn(<T>(_roots: readonly string[], launch: () => Promise<T>) => launch());
    const upgradeLegacyPluginConfigAncestorRoots = jest.fn().mockResolvedValue({ status: 'valid', roots: [] });
    const resolveActiveAuthForPath = jest.fn(() => ({ providerId: store.anthropicProviderId }));
    const resolveActiveAuthWithDefault = jest.fn().mockImplementation(async () => ({ providerId: store.anthropicProviderId }));
    const resolveProviderProfileForWorkspace = jest.fn().mockResolvedValue(undefined);
    const resolver: WorkspaceProviderProfileResolver = Object.assign(
      Object.create(WorkspaceProviderProfileResolver.prototype),
      {
        activeProviderResolver: { resolveActiveAuthForPath, resolveActiveAuthWithDefault },
        codexHome: { path: resolve('/codex-home') },
        resolveStoredModel: () => 'claude-sonnet',
        resolveProviderProfileForWorkspace,
      },
    );
    const runtimeProfile = new ChatRuntimeProfileService(
      resolver,
      createMockWorkspaceProvider({ folders: [workspace] }),
      { extensionPath: resolve('/application'), globalStoragePath: resolve('/storage') },
      { broadcastMessage: jest.fn().mockResolvedValue(undefined) },
      { nativeCodex: true },
    );
    const prepare = jest.spyOn(runtimeProfile, 'prepare');
    const registered = new Map<string, (params: unknown) => Promise<unknown>>();
    const settings = new ConnectionSettingsMethods({
      logger,
      rpcHandler: { registerMethod: (name: string, handler: (params: unknown) => Promise<unknown>) => registered.set(name, handler) },
      sentryService: { captureException: jest.fn() },
      sdkAdapter: { reset, applyWorkspaceAuthChange },
      scopeResolver: {
        getActivePath: () => workspace,
        write: async (key: string, value: string) => { if (key === 'authMethod') store.authMethod = value as typeof store.authMethod; if (key === 'anthropicProviderId') store.anthropicProviderId = value; },
        clearMoreSpecific: jest.fn().mockResolvedValue(undefined),
      },
      authSecretsService: {},
      providerModels: { getModelTiers: () => ({}), setModelTier: jest.fn().mockResolvedValue(undefined), clearCache: jest.fn() },
      connectionChecks: { clear: jest.fn() },
      connectionChecker: {},
      invalidateAuthStatusCache: jest.fn(),
    } as unknown as ConstructorParameters<typeof ConnectionSettingsMethods>[0]);
    settings.registerSaveSettings();
    const saveSettings = registered.get('auth:saveSettings');
    expect(saveSettings).toBeDefined();

    const service: ChatSessionService = Object.assign(Object.create(ChatSessionService.prototype), {
      logger,
      sentryService: { captureException: jest.fn() },
      subagentRegistry: { isResumeStateHydrated: () => true, getInterruptedBySession: () => [] },
      modelSettings: { selectedModel: { get: () => 'default' } },
      sdkContext: { resolveEnhancedPromptsContent: async () => 'instructions', isMcpServerRunning: () => false },
      runtimeProfile,
      sdkAdapter: { startChatSession, resumeSession, isSessionActive: () => false },
      sessionMetadataStore: {
        get: async () => ({ workspaceId: workspace, providerId: 'anthropic' }),
        withCodexStartLineage, upgradeLegacyPluginConfigAncestorRoots,
      },
      historyRead: { resolveSessionFolder: async () => workspace },
      workspaceProvider: createMockWorkspaceProvider({ folders: [workspace] }),
      platformInfo: { extensionPath: resolve('/application'), globalStoragePath: resolve('/storage') },
      pendingLineage: new Map(),
      codeExecutionMcp: { getPort: () => undefined },
      outputStyleActivation: { resolveSessionFields: async () => ({}) },
      streamBroadcaster: { streamEventsToWebview: jest.fn() },
      buildMcpServersOverride: async () => undefined,
    });
    const launch = (prompt: string) => service['launchSdkSession']({
      logLabel: 'chat:start', tabId: 'tab', workspaceId: workspace,
      projectPath: workspace, prompt, mcpServerRunning: false,
      mcpServersOverride: undefined, surfaceMode: undefined,
    });

    // 1. A Claude connection starts on the Claude SDK.
    await launch('before switch');
    expect(startChatSession).toHaveBeenCalledWith(expect.objectContaining({ runtime: 'claude-sdk' }));
    expect(startChatSession).toHaveBeenCalledTimes(1);

    // 2. Save the new connection at the selected scope through the real RPC handler.
    await expect(saveSettings!({ authMethod: 'thirdParty', anthropicProviderId: 'openai-codex', applyTo }))
      .resolves.toEqual({ success: true });
    expect(store).toEqual({ authMethod: 'thirdParty', anthropicProviderId: 'openai-codex' });
    if (applyTo === 'global') {
      expect(reset).toHaveBeenCalledTimes(1);
      expect(applyWorkspaceAuthChange).not.toHaveBeenCalled();
    } else {
      expect(reset).not.toHaveBeenCalled();
      expect(applyWorkspaceAuthChange).toHaveBeenCalledWith(workspace, expect.any(Function));
    }

    // 3. A new chat routes to native Codex, leaving the Claude start count at one.
    await launch('after switch');
    expect(startChatSession).toHaveBeenLastCalledWith(expect.objectContaining({ runtime: 'codex-app-server' }));
    expect(startChatSession).toHaveBeenCalledTimes(2);
    expect(startChatSession.mock.calls.filter(([config]) => config.runtime === 'claude-sdk')).toHaveLength(1);
    expect(prepare).toHaveBeenLastCalledWith(expect.any(Object), undefined, true);
    expect(resolveActiveAuthForPath).toHaveBeenCalledWith(workspace);

    // 4. Continuing the original session refuses its stored provider before adapter resume.
    await expect(service['autoResumeIfInactive'](sessionId, 'tab', 'continue', {
      sessionId, tabId: 'tab',
    })).resolves.toMatchObject({ error: {
      success: false, sessionId, errorCode: 'AUTH_REQUIRED',
      error: expect.stringContaining('provider (anthropic) differs'),
      providerId: 'anthropic',
    } });
    expect(resumeSession).not.toHaveBeenCalled();
    expect(prepare).toHaveBeenLastCalledWith(expect.any(Object), {
      version: 1, sessionId, runtime: 'claude-sdk', providerId: 'anthropic', workspaceId: workspace,
    }, true);
    expect(resolveActiveAuthWithDefault).toHaveBeenCalledWith(undefined, workspace);
  });
});
