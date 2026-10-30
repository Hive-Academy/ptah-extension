import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
/**
 * ChatSessionService / ChatSlashCommandRouterService — every chat session is
 * pinned to its own workspace's provider (TASK_PROVIDER_SCOPE follow-up).
 *
 * `chat:start`, the `chat:continue` resume and the slash-command relaunch all
 * take their provider profile from
 * `WorkspaceProviderProfileResolver.resolveProviderProfileForWorkspace`, which
 * builds a snapshot for workspaces with AND without an override of their own,
 * and throws `AuthRequiredError` instead of letting the session ride a shared
 * auth env configured for a different provider. These specs pin the chat
 * layer's half: the profile reaches the adapter (→ `authEnvOverride`), and a
 * refusal surfaces as AUTH_REQUIRED without starting anything.
 */

import 'reflect-metadata';

// `ChatSessionService` imports `@ptah-extension/cli-agent-runtime`, whose barrel
// transitively pulls `@ptah-extension/workspace-intelligence` (top-level
// `import.meta.url`, which ts-jest's CJS transform cannot parse). Stub it.
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
  Logger,
  ConfigManager,
  SentryService,
  SubagentRegistryService,
} from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type {
  IAgentAdapter,
  ProviderProfile,
  SessionId,
} from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import type { ModelSettings } from '@ptah-extension/settings-core';
import { AuthRequiredError } from '@ptah-extension/agent-sdk';

import { createMockModelSettings } from '../../../test-utils/mock-settings';
import { ChatContinueParamsSchema } from '../../handlers/chat-rpc.schema';
import { ChatSessionService } from './chat-session.service';
import { ChatSlashCommandRouterService } from './chat-slash-command-router.service';
import { SessionMcpStatusRegistry } from './session-mcp-status.registry';

const TEST_ROOT = mkdtempSync(join(tmpdir(), 'ptah-policy-fixture-'));
afterAll(() => rmSync(TEST_ROOT, { recursive: true, force: true }));
mkdirSync(join(TEST_ROOT, 'no-override-workspace'), { recursive: true });
const OPEN_FOLDER = `${TEST_ROOT}/no-override-workspace`;
const SESSION_ID = 'b5399ba8-e06d-417c-bac4-aba5add0555c' as SessionId;
const TAB_ID = 'f69cb197-0798-40bc-ac0c-6f7591e0a894';

/** The global/app snapshot a workspace without an override resolves to. */
const GLOBAL_SNAPSHOT: ProviderProfile = {
  providerId: 'kimi-code',
  authEnv: {
    ANTHROPIC_BASE_URL: 'https://api.kimi.ai/coding/',
    ANTHROPIC_AUTH_TOKEN: 'ms-key',
    ANTHROPIC_API_KEY: '',
  },
  model: 'kimi-k2.5',
};

const REFUSAL = new AuthRequiredError(
  'Cannot start this session: Kimi Code is not ready for this workspace, and the active connection uses a different provider.',
  { providerId: 'kimi-code' },
);

function emptyStream(): AsyncIterable<never> {
  return (async function* () {
    /* no events */
  })();
}

interface Harness {
  sendMessageToSession: jest.Mock;
  handleContinue: jest.Mock;
  service: ChatSessionService;
  metadataGet: jest.Mock;
  resolve: jest.Mock;
  startChatSession: jest.Mock;
  resumeSession: jest.Mock;
  executeSlashCommand: jest.Mock;
  resolveStoredModel: jest.Mock;
  storedModel: jest.Mock;
}

