/**
 * EnhancedPromptsRpcHandlers — unit specs.
 *
 * Surface under test: six RPC methods exposing the Enhanced Prompts feature
 * to the webview (`getStatus`, `runWizard`, `setEnabled`, `regenerate`,
 * `getPromptContent`, `download`). We lock in:
 *
 *   - Registration: `register()` wires all six methods into the mock
 *     RpcHandler.
 *   - Path resolution: `.` and `./` are resolved via `IWorkspaceProvider`;
 *     absolute paths pass through unchanged. Missing workspacePath returns a
 *     structured error (never throws).
 *   - Open access: `runWizard` and `regenerate` dispatch straight into
 *     EnhancedPromptsService for every workspace (no license gating).
 *   - Download: missing content returns a "generate first" error; a real
 *     content buffer is handed to `ISaveDialogProvider.showSaveAndWrite`
 *     with the expected filename/filters/title; user-cancelled save
 *     surfaces as a structured error, not a throw.
 *   - Never throws to the RPC boundary: handler surfaces errors as response
 *     objects (otherwise `handleMessage` would serialize them as generic
 *     failures — the UI relies on the structured `error` field).
 *
 * Mocking posture: direct constructor injection, no tsyringe container.
 *
 * Source-under-test:
 *   `libs/backend/rpc-handlers/src/lib/handlers/enhanced-prompts-rpc.handlers.ts`
 */

import 'reflect-metadata';

