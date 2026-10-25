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

import type { Logger } from '@ptah-extension/vscode-core';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';
import type { ProviderAccountBinding, SessionId } from '@ptah-extension/shared';
import { SessionMetadataStore } from '@ptah-extension/agent-sdk';
import { createMockModelSettings } from '../../../test-utils/mock-settings';
import { ChatSessionService } from './chat-session.service';
import { ChildChatSessionHostAdapter } from './child-chat-session-host.adapter';
import {
  ChatSlashCommandRouterService,
  gateMainSessionAccount,
  mainSessionAccountFailure,
} from './chat-slash-command-router.service';
import { SessionMcpStatusRegistry } from './session-mcp-status.registry';

const ROOT = '/c/projects/account-binding';
const SESSION = 'b5399ba8-e06d-417c-bac4-aba5add0555c' as SessionId;
const TAB = 'f69cb197-0798-40bc-ac0c-6f7591e0a894';
const ORIGINAL = '11111111-1111-4111-8111-111111111111';
const NEXT = '22222222-2222-4222-8222-222222222222';
const BINDING: ProviderAccountBinding = {
  version: 1,
  provider: 'claude',
  profileId: ORIGINAL,
  routeRevision: 0,
  routeFingerprint: 'a'.repeat(64),
  authEpoch: 0,
  runId: '33333333-3333-4333-8333-333333333333',
  identity: { kind: 'known', ownerKey: 'b'.repeat(64) },
};
/** A typed run refusal as the SDK named lifecycle throws it. */
const REFUSED = (code: string) => ({
  code,
  summary: 'The account route was refused.',
});
const continueParams = (prompt = 'Continue') => ({
  sessionId: SESSION,
  tabId: TAB,
  prompt,
});

