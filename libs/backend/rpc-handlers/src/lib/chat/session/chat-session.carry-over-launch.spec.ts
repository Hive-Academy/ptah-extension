import { createFakeDriverLockCoordinator } from '../../../test-utils/fake-driver-lock-coordinator';
/**
 * ChatSessionService — carry-over launch option (TASK_2026_865, Component 5).
 *
 * A carry-over start is pinned to the provider the carry-over checked: the
 * active provider is re-read after `prepare` on every runtime branch, and a
 * change creates nothing (F1). Its failures log and report fixed text only,
 * because the prompt holds the old conversation (F4).
 */

import 'reflect-metadata';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Same stub as the sibling specs: the workspace-intelligence barrel evaluates
// `import.meta.url`, which ts-jest's CJS transform cannot parse.
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

import type { ChatStartParams } from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { createMockWorkspaceProvider } from '@ptah-extension/platform-core/testing';

import { createMockModelSettings } from '../../../test-utils/mock-settings';
import {
  CARRY_OVER_PROVIDER_CHANGED,
  CARRY_OVER_START_FAILED,
  ChatSessionService,
} from './chat-session.service';
import { SessionMcpStatusRegistry } from './session-mcp-status.registry';

const TEST_ROOT = mkdtempSync(join(tmpdir(), 'ptah-carry-over-launch-'));
afterAll(() => rmSync(TEST_ROOT, { recursive: true, force: true }));
mkdirSync(join(TEST_ROOT, 'carry-over'), { recursive: true });
const WORKSPACE = `${TEST_ROOT}/carry-over`;
const TAB_ID = '5b0f6c2e-1d7a-4f3b-8e9c-a1b2c3d4e5f6';
const SENTINEL = 'TRANSCRIPT-SENTINEL-7f3a the customer list and api plan';
const PROMPT = `Summarize the earlier conversation.\n${SENTINEL}`;

type Execution =
  | {
      runtime: 'claude-sdk';
      model: string;
      providerProfile: { providerId: string } | undefined;
    }
  | {
      runtime: 'codex-app-server';
      seed: { providerId: 'openai-codex'; model: string };
      workspacePath: string;
      cwd: string;
      config: unknown;
    };

const claude = (providerId?: string): Execution => ({
  runtime: 'claude-sdk',
  model: 'default',
  providerProfile: providerId ? { providerId } : undefined,
});
const codex = (): Execution => ({
  runtime: 'codex-app-server',
  seed: { providerId: 'openai-codex', model: 'gpt-5' },
  workspacePath: WORKSPACE,
  cwd: WORKSPACE,
  config: {},
});

interface HarnessOptions {
  /** The active provider when the launch starts. */
  active: string;
  /** Applied inside `prepare`, before it resolves: the F1 race. */
  switchTo?: string;
  /** `prepare` result; `undefined` means no runtime profile is bound. */
  execution?: Execution;
  /** `resolveProviderProfileForWorkspace` result on the no-profile branch. */
  claudeProfile?: { providerId: string };
  prepareError?: Error;
  startError?: Error;
  /** `false` builds the service without the active-provider resolver. */
  withResolver?: boolean;
}

