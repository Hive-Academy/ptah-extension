/**
 * SetupRpcHandlers — unit specs (TASK_2025_294 W2.B4).
 *
 * Surface under test: setup RPC methods covering status, wizard launch,
 * analysis (deep-analyze / recommend-agents / cancel-analysis), saved
 * analyses (list/load), agent pack browser (list/install), and the new
 * `wizard:start-new-project-chat` chat-handoff entry point.
 *
 * Behavioural contracts locked in here:
 *   - Registration: `register()` wires every method into the mock RpcHandler.
 *   - Workspace gating: `setup-status:get-status`, `setup-wizard:launch`,
 *     and `wizard:deep-analyze` throw when no workspace is open.
 *   - DI container dispatch: `resolveService()` routes through
 *     `container.resolve()`; specs drive each method by mocking only the
 *     services the method actually calls.
 *   - `wizard:recommend-agents`:
 *       * `isMultiPhase: true` branch bypasses validation and returns the
 *         full 13-agent catalog with `recommended: true`.
 *       * Absent input throws a "Missing analysis input" error.
 *       * Invalid single-phase input throws an "Invalid analysis input"
 *         error sourced from the real Zod validation in
 *         `@ptah-extension/agent-generation`.
 *   - `wizard:cancel-analysis` is best-effort — it returns
 *     `{ cancelled: true }` as soon as any service cancels, and
 *     `{ cancelled: false }` only when every service throws.
 *   - `wizard:start-new-project-chat`:
 *       * Enables the `ptah-nx-saas` plugin via PluginLoaderService when
 *         not already enabled, and refreshes skill junctions if changed.
 *       * Always focuses chat via IPlatformCommands and broadcasts the
 *         seed prompt; missing webview / skill-junction services are
 *         tolerated as best-effort soft failures.
 *
 * Mocking posture: direct constructor injection, narrow
 * `jest.Mocked<Pick<T, ...>>` surfaces for the DI container and
 * ConfigManager helpers. No `as any` casts.
 *
 * Source-under-test:
 *   `libs/backend/rpc-handlers/src/lib/handlers/setup-rpc.handlers.ts`
 */

import 'reflect-metadata';

// ---------------------------------------------------------------------------
// Jest transitive-import guard.
//
// The SUT imports from `@ptah-extension/agent-generation`, whose types
// barrel re-exports from `@ptah-extension/workspace-intelligence`. The
// workspace-intelligence `src/index.ts` barrel eagerly re-exports
// `TreeSitterParserService`, whose module top-level evaluates
// `path.dirname(fileURLToPath(import.meta.url))` — a construct Jest's
// ts-jest CJS transform cannot parse ("SyntaxError: Cannot use
// 'import.meta' outside a module").
//
// We short-circuit the parser module *before* the SUT is imported so the
// module graph never reaches the import.meta statement. Nothing in this
// spec exercises the parser service — it's pulled in only because it
// lives in the same barrel as the enums agent-generation actually uses.
// ---------------------------------------------------------------------------
// Intercept the only memory-curator symbol the SUT imports. Mocking the
// whole module (rather than `requireActual`-ing it) keeps the heavy SQLite /
// embedder dependencies of memory-curator's barrel out of the Jest module
// graph. The SUT only consumes `deriveWorkspaceFingerprint`.
jest.mock('@ptah-extension/memory-curator', () => ({
  deriveWorkspaceFingerprint: jest.fn(),
}));

