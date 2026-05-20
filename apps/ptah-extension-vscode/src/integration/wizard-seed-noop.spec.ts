/**
 * Wizard memory seed — VS Code graceful-degradation.
 *
 * Verifies that `wizard:deep-analyze` completes successfully when
 * `PLATFORM_TOKENS.MEMORY_WRITER` is NOT registered in the container —
 * the current state of VS Code's `phase-2-libraries.ts`, which does not call
 * `registerMemoryCuratorServices`.
 *
 * Expected behaviour:
 *  1. `resolveMemoryWriterOrNull()` catches the container throw and returns null.
 *  2. `seedWizardMemory` logs `[SetupWizard] Memory seeding skipped (store unavailable)`
 *     at `info` level.
 *  3. The RPC response is returned successfully — no exception bubbles.
 *
 * This test documents that the graceful-degradation contract is explicitly
 * verified at the VS Code app boundary, not just in the shared rpc-handlers
 * library. It uses the same mock harness as the sibling spec in that library.
 *
 * Run: `nx test ptah-extension-vscode --testPathPattern=wizard-seed-noop`
 * Or:  `nx test ptah-extension-vscode`
 */

import 'reflect-metadata';

// ---------------------------------------------------------------------------
// Transitive-import guards — same pattern as setup-rpc.handlers.spec.ts
// ---------------------------------------------------------------------------
// Mock memory-curator: include both the function consumed by SetupRpcHandlers
// AND the MEMORY_TOKENS object consumed by MemoryRpcHandlers' @inject decorators
// (which are evaluated at import time). Without MEMORY_TOKENS in the mock, the
// decorator throws "Cannot read properties of undefined (reading 'MEMORY_STORE')".
jest.mock('@ptah-extension/memory-curator', () => ({
  deriveWorkspaceFingerprint: jest.fn().mockResolvedValue({
    fp: '0123456789abcdef',
    source: 'git',
  }),
  MEMORY_TOKENS: {
    MEMORY_STORE: Symbol.for('PtahMemoryStore'),
    MEMORY_SEARCH: Symbol.for('PtahMemorySearch'),
    MEMORY_CURATOR: Symbol.for('PtahMemoryCurator'),
    MEMORY_SALIENCE_SCORER: Symbol.for('PtahMemorySalienceScorer'),
    MEMORY_DECAY_JOB: Symbol.for('PtahMemoryDecayJob'),
    CURATOR_LLM: Symbol.for('PtahCuratorLlm'),
  },
}));

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
import type {
  Logger,
  RpcHandler,
  SentryService,
} from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  createMockSentryService,
  type MockRpcHandler,
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
import type { ModelSettings } from '@ptah-extension/settings-core';
import { SetupRpcHandlers } from '@ptah-extension/rpc-handlers';

// ---------------------------------------------------------------------------
// Token re-declaration (avoids transitively loading agent-generation barrel)
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
// Narrow mock surfaces
// ---------------------------------------------------------------------------

interface MockSettingHandle {
  get: jest.Mock<string, []>;
  set: jest.Mock<Promise<void>, [string]>;
  watch: jest.Mock<{ dispose: jest.Mock }, []>;
}

interface MockModelSettings {
  selectedModel: MockSettingHandle;
}