function makeHarness(resolve: jest.Mock): Harness {
  const sendMessageToSession = jest.fn().mockResolvedValue(undefined);
  const handleContinue = jest
    .fn()
    .mockResolvedValue({ error: '__NOT_PTAH_CLI__' });
  const noop = jest.fn();
  const metadataGet = jest.fn().mockResolvedValue(null);
  const startChatSession = jest.fn().mockResolvedValue(emptyStream());
  const resumeSession = jest.fn().mockResolvedValue(emptyStream());
  const executeSlashCommand = jest.fn().mockResolvedValue(emptyStream());
  const sdkAdapter = {
    startChatSession,
    resumeSession,
    executeSlashCommand,
    isSessionActive: jest.fn().mockReturnValue(false),
    sendMessageToSession,
    endSession: jest.fn(),
    interruptSession: jest.fn().mockResolvedValue(undefined),
    interruptCurrentTurn: jest.fn().mockResolvedValue(true),
  } as unknown as IAgentAdapter;
  const resolveStoredModel = jest.fn(
    (_path: string, model: string) => model || 'default',
  );
  const resolver = {
    resolveStoredModel,
    resolveProviderProfileForWorkspace: resolve,
  } as never;
  const modelSettings = createMockModelSettings();
  const sdkContext = {
    isMcpServerRunning: jest.fn().mockReturnValue(false),
    resolveEnhancedPromptsContent: jest.fn().mockResolvedValue(undefined),
    resolvePluginPaths: jest.fn().mockReturnValue([]),
  } as never;
  const streamBroadcaster = {
    streamEventsToWebview: jest.fn(),
    isStreaming: jest.fn().mockReturnValue(false),
  } as never;

  const router = new ChatSlashCommandRouterService(
    createMockLogger() as unknown as Logger,
    { broadcastMessage: noop } as never,
    modelSettings as unknown as ModelSettings,
    sdkAdapter,
    {
      intercept: jest
        .fn()
        .mockReturnValue({ action: 'new-query', rawCommand: '/compact' }),
    } as never,
    sdkContext,
    streamBroadcaster,
    resolver,
  );
  type RouteArgs = Parameters<
    ChatSlashCommandRouterService['routeFollowUpSlashCommand']
  >;

  const service = new ChatSessionService(
    createMockLogger() as unknown as Logger,
    { broadcastMessage: noop } as never,
    {
      get: noop,
      getWithDefault: jest.fn().mockReturnValue(false),
    } as unknown as ConfigManager,
    sdkAdapter,
    { captureException: jest.fn() } as unknown as SentryService,
    {
      getPort: jest.fn().mockReturnValue(0),
      ensureRegisteredForSubagents: jest
        .fn()
        .mockResolvedValue({ registered: true }),
    } as never,
    {
      resolveSessionFolder: jest.fn().mockResolvedValue(OPEN_FOLDER),
      readForResume: jest.fn().mockResolvedValue({
        resolvedWorkspacePath: OPEN_FOLDER,
        events: [],
        stats: null,
      }),
    } as never,
    {
      restoreResumableBySession: jest.fn().mockReturnValue(0),
      hydrateResumeState: jest.fn().mockReturnValue(0),
      isResumeStateHydrated: jest.fn().mockReturnValue(true),
      getInterruptedBySession: jest.fn().mockReturnValue([]),
      registerFromHistoryEvents: jest.fn().mockReturnValue(0),
      getResumableBySession: jest.fn().mockReturnValue([]),
    } as unknown as SubagentRegistryService,
    {
      intercept: jest.fn().mockReturnValue({ action: 'passthrough' }),
    } as never,
    {
      get: metadataGet,
      getCliSessionsForRestore: jest.fn().mockResolvedValue([]),
      saveResumeState: jest.fn().mockResolvedValue(undefined),
    } as never,
    createMockWorkspaceProvider({
      folders: [OPEN_FOLDER],
    }) as unknown as IWorkspaceProvider,
    {
      type: 'cli',
      extensionPath: '/tmp/ptah-app',
      globalStoragePath: '/tmp/ptah-storage',
      workspaceStoragePath: '/tmp/ptah-workspace-storage',
    } as never,
    sdkContext,
    {
      handleContinue,
    } as never,
    streamBroadcaster,
    {
      injectInterruptedAgentsContext: jest
        .fn()
        .mockImplementation(async (prompt: string) => ({
          prompt,
          injected: false,
          commit: async () => undefined,
          release: () => undefined,
        })),
    } as never,
    // Plain prompts pass through; a slash prompt is routed for real.
    {
      routeFollowUpSlashCommand: (...args: RouteArgs) =>
        args[0].startsWith('/')
          ? router.routeFollowUpSlashCommand(...args)
          : Promise.resolve(null),
    } as never,
    modelSettings as unknown as ModelSettings,
    {
      getProviderKey: jest.fn().mockResolvedValue(null),
      setProviderKey: jest.fn().mockResolvedValue(undefined),
      deleteProviderKey: jest.fn().mockResolvedValue(undefined),
    } as never,
    resolver,
    { resolveSessionFields: jest.fn().mockResolvedValue({}) } as never,
    new SessionMcpStatusRegistry(),
    { register: jest.fn().mockReturnValue(() => undefined) } as never,
    { register: jest.fn().mockReturnValue(() => undefined) } as never,
  );

  return {
    sendMessageToSession,
    handleContinue,
    service,
    metadataGet,
    resolve,
    startChatSession,
    resumeSession,
    executeSlashCommand,
    resolveStoredModel,
    storedModel: modelSettings.selectedModel.get,
  };
}

