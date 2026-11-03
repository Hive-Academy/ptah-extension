/**
 * ChatCarryOverService (TASK_2026_865, Component 4): eligibility, the
 * in-flight guard, the bounded read and the pinned start. The old session is
 * only read, and no transcript text reaches a log or a result.
 */

import 'reflect-metadata';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// `chat-session.service` (imported for its constants) pulls the
// workspace-intelligence barrel, whose `import.meta.url` ts-jest cannot parse.
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

import { RpcUserError } from '@ptah-extension/vscode-core';
import {
  CARRY_OVER_REQUEST_ID_TTL_MS,
  type ChatStartResult,
  type SessionId,
} from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';

import { createMockModelSettings } from '../../../test-utils/mock-settings';
import { ChatCarryOverService } from './chat-carry-over.service';
import {
  CARRY_OVER_INSTRUCTION,
  CARRY_OVER_READ_TAIL_BYTES,
  type CarryOverTranscript,
} from './chat-carry-over-transcript';
import { CARRY_OVER_PROVIDER_CHANGED } from './chat-session.service';

const TEST_ROOT = mkdtempSync(join(tmpdir(), 'ptah-carry-over-'));
afterAll(() => rmSync(TEST_ROOT, { recursive: true, force: true }));
const FOLDER = join(TEST_ROOT, 'project');
const OTHER_FOLDER = join(TEST_ROOT, 'other');
mkdirSync(FOLDER, { recursive: true });
mkdirSync(OTHER_FOLDER, { recursive: true });

const SESSION_ID = '0d4c3f0e-6a51-4c55-9a8e-2d3f8c1b7a10' as SessionId;
const TAB_ID = '5b0f6c2e-1d7a-4f3b-8e9c-a1b2c3d4e5f6';
const SENTINEL = 'TRANSCRIPT-SENTINEL-91c2 quarterly customer list';
const SECRET = 'sk-ant-REDACTME0123456789abcdef';
const SUMMARY_SECRET = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123';

type Execution =
  | { runtime: 'claude-sdk'; model: string; providerProfile: { providerId: string } | undefined }
  | { runtime: 'codex-app-server'; seed: { providerId: 'openai-codex'; model: string } };

const claudeExecution = (providerId?: string): Execution => ({
  runtime: 'claude-sdk',
  model: 'default',
  providerProfile: providerId ? { providerId } : undefined,
});
const codexExecution = (): Execution => ({
  runtime: 'codex-app-server',
  seed: { providerId: 'openai-codex', model: 'gpt-5' },
});

const transcript = (
  turns: CarryOverTranscript['turns'] = [
    { role: 'user', text: `Plan the uploader retries. ${SENTINEL}`, compactionSummary: false },
    { role: 'assistant', text: 'Use exponential backoff.', compactionSummary: false },
  ],
): CarryOverTranscript => ({
  turns,
  windowCoversWholeHistory: true,
  startsAtCompactionSummary: false,
});

interface HarnessOptions {
  /** Stored metadata of the old session. */
  metadata?: Record<string, unknown> | null;
  active?: string;
  /** `prepare` result; `undefined` means no runtime profile is bound. */
  execution?: Execution;
  prepareError?: Error;
  /** Claude profile on the no-runtime-profile branch. */
  claudeProfileError?: Error;
  codexSignedIn?: boolean | 'absent';
  withResolver?: boolean;
  folderError?: Error;
  read?: () => Promise<CarryOverTranscript>;
  start?: ChatStartResult;
  /** `assertAuthorizedFolder` refuses the folder, as `prepare` would. */
  folderUnauthorized?: boolean;
}