function harness(bound = false) {
  const calls: string[] = [];
  const accounts = {
    selection: jest.fn().mockReturnValue({ profileId: NEXT, revision: 8 }),
    lookupBySdkSession: jest.fn().mockImplementation(async () => {
      calls.push('authoritative');
      return bound
        ? { status: 'bound', binding: BINDING }
        : { status: 'absent' };
    }),
    // Tripwires: the gate resolves a selection; the SDK run owns admission.
    admitClaudeRoute: jest.fn(),
    releaseReservation: jest.fn(),
  };
  const activeProvider = {
    resolveActiveAuthForPath: jest
      .fn()
      .mockReturnValue({ authMethod: 'claudeCli', providerId: 'anthropic' }),
  };
  // Exercise the real server-first/two-store resolver with an in-memory get.
  const get = jest.fn().mockImplementation(async () => {
    calls.push('metadata');
    return bound ? { accountBinding: BINDING } : null;
  });
  const metadata = Object.assign(
    Object.create(SessionMetadataStore.prototype) as SessionMetadataStore,
    {
      get,
      getCliSessionsForRestore: jest.fn().mockResolvedValue([]),
    },
  );
  const stream = async function* () {
    /* no inference */
  };
  const sdk = {
    startChatSession: jest.fn().mockResolvedValue(stream()),
    resumeSession: jest.fn().mockResolvedValue(stream()),
    executeSlashCommand: jest.fn().mockResolvedValue(stream()),
    isSessionActive: jest.fn().mockReturnValue(false),
    sendMessageToSession: jest.fn().mockResolvedValue(undefined),
    interruptSession: jest.fn().mockResolvedValue(undefined),
    interruptCurrentTurn: jest.fn().mockResolvedValue(true),
  };
  const context = {
    isMcpServerRunning: jest.fn().mockReturnValue(true),
    resolveEnhancedPromptsContent: jest.fn().mockResolvedValue(undefined),
  };
  const mcp = {
    getPort: jest.fn().mockReturnValue(1234),
    ensureRegisteredForSubagents: jest
      .fn()
      .mockResolvedValue({ registered: true }),
  };
  const history = {
    resolveSessionFolder: jest.fn().mockResolvedValue(ROOT),
    readForResume: jest
      .fn()
      .mockResolvedValue({
        resolvedWorkspacePath: ROOT,
        events: [],
        stats: null,
      }),
  };
  const provider = {
    resolveProviderProfileForWorkspace: jest.fn().mockResolvedValue(undefined),
  };
  const style = { resolveSessionFields: jest.fn().mockResolvedValue({}) };
  const broadcaster = {
    streamEventsToWebview: jest.fn(),
    isStreaming: jest.fn().mockReturnValue(false),
  };
  const compact = {
    requestManualCompact: jest.fn().mockReturnValue({ action: 'send' }),
    admitManualCompact: jest
      .fn()
      .mockReturnValue({ decision: { action: 'send' } }),
    releaseManualReservation: jest.fn(),
  };
  const broadcast = { broadcastMessage: jest.fn() };
  type RouterArgs = ConstructorParameters<typeof ChatSlashCommandRouterService>;
  const router = new ChatSlashCommandRouterService(
    createMockLogger() as unknown as Logger,
    broadcast as unknown as RouterArgs[1],
    createMockModelSettings(),
    sdk as unknown as RouterArgs[3],
    {
      intercept: jest
        .fn()
        .mockImplementation((prompt: string) =>
          prompt.startsWith('/')
            ? {
                action: 'new-query',
                commandName: 'compact',
                rawCommand: prompt,
              }
            : { action: 'passthrough' },
        ),
    } as unknown as RouterArgs[4],
    context as unknown as RouterArgs[5],
    broadcaster as unknown as RouterArgs[6],
    provider as unknown as RouterArgs[7],
    compact as unknown as RouterArgs[8],
    accounts as unknown as RouterArgs[9],
    activeProvider as unknown as RouterArgs[10],
    metadata,
  );
  type Args = ConstructorParameters<typeof ChatSessionService>;
  const service = new ChatSessionService(
    createMockLogger() as unknown as Logger,
    broadcast as unknown as Args[1],
    {
      get: jest.fn(),
      getWithDefault: jest.fn().mockReturnValue(false),
    } as unknown as Args[2],
    sdk as unknown as Args[3],
    { captureException: jest.fn() } as unknown as Args[4],
    mcp as unknown as Args[5],
    history as unknown as Args[6],
    {
      restoreResumableBySession: jest.fn().mockReturnValue(0),
      registerFromHistoryEvents: jest.fn(),
      getResumableBySession: jest.fn().mockReturnValue([]),
    } as unknown as Args[7],
    {
      intercept: jest.fn().mockReturnValue({ action: 'passthrough' }),
    } as unknown as Args[8],
    metadata,
    createMockWorkspaceProvider({ folders: [ROOT] }),
    {
      type: 'cli',
      extensionPath: '/tmp/app',
      globalStoragePath: '/tmp/storage',
      workspaceStoragePath: '/tmp/ws',
    } as unknown as Args[11],
    context as unknown as Args[12],
    {
      handleContinue: jest
        .fn()
        .mockResolvedValue({ error: '__NOT_PTAH_CLI__' }),
    } as unknown as Args[13],
    broadcaster as unknown as Args[14],
    {
      injectInterruptedAgentsContext: jest
        .fn()
        .mockImplementation(async (prompt: string) => ({ prompt })),
    } as unknown as Args[15],
    router,
    createMockModelSettings(),
    {
      getProviderKey: jest.fn().mockResolvedValue(null),
      setProviderKey: jest.fn().mockResolvedValue(undefined),
      deleteProviderKey: jest.fn().mockResolvedValue(undefined),
    } as unknown as Args[18],
    provider as unknown as Args[19],
    style as unknown as Args[20],
    new SessionMcpStatusRegistry(),
    {
      register: jest.fn().mockReturnValue(() => undefined),
    } as unknown as Args[22],
    {
      register: jest.fn().mockReturnValue(() => undefined),
    } as unknown as Args[23],
    null,
    null,
    null,
    accounts as unknown as Args[27],
    activeProvider as unknown as Args[28],
  );
  return {
    service,
    router,
    accounts,
    activeProvider,
    metadata,
    get,
    sdk,
    context,
    mcp,
    history,
    provider,
    style,
    broadcaster,
    compact,
    broadcast,
    calls,
  };
}

function expectNoContext(h: ReturnType<typeof harness>) {
  expect(h.context.resolveEnhancedPromptsContent).not.toHaveBeenCalled();
  expect(h.provider.resolveProviderProfileForWorkspace).not.toHaveBeenCalled();
  expect(h.style.resolveSessionFields).not.toHaveBeenCalled();
  expect(h.mcp.ensureRegisteredForSubagents).not.toHaveBeenCalled();
  expect(h.sdk.startChatSession).not.toHaveBeenCalled();
  expect(h.sdk.resumeSession).not.toHaveBeenCalled();
  expect(h.sdk.executeSlashCommand).not.toHaveBeenCalled();
  expect(h.sdk.sendMessageToSession).not.toHaveBeenCalled();
  expect(h.sdk.interruptSession).not.toHaveBeenCalled();
  expect(h.broadcast.broadcastMessage).not.toHaveBeenCalled();
}