describe('chat:resume stored provider', () => {
  it('returns metadata identity and leaves old sessions unknown', async () => {
    const h = makeHarness(jest.fn().mockResolvedValue(GLOBAL_SNAPSHOT));
    // resumeSession reads metadata twice (account gate, then identity), so
    // stub per call rather than per read.
    h.metadataGet.mockResolvedValue({ providerId: 'openrouter' });
    const params = {
      sessionId: SESSION_ID,
      tabId: TAB_ID,
      workspacePath: OPEN_FOLDER,
    };
    expect((await h.service.resumeSession(params)).providerId).toBe(
      'openrouter',
    );
    h.metadataGet.mockResolvedValue(null);
    expect((await h.service.resumeSession(params)).providerId).toBeUndefined();
  });
});

const continueParams = (prompt: string) => ({
  prompt,
  sessionId: SESSION_ID,
  tabId: TAB_ID,
  workspacePath: OPEN_FOLDER,
});

describe('chat:continue prompt identity', () => {
  const clientMessageId = 'msg_123_Ab-9';

  it.each([undefined, 'a', clientMessageId, 'a'.repeat(64)])(
    'accepts an optional valid client id: %s',
    (id) => {
      const parsed = ChatContinueParamsSchema.parse({
        ...continueParams('More'),
        clientMessageId: id,
      });
      expect(parsed.clientMessageId).toBe(id);
    },
  );

  it.each(['', 'a'.repeat(65), 'with space', 'a.b', 'é', null, 123])(
    'rejects an invalid client id: %s',
    (id) => {
      expect(
        ChatContinueParamsSchema.safeParse({
          ...continueParams('More'),
          clientMessageId: id,
        }).success,
      ).toBe(false);
    },
  );

  it.each([undefined, clientMessageId])(
    'forwards the client id and acknowledges queue admission: %s',
    async (id) => {
      const h = makeHarness(jest.fn().mockResolvedValue(GLOBAL_SNAPSHOT));
      const result = await h.service.continueSession({
        ...continueParams('More'),
        clientMessageId: id,
      });
      expect(h.sendMessageToSession).toHaveBeenCalledWith(SESSION_ID, 'More', {
        files: [],
        images: [],
        clientMessageId: id,
      });
      expect(result).toEqual({
        success: true,
        sessionId: SESSION_ID,
        enqueued: true,
      });
    },
  );

  it('does not acknowledge queue admission for a routed slash command', async () => {
    const h = makeHarness(jest.fn().mockResolvedValue(GLOBAL_SNAPSHOT));
    const result = await h.service.continueSession({
      ...continueParams('/compact'),
      clientMessageId,
    });
    expect(result.success).toBe(true);
    expect(result).not.toHaveProperty('enqueued');
    expect(h.sendMessageToSession).not.toHaveBeenCalled();
  });

  it('does not acknowledge queue admission for a Ptah CLI continuation', async () => {
    const h = makeHarness(jest.fn().mockResolvedValue(GLOBAL_SNAPSHOT));
    h.handleContinue.mockResolvedValue({
      success: true,
      sessionId: SESSION_ID,
    });
    const result = await h.service.continueSession({
      ...continueParams('More'),
      clientMessageId,
    });
    expect(result).toEqual({ success: true, sessionId: SESSION_ID });
    expect(h.sendMessageToSession).not.toHaveBeenCalled();
    expect(h.resumeSession).not.toHaveBeenCalled();
  });

  it('does not acknowledge queue admission when sending fails', async () => {
    const h = makeHarness(jest.fn().mockResolvedValue(GLOBAL_SNAPSHOT));
    h.sendMessageToSession.mockRejectedValue(new Error('Send failed'));
    const result = await h.service.continueSession({
      ...continueParams('More'),
      clientMessageId,
    });
    expect(result).toMatchObject({ success: false, error: 'Send failed' });
    expect(result).not.toHaveProperty('enqueued');
  });
});