function makeHarness(opts: HarnessOptions = {}) {
  const state = { active: opts.active ?? 'openai-codex' };
  const logger = createMockLogger();
  const startSession = jest
    .fn()
    .mockResolvedValue(opts.start ?? { success: true });
  // The old session must never be resumed or continued (AC 2.3, 6.1).
  const session = {
    startSession,
    resumeSession: jest.fn(),
    continueSession: jest.fn(),
  };
  const resolveSessionFolder = opts.folderError
    ? jest.fn().mockRejectedValue(opts.folderError)
    : jest.fn().mockResolvedValue(FOLDER);

  const metadataWrites: string[] = [];
  const metadataGet = jest
    .fn()
    .mockResolvedValue(
      opts.metadata === undefined
        ? { providerId: 'anthropic', workspaceId: FOLDER }
        : opts.metadata,
    );
  const metadataStore = new Proxy(
    {},
    {
      get: (_target, key: string | symbol) => {
        if (key === 'get') return metadataGet;
        if (typeof key !== 'string' || key === 'then') return undefined;
        return () => {
          metadataWrites.push(key);
          return Promise.resolve(undefined);
        };
      },
    },
  );

  const readCarryOverTranscript = jest.fn(
    opts.read ?? (() => Promise.resolve(transcript())),
  );
  const prepare = jest.fn(async () => {
    if (opts.prepareError) throw opts.prepareError;
    return opts.execution as Execution;
  });
  const assertAuthorizedFolder = jest.fn((_folder: string) => {
    if (opts.folderUnauthorized) {
      throw new Error(
        'Access denied: session workspace must be an absolute path inside an open folder.',
      );
    }
  });
  const resolveProviderProfileForWorkspace = jest.fn(async () => {
    if (opts.claudeProfileError) throw opts.claudeProfileError;
    return undefined;
  });
  const profileResolver = {
    resolveStoredModel: jest.fn((_path: string, model: string) => model),
    resolveProviderProfileForWorkspace,
  };
  const activeProvider =
    opts.withResolver === false
      ? undefined
      : {
          resolveActiveAuthForPath: jest.fn(() => ({
            authMethod: 'thirdParty',
            providerId: state.active,
          })),
        };
  const isAuthenticated = jest
    .fn()
    .mockResolvedValue(opts.codexSignedIn === undefined ? true : opts.codexSignedIn);
  const codexAuth = opts.codexSignedIn === 'absent' ? undefined : { isAuthenticated };

  const service = new ChatCarryOverService(
    logger as never,
    session as never,
    { resolveSessionFolder } as never,
    metadataStore as never,
    { readCarryOverTranscript } as never,
    profileResolver as never,
    createMockModelSettings() as never,
    activeProvider as never,
    (opts.execution || opts.prepareError
      ? { prepare, assertAuthorizedFolder }
      : undefined) as never,
    codexAuth as never,
  );
  return {
    service,
    state,
    logger,
    session,
    startSession,
    resolveSessionFolder,
    metadataWrites,
    readCarryOverTranscript,
    prepare,
    assertAuthorizedFolder,
    resolveProviderProfileForWorkspace,
    isAuthenticated,
  };
}

type Harness = ReturnType<typeof makeHarness>;

const checkParams = (workspacePath = FOLDER) => ({ sessionId: SESSION_ID, workspacePath });
const carryParams = (workspacePath = FOLDER) => ({
  sessionId: SESSION_ID,
  tabId: TAB_ID,
  workspacePath,
  name: 'Uploader retries',
  ptahUiFence: true,
});

function logged(h: Harness): string {
  return JSON.stringify(
    (['debug', 'info', 'warn', 'error'] as const).map((method) => h.logger[method].mock.calls),
    (_key, value: unknown) =>
      value instanceof Error ? `${value.name}: ${value.message}\n${value.stack ?? ''}` : value,
  );
}

