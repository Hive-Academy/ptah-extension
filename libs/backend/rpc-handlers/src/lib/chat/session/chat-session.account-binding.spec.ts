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
const HELD = {
  code: 'release-held',
  summary: 'Named account admission is release held.',
};
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
    admitClaudeRoute: jest.fn().mockResolvedValue(HELD),
    releaseReservation: jest.fn().mockResolvedValue({ code: 'ok' }),
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
    expect(h.accounts.admitClaudeRoute).not.toHaveBeenCalled();
    expect(h.activeProvider.resolveActiveAuthForPath).not.toHaveBeenCalled();
    expect(h.get).not.toHaveBeenCalled();
    expect(h.sdk.startChatSession).toHaveBeenCalledTimes(1);
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
            accountSelection: { kind: 'named', profileId: ORIGINAL },
          })
        ).success,
      ).toBe(true);
      expect(h.accounts.selection).not.toHaveBeenCalled();
      expect(h.accounts.admitClaudeRoute).not.toHaveBeenCalled();
      expect(h.sdk.startChatSession).toHaveBeenCalledWith(
        expect.objectContaining({ providerProfile: profile }),
      );
    },
  );

  it('only reads the main default and surfaces the port refusal before context', async () => {
    const h = harness();
    const result = await h.service.startSession({
      tabId: TAB,
      workspacePath: ROOT,
    });
    expect(result).toMatchObject({ success: false, accountRefusal: HELD });
    expect(h.accounts.selection).toHaveBeenCalledWith(ROOT, 'main');
    expect(h.accounts.admitClaudeRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'main',
        selection: { kind: 'named', profileId: NEXT },
      }),
    );
    expectNoContext(h);
  });

  it('explicit named selection bypasses the default', async () => {
    const h = harness();
    await h.service.startSession({
      tabId: TAB,
      workspacePath: ROOT,
      accountSelection: { kind: 'named', profileId: ORIGINAL },
    });
    expect(h.accounts.selection).not.toHaveBeenCalled();
    expect(h.accounts.admitClaudeRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: { kind: 'named', profileId: ORIGINAL },
      }),
    );
    expectNoContext(h);
  });

  it('old truly unbound sessions ignore a newly selected default', async () => {
    const h = harness();
    expect((await h.service.continueSession(continueParams())).success).toBe(
      true,
    );
    expect(h.accounts.selection).not.toHaveBeenCalled();
    expect(h.accounts.admitClaudeRoute).not.toHaveBeenCalled();
    expect(h.sdk.sendMessageToSession).toHaveBeenCalledTimes(1);
  });

  it('does not retroactively attach an explicit named account to a legacy session', async () => {
    const h = harness();
    expect(
      await h.service.continueSession({
        ...continueParams(),
        accountSelection: { kind: 'named', profileId: NEXT },
      }),
    ).toMatchObject({
      success: false,
      accountRefusal: { code: 'invalid-bound' },
    });
    expectNoContext(h);
  });
});

describe('immutable authoritative continuation binding', () => {
  it.each([false, true])(
    'omitted selection retains original binding with active=%s despite default/label changes',
    async (active) => {
      const h = harness(true);
      h.sdk.isSessionActive.mockReturnValue(active);
      h.broadcaster.isStreaming.mockReturnValue(active);
      expect(await h.service.continueSession(continueParams())).toMatchObject({
        success: false,
        accountRefusal: HELD,
      });
      expect(h.accounts.lookupBySdkSession).toHaveBeenCalledWith({
        provider: 'claude',
        sdkSessionId: SESSION,
      });
      expect(h.calls[0]).toBe('authoritative');
      expect(h.accounts.selection).not.toHaveBeenCalled();
      expect(h.accounts.admitClaudeRoute).toHaveBeenCalledWith(
        expect.objectContaining({
          selection: { kind: 'named', profileId: ORIGINAL },
        }),
      );
      expectNoContext(h);
    },
  );

  it.each([
    'missing-profile',
    'route-changed',
    'identity-mismatch',
    'identity-unproved',
    'release-held',
  ])(
    'preserves conversation on %s refusal including sign-out or identity changes',
    async (code) => {
      const h = harness(true);
      h.accounts.admitClaudeRoute.mockResolvedValue({
        code,
        summary: 'The account route was refused.',
      });
      expect(await h.service.continueSession(continueParams())).toMatchObject({
        success: false,
        accountRefusal: { code },
      });
      expect(h.history.readForResume).not.toHaveBeenCalled();
      expectNoContext(h);
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
    expect(h.accounts.admitClaudeRoute).not.toHaveBeenCalled();
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
    expect(h.accounts.admitClaudeRoute).not.toHaveBeenCalled();
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
    'explicit resume activate=%s gates before history and budget work',
    async (activate) => {
      const h = harness(true);
      expect(
        await h.service.resumeSession({
          sessionId: SESSION,
          tabId: TAB,
          activate,
        }),
      ).toMatchObject({ success: false, accountRefusal: HELD });
      expect(h.history.readForResume).not.toHaveBeenCalled();
      expectNoContext(h);
    },
  );

  it.each([false, true])(
    'rewind active=%s gates before returning active or resuming',
    async (active) => {
      const h = harness(true);
      h.sdk.isSessionActive.mockReturnValue(active);
      h.broadcaster.isStreaming.mockReturnValue(active);
      expect(
        await h.service.ensureSessionActiveForRewind(SESSION, TAB, ROOT),
      ).toMatchObject({ resumed: false });
      expectNoContext(h);
    },
  );

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
    ).toMatchObject({ success: false, accountRefusal: HELD });
    expect(h.accounts.admitClaudeRoute).toHaveBeenCalledWith(
      expect.objectContaining({
        selection: { kind: 'named', profileId: ORIGINAL },
      }),
    );
    expect(h.accounts.selection).not.toHaveBeenCalled();
    expectNoContext(h);
  });

  it('child launch with source id is gated before MCP/context', async () => {
    const h = harness(true);
    expect(
      await h.service.startAgentChildSession({
        tabId: TAB,
        workspaceRoot: ROOT,
        worktreePath: ROOT,
        prompt: 'child task',
        sessionName: 'child',
        sourceSessionId: SESSION,
      }),
    ).toMatchObject({ success: false, accountRefusal: HELD });
    expectNoContext(h);
  });
});