const named = (profileId: string) => ({ kind: 'named' as const, profileId });

function expectNoRouteReservation(h: ReturnType<typeof harness>) {
  // The gate resolves a selection only; admission belongs to the SDK run.
  expect(h.accounts.admitClaudeRoute).not.toHaveBeenCalled();
  expect(h.accounts.releaseReservation).not.toHaveBeenCalled();
}

describe('main session account selection before context', () => {
  it('explicit ambient leaves the SDK path and account call count unchanged', async () => {
    const h = harness();
    expect(
      await h.service.startSession({
        tabId: TAB,
        workspacePath: ROOT,
        accountSelection: { kind: 'ambient' },
      }),
    ).toEqual({ success: true });
    expect(h.accounts.selection).not.toHaveBeenCalled();
    expectNoRouteReservation(h);
    expect(h.activeProvider.resolveActiveAuthForPath).not.toHaveBeenCalled();
    expect(h.get).not.toHaveBeenCalled();
    expect(h.sdk.startChatSession).toHaveBeenCalledTimes(1);
    expect(h.sdk.startChatSession.mock.calls[0][0]).not.toHaveProperty(
      'accountSelection',
    );
  });

  it.each(['apiKey', 'thirdParty'])(
    'never replaces intentional %s auth with a named selection',
    async (authMethod) => {
      const h = harness();
      h.activeProvider.resolveActiveAuthForPath.mockReturnValue({
        authMethod,
        providerId: 'anthropic',
      });
      const profile = {
        providerId: 'anthropic',
        authEnv: { ANTHROPIC_API_KEY: 'test-key' },
        model: 'test-model',
      };
      h.provider.resolveProviderProfileForWorkspace.mockResolvedValue(profile);
      expect(
        (
          await h.service.startSession({
            tabId: TAB,
            workspacePath: ROOT,
            accountSelection: named(ORIGINAL),
          })
        ).success,
      ).toBe(true);
      expect(h.accounts.selection).not.toHaveBeenCalled();
      expectNoRouteReservation(h);
      expect(h.sdk.startChatSession).toHaveBeenCalledWith(
        expect.objectContaining({ providerProfile: profile }),
      );
      expect(h.sdk.startChatSession.mock.calls[0][0]).not.toHaveProperty(
        'accountSelection',
      );
    },
  );

  it('fresh omitted selection forwards only the main default to the SDK run', async () => {
    const h = harness();
    expect(
      await h.service.startSession({ tabId: TAB, workspacePath: ROOT }),
    ).toEqual({ success: true });
    expect(h.accounts.selection).toHaveBeenCalledWith(ROOT, 'main');
    expect(h.sdk.startChatSession).toHaveBeenCalledWith(
      expect.objectContaining({ accountSelection: named(NEXT) }),
    );
    expectNoRouteReservation(h);
  });

  it('explicit named selection bypasses the default', async () => {
    const h = harness();
    await h.service.startSession({
      tabId: TAB,
      workspacePath: ROOT,
      accountSelection: named(ORIGINAL),
    });
    expect(h.accounts.selection).not.toHaveBeenCalled();
    expect(h.sdk.startChatSession).toHaveBeenCalledWith(
      expect.objectContaining({ accountSelection: named(ORIGINAL) }),
    );
    expectNoRouteReservation(h);
  });

  it('fresh named run refusal from the SDK keeps its typed code', async () => {
    const h = harness();
    h.sdk.startChatSession.mockRejectedValue(REFUSED('unavailable-storage'));
    expect(
      await h.service.startSession({
        tabId: TAB,
        workspacePath: ROOT,
        accountSelection: named(ORIGINAL),
      }),
    ).toMatchObject({
      success: false,
      accountRefusal: { code: 'unavailable-storage' },
    });
  });

  it('old truly unbound sessions ignore a newly selected default', async () => {
    const h = harness();
    expect((await h.service.continueSession(continueParams())).success).toBe(
      true,
    );
    expect(h.accounts.selection).not.toHaveBeenCalled();
    expectNoRouteReservation(h);
    expect(h.sdk.resumeSession.mock.calls[0][1]).not.toHaveProperty(
      'accountSelection',
    );
    expect(h.sdk.sendMessageToSession).toHaveBeenCalledTimes(1);
  });

  it('does not retroactively attach an explicit named account to a legacy session', async () => {
    const h = harness();
    expect(
      await h.service.continueSession({
        ...continueParams(),
        accountSelection: named(NEXT),
      }),
    ).toMatchObject({
      success: false,
      accountRefusal: { code: 'invalid-bound' },
    });
    expectNoContext(h);
  });
});

