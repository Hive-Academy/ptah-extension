/**
 * ChatSessionService — host routing admission (TASK_2026_857, Batch 19).
 *
 * `chat:start` and `chat:continue` hand each dispatched plain-text turn to the
 * optional `HostRoutingCoordinator`, after the dispatch and without awaiting
 * it. Slash commands, Ptah-CLI turns and `chat:resume` are never admitted, a
 * throwing admission never fails the turn, and a host without the coordinator
 * (VS Code, CLI) behaves as before.
 *
 * The coordinator module is referenced by type only, so its runtime imports
 * (`@ptah-extension/vscode-lm-tools`' candidate source) are never loaded here.
 */

import 'reflect-metadata';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// `ChatSessionService` imports `@ptah-extension/cli-agent-runtime`, whose barrel
// transitively pulls `@ptah-extension/workspace-intelligence`. That lib's
// TreeSitter module evaluates `import.meta.url` at top level, which ts-jest's
// CJS transform cannot parse. Stub it (mirrors the sibling specs).
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
  ChatContinueParams,
  ChatStartParams,
  SessionId,
} from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';

import { createMockModelSettings } from '../../../test-utils/mock-settings';
import type { AdmitUserTurnInput } from '../host-routing/host-routing.coordinator';
import { ChatSessionService } from './chat-session.service';
import { SessionMcpStatusRegistry } from './session-mcp-status.registry';

// A slash follow-up validates its execution root on disk, so the workspace
// must exist.
const TEST_ROOT = mkdtempSync(join(tmpdir(), 'ptah-host-routing-'));
afterAll(() => rmSync(TEST_ROOT, { recursive: true, force: true }));
mkdirSync(join(TEST_ROOT, 'host-routing'), { recursive: true });
const WORKSPACE = `${TEST_ROOT}/host-routing`;
const SESSION_ID = '0d4c3f0e-6a51-4c55-9a8e-2d3f8c1b7a10' as SessionId;
const TAB_ID = '5b0f6c2e-1d7a-4f3b-8e9c-a1b2c3d4e5f6';
const PROMPT = 'add retries to the uploader';

/** Assignable to `Pick<HostRoutingCoordinator, 'admitUserTurn'>`. */
type AdmitMock = jest.Mock<unknown, [AdmitUserTurnInput]>;

interface HarnessOptions {
  /** `undefined` builds the service without a coordinator (VS Code, CLI). */
  admitUserTurn?: AdmitMock;
  intercept?: jest.Mock;
  sendMessageToSession?: jest.Mock;
  startChatSession?: jest.Mock;
  routeFollowUpSlashCommand?: jest.Mock;
  ptahCliStart?: jest.Mock;
  ptahCliContinue?: jest.Mock;
}

interface Harness {
  service: ChatSessionService;
  logger: ReturnType<typeof createMockLogger>;
  startChatSession: jest.Mock;
  resumeSession: jest.Mock;
  sendMessageToSession: jest.Mock;
  routeFollowUpSlashCommand: jest.Mock;
}