// ---------------------------------------------------------------------------
// Jest transitive-import guard.
//
// The SUT imports from `@ptah-extension/agent-generation`, whose barrel
// re-exports from `@ptah-extension/workspace-intelligence`. The
// workspace-intelligence barrel eagerly re-exports `TreeSitterParserService`,
// whose module top-level evaluates `path.dirname(fileURLToPath(import.meta.url))`
// — a construct Jest's ts-jest CJS transform cannot parse. Mirrors the pattern
// used in `wizard-generation-rpc.handlers.spec.ts`.
// ---------------------------------------------------------------------------
jest.mock('@ptah-extension/workspace-intelligence', () => ({
  ProjectType: {
    Node: 'node',
    React: 'react',
    Vue: 'vue',
    Angular: 'angular',
    NextJS: 'nextjs',
    Python: 'python',
    Java: 'java',
    Rust: 'rust',
    Go: 'go',
    DotNet: 'dotnet',
    PHP: 'php',
    Ruby: 'ruby',
    General: 'general',
    Unknown: 'unknown',
  },
  Framework: {
    React: 'react',
    Vue: 'vue',
    Angular: 'angular',
    NextJS: 'nextjs',
    Nuxt: 'nuxt',
    Express: 'express',
    Django: 'django',
    Laravel: 'laravel',
    Rails: 'rails',
    Svelte: 'svelte',
    Astro: 'astro',
    NestJS: 'nestjs',
    Fastify: 'fastify',
    Flask: 'flask',
    FastAPI: 'fastapi',
    Spring: 'spring',
  },
  MonorepoType: {
    Nx: 'nx',
    Lerna: 'lerna',
    Rush: 'rush',
    Turborepo: 'turborepo',
    PnpmWorkspaces: 'pnpm-workspaces',
    YarnWorkspaces: 'yarn-workspaces',
  },
  FileType: {
    Source: 'source',
    Test: 'test',
    Config: 'config',
    Documentation: 'docs',
    Asset: 'asset',
  },
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

import type { DependencyContainer } from 'tsyringe';
import type { Logger, SentryService } from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  createMockSentryService,
  type MockRpcHandler,
  type MockSentryService,
} from '@ptah-extension/vscode-core/testing';
import type {
  ISaveDialogProvider,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  createMockWorkspaceProvider,
  type MockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';
import type { PluginLoaderService } from '@ptah-extension/agent-sdk';
import type {
  AnalysisStorageService,
  EnhancedPromptsService,
} from '@ptah-extension/agent-generation';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { EnhancedPromptsRpcHandlers } from './enhanced-prompts-rpc.handlers';
import { authorizeTabWorkspace } from './wizard-generation-binding';
import type { WebviewBroadcaster } from '../harness/streaming';

jest.mock('./wizard-generation-binding', () => ({
  authorizeTabWorkspace: jest.fn(
    async (host: string, binding: { workspacePath: string }) =>
      host === binding.workspacePath ? host : null,
  ),
}));

const WORKSPACE = '/fake/workspace';
const ANALYSIS_ROOT = `${WORKSPACE}/.ptah/analysis`;

type MockAnalysisStorage = jest.Mocked<
  Pick<AnalysisStorageService, 'resolveAuthorizedAnalysisDir' | 'loadManifest'>
>;

/**
 * Mirrors the real canonicalization contract closely enough for the handler
 * spec: a candidate under `<workspace>/.ptah/analysis` resolves to itself,
 * anything else is rejected with null.
 */
function createMockAnalysisStorage(): MockAnalysisStorage {
  return {
    loadManifest: jest.fn().mockResolvedValue({ runId: 'analysis-run' }),
    resolveAuthorizedAnalysisDir: jest.fn(
      (workspacePath: string, candidate: string): string | null =>
        candidate.startsWith(`${workspacePath}/.ptah/analysis`) &&
        !candidate.includes('..')
          ? candidate
          : null,
    ),
  };
}

// ---------------------------------------------------------------------------
// Narrow mock surfaces — only what the handler actually touches.
// ---------------------------------------------------------------------------

type MockEnhancedPromptsService = jest.Mocked<
  Pick<
    EnhancedPromptsService,
    | 'getStatus'
    | 'runWizard'
    | 'setEnabled'
    | 'regenerate'
    | 'getFullCombinedPromptContent'
    | 'acquireBoundGeneration'
    | 'releaseBoundGeneration'
    | 'resolveGuidanceRoute'
    | 'resolveGuidanceSource'
  >
>;

function createMockEnhancedPromptsService(): MockEnhancedPromptsService {
  return {
    getStatus: jest.fn(),
    runWizard: jest.fn(),
    setEnabled: jest.fn(),
    regenerate: jest.fn(),
    getFullCombinedPromptContent: jest.fn(),
    acquireBoundGeneration: jest.fn().mockReturnValue({}),
    releaseBoundGeneration: jest.fn(),
    resolveGuidanceRoute: jest
      .fn()
      .mockResolvedValue({ providerId: 'anthropic', model: 'sonnet' }),
    resolveGuidanceSource: jest
      .fn()
      .mockResolvedValue({ kind: 'workspace-discovery', reason: 'missing' }),
  };
}

type MockPluginLoader = jest.Mocked<
  Pick<PluginLoaderService, 'getWorkspacePluginConfig' | 'resolvePluginPaths'>
>;

function createMockPluginLoader(): MockPluginLoader {
  return {
    getWorkspacePluginConfig: jest.fn().mockReturnValue({
      enabledPluginIds: [],
      disabledSkillIds: [],
    }),
    resolvePluginPaths: jest.fn().mockReturnValue([]),
  };
}

type MockSaveDialog = jest.Mocked<
  Pick<ISaveDialogProvider, 'showSaveAndWrite'>
>;

function createMockSaveDialog(): MockSaveDialog {
  return { showSaveAndWrite: jest.fn() };
}

type MockContainer = jest.Mocked<
  Pick<DependencyContainer, 'isRegistered' | 'resolve'>
>;

function createMockContainer(): MockContainer {
  return {
    // Handler probes for optional collaborators (WebviewManager,
    // CodeExecutionMCP). Default to "not registered" — the handler's
    // best-effort branches MUST tolerate absence.
    isRegistered: jest.fn().mockReturnValue(false),
    resolve: jest.fn(),
  } as unknown as MockContainer;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  handlers: EnhancedPromptsRpcHandlers;
  logger: MockLogger;
  rpcHandler: MockRpcHandler;
  enhancedPrompts: MockEnhancedPromptsService;
  analysisStorage: MockAnalysisStorage;
  pluginLoader: MockPluginLoader;
  workspace: MockWorkspaceProvider;
  saveDialog: MockSaveDialog;
  container: MockContainer;
  sentry: MockSentryService;
}

function makeHarness(
  opts: { workspaceRoot?: string; broadcaster?: WebviewBroadcaster } = {},
): Harness {
  const logger = createMockLogger();
  const rpcHandler = createMockRpcHandler();
  const enhancedPrompts = createMockEnhancedPromptsService();
  const analysisStorage = createMockAnalysisStorage();
  const pluginLoader = createMockPluginLoader();
  const workspace = createMockWorkspaceProvider({
    folders: [opts.workspaceRoot ?? WORKSPACE],
  });
  const saveDialog = createMockSaveDialog();
  const container = createMockContainer();
  const sentry = createMockSentryService();

  const handlers = new EnhancedPromptsRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as import('@ptah-extension/vscode-core').RpcHandler,
    enhancedPrompts as unknown as EnhancedPromptsService,
    analysisStorage as unknown as AnalysisStorageService,
    pluginLoader as unknown as PluginLoaderService,
    workspace as unknown as IWorkspaceProvider,
    saveDialog as unknown as ISaveDialogProvider,
    sentry as unknown as SentryService,
    opts.broadcaster,
    undefined,
  );

  return {
    handlers,
    logger,
    rpcHandler,
    enhancedPrompts,
    analysisStorage,
    pluginLoader,
    workspace,
    saveDialog,
    container,
    sentry,
  };
}

async function call<TResult>(
  h: Harness,
  method: string,
  params: unknown = {},
): Promise<TResult> {
  const response = await h.rpcHandler.handleMessage({
    method,
    params: params as Record<string, unknown>,
    correlationId: `corr-${method}`,
  });
  if (!response.success) {
    throw new Error(`RPC ${method} failed: ${response.error}`);
  }
  return response.data as TResult;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EnhancedPromptsRpcHandlers', () => {
  describe('register()', () => {
    it('routes cancel and run-state lookup to the prepared functions', async () => {
      const h = makeHarness();
      const cancel = jest
        .spyOn(h.handlers, 'cancelGuidance')
        .mockResolvedValue({ cancelled: false });
      const lookup = jest
        .spyOn(h.handlers, 'getGuidanceRunState')
        .mockResolvedValue({ run: null });
      h.handlers.register();
      await call(h, 'enhancedPrompts:cancel', {});
      await call(h, 'enhancedPrompts:getRunState', {});
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(lookup).toHaveBeenCalledTimes(1);
    });
    it('registers all eight enhancedPrompts RPC methods', () => {
      const h = makeHarness();
      h.handlers.register();

      expect(h.rpcHandler.getRegisteredMethods().sort()).toEqual(
        [
          'enhancedPrompts:download',
          'enhancedPrompts:getPromptContent',
          'enhancedPrompts:getStatus',
          'enhancedPrompts:regenerate',
          'enhancedPrompts:cancel',
          'enhancedPrompts:getRunState',
          'enhancedPrompts:runWizard',
          'enhancedPrompts:setEnabled',
        ].sort(),
      );
    });
  });

  // -------------------------------------------------------------------------
  // enhancedPrompts:getStatus
  // -------------------------------------------------------------------------

  describe('enhancedPrompts:getStatus', () => {
    it('returns an error shape when workspacePath is missing', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ enabled: boolean; error?: string }>(
        h,
        'enhancedPrompts:getStatus',
        {},
      );

      expect(result.enabled).toBe(false);
      expect(result.error).toMatch(/workspace path is required/i);
      expect(h.enhancedPrompts.getStatus).not.toHaveBeenCalled();
    });

    it('resolves "." to the workspace root before delegating', async () => {
      const h = makeHarness({ workspaceRoot: '/real/root' });
      h.enhancedPrompts.getStatus.mockResolvedValue({
        enabled: true,
        hasGeneratedPrompt: true,
        generatedAt: '2026-01-01T00:00:00Z',
        detectedStack: null,
        cacheValid: true,
        invalidationReason: undefined,
      });
      h.handlers.register();

      await call(h, 'enhancedPrompts:getStatus', { workspacePath: '.' });

      expect(h.enhancedPrompts.getStatus).toHaveBeenCalledWith('/real/root');
    });

    it('passes absolute workspacePath through unchanged', async () => {
      const h = makeHarness();
      h.enhancedPrompts.getStatus.mockResolvedValue({
        enabled: true,
        hasGeneratedPrompt: false,
        generatedAt: null,
        detectedStack: null,
        cacheValid: false,
        invalidationReason: undefined,
      });
      h.handlers.register();

      await call(h, 'enhancedPrompts:getStatus', {
        workspacePath: '/explicit/path',
      });

      expect(h.enhancedPrompts.getStatus).toHaveBeenCalledWith(
        '/explicit/path',
      );
    });

    it('captures service exceptions to Sentry and returns error shape', async () => {
      const h = makeHarness();
      h.enhancedPrompts.getStatus.mockRejectedValue(new Error('boom'));
      h.handlers.register();

      const result = await call<{ enabled: boolean; error?: string }>(
        h,
        'enhancedPrompts:getStatus',
        { workspacePath: '/x' },
      );

      expect(result.enabled).toBe(false);
      expect(result.error).toBe('boom');
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // enhancedPrompts:runWizard
  // -------------------------------------------------------------------------

  describe('enhancedPrompts:runWizard', () => {
    const tabBinding = {
      tabId: 'prompt-tab',
      workflow: 'setup-project-prompt' as const,
      workspacePath: WORKSPACE,
    };

    it('accepts a bound run, ignores client analysis, and resolves a lost start response', async () => {
      const h = makeHarness();
      h.enhancedPrompts.runWizard.mockImplementation(
        () => new Promise(() => undefined),
      );
      h.handlers.register();
      const first = await call<{
        success: boolean;
        accepted?: { runId: string; source: { kind: string } };
      }>(h, 'enhancedPrompts:runWizard', {
        workspacePath: WORKSPACE,
        tabBinding,
        analysisData: { hostile: true },
      });
      expect(first.accepted?.runId).toBeTruthy();
      expect(first.accepted?.source.kind).toBe('workspace-discovery');
      expect(h.enhancedPrompts.runWizard).toHaveBeenCalledWith(
        WORKSPACE,
        undefined,
        expect.any(Function),
        undefined,
        expect.any(Object),
        undefined,
        expect.objectContaining({ reservation: expect.any(Object) }),
      );
      expect(
        (await h.handlers.getGuidanceRunState({ tabBinding })).run?.binding
          .runId,
      ).toBe(first.accepted?.runId);
      const second = await call<{ accepted?: { runId: string } }>(
        h,
        'enhancedPrompts:runWizard',
        { workspacePath: WORKSPACE, tabBinding },
      );
      expect(second.accepted?.runId).toBe(first.accepted?.runId);
      expect(h.enhancedPrompts.runWizard).toHaveBeenCalledTimes(1);
    });

    it('broadcasts timed-out lifecycle when the service timeout ends a bound run', async () => {
      const broadcaster: WebviewBroadcaster = {
        broadcastMessage: jest.fn().mockResolvedValue(undefined),
      };
      const h = makeHarness({ broadcaster });
      let onTimeout: (() => void) | undefined;
      h.enhancedPrompts.runWizard.mockImplementation(
        async (
          _workspace,
          _config,
          _progress,
          _input,
          _sdk,
          _analysisDir,
          bound,
        ) => {
          onTimeout = bound?.onTimeout;
          onTimeout?.();
          return { success: false, error: 'Guidance generation timed out' };
        },
      );
      h.handlers.register();
      const response = await call<{ accepted?: { runId: string } }>(
        h,
        'enhancedPrompts:runWizard',
        {
          workspacePath: WORKSPACE,
          tabBinding,
        },
      );
      expect(response.accepted?.runId).toBeTruthy();
      await new Promise((resolve) => setImmediate(resolve));
      expect(broadcaster.broadcastMessage).toHaveBeenCalledWith(
        'setup-wizard:enhance-stream',
        expect.objectContaining({
          lifecycle: 'timed-out',
          tabBinding: expect.objectContaining({
            runId: response.accepted?.runId,
          }),
        }),
      );
      expect(
        (
          await h.handlers.getGuidanceRunState({
            tabBinding,
            runId: response.accepted?.runId,
          })
        ).run?.committedState,
      ).toBe('unchanged');
    });

    it('broadcasts a failed terminal event when bound execution throws', async () => {
      const broadcaster: WebviewBroadcaster = {
        broadcastMessage: jest.fn().mockResolvedValue(undefined),
      };
      const h = makeHarness({ broadcaster });
      h.enhancedPrompts.runWizard.mockRejectedValue(new Error('broken'));
      h.handlers.register();
      const response = await call<{ accepted: { runId: string } }>(
        h,
        'enhancedPrompts:runWizard',
        { workspacePath: WORKSPACE, tabBinding },
      );
      await new Promise((resolve) => setImmediate(resolve));
      expect(broadcaster.broadcastMessage).toHaveBeenCalledWith(
        'setup-wizard:enhance-stream',
        expect.objectContaining({
          lifecycle: 'failed',
          tabBinding: expect.objectContaining({
            runId: response.accepted.runId,
          }),
        }),
      );
    });

    it('force release emits one terminal event and preserves the old run', async () => {
      const broadcaster: WebviewBroadcaster = {
        broadcastMessage: jest.fn().mockResolvedValue(undefined),
      };
      const h = makeHarness({ broadcaster });
      let release: (value: { success: boolean }) => void = () => undefined;
      let forceRelease: (() => void) | undefined;
      h.enhancedPrompts.runWizard.mockImplementationOnce(
        (_ws, _config, _progress, _input, _sdk, _dir, bound) => {
          forceRelease = bound?.onForceRelease;
          return new Promise((resolve) => {
            release = resolve;
          });
        },
      );
      h.handlers.register();
      const first = await call<{ accepted: { runId: string } }>(
        h,
        'enhancedPrompts:runWizard',
        { workspacePath: WORKSPACE, tabBinding },
      );
      forceRelease?.();
      forceRelease?.();
      h.enhancedPrompts.runWizard.mockImplementationOnce(
        () => new Promise(() => undefined),
      );
      const second = await call<{ accepted: { runId: string } }>(
        h,
        'enhancedPrompts:runWizard',
        {
          workspacePath: WORKSPACE,
          tabBinding: { ...tabBinding, tabId: 'next' },
        },
      );
      release({ success: false });
      await new Promise((resolve) => setImmediate(resolve));
      expect(
        (
          await h.handlers.getGuidanceRunState({
            tabBinding,
            runId: first.accepted.runId,
          })
        ).run,
      ).toMatchObject({ status: 'timed-out', committedState: 'unknown' });
      expect(second.accepted.runId).not.toBe(first.accepted.runId);
      const terminal = (
        broadcaster.broadcastMessage as jest.Mock
      ).mock.calls.filter(
        ([, event]) =>
          event.tabBinding?.runId === first.accepted.runId &&
          event.lifecycle === 'timed-out',
      );
      expect(terminal).toHaveLength(1);
    });

    it('uses the authorized canonical path for cancel and lookup', async () => {
      const authorize = jest.mocked(authorizeTabWorkspace);
      authorize.mockImplementation(async (host, binding) =>
        host === WORKSPACE && binding.workspacePath === WORKSPACE
          ? '/FAKE/workspace'
          : null,
      );
      try {
        const h = makeHarness();
        h.enhancedPrompts.runWizard.mockImplementation(
          () => new Promise(() => undefined),
        );
        h.handlers.register();
        const response = await call<{ accepted: { runId: string } }>(
          h,
          'enhancedPrompts:runWizard',
          { workspacePath: WORKSPACE, tabBinding },
        );
        expect(
          (
            await h.handlers.getGuidanceRunState({
              tabBinding,
              runId: response.accepted.runId,
            })
          ).run?.binding.workspacePath,
        ).toBe('/FAKE/workspace');
        expect(
          (
            await h.handlers.cancelGuidance({
              tabBinding: { ...tabBinding, runId: response.accepted.runId },
            })
          ).outcome,
        ).toBe('cancelled');
      } finally {
        authorize.mockImplementation(async (host, binding) =>
          host === binding.workspacePath ? host : null,
        );
      }
    });

    it('rejects foreign tabs and foreign analysis before service preparation', async () => {
      const h = makeHarness();
      h.handlers.register();
      const foreign = await call<{ rejection?: { reason: string } }>(
        h,
        'enhancedPrompts:runWizard',
        {
          workspacePath: WORKSPACE,
          tabBinding: { ...tabBinding, workspacePath: '/other' },
          analysisData: { hostile: true },
        },
      );
      expect(foreign.rejection?.reason).toBe('workspace-mismatch');
      const directory = await call<{ rejection?: { reason: string } }>(
        h,
        'enhancedPrompts:runWizard',
        {
          workspacePath: WORKSPACE,
          tabBinding,
          analysisDir: '/foreign/analysis',
        },
      );
      expect(directory.rejection?.reason).toBe('foreign-directory');
      expect(h.enhancedPrompts.acquireBoundGeneration).not.toHaveBeenCalled();
    });

    it('reports an existing service lock as blocked before acceptance', async () => {
      const h = makeHarness();
      h.enhancedPrompts.acquireBoundGeneration.mockReturnValue(null);
      h.handlers.register();
      const result = await call<{ rejection?: { reason: string } }>(
        h,
        'enhancedPrompts:runWizard',
        { workspacePath: WORKSPACE, tabBinding },
      );
      expect(result.rejection?.reason).toBe('blocked');
      expect(h.enhancedPrompts.runWizard).not.toHaveBeenCalled();
    });

    it('uses only the latest verified phase directory for a bound run', async () => {
      const h = makeHarness();
      const latest = `${ANALYSIS_ROOT}/latest`;
      h.enhancedPrompts.resolveGuidanceSource.mockResolvedValue({
        kind: 'verified-analysis',
        analysisDir: latest,
        analysisRunId: '',
      });
      h.enhancedPrompts.runWizard.mockResolvedValue({
        success: false,
        error: 'stopped',
      });
      h.handlers.register();
      const result = await call<{
        accepted?: { source: { kind: string; analysisRunId?: string } };
      }>(h, 'enhancedPrompts:runWizard', {
        workspacePath: WORKSPACE,
        tabBinding,
        analysisDir: latest,
      });
      expect(result.accepted?.source).toEqual({
        kind: 'verified-analysis',
        analysisDir: latest,
        analysisRunId: 'analysis-run',
      });
      expect(h.enhancedPrompts.runWizard).toHaveBeenCalledWith(
        WORKSPACE,
        undefined,
        expect.any(Function),
        undefined,
        expect.any(Object),
        latest,
        expect.any(Object),
      );
    });

    it('falls back to workspace discovery for stale analysis and records the effective model', async () => {
      const h = makeHarness();
      h.enhancedPrompts.resolveGuidanceSource.mockResolvedValue({
        kind: 'workspace-discovery',
        reason: 'stale',
      });
      h.enhancedPrompts.resolveGuidanceRoute.mockResolvedValue({
        providerId: 'openrouter',
        model: 'supported-fallback',
      });
      h.enhancedPrompts.runWizard.mockImplementation(
        () => new Promise(() => undefined),
      );
      h.handlers.register();
      const result = await call<{
        accepted?: {
          source: { kind: string; reason?: string };
          effectiveModel: string;
        };
      }>(h, 'enhancedPrompts:runWizard', {
        workspacePath: WORKSPACE,
        tabBinding,
        model: 'unsupported',
        analysisDir: `${ANALYSIS_ROOT}/old`,
      });
      expect(result.accepted?.source).toEqual({
        kind: 'workspace-discovery',
        reason: 'stale',
      });
      expect(result.accepted?.effectiveModel).toBe('supported-fallback');
      expect(h.enhancedPrompts.resolveGuidanceRoute).toHaveBeenCalledWith(
        WORKSPACE,
        'unsupported',
      );
      expect(h.enhancedPrompts.runWizard).toHaveBeenCalledWith(
        WORKSPACE,
        undefined,
        expect.any(Function),
        undefined,
        expect.any(Object),
        undefined,
        expect.any(Object),
      );
    });

    it('cancels only the exact bound run', async () => {
      const h = makeHarness();
      h.enhancedPrompts.runWizard.mockImplementation(
        () => new Promise(() => undefined),
      );
      h.handlers.register();
      const response = await call<{ accepted: { runId: string } }>(
        h,
        'enhancedPrompts:runWizard',
        { workspacePath: WORKSPACE, tabBinding },
      );
      expect(
        (
          await h.handlers.cancelGuidance({
            tabBinding: {
              ...tabBinding,
              runId: '00000000-0000-4000-8000-000000000000',
            },
          })
        ).outcome,
      ).toBe('not-running');
      expect(
        (
          await h.handlers.cancelGuidance({
            tabBinding: { ...tabBinding, runId: response.accepted.runId },
          })
        ).outcome,
      ).toBe('cancelled');
    });

    it('rejects missing workspacePath with structured error', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'enhancedPrompts:runWizard',
        {},
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/workspace path is required/i);
      expect(h.enhancedPrompts.runWizard).not.toHaveBeenCalled();
    });

    it('dispatches to EnhancedPromptsService and forwards the result', async () => {
      const h = makeHarness();
      h.enhancedPrompts.runWizard.mockResolvedValue({
        success: true,
        state: {
          enabled: true,
          generatedPrompt: 'DO NOT LEAK',
          generatedAt: '2026-01-01T00:00:00Z',
          detectedStack: null,
          configHash: 'abc',
          workspacePath: '/x',
        },
        summary: null,
      } as unknown as Awaited<ReturnType<EnhancedPromptsService['runWizard']>>);
      h.handlers.register();

      const result = await call<{
        success: boolean;
        generatedAt?: string;
        detectedStack?: unknown;
        summary?: unknown;
      }>(h, 'enhancedPrompts:runWizard', { workspacePath: WORKSPACE });

      expect(h.enhancedPrompts.runWizard).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(true);
      expect(result.generatedAt).toBe('2026-01-01T00:00:00Z');
      expect(result.detectedStack).toBeNull();
      expect(result.summary).toBeNull();
      // IP-protection: generated prompt content must NOT leak back to the UI.
      expect(result).not.toHaveProperty('generatedPrompt');
    });

    it('forwards a service-level failure result', async () => {
      const h = makeHarness();
      h.enhancedPrompts.runWizard.mockResolvedValue({
        success: false,
        error: 'some internal error',
      } as unknown as Awaited<ReturnType<EnhancedPromptsService['runWizard']>>);
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'enhancedPrompts:runWizard',
        { workspacePath: WORKSPACE },
      );

      expect(h.enhancedPrompts.runWizard).toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.error).toBe('some internal error');
    });

    it('rejects a workspacePath that is not an open folder before the service is reached', async () => {
      // runWizard writes the enhanced-prompt trace to disk under the
      // workspace, so the workspace itself must be authorized.
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'enhancedPrompts:runWizard',
        { workspacePath: '/tmp/evil' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/access denied/i);
      expect(h.enhancedPrompts.runWizard).not.toHaveBeenCalled();
    });

    it('rejects an analysisDir outside <workspace>/.ptah/analysis before the trace writer is reached', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'enhancedPrompts:runWizard',
        {
          workspacePath: WORKSPACE,
          analysisDir: `${WORKSPACE}/.ptah/analysis/../../secrets`,
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/analysis directory is outside/i);
      expect(h.enhancedPrompts.runWizard).not.toHaveBeenCalled();
      expect(
        h.analysisStorage.resolveAuthorizedAnalysisDir,
      ).toHaveBeenCalledWith(
        WORKSPACE,
        `${WORKSPACE}/.ptah/analysis/../../secrets`,
      );
    });

    it('passes a canonicalized in-root analysisDir through to the service', async () => {
      const h = makeHarness();
      h.enhancedPrompts.runWizard.mockResolvedValue({
        success: true,
        state: {
          enabled: true,
          generatedPrompt: 'x',
          generatedAt: '2026-01-01T00:00:00Z',
          detectedStack: null,
          configHash: 'abc',
          workspacePath: WORKSPACE,
        },
        summary: null,
      } as unknown as Awaited<ReturnType<EnhancedPromptsService['runWizard']>>);
      h.handlers.register();

      await call(h, 'enhancedPrompts:runWizard', {
        workspacePath: WORKSPACE,
        analysisDir: `${ANALYSIS_ROOT}/ptah-extension`,
      });

      const args = h.enhancedPrompts.runWizard.mock.calls[0];
      expect(args[0]).toBe(WORKSPACE);
      expect(args[5]).toBe(`${ANALYSIS_ROOT}/ptah-extension`);
    });

    it('rejects malformed analysisData with a structured error (never throws)', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'enhancedPrompts:runWizard',
        { workspacePath: WORKSPACE, analysisData: { projectType: 42 } },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/invalid analysis data/i);
      expect(h.enhancedPrompts.runWizard).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // enhancedPrompts:setEnabled
  // -------------------------------------------------------------------------

  describe('enhancedPrompts:setEnabled', () => {
    it('rejects missing workspacePath', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'enhancedPrompts:setEnabled',
        { enabled: true },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/workspace path is required/i);
      expect(h.enhancedPrompts.setEnabled).not.toHaveBeenCalled();
    });

    it('rejects non-boolean enabled flag', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'enhancedPrompts:setEnabled',
        { workspacePath: '/x', enabled: 'yes' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/enabled flag/i);
      expect(h.enhancedPrompts.setEnabled).not.toHaveBeenCalled();
    });

    it('delegates to the service and echoes the new state', async () => {
      const h = makeHarness();
      h.enhancedPrompts.setEnabled.mockResolvedValue(undefined);
      h.handlers.register();

      const result = await call<{ success: boolean; enabled?: boolean }>(
        h,
        'enhancedPrompts:setEnabled',
        { workspacePath: '/x', enabled: false },
      );

      expect(h.enhancedPrompts.setEnabled).toHaveBeenCalledWith('/x', false);
      expect(result.success).toBe(true);
      expect(result.enabled).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // enhancedPrompts:regenerate
  // -------------------------------------------------------------------------

  describe('enhancedPrompts:regenerate', () => {
    it('rejects missing workspacePath', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'enhancedPrompts:regenerate',
        {},
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/workspace path is required/i);
      expect(h.enhancedPrompts.regenerate).not.toHaveBeenCalled();
    });

    it('defaults force=true when omitted and forwards to the service', async () => {
      const h = makeHarness();
      h.enhancedPrompts.regenerate.mockResolvedValue({
        success: true,
        status: {
          enabled: true,
          hasGeneratedPrompt: true,
          generatedAt: '2026-01-01T00:00:00Z',
          detectedStack: null,
          cacheValid: true,
        },
      } as unknown as Awaited<
        ReturnType<EnhancedPromptsService['regenerate']>
      >);
      h.handlers.register();

      const result = await call<{ success: boolean; status?: unknown }>(
        h,
        'enhancedPrompts:regenerate',
        { workspacePath: WORKSPACE },
      );

      expect(h.enhancedPrompts.regenerate).toHaveBeenCalled();
      const [, request] = h.enhancedPrompts.regenerate.mock.calls[0];
      expect(request).toMatchObject({ force: true });
      expect(result.success).toBe(true);
      expect(result.status).toBeDefined();
    });

    it('rejects a workspacePath that is not an open folder', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'enhancedPrompts:regenerate',
        { workspacePath: '/tmp/evil' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/access denied/i);
      expect(h.enhancedPrompts.regenerate).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // enhancedPrompts:getPromptContent
  // -------------------------------------------------------------------------

  describe('enhancedPrompts:getPromptContent', () => {
    it('returns null content when workspacePath is missing', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ content: string | null; error?: string }>(
        h,
        'enhancedPrompts:getPromptContent',
        {},
      );

      expect(result.content).toBeNull();
      expect(result.error).toMatch(/workspace path is required/i);
    });

    it('returns the service content when present', async () => {
      const h = makeHarness();
      h.enhancedPrompts.getFullCombinedPromptContent.mockResolvedValue(
        '# Generated',
      );
      h.handlers.register();

      const result = await call<{ content: string | null }>(
        h,
        'enhancedPrompts:getPromptContent',
        { workspacePath: '/x' },
      );

      expect(result.content).toBe('# Generated');
    });
  });

  // -------------------------------------------------------------------------
  // enhancedPrompts:download
  // -------------------------------------------------------------------------

  describe('enhancedPrompts:download', () => {
    it('rejects when workspacePath is missing', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'enhancedPrompts:download',
        {},
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/workspace path is required/i);
      expect(h.saveDialog.showSaveAndWrite).not.toHaveBeenCalled();
    });

    it('rejects when no generated content exists', async () => {
      const h = makeHarness();
      h.enhancedPrompts.getFullCombinedPromptContent.mockResolvedValue(null);
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'enhancedPrompts:download',
        { workspacePath: '/x' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/generate enhanced prompts first/i);
      expect(h.saveDialog.showSaveAndWrite).not.toHaveBeenCalled();
    });

    it('invokes the save dialog with the expected filename/filters/title', async () => {
      const h = makeHarness();
      h.enhancedPrompts.getFullCombinedPromptContent.mockResolvedValue(
        '# Hello',
      );
      h.saveDialog.showSaveAndWrite.mockResolvedValue('/tmp/out.md');
      h.handlers.register();

      const result = await call<{ success: boolean; filePath?: string }>(
        h,
        'enhancedPrompts:download',
        { workspacePath: '/x' },
      );

      expect(h.saveDialog.showSaveAndWrite).toHaveBeenCalledTimes(1);
      const [opts] = h.saveDialog.showSaveAndWrite.mock.calls[0];
      expect(opts.defaultFilename).toBe('enhanced-prompt.md');
      expect(opts.filters).toEqual({ Markdown: ['md'] });
      expect(opts.title).toBe('Save Enhanced Prompt');
      expect(Buffer.isBuffer(opts.content)).toBe(true);
      expect((opts.content as Buffer).toString('utf-8')).toBe('# Hello');

      expect(result.success).toBe(true);
      expect(result.filePath).toBe('/tmp/out.md');
    });

    it('surfaces a cancellation message when the user closes the save dialog', async () => {
      const h = makeHarness();
      h.enhancedPrompts.getFullCombinedPromptContent.mockResolvedValue(
        '# Hello',
      );
      h.saveDialog.showSaveAndWrite.mockResolvedValue(null);
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'enhancedPrompts:download',
        { workspacePath: '/x' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/cancelled/i);
    });
  });
});