describe('immutable authoritative continuation binding', () => {
  it.each(['absent', 'omitted', 'same'] as const)(
    'inactive bound resume with %s selection forwards the original binding despite default changes',
    async (kind) => {
      const h = harness(true);
      const accountSelection =
        kind === 'omitted'
          ? { kind }
          : kind === 'same'
            ? named(ORIGINAL)
            : undefined;
      expect(
        await h.service.continueSession({
          ...continueParams(),
          ...(accountSelection ? { accountSelection } : {}),
        }),
      ).toMatchObject({ success: true });
      expect(h.accounts.lookupBySdkSession).toHaveBeenCalledWith({
        provider: 'claude',
        sdkSessionId: SESSION,
      });
      expect(h.calls[0]).toBe('authoritative');
      expect(h.accounts.selection).not.toHaveBeenCalled();
      expect(h.sdk.resumeSession).toHaveBeenCalledTimes(1);
      expect(h.sdk.resumeSession).toHaveBeenCalledWith(
        SESSION,
        expect.objectContaining({ accountSelection: named(ORIGINAL) }),
      );
      expectNoRouteReservation(h);
    },
  );

  it('live bound session continues on the owner without a resume, binding or lease', async () => {
    const h = harness(true);
    h.sdk.isSessionActive.mockReturnValue(true);
    h.broadcaster.isStreaming.mockReturnValue(true);
    expect(await h.service.continueSession(continueParams())).toMatchObject({
      success: true,
    });
    expect(h.sdk.resumeSession).not.toHaveBeenCalled();
    expect(h.sdk.startChatSession).not.toHaveBeenCalled();
    expect(h.sdk.sendMessageToSession).toHaveBeenCalledTimes(1);
    expectNoRouteReservation(h);
  });

  it.each([
    'missing-profile',
    'route-changed',
    'identity-mismatch',
    'identity-unproved',
    'unavailable-storage',
  ])(
    'preserves conversation on a %s run refusal including sign-out or identity changes',
    async (code) => {
      const h = harness(true);
      h.sdk.resumeSession.mockRejectedValue(REFUSED(code));
      expect(await h.service.continueSession(continueParams())).toMatchObject({
        success: false,
        accountRefusal: { code },
      });
      expect(h.sdk.sendMessageToSession).not.toHaveBeenCalled();
      expectNoRouteReservation(h);
    },
  );

  it.each(['ambient', 'named'] as const)(
    'refuses switching an existing binding to %s',
    async (kind) => {
      const h = harness(true);
      const accountSelection =
        kind === 'ambient' ? { kind } : { kind, profileId: NEXT };
      expect(
        await h.service.continueSession({
          ...continueParams(),
          accountSelection,
        }),
      ).toMatchObject({ success: false, accountRefusal: { code: 'conflict' } });
      expectNoContext(h);
    },
  );

  it('authoritative binding cannot be erased by a CLI/local index without linkage', async () => {
    const h = harness(true);
    h.get.mockResolvedValue({ providerId: 'claude' });
    expect(await h.service.continueSession(continueParams())).toMatchObject({
      success: false,
      accountRefusal: { code: expect.stringMatching(/invalid-bound|conflict/) },
    });
    expectNoRouteReservation(h);
    expectNoContext(h);
  });

  it('unknown stored identity refuses before admission', async () => {
    const h = harness(true);
    const binding = { ...BINDING, identity: { kind: 'unknown' } };
    h.accounts.lookupBySdkSession.mockResolvedValue({
      status: 'bound',
      binding,
    });
    h.get.mockResolvedValue({ accountBinding: binding });
    expect(await h.service.continueSession(continueParams())).toMatchObject({
      success: false,
      accountRefusal: { code: 'identity-unproved' },
    });
    expectNoRouteReservation(h);
    expectNoContext(h);
  });

  it.each(['invalid-bound', 'unavailable-storage'])(
    'never falls back on authoritative %s',
    async (status) => {
      const h = harness(true);
      h.accounts.lookupBySdkSession.mockResolvedValue({ status });
      expect(await h.service.continueSession(continueParams())).toMatchObject({
        success: false,
        accountRefusal: { code: status },
      });
      expectNoContext(h);
    },
  );

  it.each([false, true])(
    'explicit resume activate=%s refuses a conflicting selection before history and budget work',
    async (activate) => {
      const h = harness(true);
      expect(
        await h.service.resumeSession({
          sessionId: SESSION,
          tabId: TAB,
          activate,
          accountSelection: { kind: 'ambient' },
        }),
      ).toMatchObject({ success: false, accountRefusal: { code: 'conflict' } });
      expect(h.history.readForResume).not.toHaveBeenCalled();
      expectNoContext(h);
    },
  );

  it('explicit resume with activate forwards the original binding to the SDK resume', async () => {
    const h = harness(true);
    await h.service.resumeSession({
      sessionId: SESSION,
      tabId: TAB,
      activate: true,
    });
    expect(h.sdk.resumeSession).toHaveBeenCalledWith(
      SESSION,
      expect.objectContaining({ accountSelection: named(ORIGINAL) }),
    );
    expectNoRouteReservation(h);
  });

  it('rewind of a live bound session returns active without a second run', async () => {
    const h = harness(true);
    h.sdk.isSessionActive.mockReturnValue(true);
    h.broadcaster.isStreaming.mockReturnValue(true);
    expect(
      await h.service.ensureSessionActiveForRewind(SESSION, TAB, ROOT),
    ).toEqual({ alreadyActive: true });
    expect(h.sdk.resumeSession).not.toHaveBeenCalled();
    expectNoRouteReservation(h);
  });

  it('rewind of an inactive bound session resumes on the original binding', async () => {
    const h = harness(true);
    expect(
      await h.service.ensureSessionActiveForRewind(SESSION, TAB, ROOT),
    ).toEqual({ resumed: true });
    expect(h.sdk.resumeSession).toHaveBeenCalledWith(
      SESSION,
      expect.objectContaining({ accountSelection: named(ORIGINAL) }),
    );
  });

  it('rewind reports a run refusal as not resumed', async () => {
    const h = harness(true);
    h.sdk.resumeSession.mockRejectedValue(REFUSED('route-changed'));
    expect(
      await h.service.ensureSessionActiveForRewind(SESSION, TAB, ROOT),
    ).toMatchObject({ resumed: false });
  });

  it('fresh-context handoff with source id inherits the original binding', async () => {
    const h = harness(true);
    expect(
      await h.service.startHandoffSession({
        tabId: TAB,
        workspaceRoot: ROOT,
        cwd: ROOT,
        prompt: 'private continuation',
        sessionName: 'handoff',
        sourceSessionId: SESSION,
      }),
    ).toEqual({ success: true });
    expect(h.sdk.startChatSession).toHaveBeenCalledWith(
      expect.objectContaining({ accountSelection: named(ORIGINAL) }),
    );
    expect(h.accounts.selection).not.toHaveBeenCalled();
    expectNoRouteReservation(h);
  });

  it('child launch with source id refuses a conflicting selection before MCP/context', async () => {
    const h = harness(true);
    expect(
      await h.service.startAgentChildSession({
        tabId: TAB,
        workspaceRoot: ROOT,
        worktreePath: ROOT,
        prompt: 'child task',
        sessionName: 'child',
        sourceSessionId: SESSION,
        accountSelection: named(NEXT),
      }),
    ).toMatchObject({ success: false, accountRefusal: { code: 'conflict' } });
    expectNoContext(h);
  });
});