function makeHarness(opts: HarnessOptions = {}): Harness {
  const stream = { [Symbol.asyncIterator]: jest.fn() };
  const logger = createMockLogger();
  const startChatSession =
    opts.startChatSession ?? jest.fn().mockResolvedValue(stream);
  const resumeSession = jest.fn().mockResolvedValue(stream);
  const sendMessageToSession =
    opts.sendMessageToSession ?? jest.fn().mockResolvedValue(undefined);
  const routeFollowUpSlashCommand =
    opts.routeFollowUpSlashCommand ?? jest.fn().mockResolvedValue(null);
  const hostRouting = opts.admitUserTurn
    ? { admitUserTurn: opts.admitUserTurn }
    : undefined;

  const service = new ChatSessionService(
    logger as never,
    { broadcastMessage: jest.fn().mockResolvedValue(undefined) } as never,
    {
      get: jest.fn(),
      getWithDefault: jest.fn().mockReturnValue(false),
    } as never,
    {
      startChatSession,
      resumeSession,
      // A live session: `chat:continue` sends without resuming first.
      isSessionActive: jest.fn().mockReturnValue(true),
      sendMessageToSession,
      endSession: jest.fn().mockResolvedValue(undefined),
      interruptSession: jest.fn().mockResolvedValue(undefined),
    } as never,
    { captureException: jest.fn() } as never,
    { getPort: jest.fn().mockReturnValue(0) } as never,
    {
      readForResume: jest
        .fn()
        .mockResolvedValue({ events: [], resolvedWorkspacePath: WORKSPACE }),
      resolveSessionFolder: jest.fn().mockResolvedValue(WORKSPACE),
    } as never,
    {
      restoreResumableBySession: jest.fn().mockReturnValue(0),
      hydrateResumeState: jest.fn().mockReturnValue(0),
      isResumeStateHydrated: jest.fn().mockReturnValue(true),
      registerFromHistoryEvents: jest.fn().mockReturnValue(0),
      getResumableBySession: jest.fn().mockReturnValue([]),
    } as never,
    {
      intercept:
        opts.intercept ?? jest.fn().mockReturnValue({ action: 'passthrough' }),
    } as never,
    {
      get: jest.fn().mockResolvedValue(null),
      getCliSessionsForRestore: jest.fn().mockResolvedValue([]),
    } as never,
    createMockWorkspaceProvider({ folders: [WORKSPACE] }) as never,
    {
      type: 'cli',
      extensionPath: '/tmp/ptah',
      globalStoragePath: '/tmp/storage',
      workspaceStoragePath: '/tmp/workspace',
    } as never,
    {
      isMcpServerRunning: jest.fn().mockReturnValue(false),
      resolveEnhancedPromptsContent: jest.fn().mockResolvedValue(undefined),
    } as never,
    {
      handleStart:
        opts.ptahCliStart ??
        jest.fn().mockResolvedValue({ result: { success: false } }),
      handleContinue:
        opts.ptahCliContinue ??
        jest.fn().mockResolvedValue({ error: '__NOT_PTAH_CLI__' }),
    } as never,
    {
      streamEventsToWebview: jest.fn(),
      isStreaming: jest.fn().mockReturnValue(true),
    } as never,
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
    { routeFollowUpSlashCommand } as never,
    createMockModelSettings() as never,
    { getProviderKey: jest.fn().mockResolvedValue(undefined) } as never,
    {
      resolveStoredModel: jest.fn(
        (_path: string, model: string) => model || 'default',
      ),
      resolveProviderProfileForWorkspace: jest
        .fn()
        .mockResolvedValue(undefined),
    } as never,
    { resolveSessionFields: jest.fn().mockResolvedValue({}) } as never,
    new SessionMcpStatusRegistry(),
    { register: jest.fn().mockReturnValue(() => undefined) } as never,
    { register: jest.fn().mockReturnValue(() => undefined) } as never,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    hostRouting,
  );

  jest
    .spyOn(
      service as unknown as {
        buildMcpServersOverride: (caller: unknown) => Promise<unknown>;
      },
      'buildMcpServersOverride',
    )
    .mockResolvedValue(undefined);
  return {
    service,
    logger,
    startChatSession,
    resumeSession,
    sendMessageToSession,
    routeFollowUpSlashCommand,
  };
}

function startParams(prompt: string): ChatStartParams {
  return { tabId: TAB_ID, prompt, workspacePath: WORKSPACE };
}

function continueParams(prompt: string): ChatContinueParams {
  return {
    tabId: TAB_ID,
    sessionId: SESSION_ID,
    prompt,
    workspacePath: WORKSPACE,
  };
}

/** Every logged argument as text; an `Error` contributes its message. */
function loggedText(calls: ReadonlyArray<readonly unknown[]>): string {
  return JSON.stringify(calls, (_key, value: unknown) =>
    value instanceof Error ? `${value.name}: ${value.message}` : value,
  );
}

/** Never settles: stands in for a coordinator whose background work hangs. */
function neverSettles(): Promise<never> {
  return new Promise<never>(() => undefined);
}