jest.mock('@ptah-extension/workspace-intelligence', () => ({
  // Enums consumed by agent-generation's analysis-schema.ts — must match
  // the real string-valued enum shape so Zod native-enum schemas stay
  // structurally identical at test time.
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
  // Service classes — agent-generation's DI register pulls the constructors,
  // but our spec never resolves them, so empty stub classes suffice.
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
import type {
  ConfigManager,
  Logger,
  RpcHandler,
  SentryService,
} from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  createMockSentryService,
  type MockRpcHandler,
  type MockSentryService,
} from '@ptah-extension/vscode-core/testing';
import type {
  IWorkspaceProvider,
  IPlatformCommands,
} from '@ptah-extension/platform-core';
import {
  createMockWorkspaceProvider,
  createMockPlatformCommands,
  type MockWorkspaceProvider,
  type MockPlatformCommands,
} from '@ptah-extension/platform-core/testing';
import type { PluginLoaderService } from '@ptah-extension/agent-sdk';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { SetupRpcHandlers } from './setup-rpc.handlers';

// ---------------------------------------------------------------------------
// Token re-declaration (via Symbol.for) — avoids transitively loading the
// full `@ptah-extension/agent-generation` barrel, which pulls in
// `workspace-intelligence` → `tree-sitter-parser.service.ts`, whose
// top-level `import.meta.url` can't be parsed under Jest's CJS transform.
//
// These Symbol.for descriptors MUST match
// `libs/backend/agent-generation/src/lib/di/tokens.ts` exactly — the
// global Symbol.for registry guarantees identity, so the handler's
// `container.resolve(TOKEN)` call sees the same symbol the spec
// registers under.
// ---------------------------------------------------------------------------

const AGENT_GENERATION_TOKENS = {
  SETUP_STATUS_SERVICE: Symbol.for('SetupStatusService'),
  SETUP_WIZARD_SERVICE: Symbol.for('SetupWizardService'),
  MULTI_PHASE_ANALYSIS_SERVICE: Symbol.for('MultiPhaseAnalysisService'),
  ANALYSIS_STORAGE_SERVICE: Symbol.for('AnalysisStorageService'),
  AGENT_RECOMMENDATION_SERVICE: Symbol.for('AgentRecommendationService'),
  AGENTIC_ANALYSIS_SERVICE: Symbol.for('AgenticAnalysisService'),
  WIZARD_WEBVIEW_LIFECYCLE: Symbol.for('WizardWebviewLifecycleService'),
} as const;

// ---------------------------------------------------------------------------
// Narrow mock surfaces — only what the handler actually touches.
// ---------------------------------------------------------------------------

type MockConfigManagerLite = jest.Mocked<
  Pick<ConfigManager, 'get' | 'getWithDefault' | 'set'>
>;

function createMockConfigManagerLite(): MockConfigManagerLite {
  return {
    get: jest.fn(),
    getWithDefault: jest.fn(),
    set: jest.fn().mockResolvedValue(undefined),
  } as unknown as MockConfigManagerLite;
}

type MockPluginLoader = jest.Mocked<
  Pick<
    PluginLoaderService,
    | 'getWorkspacePluginConfig'
    | 'resolvePluginPaths'
    | 'saveWorkspacePluginConfig'
  >
>;

function createMockPluginLoader(): MockPluginLoader {
  return {
    getWorkspacePluginConfig: jest.fn().mockReturnValue({
      enabledPluginIds: [],
      disabledSkillIds: [],
    }),
    resolvePluginPaths: jest.fn().mockReturnValue([]),
    saveWorkspacePluginConfig: jest.fn().mockResolvedValue(undefined),
  };
}

/**
 * Mock DI container that maps tokens to prepared service stubs. The real
 * handler calls `container.resolve(token)` for every agent-generation
 * service; this harness lets each spec seed the subset of services its
 * RPC path touches.
 */
interface MockContainer extends jest.Mocked<
  Pick<DependencyContainer, 'resolve'>
> {
  __register(token: symbol | string, service: unknown): void;
}

function createMockContainer(): MockContainer {
  const services = new Map<symbol | string, unknown>();
  const mock = {
    resolve: jest.fn((token: symbol | string): unknown => {
      if (services.has(token)) {
        return services.get(token);
      }
      throw new Error(
        `MockContainer: no service registered for token ${String(token)}`,
      );
    }),
    __register(token: symbol | string, service: unknown): void {
      services.set(token, service);
    },
  } as unknown as MockContainer;
  return mock;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const WORKSPACE = '/fake/workspace';

interface Harness {
  handlers: SetupRpcHandlers;
  logger: MockLogger;
  rpcHandler: MockRpcHandler;
  configManager: MockConfigManagerLite;
  pluginLoader: MockPluginLoader;
  workspace: MockWorkspaceProvider;
  container: MockContainer;
  sentry: MockSentryService;
  platformCommands: MockPlatformCommands;
}

function makeHarness(opts: { workspaceFolders?: string[] } = {}): Harness {
  const logger = createMockLogger();
  const rpcHandler = createMockRpcHandler();
  const configManager = createMockConfigManagerLite();
  const pluginLoader = createMockPluginLoader();
  const workspace = createMockWorkspaceProvider({
    folders: opts.workspaceFolders ?? [WORKSPACE],
  });
  const container = createMockContainer();
  const sentry = createMockSentryService();
  const platformCommands = createMockPlatformCommands();

  const handlers = new SetupRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as RpcHandler,
    configManager as unknown as ConfigManager,
    pluginLoader as unknown as PluginLoaderService,
    workspace as unknown as IWorkspaceProvider,
    container as unknown as DependencyContainer,
    sentry as unknown as SentryService,
    platformCommands as unknown as IPlatformCommands,
  );

  return {
    handlers,
    logger,
    rpcHandler,
    configManager,
    pluginLoader,
    workspace,
    container,
    sentry,
    platformCommands,
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

async function callRaw(
  h: Harness,
  method: string,
  params: unknown = {},
): Promise<{
  success: boolean;
  data?: unknown;
  error?: string;
  errorCode?: string;
}> {
  return h.rpcHandler.handleMessage({
    method,
    params: params as Record<string, unknown>,
    correlationId: `corr-${method}`,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SetupRpcHandlers', () => {
  describe('register()', () => {
    it('registers all setup RPC methods', () => {
      const h = makeHarness();
      h.handlers.register();

      expect(h.rpcHandler.getRegisteredMethods().sort()).toEqual(
        [
          'setup-status:get-status',
          'setup-wizard:launch',
          'wizard:cancel-analysis',
          'wizard:deep-analyze',
          'wizard:install-pack-agents',
          'wizard:list-agent-packs',
          'wizard:list-analyses',
          'wizard:load-analysis',
          'wizard:recommend-agents',
          'wizard:start-new-project-chat',
        ].sort(),
      );
    });
  });

  // -------------------------------------------------------------------------
  // setup-status:get-status
  // -------------------------------------------------------------------------

  describe('setup-status:get-status', () => {
    it('returns WORKSPACE_NOT_OPEN typed error (not a Sentry-reported throw) when no workspace is open', async () => {
      const h = makeHarness({ workspaceFolders: [] });
      h.handlers.register();

      const response = await callRaw(h, 'setup-status:get-status');

      // Must be a structured error response, not an unhandled exception.
      expect(response.success).toBe(false);
      expect(response.error).toMatch(/No workspace folder/);
      // The typed errorCode must be present so the frontend can show a
      // friendly "Open Folder" prompt instead of a generic error toast.
      expect(response.errorCode).toBe('WORKSPACE_NOT_OPEN');
      // Sentry must NOT be called — this is an expected user condition.
      expect(h.sentry.captureException).not.toHaveBeenCalled();
    });

    it('delegates to SetupStatusService and returns its .value when workspace is open', async () => {
      const h = makeHarness();
      const expected = {
        isConfigured: true,
        agentCount: 3,
        lastModified: '2025-01-01T00:00:00Z',
        projectAgents: ['a', 'b'],
        userAgents: ['c'],
      };
      h.container.__register(AGENT_GENERATION_TOKENS.SETUP_STATUS_SERVICE, {
        getStatus: jest.fn().mockResolvedValue({
          isErr: () => false,
          value: expected,
        }),
      });
      h.handlers.register();

      const result = await call<typeof expected>(h, 'setup-status:get-status');
      expect(result).toEqual(expected);
      // No errors on the happy path.
      expect(h.sentry.captureException).not.toHaveBeenCalled();
    });

    it('returns error response when SetupStatusService returns an Err result', async () => {
      const h = makeHarness();
      h.container.__register(AGENT_GENERATION_TOKENS.SETUP_STATUS_SERVICE, {
        getStatus: jest.fn().mockResolvedValue({
          isErr: () => true,
          error: new Error('stat failed'),
        }),
      });
      h.handlers.register();

      const response = await callRaw(h, 'setup-status:get-status');
      expect(response.success).toBe(false);
      expect(response.error).toMatch(/stat failed/);
    });
  });

  // -------------------------------------------------------------------------
  // setup-wizard:launch
  // -------------------------------------------------------------------------

  describe('setup-wizard:launch', () => {
    it('returns WORKSPACE_NOT_OPEN typed error (no Sentry) when no workspace is open', async () => {
      const h = makeHarness({ workspaceFolders: [] });
      h.handlers.register();

      const response = await callRaw(h, 'setup-wizard:launch');
      expect(response.success).toBe(false);
      expect(response.error).toMatch(/No workspace folder/);
      expect(response.errorCode).toBe('WORKSPACE_NOT_OPEN');
      expect(h.sentry.captureException).not.toHaveBeenCalled();
    });

    it('delegates to SetupWizardService and returns { success: true } on Ok', async () => {
      const h = makeHarness();
      const launchMock = jest.fn().mockResolvedValue({ isErr: () => false });
      h.container.__register(AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE, {
        launchWizard: launchMock,
      });
      h.handlers.register();

      const result = await call<{ success: boolean }>(h, 'setup-wizard:launch');
      expect(result.success).toBe(true);
      expect(launchMock).toHaveBeenCalledWith(WORKSPACE);
    });
  });

  // -------------------------------------------------------------------------
  // wizard:deep-analyze — premium+MCP gating
  // -------------------------------------------------------------------------

  describe('wizard:deep-analyze', () => {
    it('returns WORKSPACE_NOT_OPEN typed error (no Sentry) when no workspace is open', async () => {
      const h = makeHarness({ workspaceFolders: [] });
      h.handlers.register();

      const response = await callRaw(h, 'wizard:deep-analyze', {});
      expect(response.success).toBe(false);
      expect(response.error).toMatch(/No workspace folder/);
      expect(response.errorCode).toBe('WORKSPACE_NOT_OPEN');
      expect(h.sentry.captureException).not.toHaveBeenCalled();
    });

    it('throws when license service / MCP cannot be resolved (free tier)', async () => {
      // No LicenseService or CodeExecutionMCP registered → resolveService
      // throws, the handler catches and leaves isPremium=false, so the
      // subsequent premium check fails with the user-facing message.
      const h = makeHarness();
      h.handlers.register();

      const response = await callRaw(h, 'wizard:deep-analyze', {});
      expect(response.success).toBe(false);
      expect(response.error).toMatch(/Premium license and MCP server required/);
    });

    it('returns UNAUTHORIZED_WORKSPACE error when renderer supplies an unauthorized workspacePath', async () => {
      const h = makeHarness({ workspaceFolders: [WORKSPACE] });
      h.handlers.register();

      const response = await callRaw(h, 'wizard:deep-analyze', {
        workspacePath: '/tmp/evil-directory',
      });
      expect(response.success).toBe(false);
      expect(response.error).toMatch(/Access denied/);
      expect(response.errorCode).toBe('UNAUTHORIZED_WORKSPACE');
      expect(h.sentry.captureException).not.toHaveBeenCalled();
    });

    it('does not gate when renderer does not supply workspacePath (backend fallback is trusted)', async () => {
      // When workspacePath is absent the backend uses getWorkspaceRoot() which
      // is trusted — the auth gate must NOT fire. The license check fires next
      // and fails with "Premium license required" (expected on free tier).
      const h = makeHarness({ workspaceFolders: [WORKSPACE] });
      h.handlers.register();

      const response = await callRaw(h, 'wizard:deep-analyze', {});
      expect(response.success).toBe(false);
      // Must NOT be an UNAUTHORIZED_WORKSPACE error
      expect(response.errorCode).not.toBe('UNAUTHORIZED_WORKSPACE');
    });
  });

  // -------------------------------------------------------------------------
  // wizard:load-analysis — unauthorized workspace gate
  // -------------------------------------------------------------------------

  describe('wizard:load-analysis — authorization gate', () => {
    it('returns UNAUTHORIZED_WORKSPACE error for an out-of-workspace path', async () => {
      const h = makeHarness({ workspaceFolders: [WORKSPACE] });
      h.handlers.register();

      const response = await callRaw(h, 'wizard:load-analysis', {
        filename: 'analysis.json',
        workspacePath: '/tmp/evil',
      });
      expect(response.success).toBe(false);
      expect(response.error).toMatch(/Access denied/);
      expect(response.errorCode).toBe('UNAUTHORIZED_WORKSPACE');
    });
  });

  // -------------------------------------------------------------------------
  // wizard:list-analyses — workspacePath fallback + authorization gate
  // -------------------------------------------------------------------------

  describe('wizard:list-analyses — workspacePath param', () => {
    it('returns UNAUTHORIZED_WORKSPACE for an out-of-workspace path', async () => {
      const h = makeHarness({ workspaceFolders: [WORKSPACE] });
      h.handlers.register();

      const response = await callRaw(h, 'wizard:list-analyses', {
        workspacePath: '/tmp/evil',
      });
      expect(response.success).toBe(false);
      expect(response.error).toMatch(/Access denied/);
      expect(response.errorCode).toBe('UNAUTHORIZED_WORKSPACE');
    });

    it('returns empty analyses when no workspace is open and no workspacePath supplied', async () => {
      const h = makeHarness({ workspaceFolders: [] });
      h.handlers.register();

      const response = await callRaw(h, 'wizard:list-analyses', {});
      expect(response.success).toBe(true);
      expect((response.data as { analyses: unknown[] }).analyses).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // wizard:recommend-agents
  // -------------------------------------------------------------------------

  describe('wizard:recommend-agents', () => {
    it('throws when input is missing', async () => {
      const h = makeHarness();
      h.handlers.register();

      const response = await callRaw(h, 'wizard:recommend-agents', null);
      expect(response.success).toBe(false);
      expect(response.error).toMatch(/Missing analysis input/);
    });

    it('short-circuits to the full 13-agent catalog on isMultiPhase input', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<
        Array<{
          agentId: string;
          recommended: boolean;
          relevanceScore: number;
        }>
      >(h, 'wizard:recommend-agents', { isMultiPhase: true });

      // All 13 canonical agents, all recommended with relevanceScore=100.
      expect(result).toHaveLength(13);
      expect(result.every((r) => r.recommended === true)).toBe(true);
      expect(result.every((r) => r.relevanceScore === 100)).toBe(true);

      // Spot-check: anchor agents from each category.
      const ids = new Set(result.map((r) => r.agentId));
      expect(ids.has('backend-developer')).toBe(true);
      expect(ids.has('ui-ux-designer')).toBe(true);
      expect(ids.has('senior-tester')).toBe(true);
    });

    it('throws "Invalid analysis input" for malformed single-phase input', async () => {
      const h = makeHarness();
      h.handlers.register();

      // Not multi-phase → Zod validation runs. Empty object is missing
      // every required field in ProjectAnalysisZodSchema.
      const response = await callRaw(h, 'wizard:recommend-agents', {});

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/Invalid analysis input/);
    });
  });

  // -------------------------------------------------------------------------
  // wizard:cancel-analysis — best-effort
  // -------------------------------------------------------------------------

  describe('wizard:cancel-analysis', () => {
    it('returns cancelled=true when at least one service cancels', async () => {
      const h = makeHarness();
      h.container.__register(
        AGENT_GENERATION_TOKENS.MULTI_PHASE_ANALYSIS_SERVICE,
        {
          cancelAnalysis: jest.fn(),
        },
      );
      // AgenticAnalysisService deliberately NOT registered → resolveService
      // throws, handler swallows it. `cancelled` should still be true.
      h.handlers.register();

      const result = await call<{ cancelled: boolean }>(
        h,
        'wizard:cancel-analysis',
      );
      expect(result.cancelled).toBe(true);
    });

    it('returns cancelled=false when every service fails to resolve', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ cancelled: boolean }>(
        h,
        'wizard:cancel-analysis',
      );
      expect(result.cancelled).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // wizard:list-analyses / wizard:load-analysis
  // -------------------------------------------------------------------------

  describe('wizard:list-analyses', () => {
    it('returns { analyses: [] } when no workspace is open', async () => {
      const h = makeHarness({ workspaceFolders: [] });
      h.handlers.register();

      const result = await call<{ analyses: unknown[] }>(
        h,
        'wizard:list-analyses',
      );
      expect(result.analyses).toEqual([]);
    });

    it('delegates to AnalysisStorageService.list when workspace is open', async () => {
      const h = makeHarness();
      const analyses = [
        { filename: 'a.json', analyzedAt: 1 },
        { filename: 'b.json', analyzedAt: 2 },
      ];
      h.container.__register(AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE, {
        list: jest.fn().mockResolvedValue(analyses),
      });
      h.handlers.register();

      const result = await call<{ analyses: unknown[] }>(
        h,
        'wizard:list-analyses',
      );
      expect(result.analyses).toEqual(analyses);
    });
  });

  describe('wizard:load-analysis', () => {
    it('throws when no workspace is open', async () => {
      const h = makeHarness({ workspaceFolders: [] });
      h.handlers.register();

      const response = await callRaw(h, 'wizard:load-analysis', {
        filename: 'x.json',
      });
      expect(response.success).toBe(false);
      expect(response.error).toMatch(/No workspace folder/);
    });

    it('strips path segments from filename before delegating (defense-in-depth)', async () => {
      const h = makeHarness();
      const loadMock = jest.fn().mockResolvedValue({
        isMultiPhase: true,
        manifest: {
          slug: 'x',
          analyzedAt: '',
          model: '',
          totalDurationMs: 0,
          phases: {},
        },
        phaseContents: {},
        analysisDir: '',
      });
      h.container.__register(AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE, {
        loadMultiPhase: loadMock,
      });
      h.handlers.register();

      await call(h, 'wizard:load-analysis', {
        filename: '../../etc/passwd',
      });

      // The handler calls path.basename() before forwarding — ensures the
      // storage layer never sees the traversal-y path.
      expect(loadMock).toHaveBeenCalledWith(WORKSPACE, 'passwd');
    });
  });

  // -------------------------------------------------------------------------
  // wizard:install-pack-agents — untrusted source rejection
  // -------------------------------------------------------------------------

  describe('wizard:install-pack-agents', () => {
    it('rejects sources not in the curated pack list', async () => {
      const h = makeHarness();
      h.handlers.register();

      // The handler calls AgentPackDownloadService.listCuratedPacks() which
      // reaches out to the real curated list. When nothing matches
      // `params.source`, the handler must throw with a trust message —
      // regardless of whether the network succeeded or failed, an
      // "evil.example.com" URL cannot match.
      const response = await callRaw(h, 'wizard:install-pack-agents', {
        source: 'https://evil.example.com/malicious-pack',
        agentFiles: ['attack.md'],
      });

      expect(response.success).toBe(false);
      // Either the untrusted-source guard fires, or the network fetch
      // fails first — either way, we MUST NOT see success=true.
      expect(response.error).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // wizard:start-new-project-chat
  // -------------------------------------------------------------------------

  describe('wizard:start-new-project-chat', () => {
    it('enables the ptah-nx-saas plugin and refreshes skill junctions when not already enabled', async () => {
      const h = makeHarness();
      const createJunctions = jest
        .fn()
        .mockReturnValue({ created: 1, skipped: 0, removed: 0, errors: [] });
      h.container.__register(Symbol.for('SdkSkillJunction'), {
        createJunctions,
      });
      const broadcastMessage = jest.fn().mockResolvedValue(undefined);
      h.container.__register(Symbol.for('WebviewManager'), {
        broadcastMessage,
      });
      h.container.__register(AGENT_GENERATION_TOKENS.WIZARD_WEBVIEW_LIFECYCLE, {
        disposeWebview: jest.fn(),
      });

      h.pluginLoader.resolvePluginPaths.mockReturnValue([
        '/plugins/ptah-nx-saas',
      ]);

      h.handlers.register();

      const result = await call<{ success: boolean }>(
        h,
        'wizard:start-new-project-chat',
      );

      expect(result.success).toBe(true);
      expect(h.pluginLoader.saveWorkspacePluginConfig).toHaveBeenCalledWith({
        enabledPluginIds: ['ptah-nx-saas'],
        disabledSkillIds: [],
      });
      expect(createJunctions).toHaveBeenCalled();
      expect(h.platformCommands.focusChat).toHaveBeenCalled();
      expect(broadcastMessage).toHaveBeenCalledWith(
        'setup-wizard:start-new-project-chat',
        expect.objectContaining({
          prompt: expect.stringContaining('saas-workspace-initializer'),
        }),
      );
    });

    it('skips plugin enablement and junction refresh when ptah-nx-saas is already enabled', async () => {
      const h = makeHarness();
      h.pluginLoader.getWorkspacePluginConfig.mockReturnValue({
        enabledPluginIds: ['ptah-nx-saas'],
        disabledSkillIds: [],
      });
      const createJunctions = jest.fn();
      h.container.__register(Symbol.for('SdkSkillJunction'), {
        createJunctions,
      });
      h.container.__register(Symbol.for('WebviewManager'), {
        broadcastMessage: jest.fn().mockResolvedValue(undefined),
      });
      h.container.__register(AGENT_GENERATION_TOKENS.WIZARD_WEBVIEW_LIFECYCLE, {
        disposeWebview: jest.fn(),
      });

      h.handlers.register();

      const result = await call<{ success: boolean }>(
        h,
        'wizard:start-new-project-chat',
      );

      expect(result.success).toBe(true);
      expect(h.pluginLoader.saveWorkspacePluginConfig).not.toHaveBeenCalled();
      expect(createJunctions).not.toHaveBeenCalled();
    });

    it('returns success even when broadcast / dispose / junction refresh fail (best-effort)', async () => {
      const h = makeHarness();
      // No webview, no junction service, no wizard lifecycle registered →
      // resolveService throws for each, handler should swallow them.
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'wizard:start-new-project-chat',
      );

      expect(result.success).toBe(true);
      // Plugin enablement still happened.
      expect(h.pluginLoader.saveWorkspacePluginConfig).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // THOTH wizard memory seeding (TASK_2026_THOTH_WIZARD_SEED — Batch 4)
  //
  // The seeding hook lives inside `wizard:deep-analyze` between
  // `phaseContents` assembly and `return response`. Driving it through the
  // RPC requires mocking license/MCP gating + the multi-phase service +
  // storage service. Builders are also exercised via this RPC path so all
  // fixtures are real LLM-shape markdown blobs (mirroring this workspace's
  // own `.ptah/analysis/<slug>/` outputs).
  // -------------------------------------------------------------------------

  describe('seedWizardMemory (wizard:deep-analyze hook)', () => {
    // Phase fixtures matching the multi-phase markdown shape.
    const PROJECT_PROFILE_FIXTURE = `# Acme Web Platform

**Frameworks**: NestJS, Angular, RxJS
**Monorepo**: Nx 22
**Tech Stack**: TypeScript, PostgreSQL, Redis, Docker

## Architecture

The Acme platform is a hexagonal monorepo with strict ports-and-adapters separation between the core domain and the runtime adapters.

Some additional paragraph here.
`;

    const QUALITY_AUDIT_FIXTURE = `# Code Quality Audit

## Overall Quality Score
Score: 78 / 100

## Code Conventions
- Use \`unknown\` in catch clauses; never \`any\`
- Validate external input with zod at all RPC boundaries
- Inject by token through tsyringe, never by class
- Prefer Observable + BehaviorSubject over manual EventEmitters
- Always use prepared statements for SQLite

## File-Level Findings
Lots of details here.
`;

    const KEY_FILES_FIXTURE = `# Project Profile

## File Structure

\`\`\`text
acme-platform/
├── apps/
│   ├── api/
│   │   └── src/main.ts
│   ├── web/
│   │   └── src/index.ts
│   └── worker/
│       └── src/server.ts
├── libs/
│   ├── shared/
│   └── domain/
├── package.json
├── tsconfig.json
├── nx.json
└── docker-compose.yml
\`\`\`

## Key Files

- \`apps/api/src/users.controller.ts\`
- \`apps/api/src/auth.service.ts\`
- \`apps/web/src/app/profile.component.ts\`
- \`libs/domain/src/lib/user.entity.ts\`
- \`apps/api/src/__tests__/auth.spec.ts\`
`;

    const MANIFEST = {
      version: 2 as const,
      slug: 'acme-platform',
      analyzedAt: '2026-05-08T00:00:00.000Z',
      model: 'sonnet',
      totalDurationMs: 1234,
      phases: {
        'project-profile': {
          status: 'completed' as const,
          file: '01-project-profile.md',
          durationMs: 100,
        },
        'architecture-assessment': {
          status: 'completed' as const,
          file: '02-architecture-assessment.md',
          durationMs: 100,
        },
        'quality-audit': {
          status: 'completed' as const,
          file: '03-quality-audit.md',
          durationMs: 100,
        },
        'elevation-plan': {
          status: 'completed' as const,
          file: '04-elevation-plan.md',
          durationMs: 100,
        },
      },
    };

    /**
     * Pull the upsert request payload for a given subject out of a writer
     * mock's call history. Throws (failing the test with a descriptive
     * error) when the call is missing — keeps test bodies free of
     * `!` non-null assertions.
     */
    function callForSubject(
      writer: { upsert: jest.Mock },
      subject: string,
    ): {
      content: string;
      tier: string;
      kind: string;
      pinned: boolean;
      salience: number;
      decayRate: number;
      subject: string;
    } {
      const found = writer.upsert.mock.calls.find(
        ([req]) =>
          (req as { subject: string } | undefined)?.subject === subject,
      );
      if (!found) {
        throw new Error(`No upsert call found for subject='${subject}'`);
      }
      return found[0] as ReturnType<typeof callForSubject>;
    }

    /** Wire the deep-analyze RPC up with a registered writer + happy gating. */
    function seedHarness(
      opts: {
        writer?: { upsert: jest.Mock };
        registerWriter?: boolean;
        fingerprintSource?: 'git' | 'package' | 'path';
        fingerprintFn?: () => Promise<{
          fp: string;
          source: 'git' | 'package' | 'path';
        }>;
        analyzeResult?: {
          isErr: () => boolean;
          value?: unknown;
          error?: Error;
        };
        phaseContents?: Record<string, string>;
      } = {},
    ): {
      h: Harness;
      writer: { upsert: jest.Mock };
      analyzeMock: jest.Mock;
    } {
      const h = makeHarness();
      const writer = opts.writer ?? { upsert: jest.fn() };
      const registerWriter = opts.registerWriter ?? true;
      const phaseContents = opts.phaseContents ?? {
        'project-profile': PROJECT_PROFILE_FIXTURE,
        'architecture-assessment': '## Architecture\n\nHexagonal.\n',
        'quality-audit': QUALITY_AUDIT_FIXTURE,
        'elevation-plan': KEY_FILES_FIXTURE,
      };
      const analyzeMock = jest.fn().mockResolvedValue(
        opts.analyzeResult ?? {
          isErr: () => false,
          value: MANIFEST,
        },
      );

      // Premium-gating services. Token names per vscode-core/src/di/tokens.ts.
      h.container.__register(Symbol.for('LicenseService'), {
        verifyLicense: jest.fn().mockResolvedValue({
          valid: true,
          plan: { isPremium: true },
          tier: 'pro',
        }),
      });
      h.container.__register(Symbol.for('CodeExecutionMCP'), {
        getPort: () => 9999,
      });

      // Multi-phase service.
      h.container.__register(
        AGENT_GENERATION_TOKENS.MULTI_PHASE_ANALYSIS_SERVICE,
        { analyzeWorkspace: analyzeMock },
      );

      // Storage service — returns the per-phase fixture content.
      h.container.__register(AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE, {
        getSlugDir: jest.fn().mockReturnValue('/fake/slug/dir'),
        readPhaseFile: jest
          .fn()
          .mockImplementation(async (_dir: string, file: string) => {
            // Map manifest file → phase id → fixture.
            const phaseByFile: Record<string, string> = {
              '01-project-profile.md': 'project-profile',
              '02-architecture-assessment.md': 'architecture-assessment',
              '03-quality-audit.md': 'quality-audit',
              '04-elevation-plan.md': 'elevation-plan',
            };
            const phaseId = phaseByFile[file];
            return phaseId ? (phaseContents[phaseId] ?? null) : null;
          }),
      });

      // FileSystemProvider — only consulted by deriveWorkspaceFingerprint,
      // which is itself mocked. Register a stub anyway.
      h.container.__register(Symbol.for('PlatformFileSystemProvider'), {
        readFile: jest.fn().mockResolvedValue(''),
      });

      // Memory writer port registration (test 12 omits this).
      if (registerWriter) {
        h.container.__register(Symbol.for('PlatformMemoryWriter'), writer);
      }

      // Mock fingerprint outcome.
      const mc = jest.requireMock('@ptah-extension/memory-curator') as {
        deriveWorkspaceFingerprint: jest.Mock;
      };
      mc.deriveWorkspaceFingerprint.mockReset();
      if (opts.fingerprintFn) {
        mc.deriveWorkspaceFingerprint.mockImplementation(opts.fingerprintFn);
      } else {
        mc.deriveWorkspaceFingerprint.mockResolvedValue({
          fp: '0123456789abcdef',
          source: opts.fingerprintSource ?? 'git',
        });
      }

      return { h, writer, analyzeMock };
    }

    // -- Test 11 ----------------------------------------------------------
    it('[seed-success-path] writes 3 entries and emits "Seeded 3 memory entries" info log', async () => {
      const upsert = jest
        .fn()
        .mockResolvedValueOnce({ status: 'inserted', id: 'a' })
        .mockResolvedValueOnce({ status: 'inserted', id: 'b' })
        .mockResolvedValueOnce({ status: 'inserted', id: 'c' });
      const { h, writer } = seedHarness({ writer: { upsert } });
      h.handlers.register();

      const response = await callRaw(h, 'wizard:deep-analyze', {});

      expect(response.success).toBe(true);
      expect(writer.upsert).toHaveBeenCalledTimes(3);
      const seedLog = h.logger.info.mock.calls.find(([msg]) =>
        String(msg).startsWith('[SetupWizard] Seeded 3 memory entries'),
      );
      expect(seedLog).toBeDefined();
      expect(seedLog?.[1]).toMatchObject({
        inserted: 3,
        replaced: 0,
        unchanged: 0,
        fingerprintSource: 'git',
      });
    });

    // -- Test 12 ----------------------------------------------------------
    it('[seed-skipped-no-writer] logs skip line when MEMORY_WRITER token is unregistered', async () => {
      const { h, writer } = seedHarness({ registerWriter: false });
      h.handlers.register();

      const response = await callRaw(h, 'wizard:deep-analyze', {});

      expect(response.success).toBe(true);
      expect(writer.upsert).not.toHaveBeenCalled();
      const skipLog = h.logger.info.mock.calls.find(
        ([msg]) =>
          String(msg) ===
          '[SetupWizard] Memory seeding skipped (store unavailable)',
      );
      expect(skipLog).toBeDefined();
    });

    // -- Test 13 ----------------------------------------------------------
    it('[seed-non-fatal-on-throw] continues after a per-entry failure and logs warn with subject', async () => {
      const upsert = jest
        .fn()
        .mockResolvedValueOnce({ status: 'inserted', id: 'a' })
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValueOnce({ status: 'inserted', id: 'c' });
      const { h, writer } = seedHarness({ writer: { upsert } });
      h.handlers.register();

      const response = await callRaw(h, 'wizard:deep-analyze', {});

      expect(response.success).toBe(true);
      expect(writer.upsert).toHaveBeenCalledTimes(3);
      const warnCall = h.logger.warn.mock.calls.find(
        ([msg, ctx]) =>
          msg === '[SetupWizard] Memory seeding failed (non-fatal)' &&
          (ctx as { subject?: string } | undefined)?.subject ===
            'code-conventions',
      );
      expect(warnCall).toBeDefined();
    });

    // -- Test 14 ----------------------------------------------------------
    it('[content-builder-project-profile] extracts Type / Frameworks / Source lines from real markdown', async () => {
      const upsert = jest
        .fn()
        .mockResolvedValue({ status: 'inserted', id: 'x' });
      const { h, writer } = seedHarness({ writer: { upsert } });
      h.handlers.register();

      await callRaw(h, 'wizard:deep-analyze', {});

      const projectProfileCall = callForSubject(writer, 'project-profile');
      const content = projectProfileCall.content;
      expect(content).toContain('## Project Profile');
      expect(content).toContain('Type: Acme Web Platform');
      expect(content).toMatch(/^Frameworks: NestJS, Angular, RxJS/m);
      expect(content).toContain('Monorepo: Nx 22');
      expect(content).toMatch(/^Tech stack: TypeScript/m);
      expect(content).toContain('Architecture patterns: ');
      expect(content).toContain(
        'Source: .ptah/analysis/acme-platform/project-profile.md',
      );
    });

    // -- Test 15 ----------------------------------------------------------
    it('[content-builder-code-conventions] extracts bullets from quality-audit; missing-section yields fallback', async () => {
      // Happy path — bullets from quality-audit fixture.
      {
        const upsert = jest
          .fn()
          .mockResolvedValue({ status: 'inserted', id: 'x' });
        const { h, writer } = seedHarness({ writer: { upsert } });
        h.handlers.register();

        await callRaw(h, 'wizard:deep-analyze', {});

        const content = callForSubject(writer, 'code-conventions').content;
        expect(content).toContain('## Code Conventions');
        expect(content).toContain('Use `unknown` in catch clauses');
        // The "validate input with zod" bullet — contains 'z', guards against
        // the \z regex regression (truncation at first 'z' in section body).
        expect(content).toContain('Validate external input with zod');
        // Bullets 3–5 appear after 'z' in the fixture; asserting them catches
        // any future \z-class regex regression immediately.
        expect(content).toContain('Inject by token through tsyringe');
        expect(content).toContain('Prefer Observable');
        expect(content).toContain('Always use prepared statements');
        // Source line uses actual slug from manifest, not literal '<slug>'.
        expect(content).toContain(
          'Source: .ptah/analysis/acme-platform/03-quality-audit.md',
        );
      }

      // EOF-anchor guard — ## Code Conventions is the LAST section in the
      // document (no following heading). This fixture would return null with
      // the old \z anchor; with the fixed $ anchor all bullets are extracted.
      {
        const terminalSectionFixture = `# Quality Audit

## Overall Score
Score: 90 / 100

## Code Conventions
- Use \`unknown\` in catch clauses; never \`any\`
- Validate external input with zod at boundaries
- Inject by token through tsyringe, never by class`;

        const upsert = jest
          .fn()
          .mockResolvedValue({ status: 'inserted', id: 'x' });
        const { h, writer } = seedHarness({
          writer: { upsert },
          phaseContents: {
            'project-profile': PROJECT_PROFILE_FIXTURE,
            'architecture-assessment': '## Architecture\n\nHexagonal.\n',
            'quality-audit': terminalSectionFixture,
            'elevation-plan': '',
          },
        });
        h.handlers.register();

        await callRaw(h, 'wizard:deep-analyze', {});

        const content = callForSubject(writer, 'code-conventions').content;
        expect(content).toContain('## Code Conventions');
        // All three bullets must be extracted even though Code Conventions is
        // the terminal section with no trailing heading.
        expect(content).toContain('Use `unknown` in catch clauses');
        expect(content).toContain('Validate external input with zod');
        expect(content).toContain('Inject by token through tsyringe');
      }

      // Fallback — quality-audit + architecture-assessment both lack the
      // ## Code Conventions section.
      {
        const upsert = jest
          .fn()
          .mockResolvedValue({ status: 'inserted', id: 'x' });
        const { h, writer } = seedHarness({
          writer: { upsert },
          phaseContents: {
            'project-profile': PROJECT_PROFILE_FIXTURE,
            'architecture-assessment': '## Architecture\n\nNothing.\n',
            'quality-audit': '## Findings\nNo conventions section.\n',
            'elevation-plan': '',
          },
        });
        h.handlers.register();

        await callRaw(h, 'wizard:deep-analyze', {});

        const content = callForSubject(writer, 'code-conventions').content;
        expect(content).toContain('(not detected — see analysis files)');
      }
    });

    // -- Test 16 ----------------------------------------------------------
    it('[content-builder-key-files] categorises paths, caps at 2 KB, falls back to (none detected)', async () => {
      // Happy path — KEY_FILES_FIXTURE provides paths.
      {
        const upsert = jest
          .fn()
          .mockResolvedValue({ status: 'inserted', id: 'x' });
        const { h, writer } = seedHarness({ writer: { upsert } });
        h.handlers.register();

        await callRaw(h, 'wizard:deep-analyze', {});

        const content = callForSubject(writer, 'key-files').content;
        expect(content).toContain('## Key File Locations');
        expect(content).toContain('Source: .ptah/analysis/acme-platform/');
        expect(Buffer.byteLength(content, 'utf8')).toBeLessThanOrEqual(2048);
        // At least entry points + configs should be detected.
        expect(content).toMatch(/Entry points: /);
        expect(content).toMatch(/Configs: /);
      }

      // 2 KB cap & per-category truncation: build a fixture with 30 paths
      // categorised as Components.
      {
        const manyPaths = Array.from(
          { length: 30 },
          (_, i) => `src/app/components/widget-${i}.component.ts`,
        );
        const huge =
          '## Key Files\n' +
          manyPaths.map((p) => `- \`${p}\``).join('\n') +
          '\n';
        const upsert = jest
          .fn()
          .mockResolvedValue({ status: 'inserted', id: 'x' });
        const { h, writer } = seedHarness({
          writer: { upsert },
          phaseContents: {
            'project-profile': PROJECT_PROFILE_FIXTURE,
            'architecture-assessment': '',
            'quality-audit': '',
            'elevation-plan': huge,
          },
        });
        h.handlers.register();

        await callRaw(h, 'wizard:deep-analyze', {});

        const content = callForSubject(writer, 'key-files').content;
        expect(content).toMatch(/\+14 more/); // 30 - 16 = 14 hidden
        expect(Buffer.byteLength(content, 'utf8')).toBeLessThanOrEqual(2048);
      }

      // Empty fixture → (none detected).
      {
        const upsert = jest
          .fn()
          .mockResolvedValue({ status: 'inserted', id: 'x' });
        const { h, writer } = seedHarness({
          writer: { upsert },
          phaseContents: {
            'project-profile': '# Empty\n',
            'architecture-assessment': '',
            'quality-audit': '',
            'elevation-plan': '',
          },
        });
        h.handlers.register();

        await callRaw(h, 'wizard:deep-analyze', {});

        const content = callForSubject(writer, 'key-files').content;
        expect(content).toBe('## Key File Locations\n(none detected)');
      }
    });

    // -- Test 17 ----------------------------------------------------------
    it('[key-files-tier-and-pinning] writer call for key-files carries tier=recall, kind=entity, pinned=false', async () => {
      const upsert = jest
        .fn()
        .mockResolvedValue({ status: 'inserted', id: 'x' });
      const { h, writer } = seedHarness({ writer: { upsert } });
      h.handlers.register();

      await callRaw(h, 'wizard:deep-analyze', {});

      const req = callForSubject(writer, 'key-files');
      expect(req).toMatchObject({
        subject: 'key-files',
        tier: 'recall',
        kind: 'entity',
        pinned: false,
        salience: 0.6,
        decayRate: 0.01,
      });
    });

    // -- Test 18 ----------------------------------------------------------
    it('[fingerprint-fallback-logs-warning] emits the path-fallback info log exactly once when source=path', async () => {
      const upsert = jest
        .fn()
        .mockResolvedValue({ status: 'inserted', id: 'x' });
      const { h } = seedHarness({
        writer: { upsert },
        fingerprintSource: 'path',
      });
      h.handlers.register();

      await callRaw(h, 'wizard:deep-analyze', {});

      const fallbackLogs = h.logger.info.mock.calls.filter(
        ([msg]) =>
          String(msg) ===
          '[SetupWizard] Workspace fingerprint falling back to path; memories will not survive moves',
      );
      expect(fallbackLogs).toHaveLength(1);
    });

    // -- Test 19 ----------------------------------------------------------
    it('[seeding-runs-before-response-return] all 3 upserts complete before the response is returned', async () => {
      const events: string[] = [];
      const upsert = jest
        .fn()
        .mockImplementation(async (req: { subject: string }) => {
          events.push(`upsert:${req.subject}`);
          return { status: 'inserted', id: req.subject };
        });
      const { h } = seedHarness({ writer: { upsert } });
      h.handlers.register();

      const response = await callRaw(h, 'wizard:deep-analyze', {});
      events.push('response-returned');

      expect(response.success).toBe(true);
      // The three upserts MUST appear before the response-returned marker.
      expect(events).toEqual([
        'upsert:project-profile',
        'upsert:code-conventions',
        'upsert:key-files',
        'response-returned',
      ]);
    });

    // -- Test 20 ----------------------------------------------------------
    it('[seeding-not-fired-on-analysis-failure] writer is never called when analyzeWorkspace returns Err', async () => {
      const upsert = jest.fn();
      const { h } = seedHarness({
        writer: { upsert },
        analyzeResult: {
          isErr: () => true,
          error: new Error('analysis failed'),
        },
      });
      h.handlers.register();

      const response = await callRaw(h, 'wizard:deep-analyze', {});

      expect(response.success).toBe(false);
      expect(upsert).not.toHaveBeenCalled();
    });
  });
});