describe('slash routes on a bound session', () => {
  it('direct slash relaunch carries the original binding into the SDK run', async () => {
    const h = harness(true);
    expect(
      await h.router.routeFollowUpSlashCommand(
        '/compact',
        SESSION,
        TAB,
        ROOT,
        continueParams('/compact'),
      ),
    ).toEqual({ success: true, sessionId: SESSION });
    expect(h.sdk.executeSlashCommand).toHaveBeenCalledWith(
      SESSION,
      '/compact',
      expect.objectContaining({ accountSelection: named(ORIGINAL) }),
    );
    expectNoRouteReservation(h);
  });

  it('direct slash with a conflicting selection refuses before compact cost admission and context', async () => {
    const h = harness(true);
    expect(
      await h.router.routeFollowUpSlashCommand('/compact', SESSION, TAB, ROOT, {
        ...continueParams('/compact'),
        accountSelection: { kind: 'ambient' },
      }),
    ).toMatchObject({ success: false, accountRefusal: { code: 'conflict' } });
    expect(h.compact.requestManualCompact).not.toHaveBeenCalled();
    expect(h.compact.admitManualCompact).not.toHaveBeenCalled();
    expectNoContext(h);
  });

  it('central slash with a conflicting selection refuses before dead-session cleanup', async () => {
    const h = harness(true);
    h.sdk.isSessionActive.mockReturnValue(true);
    expect(
      await h.service.continueSession({
        ...continueParams('/compact'),
        accountSelection: named(NEXT),
      }),
    ).toMatchObject({ success: false, accountRefusal: { code: 'conflict' } });
    expect(h.compact.requestManualCompact).not.toHaveBeenCalled();
    expectNoContext(h);
  });

  it('the gate resolves a named selection without reserving a route', async () => {
    const h = harness();
    await expect(
      gateMainSessionAccount(h, {
        workspacePath: ROOT,
        accountSelection: named(ORIGINAL),
      }),
    ).resolves.toEqual(named(ORIGINAL));
    expectNoRouteReservation(h);
    expectNoContext(h);
  });

  it('structural refusals expose codes without raw exception paths', () => {
    expect(
      mainSessionAccountFailure({
        code: 'identity-mismatch',
        summary: '/secret/account',
      }),
    ).toMatchObject({ accountRefusal: { code: 'identity-mismatch' } });
    expect(
      mainSessionAccountFailure({
        code: 'identity-mismatch',
        summary: '/secret/account',
      })?.error,
    ).not.toContain('/secret');
  });

  it('missing account service cannot erase existing local linkage', async () => {
    const h = harness(true);
    await expect(
      gateMainSessionAccount({ metadata: h.metadata }, { sessionId: SESSION }),
    ).rejects.toMatchObject({ code: 'unavailable-storage' });
  });

  it('rejects malformed selections before storage or context', async () => {
    const h = harness();
    await expect(
      gateMainSessionAccount(h, {
        workspacePath: ROOT,
        accountSelection: { kind: 'named', profileId: '/not-an-id' },
      }),
    ).rejects.toMatchObject({ code: 'conflict' });
    expect(h.accounts.selection).not.toHaveBeenCalled();
    expectNoRouteReservation(h);
    expectNoContext(h);
  });
});