describe('slash routes and release hold', () => {
  it('direct slash resume is gated before compact cost admission and context', async () => {
    const h = harness(true);
    expect(
      await h.router.routeFollowUpSlashCommand(
        '/compact',
        SESSION,
        TAB,
        ROOT,
        continueParams('/compact'),
      ),
    ).toMatchObject({ success: false, accountRefusal: HELD });
    expect(h.compact.requestManualCompact).not.toHaveBeenCalled();
    expect(h.compact.admitManualCompact).not.toHaveBeenCalled();
    expectNoContext(h);
  });

  it('central slash resume refuses before dead-session cleanup', async () => {
    const h = harness(true);
    h.sdk.isSessionActive.mockReturnValue(true);
    expect(
      await h.service.continueSession(continueParams('/compact')),
    ).toMatchObject({ success: false, accountRefusal: HELD });
    expect(h.compact.requestManualCompact).not.toHaveBeenCalled();
    expectNoContext(h);
  });

  it('future successful preflight cannot accidentally enable a prompt without lease transfer', async () => {
    const h = harness();
    h.accounts.admitClaudeRoute.mockResolvedValue({
      code: 'ok',
      reservation: {
        reservationId: 'reservation-123',
        operationId: 'operation-123',
        authEpoch: 0,
      },
    });
    await expect(
      gateMainSessionAccount(h, {
        workspacePath: ROOT,
        accountSelection: { kind: 'named', profileId: ORIGINAL },
      }),
    ).rejects.toMatchObject({ code: 'release-held' });
    expect(h.accounts.releaseReservation).toHaveBeenCalledWith({
      reservationId: 'reservation-123',
      operationId: 'operation-123',
      authEpoch: 0,
      reason: 'startup-failure',
    });
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
    expect(h.accounts.admitClaudeRoute).not.toHaveBeenCalled();
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
      expect(await launch(h, handoff)).toMatchObject({
        success: false,
        accountRefusal: HELD,
      });
      expect(h.accounts.lookupBySdkSession).toHaveBeenCalledWith({
        provider: 'claude',
        sdkSessionId: SESSION,
      });
      expect(h.accounts.admitClaudeRoute).toHaveBeenCalledWith(
        expect.objectContaining({
          selection: { kind: 'named', profileId: ORIGINAL },
          runId: BINDING.runId,
        }),
      );
      expect(h.accounts.selection).not.toHaveBeenCalled();
      expectNoContext(h);
    },
  );

  it.each([
    'missing-profile',
    'route-changed',
    'identity-mismatch',
    'identity-unproved',
  ])('refuses %s before child content', async (code) => {
    const h = harness(true);
    h.accounts.admitClaudeRoute.mockResolvedValue({
      code,
      summary: 'The account route was refused.',
    });
    expect(await launch(h)).toMatchObject({
      success: false,
      accountRefusal: { code },
    });
    expect(h.accounts.releaseReservation).not.toHaveBeenCalled();
    expectNoContext(h);
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
      expect(h.accounts.admitClaudeRoute).not.toHaveBeenCalled();
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
    expect(h.accounts.admitClaudeRoute).not.toHaveBeenCalled();
    expectNoContext(h);
  });

  it.each([false, true])(
    'unbound source ignores a newly named default, handoff=%s',
    async (handoff) => {
      const h = harness();
      expect(await launch(h, handoff)).toEqual({ success: true });
      expect(h.accounts.selection).not.toHaveBeenCalled();
      expect(h.accounts.admitClaudeRoute).not.toHaveBeenCalled();
      expect(h.sdk.startChatSession).toHaveBeenCalledTimes(1);
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
      expect(inherited.accounts.admitClaudeRoute).not.toHaveBeenCalled();
    },
  );

  it('releases only the child preflight reservation and retains the release hold', async () => {
    const h = harness(true);
    h.accounts.admitClaudeRoute.mockResolvedValue({
      code: 'ok',
      reservation: {
        reservationId: 'child-reservation',
        operationId: 'child-operation',
        authEpoch: 0,
      },
    });
    expect(await launch(h)).toMatchObject({
      success: false,
      accountRefusal: { code: 'release-held' },
    });
    expect(h.accounts.releaseReservation.mock.calls).toEqual([
      [
        {
          reservationId: 'child-reservation',
          operationId: 'child-operation',
          authEpoch: 0,
          reason: 'startup-failure',
        },
      ],
    ]);
    expectNoContext(h);
  });
});

describe('host passes authoritative source IDs (D22)', () => {
  it.each([false, true])(
    'passes the SDK source and retains typed refusal, handoff=%s',
    async (handoff) => {
      const h = harness(true);
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
      expect(result).toMatchObject({ started: false, accountRefusal: HELD });
      expect(h.accounts.lookupBySdkSession).toHaveBeenCalledWith({
        provider: 'claude',
        sdkSessionId: SESSION,
      });
      expect(h.accounts.selection).not.toHaveBeenCalled();
      expectNoContext(h);
    },
  );
});
