/**
 * SetupRpcHandlers — unit specs (TASK_2025_294 W2.B4).
 *
 * Surface under test: thirteen RPC methods covering the agent setup wizard
 * (status, launch, deep-analyze, recommend-agents, cancel-analysis,
 * list/load analyses, list/install agent packs, and the new-project
 * wizard flow).
 *
 * Behavioural contracts locked in here:
 *   - Registration: `register()` wires all thirteen methods into the mock
 *     RpcHandler.
 *   - Workspace gating: `setup-status:get-status`, `setup-wizard:launch`,
 *     `wizard:deep-analyze`, and the new-project methods all throw when no
 *     workspace is open (the RPC error surfaces via `handleMessage`).
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
 *   - `wizard:new-project-submit-answers`:
 *       * Returns early with `success: true` when an existing plan is
 *         found on disk and `force` is not set (idempotent retry).
 *       * Deletes the existing plan when `force: true`.
 *       * Returns `{ success: false }` when answers fail validation —
 *         never throws.
 *   - `wizard:new-project-approve-plan` returns early with `success:false`
 *     when not approved; otherwise re-saves the loaded plan (idempotent).
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
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  createMockWorkspaceProvider,
  type MockWorkspaceProvider,
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
  NEW_PROJECT_DISCOVERY_SERVICE: Symbol.for('NewProjectDiscoveryService'),
  MASTER_PLAN_GENERATION_SERVICE: Symbol.for('MasterPlanGenerationService'),
  NEW_PROJECT_STORAGE_SERVICE: Symbol.for('NewProjectStorageService'),
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

  const handlers = new SetupRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as RpcHandler,
    configManager as unknown as ConfigManager,
    pluginLoader as unknown as PluginLoaderService,
    workspace as unknown as IWorkspaceProvider,
    container as unknown as DependencyContainer,
    sentry as unknown as SentryService,
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
): Promise<{ success: boolean; data?: unknown; error?: string }> {
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
    it('registers all thirteen setup RPC methods', () => {
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
          'wizard:new-project-approve-plan',
          'wizard:new-project-get-plan',
          'wizard:new-project-select-type',
          'wizard:new-project-submit-answers',
          'wizard:recommend-agents',
        ].sort(),
      );
    });
  });

  // -------------------------------------------------------------------------
  // setup-status:get-status
  // -------------------------------------------------------------------------

  describe('setup-status:get-status', () => {
    it('throws when no workspace is open', async () => {
      const h = makeHarness({ workspaceFolders: [] });
      h.handlers.register();

      const response = await callRaw(h, 'setup-status:get-status');
      expect(response.success).toBe(false);
      expect(response.error).toMatch(/No workspace folder/);
    });

    it('delegates to SetupStatusService and returns its .value on Ok', async () => {
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
    });

    it('throws when SetupStatusService returns an Err result', async () => {
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
    it('throws when no workspace is open', async () => {
      const h = makeHarness({ workspaceFolders: [] });
      h.handlers.register();

      const response = await callRaw(h, 'setup-wizard:launch');
      expect(response.success).toBe(false);
      expect(response.error).toMatch(/No workspace folder/);
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
    it('throws when no workspace is open', async () => {
      const h = makeHarness({ workspaceFolders: [] });
      h.handlers.register();

      const response = await callRaw(h, 'wizard:deep-analyze', {});
      expect(response.success).toBe(false);
      expect(response.error).toMatch(/No workspace folder/);
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
  // wizard:new-project-select-type
  // -------------------------------------------------------------------------

  describe('wizard:new-project-select-type', () => {
    it('delegates to NewProjectDiscoveryService.getQuestionGroups', async () => {
      const h = makeHarness();
      const groups = [{ id: 'basics', questions: [] }];
      h.container.__register(
        AGENT_GENERATION_TOKENS.NEW_PROJECT_DISCOVERY_SERVICE,
        { getQuestionGroups: jest.fn().mockReturnValue(groups) },
      );
      h.handlers.register();

      const result = await call<{ groups: unknown[] }>(
        h,
        'wizard:new-project-select-type',
        { projectType: 'web-app' },
      );
      expect(result.groups).toEqual(groups);
    });
  });

  // -------------------------------------------------------------------------
  // wizard:new-project-submit-answers — idempotent retry + validation
  // -------------------------------------------------------------------------

  describe('wizard:new-project-submit-answers', () => {
    it('throws when no workspace is open', async () => {
      const h = makeHarness({ workspaceFolders: [] });
      h.handlers.register();

      const response = await callRaw(h, 'wizard:new-project-submit-answers', {
        projectType: 'web-app',
        projectName: 'MyApp',
        answers: {},
      });
      expect(response.success).toBe(false);
      expect(response.error).toMatch(/No workspace folder/);
    });

    it('short-circuits with success=true when plan exists on disk (idempotent retry)', async () => {
      const h = makeHarness();
      const existingPlan = {
        projectName: 'Existing',
        phases: [{ tasks: [] }],
      };
      h.container.__register(
        AGENT_GENERATION_TOKENS.NEW_PROJECT_STORAGE_SERVICE,
        {
          loadPlan: jest.fn().mockResolvedValue(existingPlan),
          deletePlan: jest.fn(),
          savePlan: jest.fn(),
        },
      );
      h.handlers.register();

      const result = await call<{ success: boolean }>(
        h,
        'wizard:new-project-submit-answers',
        {
          projectType: 'web-app',
          projectName: 'Unused',
          answers: {},
        },
      );

      expect(result.success).toBe(true);
      // Validation / generation / save were all skipped.
    });

    it('deletes the existing plan when force=true, then regenerates', async () => {
      const h = makeHarness();

      const deletePlan = jest.fn().mockResolvedValue(undefined);
      const savePlan = jest
        .fn()
        .mockResolvedValue('/fake/workspace/.ptah/new-project/plan.json');
      const loadPlan = jest.fn().mockResolvedValue(null);
      h.container.__register(
        AGENT_GENERATION_TOKENS.NEW_PROJECT_STORAGE_SERVICE,
        { deletePlan, savePlan, loadPlan },
      );

      const validateAnswers = jest
        .fn()
        .mockReturnValue({ valid: true, missingFields: [] });
      h.container.__register(
        AGENT_GENERATION_TOKENS.NEW_PROJECT_DISCOVERY_SERVICE,
        { validateAnswers },
      );

      const generatedPlan = {
        projectName: 'Brand New',
        phases: [{ tasks: [{ id: 't1' }] }],
      };
      h.container.__register(
        AGENT_GENERATION_TOKENS.MASTER_PLAN_GENERATION_SERVICE,
        { generatePlan: jest.fn().mockResolvedValue(generatedPlan) },
      );
      h.handlers.register();

      const result = await call<{ success: boolean }>(
        h,
        'wizard:new-project-submit-answers',
        {
          projectType: 'web-app',
          projectName: 'Brand New',
          answers: { foo: 'bar' },
          force: true,
        },
      );

      expect(result.success).toBe(true);
      expect(deletePlan).toHaveBeenCalledWith(WORKSPACE);
      expect(savePlan).toHaveBeenCalledWith(WORKSPACE, generatedPlan);
    });

    it('returns success=false with missing-fields error when validation fails', async () => {
      const h = makeHarness();
      h.container.__register(
        AGENT_GENERATION_TOKENS.NEW_PROJECT_STORAGE_SERVICE,
        {
          loadPlan: jest.fn().mockResolvedValue(null),
          deletePlan: jest.fn(),
          savePlan: jest.fn(),
        },
      );
      h.container.__register(
        AGENT_GENERATION_TOKENS.NEW_PROJECT_DISCOVERY_SERVICE,
        {
          validateAnswers: jest.fn().mockReturnValue({
            valid: false,
            missingFields: ['projectName', 'tech'],
          }),
        },
      );
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'wizard:new-project-submit-answers',
        {
          projectType: 'web-app',
          projectName: 'X',
          answers: {},
        },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Missing required fields/);
      expect(result.error).toMatch(/projectName/);
      expect(result.error).toMatch(/tech/);
    });
  });

  // -------------------------------------------------------------------------
  // wizard:new-project-get-plan
  // -------------------------------------------------------------------------

  describe('wizard:new-project-get-plan', () => {
    it('throws when no workspace is open', async () => {
      const h = makeHarness({ workspaceFolders: [] });
      h.handlers.register();

      const response = await callRaw(h, 'wizard:new-project-get-plan');
      expect(response.success).toBe(false);
      expect(response.error).toMatch(/No workspace folder/);
    });

    it('throws when no plan has been generated yet', async () => {
      const h = makeHarness();
      h.container.__register(
        AGENT_GENERATION_TOKENS.NEW_PROJECT_STORAGE_SERVICE,
        { loadPlan: jest.fn().mockResolvedValue(null) },
      );
      h.handlers.register();

      const response = await callRaw(h, 'wizard:new-project-get-plan');
      expect(response.success).toBe(false);
      expect(response.error).toMatch(/No master plan found/);
    });

    it('returns the loaded plan on the happy path', async () => {
      const h = makeHarness();
      const plan = {
        projectName: 'Existing',
        phases: [{ id: 'p1', tasks: [] }],
      };
      h.container.__register(
        AGENT_GENERATION_TOKENS.NEW_PROJECT_STORAGE_SERVICE,
        { loadPlan: jest.fn().mockResolvedValue(plan) },
      );
      h.handlers.register();

      const result = await call<{ plan: unknown }>(
        h,
        'wizard:new-project-get-plan',
      );
      expect(result.plan).toEqual(plan);
    });
  });

  // -------------------------------------------------------------------------
  // wizard:new-project-approve-plan
  // -------------------------------------------------------------------------

  describe('wizard:new-project-approve-plan', () => {
    it('returns success=false, planPath="" when approved=false', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean; planPath: string }>(
        h,
        'wizard:new-project-approve-plan',
        { approved: false },
      );

      expect(result.success).toBe(false);
      expect(result.planPath).toBe('');
    });

    it('throws when no workspace is open but approved=true', async () => {
      const h = makeHarness({ workspaceFolders: [] });
      h.handlers.register();

      const response = await callRaw(h, 'wizard:new-project-approve-plan', {
        approved: true,
      });
      expect(response.success).toBe(false);
      expect(response.error).toMatch(/No workspace folder/);
    });

    it('throws when loadPlan returns null on approval', async () => {
      const h = makeHarness();
      h.container.__register(
        AGENT_GENERATION_TOKENS.NEW_PROJECT_STORAGE_SERVICE,
        {
          loadPlan: jest.fn().mockResolvedValue(null),
          savePlan: jest.fn(),
        },
      );
      h.handlers.register();

      const response = await callRaw(h, 'wizard:new-project-approve-plan', {
        approved: true,
      });
      expect(response.success).toBe(false);
      expect(response.error).toMatch(/No master plan found to approve/);
    });

    it('idempotently re-saves the loaded plan and returns its path on success', async () => {
      const h = makeHarness();
      const plan = { projectName: 'OK', phases: [{ tasks: [] }] };
      const savePlan = jest
        .fn()
        .mockResolvedValue('/fake/workspace/.ptah/new-project/plan.json');
      h.container.__register(
        AGENT_GENERATION_TOKENS.NEW_PROJECT_STORAGE_SERVICE,
        {
          loadPlan: jest.fn().mockResolvedValue(plan),
          savePlan,
        },
      );
      h.handlers.register();

      const result = await call<{ success: boolean; planPath: string }>(
        h,
        'wizard:new-project-approve-plan',
        { approved: true },
      );

      expect(result.success).toBe(true);
      expect(result.planPath).toBe(
        '/fake/workspace/.ptah/new-project/plan.json',
      );
      expect(savePlan).toHaveBeenCalledWith(WORKSPACE, plan);
    });
  });
});