function expectAbsent(h: Harness, result: unknown, ...texts: string[]): void {
  for (const text of texts) {
    expect(logged(h)).not.toContain(text);
    expect(JSON.stringify(result)).not.toContain(text);
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('ChatCarryOverService', () => {
  describe('check: eligible on a provider mismatch (AC 1.1)', () => {
    it('Claude -> Codex', async () => {
      const h = makeHarness({ active: 'openai-codex', execution: codexExecution() });

      await expect(h.service.check(checkParams())).resolves.toEqual({
        eligible: true,
        providerId: 'openai-codex',
        providerName: 'Codex',
      });
      expect(h.isAuthenticated).toHaveBeenCalledTimes(1);
      expect(h.readCarryOverTranscript).not.toHaveBeenCalled();
      expect(h.startSession).not.toHaveBeenCalled();
    });

    it('OpenRouter -> Claude', async () => {
      const h = makeHarness({
        metadata: { providerId: 'openrouter', workspaceId: FOLDER },
        active: 'anthropic',
        execution: claudeExecution(undefined),
      });

      await expect(h.service.check(checkParams())).resolves.toEqual({
        eligible: true,
        providerId: 'anthropic',
        providerName: 'Claude',
      });
    });

    it('a third-party target is named from the provider registry', async () => {
      const h = makeHarness({ active: 'openrouter', execution: claudeExecution('openrouter') });

      const result = await h.service.check(checkParams());
      expect(result).toMatchObject({ eligible: true, providerId: 'openrouter' });
      expect(result).not.toMatchObject({ providerName: 'openrouter' });
    });
  });

  describe('check: not eligible', () => {
    it('the same provider, with no readiness probe (AC 2.5, K22)', async () => {
      const h = makeHarness({ active: 'anthropic', execution: claudeExecution(undefined) });

      await expect(h.service.check(checkParams())).resolves.toEqual({ eligible: false });
      expect(h.prepare).not.toHaveBeenCalled();
      expect(h.resolveProviderProfileForWorkspace).not.toHaveBeenCalled();
    });

    it.each([
      ['Codex', { active: 'openai-codex', prepareError: new Error('codex not ready') }],
      ['Claude', {
        metadata: { providerId: 'openrouter', workspaceId: FOLDER },
        active: 'anthropic',
        prepareError: new Error('claude not ready'),
      }],
      ['Claude without a runtime profile', {
        metadata: { providerId: 'openrouter', workspaceId: FOLDER },
        active: 'anthropic',
        claudeProfileError: new Error('profile failed'),
      }],
    ] as const)('a %s readiness probe that throws (AC 1.3)', async (_label, opts) => {
      const h = makeHarness(opts);

      await expect(h.service.check(checkParams())).resolves.toEqual({ eligible: false });
      expect(h.logger.warn).toHaveBeenCalledWith('[carry-over] readiness probe failed', {
        sessionId: SESSION_ID,
        error: 'Error',
      });
    });

    it('Codex not signed in (AC 1.3)', async () => {
      const h = makeHarness({ execution: codexExecution(), codexSignedIn: false });
      await expect(h.service.check(checkParams())).resolves.toEqual({ eligible: false });
    });

    it('Codex auth not bound (fail closed)', async () => {
      const h = makeHarness({ execution: codexExecution(), codexSignedIn: 'absent' });
      await expect(h.service.check(checkParams())).resolves.toEqual({ eligible: false });
    });

    it('no active-provider resolver (fail closed)', async () => {
      const h = makeHarness({ execution: codexExecution(), withResolver: false });
      await expect(h.service.check(checkParams())).resolves.toEqual({ eligible: false });
      expect(h.prepare).not.toHaveBeenCalled();
    });

    it('a proxy-era Codex Claude SDK session (AC 1.2)', async () => {
      const h = makeHarness({
        metadata: { providerId: 'openai-codex', workspaceId: FOLDER },
        active: 'anthropic',
        execution: claudeExecution(undefined),
      });

      await expect(h.service.check(checkParams())).resolves.toEqual({ eligible: false });
      expect(h.prepare).not.toHaveBeenCalled();
    });

    it('a native codex-app-server session, before any router call (T2)', async () => {
      const h = makeHarness({
        metadata: {
          workspaceId: FOLDER,
          codexExecution: {
            version: 1,
            sessionId: SESSION_ID,
            runtime: 'codex-app-server',
            providerId: 'openai-codex',
            workspaceId: FOLDER,
            codex: { normalizedHome: '/home/u/.codex' },
          },
        },
        active: 'anthropic',
        execution: claudeExecution(undefined),
      });

      await expect(h.service.check(checkParams())).resolves.toEqual({ eligible: false });
      await expect(h.service.carryOver(carryParams())).resolves.toMatchObject({
        success: false,
        reason: 'NOT_ELIGIBLE',
      });
      expect(h.readCarryOverTranscript).toHaveBeenCalledTimes(0);
      expect(h.prepare).not.toHaveBeenCalled();
      expect(h.startSession).not.toHaveBeenCalled();
    });

    it('a folder that is not the session folder, with no read (AC 2.6)', async () => {
      const h = makeHarness({ execution: codexExecution() });

      await expect(h.service.check(checkParams(OTHER_FOLDER))).resolves.toEqual({
        eligible: false,
      });
      await expect(h.service.carryOver(carryParams(OTHER_FOLDER))).resolves.toMatchObject({
        reason: 'NOT_ELIGIBLE',
      });
      expect(h.metadataWrites).toEqual([]);
      expect(h.readCarryOverTranscript).not.toHaveBeenCalled();
      expect(h.startSession).not.toHaveBeenCalled();
    });

    it('an unknown session, with no read (AC 2.6)', async () => {
      const h = makeHarness({
        execution: codexExecution(),
        folderError: new RpcUserError(`Session not found: ${SESSION_ID}`, 'SESSION_NOT_FOUND'),
      });

      await expect(h.service.check(checkParams())).resolves.toEqual({ eligible: false });
      await expect(h.service.carryOver(carryParams())).resolves.toMatchObject({
        reason: 'NOT_ELIGIBLE',
      });
      expect(h.readCarryOverTranscript).not.toHaveBeenCalled();
    });
  });

  describe('check: no lasting side effect (review fix 1)', () => {
    // Resolving a proxy-backed provider's profile acquires a pooled proxy that
    // the pool never releases on its own, so the offer must not resolve it.
    it.each(['openrouter', 'github-copilot', 'lm-studio'])(
      'a check without a click acquires no proxy for %s',
      async (active) => {
        const h = makeHarness({ active, execution: claudeExecution(active) });

        await expect(h.service.check(checkParams())).resolves.toMatchObject({
          eligible: true,
          providerId: active,
        });
        expect(h.prepare).not.toHaveBeenCalled();
        expect(h.resolveProviderProfileForWorkspace).not.toHaveBeenCalled();
        expect(h.startSession).not.toHaveBeenCalled();
      },
    );

    it('acquires no proxy and makes no offer without a runtime profile (R3: fail closed)', async () => {
      const h = makeHarness({ active: 'openrouter' });

      // The open-folder check lives on the runtime profile service; without
      // it the folder cannot be proved authorized, so there is no offer.
      await expect(h.service.check(checkParams())).resolves.toEqual({ eligible: false });
      expect(h.resolveProviderProfileForWorkspace).not.toHaveBeenCalled();
    });

    it('a proxy-backed offer runs the open-folder check first (R3)', async () => {
      const h = makeHarness({ active: 'openrouter', execution: claudeExecution('openrouter') });

      await expect(h.service.check(checkParams())).resolves.toMatchObject({ eligible: true });
      expect(h.assertAuthorizedFolder).toHaveBeenCalledWith(FOLDER);
      expect(h.prepare).not.toHaveBeenCalled();
    });

    it.each(['openrouter', 'github-copilot'])(
      'an unauthorized folder gets no offer for %s and acquires no proxy (R3)',
      async (active) => {
        const h = makeHarness({
          active,
          execution: claudeExecution(active),
          folderUnauthorized: true,
        });

        await expect(h.service.check(checkParams())).resolves.toEqual({ eligible: false });
        expect(h.assertAuthorizedFolder).toHaveBeenCalledWith(FOLDER);
        expect(h.prepare).not.toHaveBeenCalled();
        expect(h.resolveProviderProfileForWorkspace).not.toHaveBeenCalled();
        expect(h.startSession).not.toHaveBeenCalled();
        // Logged by class name only.
        expect(h.logger.warn).toHaveBeenCalledWith('[carry-over] readiness probe failed', {
          sessionId: SESSION_ID,
          error: 'Error',
        });
      },
    );

    it('a provider switch after a check leaves no retained probe proxy', async () => {
      const h = makeHarness({ active: 'openrouter', execution: claudeExecution('openrouter') });

      await h.service.check(checkParams());
      h.state.active = 'github-copilot';
      await expect(h.service.check(checkParams())).resolves.toMatchObject({
        eligible: true,
        providerId: 'github-copilot',
      });
      // Neither offer resolved a profile, so no proxy is held for either provider.
      expect(h.prepare).not.toHaveBeenCalled();
      expect(h.resolveProviderProfileForWorkspace).not.toHaveBeenCalled();

      // The click still runs the full readiness resolution on the current provider.
      await expect(h.service.carryOver(carryParams())).resolves.toMatchObject({
        success: true,
        providerId: 'github-copilot',
      });
      expect(h.prepare).toHaveBeenCalledTimes(1);
      expect(h.startSession).toHaveBeenCalledWith(expect.anything(), {
        expectedProviderId: 'github-copilot',
      });
    });

    it('a direct (non-proxy) provider is still probed by the check', async () => {
      const h = makeHarness({
        active: 'requesty',
        prepareError: new Error('requesty not ready'),
      });

      await expect(h.service.check(checkParams())).resolves.toEqual({ eligible: false });
      expect(h.prepare).toHaveBeenCalledTimes(1);
    });
  });

  describe('carryOver', () => {
    it('starts one new session on the checked provider (AC 2.1, 2.2, 2.3, 2.4)', async () => {
      const h = makeHarness({ execution: codexExecution() });

      const result = await h.service.carryOver(carryParams());

      expect(result).toEqual({ success: true, providerId: 'openai-codex', providerName: 'Codex' });
      // The probe is a NEW-session resolution: never the stored identity.
      expect(h.prepare).toHaveBeenCalledTimes(1);
      expect(h.prepare).toHaveBeenCalledWith(
        expect.objectContaining({ workspaceId: FOLDER, projectPath: FOLDER }),
        undefined,
        true,
      );
      expect(h.session.resumeSession).toHaveBeenCalledTimes(0);
      expect(h.session.continueSession).toHaveBeenCalledTimes(0);
      expect(h.metadataWrites).toEqual([]);

      expect(h.startSession).toHaveBeenCalledTimes(1);
      const [startParams, launch] = h.startSession.mock.calls[0];
      expect(startParams).toEqual({
        tabId: TAB_ID,
        workspacePath: FOLDER,
        prompt: expect.any(String),
        name: 'Uploader retries',
        ptahUiFence: true,
      });
      expect(startParams).not.toHaveProperty('options');
      expect(startParams.prompt.startsWith(CARRY_OVER_INSTRUCTION)).toBe(true);
      expect(launch).toEqual({ expectedProviderId: 'openai-codex' });

      expect(h.logger.info).toHaveBeenCalledWith('[carry-over] started', {
        sessionId: SESSION_ID,
        tabId: TAB_ID,
        providerId: 'openai-codex',
        source: 'claude-jsonl',
        keptTurns: 2,
        omittedTurns: 0,
      });
      expectAbsent(h, result, SENTINEL);
    });

    describe('request ID tags (R1)', () => {
      const REQUEST_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

      it('tags the tab\'s next resolution once, only after the start was admitted', async () => {
        const h = makeHarness({ execution: codexExecution() });
        h.startSession.mockImplementationOnce(
          async (_params: unknown, launch: { onAdmitted?: () => void }) => {
            // Before the pin passed, nothing is attributed to the launch.
            expect(h.service.claimResolutionRequestId(TAB_ID)).toBeUndefined();
            launch.onAdmitted?.();
            return { success: true };
          },
        );

        await expect(
          h.service.carryOver({ ...carryParams(), requestId: REQUEST_ID }),
        ).resolves.toMatchObject({ success: true });
        expect(h.startSession).toHaveBeenCalledWith(expect.anything(), {
          expectedProviderId: 'openai-codex',
          onAdmitted: expect.any(Function),
        });
        expect(h.service.claimResolutionRequestId('another-tab')).toBeUndefined();
        expect(h.service.claimResolutionRequestId(TAB_ID)).toBe(REQUEST_ID);
        // Claimed once: a later resolution of the tab goes out untagged.
        expect(h.service.claimResolutionRequestId(TAB_ID)).toBeUndefined();
      });

      it('a refused start leaves no tag behind', async () => {
        const h = makeHarness({
          execution: codexExecution(),
          start: { success: false, error: 'boom' },
        });
        h.startSession.mockImplementationOnce(
          async (_params: unknown, launch: { onAdmitted?: () => void }) => {
            launch.onAdmitted?.();
            return { success: false, error: 'boom' };
          },
        );

        await h.service.carryOver({ ...carryParams(), requestId: REQUEST_ID });
        expect(h.service.claimResolutionRequestId(TAB_ID)).toBeUndefined();
      });

      it('an unclaimed tag lapses after CARRY_OVER_REQUEST_ID_TTL_MS', async () => {
        const h = makeHarness({ execution: codexExecution() });
        h.startSession.mockImplementationOnce(
          async (_params: unknown, launch: { onAdmitted?: () => void }) => {
            launch.onAdmitted?.();
            return { success: true };
          },
        );
        const now = jest.spyOn(Date, 'now').mockReturnValue(1_000);
        try {
          await h.service.carryOver({ ...carryParams(), requestId: REQUEST_ID });
          now.mockReturnValue(1_000 + CARRY_OVER_REQUEST_ID_TTL_MS + 1);
          expect(h.service.claimResolutionRequestId(TAB_ID)).toBeUndefined();
        } finally {
          now.mockRestore();
        }
      });

      it('a launch without a request ID passes no admission hook', async () => {
        const h = makeHarness({ execution: codexExecution() });

        await h.service.carryOver(carryParams());
        expect(h.startSession.mock.calls[0][1]).toEqual({
          expectedProviderId: 'openai-codex',
        });
        expect(h.service.claimResolutionRequestId(TAB_ID)).toBeUndefined();
      });
    });

    it('reads the Claude JSONL tail with the bound and a timeout signal (AC 3.10)', async () => {
      const h = makeHarness({ execution: codexExecution() });

      await h.service.carryOver(carryParams());

      expect(h.readCarryOverTranscript).toHaveBeenCalledTimes(1);
      const [sessionId, folder, options] = h.readCarryOverTranscript.mock.calls[0] as unknown as [
        string,
        string,
        Record<string, unknown>,
      ];
      expect(sessionId).toBe(SESSION_ID);
      expect(folder).toBe(FOLDER);
      expect(options['tailBytes']).toBe(CARRY_OVER_READ_TAIL_BYTES);
      expect(options['signal']).toBeInstanceOf(AbortSignal);
      expect(Object.keys(options).sort()).toEqual(['signal', 'tailBytes']);
    });

    it('a provider switch during the read: NOT_ELIGIBLE, no start (AC 1.7, 2.5)', async () => {
      const read = deferred<CarryOverTranscript>();
      const readStarted = deferred<void>();
      const h = makeHarness({
        execution: codexExecution(),
        read: () => {
          readStarted.resolve();
          return read.promise;
        },
      });

      const pending = h.service.carryOver(carryParams());
      await readStarted.promise;
      expect(h.prepare).toHaveBeenCalledTimes(1);
      h.state.active = 'anthropic';
      read.resolve(transcript());

      await expect(pending).resolves.toEqual({
        success: false,
        reason: 'NOT_ELIGIBLE',
        error: expect.any(String),
      });
      expect(h.startSession).not.toHaveBeenCalled();
      expect(h.prepare).toHaveBeenCalledTimes(1);
      expect(h.metadataWrites).toEqual([]);
    });

    it('maps CARRY_OVER_PROVIDER_CHANGED from the start to NOT_ELIGIBLE', async () => {
      const h = makeHarness({
        execution: codexExecution(),
        start: { success: false, error: CARRY_OVER_PROVIDER_CHANGED },
      });

      await expect(h.service.carryOver(carryParams())).resolves.toMatchObject({
        success: false,
        reason: 'NOT_ELIGIBLE',
      });
    });

    it('a transcript sentinel in a start error stays out of the result and logs (AC 8.5)', async () => {
      const h = makeHarness({
        execution: codexExecution(),
        start: { success: false, error: `failed on "${SENTINEL}"` },
      });

      const result = await h.service.carryOver(carryParams());

      expect(result).toEqual({
        success: false,
        reason: 'START_FAILED',
        error: "Couldn't start a new chat with Codex.",
      });
      expectAbsent(h, result, SENTINEL);
    });

    it('a concurrent second call gets IN_FLIGHT and one start (AC 5.4)', async () => {
      const read = deferred<CarryOverTranscript>();
      const h = makeHarness({ execution: codexExecution(), read: () => read.promise });

      const first = h.service.carryOver(carryParams());
      await expect(h.service.carryOver(carryParams())).resolves.toMatchObject({
        success: false,
        reason: 'IN_FLIGHT',
      });
      read.resolve(transcript());
      await expect(first).resolves.toMatchObject({ success: true });
      expect(h.startSession).toHaveBeenCalledTimes(1);

      // The guard is released in `finally`, so a later carry-over may run.
      h.readCarryOverTranscript.mockImplementation(() => Promise.resolve(transcript()));
      await expect(h.service.carryOver(carryParams())).resolves.toMatchObject({ success: true });
      expect(h.startSession).toHaveBeenCalledTimes(2);
    });

    it('releases the guard after a failure', async () => {
      const h = makeHarness({
        execution: codexExecution(),
        read: () => Promise.reject(new Error('unreadable')),
      });

      await h.service.carryOver(carryParams());
      await expect(h.service.carryOver(carryParams())).resolves.toMatchObject({
        reason: 'HISTORY_UNREADABLE',
      });
    });

    it.each([
      ['an empty history', () => Promise.resolve(transcript([]))],
      ['a blank history', () =>
        Promise.resolve(transcript([{ role: 'user', text: '   ', compactionSummary: false }]))],
      ['an unreadable history', () => Promise.reject(new Error(`bad line ${SENTINEL}`))],
    ] as const)('%s makes no start (AC 5.1)', async (_label, read) => {
      const h = makeHarness({ execution: codexExecution(), read });

      const result = await h.service.carryOver(carryParams());

      expect(result).toEqual({
        success: false,
        reason: 'HISTORY_UNREADABLE',
        error: expect.any(String),
      });
      expect(h.startSession).not.toHaveBeenCalled();
      expectAbsent(h, result, SENTINEL);
    });

    it.each([
      [{ success: false, error: 'Auth needed', errorCode: 'AUTH_REQUIRED', providerId: 'openai-codex' }],
      [{ success: false, error: 'Codex chat is unavailable.', errorCode: 'CODEX_UNAVAILABLE' }],
    ] as const)('passes the start code through (AC 5.2): %o', async (start) => {
      const h = makeHarness({ execution: codexExecution(), start: start as ChatStartResult });

      const result = await h.service.carryOver(carryParams());

      expect(result).toEqual({
        success: false,
        reason: 'START_FAILED',
        error: "Couldn't start a new chat with Codex.",
        errorCode: start.errorCode,
        ...('providerId' in start ? { providerId: start.providerId } : {}),
      });
    });

    it('a cancelled start is START_FAILED', async () => {
      const h = makeHarness({
        execution: codexExecution(),
        start: { success: false, cancelled: true },
      });

      await expect(h.service.carryOver(carryParams())).resolves.toMatchObject({
        reason: 'START_FAILED',
      });
    });

    describe('secrets in the transcript and the summary (AC 8.3, 8.5)', () => {
      const withSecrets = () =>
        Promise.resolve<CarryOverTranscript>({
          turns: [
            {
              role: 'user',
              text: `Summary so far: token=${SUMMARY_SECRET}`,
              compactionSummary: true,
            },
            { role: 'user', text: `use key ${SECRET} please`, compactionSummary: false },
          ],
          windowCoversWholeHistory: false,
          startsAtCompactionSummary: true,
        });

      it('on success: redacted in the prompt, absent from logs and the result', async () => {
        const h = makeHarness({ execution: codexExecution(), read: withSecrets });

        const result = await h.service.carryOver(carryParams());

        expect(result).toMatchObject({ success: true });
        const prompt: string = h.startSession.mock.calls[0][0].prompt;
        expect(prompt).not.toContain(SECRET);
        expect(prompt).not.toContain(SUMMARY_SECRET);
        expectAbsent(h, result, SECRET, SUMMARY_SECRET);
      });

      it('on a forced start failure', async () => {
        const h = makeHarness({
          execution: codexExecution(),
          read: withSecrets,
          start: { success: false, error: `leaked ${SECRET} ${SUMMARY_SECRET}` },
        });

        const result = await h.service.carryOver(carryParams());

        expect(result).toMatchObject({ success: false, reason: 'START_FAILED' });
        expectAbsent(h, result, SECRET, SUMMARY_SECRET);
      });
    });

    it('never throws when the start throws', async () => {
      const h = makeHarness({ execution: codexExecution() });
      h.startSession.mockRejectedValue(new Error(`boom ${SENTINEL}`));

      const result = await h.service.carryOver(carryParams());

      expect(result).toMatchObject({ success: false, reason: 'START_FAILED' });
      expectAbsent(h, result, SENTINEL);
    });
  });
});