describe('chat sessions in a workspace without its own override', () => {
  it('chat:start hands the global/app snapshot to the adapter', async () => {
    const h = makeHarness(jest.fn().mockResolvedValue(GLOBAL_SNAPSHOT));

    const result = await h.service.startSession({
      tabId: TAB_ID,
      prompt: 'Hello',
      workspacePath: OPEN_FOLDER,
    });

    expect(result.success).toBe(true);
    expect(h.resolve).toHaveBeenCalledWith(OPEN_FOLDER, expect.any(String));
    const [config] = h.startChatSession.mock.calls[0];
    expect(config.providerProfile).toBe(GLOBAL_SNAPSHOT);
    expect(config.providerProfile.authEnv).toBeDefined();
  });

  it('chat:continue resumes an inactive session on the global/app snapshot', async () => {
    const h = makeHarness(jest.fn().mockResolvedValue(GLOBAL_SNAPSHOT));

    const result = await h.service.continueSession(continueParams('More'));

    expect(result.success).toBe(true);
    expect(h.resolve).toHaveBeenCalledWith(OPEN_FOLDER, expect.any(String));
    const [, config] = h.resumeSession.mock.calls[0];
    expect(config.providerProfile).toBe(GLOBAL_SNAPSHOT);
  });

  it('a slash-command relaunch carries the snapshot to the adapter', async () => {
    const h = makeHarness(jest.fn().mockResolvedValue(GLOBAL_SNAPSHOT));

    const result = await h.service.continueSession(continueParams('/compact'));

    expect(result).toEqual({ success: true, sessionId: SESSION_ID });
    expect(h.resumeSession).not.toHaveBeenCalled();
    const [, , config] = h.executeSlashCommand.mock.calls[0];
    expect(config.providerProfile).toBe(GLOBAL_SNAPSHOT);
  });
});