describe('separate child account inheritance (Batch 21)', () => {
  const launch = (h: ReturnType<typeof harness>, handoff = false) => {
    const common = {
      tabId: TAB,
      workspaceRoot: ROOT,
      prompt: 'private child task',
      sessionName: 'child',
      sourceSessionId: SESSION,
    };
    return handoff
      ? h.service.startHandoffSession({ ...common, cwd: ROOT })
      : h.service.startAgentChildSession({ ...common, worktreePath: ROOT });
  };

  it.each([false, true])(
    'inherits account A despite default B, handoff=%s',
    async (handoff) => {
      const h = harness(true);
      expect(await launch(h, handoff)).toEqual({ success: true });
      expect(h.accounts.lookupBySdkSession).toHaveBeenCalledWith({
        provider: 'claude',
        sdkSessionId: SESSION,
      });
      expect(h.sdk.startChatSession).toHaveBeenCalledWith(
        expect.objectContaining({ accountSelection: named(ORIGINAL) }),
      );
      expect(h.accounts.selection).not.toHaveBeenCalled();
      expectNoRouteReservation(h);
    },
  );

  it.each([
    'missing-profile',
    'route-changed',
    'identity-mismatch',
    'identity-unproved',
  ])('keeps the typed %s refusal of the child run', async (code) => {
    const h = harness(true);
    h.sdk.startChatSession.mockRejectedValue(REFUSED(code));
    expect(await launch(h)).toMatchObject({
      success: false,
      accountRefusal: { code },
    });
    expectNoRouteReservation(h);
  });

  it.each(['invalid-bound', 'unavailable-storage'])(
    'does not replace an unknown parent binding: %s',
    async (status) => {
      const h = harness(true);
      h.accounts.lookupBySdkSession.mockResolvedValue({ status });
      expect(await launch(h)).toMatchObject({
        success: false,
        accountRefusal: { code: status },
      });
      expect(h.accounts.selection).not.toHaveBeenCalled();
      expectNoRouteReservation(h);
      expectNoContext(h);
    },
  );

  it('refuses an unknown parent identity before admission', async () => {
    const h = harness(true);
    const binding = { ...BINDING, identity: { kind: 'unknown' } };
    h.accounts.lookupBySdkSession.mockResolvedValue({
      status: 'bound',
      binding,
    });
    h.get.mockResolvedValue({ accountBinding: binding });
    expect(await launch(h)).toMatchObject({
      success: false,
      accountRefusal: { code: 'identity-unproved' },
    });
    expectNoRouteReservation(h);
    expectNoContext(h);
  });

  it.each([false, true])(
    'unbound source ignores a newly named default, handoff=%s',
    async (handoff) => {
      const h = harness();
      expect(await launch(h, handoff)).toEqual({ success: true });
      expect(h.accounts.selection).not.toHaveBeenCalled();
      expectNoRouteReservation(h);
      expect(h.sdk.startChatSession).toHaveBeenCalledTimes(1);
      expect(h.sdk.startChatSession.mock.calls[0][0]).not.toHaveProperty(
        'accountSelection',
      );
    },
  );

  it.each([false, true])(
    'incompatible provider keeps its existing launch arguments, handoff=%s',
    async (handoff) => {
      const inherited = harness(true);
      const fresh = harness();
      for (const h of [inherited, fresh]) {
        h.activeProvider.resolveActiveAuthForPath.mockReturnValue({
          authMethod: 'apiKey',
          providerId: 'anthropic',
        });
      }
      expect(await launch(inherited, handoff)).toEqual({ success: true });
      const common = {
        tabId: TAB,
        workspaceRoot: ROOT,
        prompt: 'private child task',
        sessionName: 'child',
      };
      expect(
        await (handoff
          ? fresh.service.startHandoffSession({ ...common, cwd: ROOT })
          : fresh.service.startAgentChildSession({
              ...common,
              worktreePath: ROOT,
            })),
      ).toEqual({ success: true });
      expect(inherited.sdk.startChatSession.mock.calls).toEqual(
        fresh.sdk.startChatSession.mock.calls,
      );
      expect(inherited.accounts.lookupBySdkSession).not.toHaveBeenCalled();
      expectNoRouteReservation(inherited);
    },
  );
});