function createMockModelSettings(): MockModelSettings & ModelSettings {
  return {
    selectedModel: {
      get: jest.fn().mockReturnValue(''),
      set: jest.fn().mockResolvedValue(undefined),
      watch: jest.fn().mockReturnValue({ dispose: jest.fn() }),
    },
  } as unknown as MockModelSettings & ModelSettings;
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

interface MockContainer extends jest.Mocked<
  Pick<DependencyContainer, 'resolve'>
> {
  __register(token: symbol | string, service: unknown): void;
}

function createMockContainer(): MockContainer {
  const services = new Map<symbol | string, unknown>();
  const mock = {
    resolve: jest.fn((token: symbol | string): unknown => {
      if (services.has(token)) return services.get(token);
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
// Manifest fixture
// ---------------------------------------------------------------------------

const MANIFEST = {
  version: 2 as const,
  slug: 'vscode-test-project',
  analyzedAt: '2026-05-08T00:00:00.000Z',
  model: 'sonnet',
  totalDurationMs: 500,
  phases: {
    'project-profile': {
      status: 'completed' as const,
      file: '01-project-profile.md',
      durationMs: 100,
    },
    'quality-audit': {
      status: 'completed' as const,
      file: '03-quality-audit.md',
      durationMs: 100,
    },
  },
};

// ---------------------------------------------------------------------------
// Harness builder
// ---------------------------------------------------------------------------

const WORKSPACE = '/fake/vscode/workspace';

interface Harness {
  handlers: SetupRpcHandlers;
  logger: MockLogger;
  rpcHandler: MockRpcHandler;
  container: MockContainer;
  workspace: MockWorkspaceProvider;
  platformCommands: MockPlatformCommands;
}

function makeHarness(): Harness {
  const logger = createMockLogger();
  const rpcHandler = createMockRpcHandler();
  const modelSettings = createMockModelSettings();
  const pluginLoader = createMockPluginLoader();
  const workspace = createMockWorkspaceProvider({ folders: [WORKSPACE] });
  const container = createMockContainer();
  const sentry = createMockSentryService();
  const platformCommands = createMockPlatformCommands();

  const handlers = new SetupRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as RpcHandler,
    modelSettings as unknown as ModelSettings,
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
    container,
    workspace,
    platformCommands,
  };
}

// ---------------------------------------------------------------------------
// Graceful-degradation test
// ---------------------------------------------------------------------------

describe('VS Code wizard:deep-analyze — memory seeding no-op (T5.2)', () => {
  it('[vscode-noop] seeding is skipped gracefully when memory-curator is not registered', async () => {
    const h = makeHarness();

    // Wire premium-gating services (required for wizard:deep-analyze to proceed)
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

    // Wire multi-phase analysis service
    h.container.__register(
      AGENT_GENERATION_TOKENS.MULTI_PHASE_ANALYSIS_SERVICE,
      {
        analyzeWorkspace: jest.fn().mockResolvedValue({
          isErr: () => false,
          value: MANIFEST,
        }),
      },
    );

    // Wire storage service
    h.container.__register(AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE, {
      getSlugDir: jest.fn().mockReturnValue('/fake/slug'),
      readPhaseFile: jest
        .fn()
        .mockImplementation(async (_dir: string, file: string) => {
          if (file === '01-project-profile.md')
            return '# VS Code Test\n**Frameworks**: Express\n';
          if (file === '03-quality-audit.md')
            return '## Code Conventions\n- Use ESLint\n';
          return null;
        }),
    });

    // Wire file system provider stub (consulted by deriveWorkspaceFingerprint)
    h.container.__register(Symbol.for('PlatformFileSystemProvider'), {
      readFile: jest.fn().mockResolvedValue(''),
    });

    // CRITICAL: PLATFORM_TOKENS.MEMORY_WRITER is NOT registered here.
    // This is the current state of VS Code's phase-2-libraries.ts.

    h.handlers.register();

    // Invoke wizard:deep-analyze
    const response = await h.rpcHandler.handleMessage({
      method: 'wizard:deep-analyze',
      params: {},
      correlationId: 'test-vscode-noop',
    });

    // 1. Analysis response returns successfully — no exception bubbles
    expect(response.success).toBe(true);

    // 2. The skip log is emitted at info level
    const skipLog = h.logger.info.mock.calls.find(
      ([msg]) =>
        String(msg) ===
        '[SetupWizard] Memory seeding skipped (store unavailable)',
    );
    expect(skipLog).toBeDefined();

    // 3. No warn logs for seeding failures (the skip is graceful, not an error)
    const seedingWarnLogs = h.logger.warn.mock.calls.filter(([msg]) =>
      String(msg).includes('[SetupWizard] Memory seeding failed'),
    );
    expect(seedingWarnLogs).toHaveLength(0);
  });
});