function makeHarness(opts: HarnessOptions) {
  const state = { active: opts.active };
  const stream = { [Symbol.asyncIterator]: jest.fn() };
  const logger = createMockLogger();
  const captureException = jest.fn();
  const startChatSession = opts.startError
    ? jest.fn().mockRejectedValue(opts.startError)
    : jest.fn().mockResolvedValue(stream);
  const resumeSession = jest.fn().mockResolvedValue(stream);
  const streamEventsToWebview = jest.fn();

  // Every metadata store call except the two reads counts as a write.
  const metadataWrites: string[] = [];
  const reads: Record<string, jest.Mock> = {
    get: jest.fn().mockResolvedValue(null),
    getCliSessionsForRestore: jest.fn().mockResolvedValue([]),
  };
  const metadataStore = new Proxy(
    {},
    {
      get: (_target, key: string | symbol) => {
        if (typeof key !== 'string' || key === 'then') return undefined;
        if (reads[key]) return reads[key];
        return (...args: unknown[]) => {
          metadataWrites.push(key);
          if (key === 'withCodexStartLineage') {
            const run = args[1] as () => Promise<unknown>;
            return run();
          }
          return Promise.resolve(undefined);
        };
      },
    },
  );

  const switchDuringPrepare = async <T>(result: () => T): Promise<T> => {
    await Promise.resolve();
    if (opts.switchTo !== undefined) state.active = opts.switchTo;
    if (opts.prepareError) throw opts.prepareError;
    return result();
  };
  const prepare = jest.fn(() =>
    switchDuringPrepare(() => opts.execution as Execution),
  );
  const runtimeProfile = opts.execution
    ? { prepare, publishRuntimeNotices: jest.fn().mockResolvedValue(undefined) }
    : undefined;
  const resolveProviderProfileForWorkspace = jest.fn(() =>
    switchDuringPrepare(() => opts.claudeProfile),
  );
  const activeProvider =
    opts.withResolver === false
      ? undefined
      : {
          resolveActiveAuthForPath: jest.fn(() => ({
            authMethod: 'thirdParty',
            providerId: state.active,
          })),
        };

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
      isSessionActive: jest.fn().mockReturnValue(false),
      sendMessageToSession: jest.fn().mockResolvedValue(undefined),
      endSession: jest.fn().mockResolvedValue(undefined),
      interruptSession: jest.fn().mockResolvedValue(undefined),
    } as never,
    { captureException } as never,
    { getPort: jest.fn().mockReturnValue(0) } as never,
    {
      readForResume: jest.fn(),
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
      intercept: jest.fn().mockReturnValue({ action: 'passthrough' }),
    } as never,
    metadataStore as never,
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
    { handleStart: jest.fn() } as never,
    {
      streamEventsToWebview,
      isStreaming: jest.fn().mockReturnValue(false),
    } as never,
    { injectInterruptedAgentsContext: jest.fn() } as never,
    { routeFollowUpSlashCommand: jest.fn() } as never,
    createMockModelSettings() as never,
    { getProviderKey: jest.fn().mockResolvedValue(undefined) } as never,
    {
      resolveStoredModel: jest.fn(
        (_path: string, model: string) => model || 'default',
      ),
      resolveProviderProfileForWorkspace,
    } as never,
    { resolveSessionFields: jest.fn().mockResolvedValue({}) } as never,
    new SessionMcpStatusRegistry(),
    { register: jest.fn().mockReturnValue(() => undefined) } as never,
    { register: jest.fn().mockReturnValue(() => undefined) } as never,
    undefined,
    undefined,
    undefined,
    undefined,
    activeProvider as never,
    runtimeProfile as never,
    undefined,
    undefined,
    undefined,
    createFakeDriverLockCoordinator(),
  );
  jest
    .spyOn(
      service as unknown as {
        buildMcpServersOverride: (caller: unknown) => Promise<unknown>;
      },
      'buildMcpServersOverride',
    )
    .mockResolvedValue(undefined);
  const pendingLineage = (
    service as unknown as { pendingLineage: Map<string, unknown> }
  ).pendingLineage;
  const lineageSet = jest.spyOn(pendingLineage, 'set');

  return {
    service,
    logger,
    captureException,
    startChatSession,
    resumeSession,
    streamEventsToWebview,
    metadataWrites,
    pendingLineage,
    lineageSet,
    prepare,
    resolveProviderProfileForWorkspace,
  };
}

type Harness = ReturnType<typeof makeHarness>;

function params(): ChatStartParams {
  return { tabId: TAB_ID, prompt: PROMPT, workspacePath: WORKSPACE };
}

/** Every logged argument as text; an `Error` contributes its name, message and stack. */
function asText(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner instanceof Error
      ? `${inner.name}: ${inner.message}\n${inner.stack ?? ''}`
      : inner,
  );
}

function expectNoSentinel(h: Harness, result: unknown): void {
  for (const method of ['debug', 'info', 'warn', 'error'] as const) {
    expect(asText(h.logger[method].mock.calls)).not.toContain(SENTINEL);
  }
  expect(asText(h.captureException.mock.calls)).not.toContain(SENTINEL);
  expect(asText(result)).not.toContain(SENTINEL);
}

function expectNothingLaunched(h: Harness): void {
  expect(h.startChatSession).not.toHaveBeenCalled();
  expect(h.resumeSession).not.toHaveBeenCalled();
  expect(h.metadataWrites).toEqual([]);
  expect(h.lineageSet).not.toHaveBeenCalled();
  expect(h.pendingLineage.has(TAB_ID)).toBe(false);
  expect(h.streamEventsToWebview).not.toHaveBeenCalled();
}