describe('host passes authoritative source IDs (D22)', () => {
  it.each([false, true])(
    'passes the SDK source and retains typed refusal, handoff=%s',
    async (handoff) => {
      const h = harness(true);
      h.sdk.startChatSession.mockRejectedValue(REFUSED('identity-unproved'));
      const host = new ChildChatSessionHostAdapter(
        createMockLogger() as unknown as Logger,
        {
          getActiveWebviews: () => [],
          sendMessage: jest.fn().mockResolvedValue(false),
          broadcastMessage: jest.fn().mockResolvedValue(undefined),
        },
        h.service,
      );
      const common = {
        tabId: TAB,
        workspaceRoot: ROOT,
        prompt: 'private task',
        sessionName: 'child',
      };
      const result = handoff
        ? await host.startHandoffSession({
            ...common,
            cwd: ROOT,
            descriptor: {
              tabId: TAB,
              fromTabId: TAB,
              fromSessionId: SESSION,
              workspaceRoot: ROOT,
              cwd: ROOT,
              label: 'handoff',
              displayPrompt: 'private task',
              startedAt: 1,
            },
          })
        : await host.startChildSession({
            ...common,
            worktreePath: ROOT,
            descriptor: {
              tabId: TAB,
              sessionId: null,
              parentTabId: TAB,
              parentSessionId: SESSION,
              workspaceRoot: ROOT,
              worktreePath: ROOT,
              branch: 'feat/child',
              label: 'child',
              displayPrompt: 'private task',
              startedAt: 1,
            },
          });
      expect(result).toMatchObject({
        started: false,
        accountRefusal: { code: 'identity-unproved' },
      });
      expect(h.accounts.lookupBySdkSession).toHaveBeenCalledWith({
        provider: 'claude',
        sdkSessionId: SESSION,
      });
      expect(h.sdk.startChatSession).toHaveBeenCalledWith(
        expect.objectContaining({ accountSelection: named(ORIGINAL) }),
      );
      expect(h.accounts.selection).not.toHaveBeenCalled();
    },
  );
});