describe('ChatSessionService host routing admission', () => {
  describe('admits dispatched plain-text turns', () => {
    it('admits a chat:start turn with a null session id after the launch', async () => {
      const admitUserTurn: AdmitMock = jest.fn();
      const h = makeHarness({ admitUserTurn });

      await expect(
        h.service.startSession(startParams(PROMPT)),
      ).resolves.toEqual({ success: true });

      expect(admitUserTurn).toHaveBeenCalledTimes(1);
      expect(admitUserTurn).toHaveBeenCalledWith({
        tabId: TAB_ID,
        sessionId: null,
        prompt: PROMPT,
      });
      expect(h.startChatSession).toHaveBeenCalledTimes(1);
      expect(h.startChatSession.mock.invocationCallOrder[0]).toBeLessThan(
        admitUserTurn.mock.invocationCallOrder[0],
      );
    });

    it('admits a chat:continue turn with the real session id after the send', async () => {
      const admitUserTurn: AdmitMock = jest.fn();
      const h = makeHarness({ admitUserTurn });

      await expect(
        h.service.continueSession(continueParams(PROMPT)),
      ).resolves.toEqual({
        success: true,
        sessionId: SESSION_ID,
        enqueued: true,
      });

      expect(admitUserTurn).toHaveBeenCalledTimes(1);
      expect(admitUserTurn).toHaveBeenCalledWith({
        tabId: TAB_ID,
        sessionId: SESSION_ID,
        prompt: PROMPT,
      });
      expect(h.sendMessageToSession.mock.invocationCallOrder[0]).toBeLessThan(
        admitUserTurn.mock.invocationCallOrder[0],
      );
    });

    it('does not admit a continue turn before sendMessageToSession resolves', async () => {
      const admitUserTurn: AdmitMock = jest.fn();
      let releaseSend: () => void = () => undefined;
      const sendMessageToSession = jest.fn(
        () =>
          new Promise<void>((resolve) => {
            releaseSend = resolve;
          }),
      );
      const h = makeHarness({ admitUserTurn, sendMessageToSession });

      const turn = h.service.continueSession(continueParams(PROMPT));
      await new Promise((resolve) => setImmediate(resolve));
      expect(sendMessageToSession).toHaveBeenCalledTimes(1);
      expect(admitUserTurn).not.toHaveBeenCalled();

      releaseSend();
      await expect(turn).resolves.toMatchObject({ success: true });
      expect(admitUserTurn).toHaveBeenCalledTimes(1);
    });
  });

  describe('never admits', () => {
    it('a native slash command on chat:start', async () => {
      const admitUserTurn: AdmitMock = jest.fn();
      const h = makeHarness({
        admitUserTurn,
        intercept: jest.fn().mockReturnValue({
          action: 'native',
          commandName: 'clear',
          args: '',
          rawCommand: '/clear',
        }),
      });

      await h.service.startSession(startParams('/clear'));

      expect(admitUserTurn).not.toHaveBeenCalled();
    });

    it('a slash command that starts a new query on chat:start', async () => {
      const admitUserTurn: AdmitMock = jest.fn();
      const h = makeHarness({
        admitUserTurn,
        intercept: jest.fn().mockReturnValue({
          action: 'new-query',
          commandName: 'orchestrate',
          args: 'asset-audit',
          rawCommand: '/orchestrate asset-audit',
        }),
      });

      await h.service.startSession(startParams('/orchestrate asset-audit'));

      expect(h.startChatSession).toHaveBeenCalledTimes(1);
      expect(admitUserTurn).not.toHaveBeenCalled();
    });

    it('a slash command the follow-up router handles on chat:continue', async () => {
      const admitUserTurn: AdmitMock = jest.fn();
      const h = makeHarness({
        admitUserTurn,
        routeFollowUpSlashCommand: jest
          .fn()
          .mockResolvedValue({ success: true, sessionId: SESSION_ID }),
      });

      await h.service.continueSession(continueParams('/orchestrate audit'));

      expect(h.routeFollowUpSlashCommand).toHaveBeenCalledTimes(1);
      expect(admitUserTurn).not.toHaveBeenCalled();
    });

    it('a slash command the follow-up router passes through on chat:continue', async () => {
      const admitUserTurn: AdmitMock = jest.fn();
      const h = makeHarness({ admitUserTurn });

      await h.service.continueSession(continueParams('/compact'));

      expect(h.sendMessageToSession).toHaveBeenCalledTimes(1);
      expect(admitUserTurn).not.toHaveBeenCalled();
    });

    it('a Ptah-CLI chat:start turn', async () => {
      const admitUserTurn: AdmitMock = jest.fn();
      const h = makeHarness({
        admitUserTurn,
        ptahCliStart: jest
          .fn()
          .mockResolvedValue({ result: { success: true } }),
      });

      await h.service.startSession({
        ...startParams(PROMPT),
        ptahCliId: 'ptah-cli-1',
      });

      expect(h.startChatSession).not.toHaveBeenCalled();
      expect(admitUserTurn).not.toHaveBeenCalled();
    });

    it('a Ptah-CLI chat:continue turn', async () => {
      const admitUserTurn: AdmitMock = jest.fn();
      const h = makeHarness({
        admitUserTurn,
        ptahCliContinue: jest
          .fn()
          .mockResolvedValue({ success: true, sessionId: SESSION_ID }),
      });

      await h.service.continueSession(continueParams(PROMPT));

      expect(h.sendMessageToSession).not.toHaveBeenCalled();
      expect(admitUserTurn).not.toHaveBeenCalled();
    });

    it('a chat:resume activation', async () => {
      const admitUserTurn: AdmitMock = jest.fn();
      const h = makeHarness({ admitUserTurn });

      await h.service.resumeSession({
        tabId: TAB_ID,
        sessionId: SESSION_ID,
        workspacePath: WORKSPACE,
        activate: true,
      });

      expect(admitUserTurn).not.toHaveBeenCalled();
    });
  });

  describe('stays off the reply path', () => {
    it('resolves chat:start and chat:continue while the admission never settles', async () => {
      // A service that awaited the admission's result would hang here and
      // fail on the Jest timeout.
      const admitUserTurn: AdmitMock = jest.fn((_input: AdmitUserTurnInput) =>
        neverSettles(),
      );
      const h = makeHarness({ admitUserTurn });

      await expect(
        h.service.startSession(startParams(PROMPT)),
      ).resolves.toEqual({ success: true });
      await expect(
        h.service.continueSession(continueParams(PROMPT)),
      ).resolves.toMatchObject({ success: true, enqueued: true });
      expect(admitUserTurn).toHaveBeenCalledTimes(2);
    });

    it('does not fail the turn when the admission throws, and logs no prompt text', async () => {
      const secret = 'customer list for the Q3 audit';
      const admitUserTurn: AdmitMock = jest.fn((_input: AdmitUserTurnInput) => {
        throw new TypeError(`cannot admit "${secret}"`);
      });
      const h = makeHarness({ admitUserTurn });

      await expect(
        h.service.startSession(startParams(secret)),
      ).resolves.toEqual({ success: true });
      await expect(
        h.service.continueSession(continueParams(secret)),
      ).resolves.toEqual({
        success: true,
        sessionId: SESSION_ID,
        enqueued: true,
      });

      expect(h.logger.warn).toHaveBeenCalledTimes(2);
      // The mock's declared tuple is (message, context?); the service passes
      // (message, Error, context) through `Logger.warn(message, ...args)`.
      const call: readonly unknown[] = h.logger.warn.mock.calls[0];
      expect(call[0]).toBe('[RPC] host routing admission failed');
      expect(call[1]).toBeInstanceOf(Error);
      expect(call[1]).toMatchObject({
        message: 'admitUserTurn threw TypeError',
      });
      expect(call[2]).toEqual({ tabId: TAB_ID });
      for (const method of ['debug', 'info', 'warn', 'error'] as const) {
        expect(loggedText(h.logger[method].mock.calls)).not.toContain(secret);
      }
    });

    it('is a no-op when the host did not bind a coordinator', async () => {
      const h = makeHarness();

      await expect(
        h.service.startSession(startParams(PROMPT)),
      ).resolves.toEqual({ success: true });
      await expect(
        h.service.continueSession(continueParams(PROMPT)),
      ).resolves.toEqual({
        success: true,
        sessionId: SESSION_ID,
        enqueued: true,
      });
      expect(h.startChatSession).toHaveBeenCalledTimes(1);
      expect(h.sendMessageToSession).toHaveBeenCalledTimes(1);
      expect(h.logger.warn).not.toHaveBeenCalled();
    });
  });
});