function sentinelError(): Error {
  const error = new TypeError(`could not send "${SENTINEL}"`);
  error.stack = `TypeError: could not send "${SENTINEL}"\n    at fake (${SENTINEL}.ts:1:1)`;
  return error;
}

describe('ChatSessionService carry-over launch', () => {
  describe('the provider pin holds', () => {
    it.each([
      ['Claude with a matching profile', 'openrouter', claude('openrouter')],
      ['Claude with an undefined profile', 'anthropic', claude(undefined)],
      ['Codex whose seed matches', 'openai-codex', codex()],
    ] as const)('%s: starts once', async (_label, pin, execution) => {
      const h = makeHarness({ active: pin, execution });

      await expect(
        h.service.startSession(params(), { expectedProviderId: pin }),
      ).resolves.toEqual({ success: true });

      expect(h.startChatSession).toHaveBeenCalledTimes(1);
      expect(h.resumeSession).not.toHaveBeenCalled();
      expect(h.prepare).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: WORKSPACE }),
        undefined,
        true,
      );
    });

    it('starts once on the no-runtime-profile branch with a matching profile', async () => {
      const h = makeHarness({
        active: 'openrouter',
        claudeProfile: { providerId: 'openrouter' },
      });

      await expect(
        h.service.startSession(params(), { expectedProviderId: 'openrouter' }),
      ).resolves.toEqual({ success: true });
      expect(h.startChatSession).toHaveBeenCalledTimes(1);
    });
  });

  describe('R1: the admission hook', () => {
    it('runs once after the pin, before the adapter starts the session', async () => {
      const h = makeHarness({
        active: 'openrouter',
        execution: claude('openrouter'),
      });
      const onAdmitted = jest.fn();

      await expect(
        h.service.startSession(params(), {
          expectedProviderId: 'openrouter',
          onAdmitted,
        }),
      ).resolves.toEqual({ success: true });
      expect(onAdmitted).toHaveBeenCalledTimes(1);
      expect(onAdmitted.mock.invocationCallOrder[0]).toBeLessThan(
        h.startChatSession.mock.invocationCallOrder[0],
      );
    });

    it('does not run when the pin refuses the launch', async () => {
      const h = makeHarness({
        active: 'openrouter',
        switchTo: 'anthropic',
        execution: claude('openrouter'),
      });
      const onAdmitted = jest.fn();

      await expect(
        h.service.startSession(params(), {
          expectedProviderId: 'openrouter',
          onAdmitted,
        }),
      ).resolves.toEqual({
        success: false,
        error: CARRY_OVER_PROVIDER_CHANGED,
      });
      expect(onAdmitted).not.toHaveBeenCalled();
      expectNothingLaunched(h);
    });
  });

  describe('F1: the active provider switches back during prepare', () => {
    it.each([
      ['Claude with a matching profile', 'openrouter', claude('openrouter')],
      ['Claude with an undefined profile', 'openrouter', claude(undefined)],
      ['Codex whose seed matches', 'openai-codex', codex()],
    ] as const)(
      '%s: creates nothing (AC 2.3, 2.5)',
      async (_label, pin, execution) => {
        const h = makeHarness({
          active: pin,
          switchTo: 'anthropic',
          execution,
        });

        const result = await h.service.startSession(params(), {
          expectedProviderId: pin,
        });

        expect(result).toEqual({
          success: false,
          error: CARRY_OVER_PROVIDER_CHANGED,
        });
        expect(h.prepare).toHaveBeenCalledTimes(1);
        expectNothingLaunched(h);
        expect(h.captureException).not.toHaveBeenCalled();
        expect(h.logger.warn).not.toHaveBeenCalled();
        expect(h.logger.error).not.toHaveBeenCalled();
      },
    );

    it('the no-runtime-profile branch: creates nothing', async () => {
      const h = makeHarness({
        active: 'openrouter',
        switchTo: 'anthropic',
        claudeProfile: { providerId: 'openrouter' },
      });

      await expect(
        h.service.startSession(params(), { expectedProviderId: 'openrouter' }),
      ).resolves.toEqual({
        success: false,
        error: CARRY_OVER_PROVIDER_CHANGED,
      });
      expect(h.resolveProviderProfileForWorkspace).toHaveBeenCalledTimes(1);
      expectNothingLaunched(h);
    });
  });

  describe('refuses a launch it cannot pin', () => {
    it('a Claude profile that serves another provider', async () => {
      const h = makeHarness({
        active: 'anthropic',
        execution: claude('openrouter'),
      });

      await expect(
        h.service.startSession(params(), { expectedProviderId: 'anthropic' }),
      ).resolves.toEqual({
        success: false,
        error: CARRY_OVER_PROVIDER_CHANGED,
      });
      expectNothingLaunched(h);
    });

    it('a Codex execution when the pin is another provider', async () => {
      const h = makeHarness({ active: 'anthropic', execution: codex() });

      await expect(
        h.service.startSession(params(), { expectedProviderId: 'anthropic' }),
      ).resolves.toEqual({
        success: false,
        error: CARRY_OVER_PROVIDER_CHANGED,
      });
      expectNothingLaunched(h);
    });

    it('a host without the active-provider resolver (fail closed)', async () => {
      const h = makeHarness({
        active: 'anthropic',
        execution: claude(undefined),
        withResolver: false,
      });

      await expect(
        h.service.startSession(params(), { expectedProviderId: 'anthropic' }),
      ).resolves.toEqual({
        success: false,
        error: CARRY_OVER_PROVIDER_CHANGED,
      });
      expectNothingLaunched(h);
    });
  });

  describe('F4: a failure carries no transcript text (AC 8.5)', () => {
    it('a throw from prepare', async () => {
      const h = makeHarness({
        active: 'anthropic',
        execution: claude(undefined),
        prepareError: sentinelError(),
      });

      const result = await h.service.startSession(params(), {
        expectedProviderId: 'anthropic',
      });

      expect(result).toEqual({
        success: false,
        error: CARRY_OVER_START_FAILED,
      });
      expectNothingLaunched(h);
      expectNoSentinel(h, result);
      expect(h.logger.warn).toHaveBeenCalledWith(
        '[carry-over] start failed',
        expect.objectContaining({
          message: 'carry-over start threw TypeError',
        }),
        { tabId: TAB_ID },
      );
      expect(h.captureException).toHaveBeenCalledTimes(1);
      expect(h.captureException).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'carry-over start threw TypeError',
        }),
        { errorSource: 'ChatSessionService.carryOverStart' },
      );
      expect(h.logger.error).not.toHaveBeenCalled();
    });

    it('a throw from startChatSession', async () => {
      const h = makeHarness({
        active: 'anthropic',
        execution: claude(undefined),
        startError: sentinelError(),
      });

      const result = await h.service.startSession(params(), {
        expectedProviderId: 'anthropic',
      });

      expect(result).toEqual({
        success: false,
        error: CARRY_OVER_START_FAILED,
      });
      expect(h.startChatSession).toHaveBeenCalledTimes(1);
      expect(h.pendingLineage.has(TAB_ID)).toBe(false);
      expectNoSentinel(h, result);
      expect(h.captureException).toHaveBeenCalledTimes(1);
    });
  });

  describe('without a launch (regression pin)', () => {
    it('the same prepare throw takes the chat:start branch', async () => {
      const error = sentinelError();
      const h = makeHarness({
        active: 'anthropic',
        execution: claude(undefined),
        prepareError: error,
      });

      const result = await h.service.startSession(params());

      expect(result).toEqual({ success: false, error: error.message });
      expect(h.logger.error).toHaveBeenCalledWith(
        'RPC: chat:start failed',
        error,
      );
      expect(h.captureException).toHaveBeenCalledWith(error, {
        errorSource: 'ChatRpcHandlers.registerChatStart',
      });
      expect(h.logger.warn).not.toHaveBeenCalledWith(
        '[carry-over] start failed',
        expect.anything(),
        expect.anything(),
      );
    });

    it('a provider switch during prepare does not refuse chat:start', async () => {
      const h = makeHarness({
        active: 'openrouter',
        switchTo: 'anthropic',
        execution: claude('openrouter'),
      });

      await expect(h.service.startSession(params())).resolves.toEqual({
        success: true,
      });
      expect(h.startChatSession).toHaveBeenCalledTimes(1);
    });
  });
});