describe('fail closed: no snapshot and the shared env serves another provider', () => {
  it('chat:start returns AUTH_REQUIRED and starts nothing', async () => {
    const h = makeHarness(jest.fn().mockRejectedValue(REFUSAL));

    const result = await h.service.startSession({
      tabId: TAB_ID,
      prompt: 'Hello',
      workspacePath: OPEN_FOLDER,
    });

    expect(result).toMatchObject({
      success: false,
      errorCode: 'AUTH_REQUIRED',
      providerId: 'kimi-code',
      error: REFUSAL.message,
    });
    expect(h.startChatSession).not.toHaveBeenCalled();
  });

  it('chat:continue returns AUTH_REQUIRED and resumes nothing', async () => {
    const h = makeHarness(jest.fn().mockRejectedValue(REFUSAL));

    const result = await h.service.continueSession(continueParams('More'));

    expect(result).toMatchObject({
      success: false,
      errorCode: 'AUTH_REQUIRED',
      providerId: 'kimi-code',
    });
    expect(h.resumeSession).not.toHaveBeenCalled();
  });

  it('a slash-command relaunch returns AUTH_REQUIRED and runs nothing', async () => {
    const h = makeHarness(jest.fn().mockRejectedValue(REFUSAL));

    const result = await h.service.continueSession(continueParams('/compact'));

    expect(result).toMatchObject({
      success: false,
      errorCode: 'AUTH_REQUIRED',
      providerId: 'kimi-code',
    });
    expect(h.executeSlashCommand).not.toHaveBeenCalled();
  });
});

describe('no snapshot, shared env serves the same provider', () => {
  it('chat:start proceeds without a profile (the shared env is used)', async () => {
    const h = makeHarness(jest.fn().mockResolvedValue(undefined));

    const result = await h.service.startSession({
      tabId: TAB_ID,
      prompt: 'Hello',
      workspacePath: OPEN_FOLDER,
    });

    expect(result.success).toBe(true);
    const [config] = h.startChatSession.mock.calls[0];
    expect(config.providerProfile).toBeUndefined();
  });
});

describe('the stored model is checked against the workspace provider', () => {
  // The stored model belongs to whatever provider was active when it was
  // saved; a send without its own `model` must not carry e.g. a Codex id to
  // Anthropic. `resolveStoredModel` decides, and its answer is what runs.
  function withStaleStoredModel(): Harness {
    const h = makeHarness(jest.fn().mockResolvedValue(undefined));
    h.storedModel.mockReturnValue('gpt-6-luna');
    h.resolveStoredModel.mockReturnValue('default');
    return h;
  }

  it('chat:start runs on the checked model, not the stored one', async () => {
    const h = withStaleStoredModel();

    await h.service.startSession({
      tabId: TAB_ID,
      prompt: 'Hello',
      workspacePath: OPEN_FOLDER,
    });

    expect(h.resolveStoredModel).toHaveBeenCalledWith(
      OPEN_FOLDER,
      'gpt-6-luna',
    );
    expect(h.resolve).toHaveBeenCalledWith(OPEN_FOLDER, 'default');
    const [config] = h.startChatSession.mock.calls[0];
    expect(config.model).toBe('default');
  });

  it('chat:start keeps an explicit request model without the check', async () => {
    const h = withStaleStoredModel();

    await h.service.startSession({
      tabId: TAB_ID,
      prompt: 'Hello',
      workspacePath: OPEN_FOLDER,
      options: { model: 'claude-sonnet-5-5' },
    });

    expect(h.resolveStoredModel).not.toHaveBeenCalled();
    const [config] = h.startChatSession.mock.calls[0];
    expect(config.model).toBe('claude-sonnet-5-5');
  });

  it('chat:continue resumes on the checked model', async () => {
    const h = withStaleStoredModel();

    await h.service.continueSession(continueParams('More'));

    expect(h.resolveStoredModel).toHaveBeenCalledWith(
      OPEN_FOLDER,
      'gpt-6-luna',
    );
    const [, config] = h.resumeSession.mock.calls[0];
    expect(config.model).toBe('default');
  });

  it('a slash-command relaunch runs on the checked model', async () => {
    const h = withStaleStoredModel();

    await h.service.continueSession(continueParams('/compact'));

    expect(h.resolveStoredModel).toHaveBeenCalledWith(
      OPEN_FOLDER,
      'gpt-6-luna',
    );
    expect(h.resolve).toHaveBeenCalledWith(OPEN_FOLDER, 'default');
    const [, , config] = h.executeSlashCommand.mock.calls[0];
    expect(config.sessionConfig.model).toBe('default');
  });
});
