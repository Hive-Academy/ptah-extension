/**
 * WizardGenerationRpcHandlers — unit specs.
 *
 * Surface under test: the three RPC methods wiring the setup-wizard
 * generation pipeline to the webview (`wizard:submit-selection`,
 * `wizard:cancel`, `wizard:retry-item`), driven through the REAL
 * `GenerationCheckpointService` and `GenerationRunSupervisor` collaborators
 * over an in-memory `AnalysisStorageService` fake. The handler uses LAZY DI
 * resolution for agent-generation services, so the spec drives a mock
 * `DependencyContainer`.
 *
 * Behavioural contracts locked in here (TASK_2026_361 Batch 3):
 *
 *   - Zod boundary: a traversal-y agent id / missing itemId / non-boolean
 *     saveProgress is an `INVALID_PARAMS` typed error, never a Sentry report.
 *   - Checkpoint-before-launch: the generation manifest is written with every
 *     agent `pending` BEFORE the orchestrator is invoked; a manifest write
 *     failure starts no work.
 *   - One owned controller: the watchdog aborts the orchestrator through the
 *     signal it was handed, the run is AWAITED until it settles, propagation
 *     runs because a file was written, and exactly one completion payload
 *     goes out — derived from explicit outcomes, `success: false`.
 *   - Cancel is a pause: the run stays active until settlement (a second
 *     submit is still rejected meanwhile), the checkpoint is kept with
 *     lifecycle `paused`, and the earlier write still propagates.
 *   - Resume re-runs only `pending | running | failed` agents, normalizes a
 *     stale `running` record, carries `written | unchanged` files forward as
 *     `unchanged` in the payload, and refuses a checkpoint whose paths leave
 *     the workspace without deleting it.
 *   - Retry reuses the last run's options, updates the same checkpoint
 *     record, and propagates only after a real write.
 *
 * Source-under-test:
 *   `libs/backend/rpc-handlers/src/lib/handlers/wizard-generation-rpc.handlers.ts`
 */

import 'reflect-metadata';

// ---------------------------------------------------------------------------
// Jest transitive-import guard.
//
// The SUT imports from `@ptah-extension/agent-generation`, whose barrel
// re-exports from `@ptah-extension/workspace-intelligence`. The
// workspace-intelligence barrel eagerly re-exports `TreeSitterParserService`,
// whose module top-level evaluates
// `path.dirname(fileURLToPath(import.meta.url))` — a construct Jest's
// ts-jest CJS transform cannot parse ("SyntaxError: Cannot use
// 'import.meta' outside a module"). Matches `setup-rpc.handlers.spec.ts`.
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

import * as path from 'path';
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
  type MockSentryService,
} from '@ptah-extension/vscode-core/testing';
import {
  createMockWorkspaceProvider,
  type MockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type {
  GenerationCheckpointManifest,
  GenerationSummary,
  OrchestratorGenerationOptions,
} from '@ptah-extension/agent-generation';
import type { PluginLoaderService } from '@ptah-extension/agent-sdk';
import {
  Result,
  type GenerationAgentOutcome,
  type GenerationCompletePayload,
  type WizardSubmitSelectionParams,
} from '@ptah-extension/shared';
import { TOKENS } from '@ptah-extension/vscode-core';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

// ---------------------------------------------------------------------------
// Token re-declaration via `Symbol.for` — avoids a value import of the
// `@ptah-extension/agent-generation` / `agent-sdk` / `harness-sync` barrels.
// The global `Symbol.for` registry guarantees these symbols are IDENTICAL to
// the ones the SUT resolves at runtime.
//
// Must stay in sync with:
//   - `libs/backend/agent-generation/src/lib/di/tokens.ts`
//   - `libs/backend/harness-sync/src/lib/di/tokens.ts`
// ---------------------------------------------------------------------------
const AGENT_GENERATION_TOKENS = {
  AGENT_GENERATION_ORCHESTRATOR: Symbol.for(
    'AgentGenerationOrchestratorService',
  ),
  SETUP_WIZARD_SERVICE: Symbol.for('SetupWizardService'),
  ENHANCED_PROMPTS_SERVICE: Symbol.for('SdkEnhancedPromptsService'),
  ANALYSIS_STORAGE_SERVICE: Symbol.for('AnalysisStorageService'),
} as const;

const HARNESS_SYNC_TOKENS = {
  PROPAGATION: Symbol.for('HarnessSyncPropagation'),
  AGENT_SYNC_GATE: Symbol.for('HarnessSyncAgentSyncGate'),
} as const;

import { WizardGenerationRpcHandlers } from './wizard-generation-rpc.handlers';
import { GenerationCheckpointService } from './wizard-generation-checkpoint.service';
import {
  GENERATION_TIMEOUT_MS,
  GenerationRunSupervisor,
} from './wizard-generation-run.supervisor';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORKSPACE = '/fake/workspace';
const ANALYSIS_DIR = `${WORKSPACE}/.ptah/analysis/acme`;
/** Same computation the checkpoint service and the orchestrator use. */
const OUTPUT_DIR = path.join(WORKSPACE, '.claude', 'agents');

function outcome(
  agentId: string,
  status: GenerationAgentOutcome['status'],
  extra: Partial<GenerationAgentOutcome> = {},
): GenerationAgentOutcome {
  return {
    agentId,
    filePath: path.join(OUTPUT_DIR, `${agentId}.md`),
    status,
    rejectedSections: 0,
    tailoredSections: 0,
    ...extra,
  };
}

function makeSummary(
  outcomes: GenerationAgentOutcome[],
  overrides: Partial<GenerationSummary> = {},
): GenerationSummary {
  const count = (status: GenerationAgentOutcome['status']): number =>
    outcomes.filter((o) => o.status === status).length;
  const written = count('written');
  const unchanged = count('unchanged');
  const failed = count('failed');
  return {
    totalAgents: outcomes.length,
    successful: written + unchanged,
    failed,
    durationMs: 123,
    warnings: [],
    outputDirectory: OUTPUT_DIR,
    writtenCount: written,
    unchangedCount: unchanged,
    failedCount: failed,
    rejectedSections: outcomes.reduce((s, o) => s + o.rejectedSections, 0),
    tailoredSections: outcomes.reduce((s, o) => s + o.tailoredSections, 0),
    lifecycle: written + unchanged === 0 && failed > 0 ? 'failed' : 'completed',
    outcomes,
    enhancedPromptsUsed: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Narrow mock surfaces
// ---------------------------------------------------------------------------

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

interface OrchestratorFake {
  generateAgents: jest.Mock;
}

function createMockOrchestrator(): OrchestratorFake {
  return {
    // Default: never resolve. Individual tests override.
    generateAgents: jest.fn().mockImplementation(
      () =>
        new Promise(() => {
          /* pending forever so tests can assert mid-flight state */
        }),
    ),
  };
}

interface SetupWizardFake {
  getCurrentSession: jest.Mock;
  cancelWizard: jest.Mock;
}

function createMockSetupWizard(): SetupWizardFake {
  return {
    getCurrentSession: jest.fn().mockReturnValue(null),
    cancelWizard: jest.fn().mockResolvedValue(Result.ok(undefined)),
  };
}

interface WebviewManagerFake {
  broadcastMessage: jest.Mock;
}

function createMockWebviewManager(): WebviewManagerFake {
  return {
    broadcastMessage: jest.fn().mockResolvedValue(undefined),
  };
}

/**
 * In-memory stand-in for the slice of `AnalysisStorageService` the checkpoint
 * service uses. Manifests are keyed by workspace + analysis dir exactly as the
 * real service keys its file path, and `updateGenerationManifest` mirrors the
 * real load → patch → write sequence.
 */
interface StorageFake {
  manifests: Map<string, GenerationCheckpointManifest>;
  resumable: {
    slugDir: string | null;
    manifest: unknown;
    generation: GenerationCheckpointManifest | null;
  } | null;
  resolveAuthorizedAnalysisDir: jest.Mock;
  writeGenerationManifest: jest.Mock;
  loadGenerationManifest: jest.Mock;
  updateGenerationManifest: jest.Mock;
  findLatestResumableRun: jest.Mock;
  loadManifest: jest.Mock;
}

const manifestKey = (ws: string, dir: string | null): string =>
  `${ws}|${dir ?? ''}`;

function createStorageFake(): StorageFake {
  const manifests = new Map<string, GenerationCheckpointManifest>();
  const fake: StorageFake = {
    manifests,
    resumable: null,
    resolveAuthorizedAnalysisDir: jest.fn(
      (ws: string, candidate: string): string | null =>
        candidate.startsWith(`${ws}/.ptah/analysis`) &&
        !candidate.includes('..')
          ? candidate
          : null,
    ),
    writeGenerationManifest: jest.fn(
      async (
        ws: string,
        dir: string | null,
        manifest: GenerationCheckpointManifest,
      ) => {
        manifests.set(manifestKey(ws, dir), structuredClone(manifest));
        return `${dir ?? ws}/generation-manifest.json`;
      },
    ),
    loadGenerationManifest: jest.fn(async (ws: string, dir: string | null) => {
      const found = manifests.get(manifestKey(ws, dir));
      return found ? structuredClone(found) : null;
    }),
    updateGenerationManifest: jest.fn(
      async (
        ws: string,
        dir: string | null,
        patch: (
          m: GenerationCheckpointManifest,
        ) => GenerationCheckpointManifest,
      ) => {
        const current = manifests.get(manifestKey(ws, dir));
        if (!current) return null;
        const next = patch(structuredClone(current));
        next.updatedAt = new Date().toISOString();
        manifests.set(manifestKey(ws, dir), structuredClone(next));
        return next;
      },
    ),
    findLatestResumableRun: jest.fn(async () => fake.resumable),
    loadManifest: jest.fn(async () => null),
  };
  return fake;
}

function createMockContainer(
  registry: Map<symbol | string, unknown>,
): jest.Mocked<Pick<DependencyContainer, 'resolve' | 'isRegistered'>> {
  return {
    resolve: jest.fn((token: symbol | string) => {
      if (registry.has(token)) return registry.get(token);
      throw new Error(`Token not registered: ${String(token)}`);
    }),
    isRegistered: jest.fn((token: symbol | string) => registry.has(token)),
  } as unknown as jest.Mocked<
    Pick<DependencyContainer, 'resolve' | 'isRegistered'>
  >;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  handlers: WizardGenerationRpcHandlers;
  logger: MockLogger;
  rpcHandler: MockRpcHandler;
  pluginLoader: MockPluginLoader;
  workspace: MockWorkspaceProvider;
  container: jest.Mocked<Pick<DependencyContainer, 'resolve' | 'isRegistered'>>;
  registry: Map<symbol | string, unknown>;
  orchestrator: OrchestratorFake;
  setupWizard: SetupWizardFake;
  webviewManager: WebviewManagerFake;
  storage: StorageFake;
  propagation: { propagate: jest.Mock };
  sentry: MockSentryService;
}

function makeHarness(
  opts: {
    workspaceRoot?: string;
    /** Omit specific tokens from the registry to simulate "not registered". */
    skip?: Array<symbol | string>;
  } = {},
): Harness {
  const logger = createMockLogger();
  const rpcHandler = createMockRpcHandler();
  const pluginLoader = createMockPluginLoader();
  const workspace = createMockWorkspaceProvider({
    folders: opts.workspaceRoot === '' ? [] : [opts.workspaceRoot ?? WORKSPACE],
  });
  const sentry = createMockSentryService();

  const orchestrator = createMockOrchestrator();
  const setupWizard = createMockSetupWizard();
  const webviewManager = createMockWebviewManager();
  const storage = createStorageFake();
  const propagation = {
    propagate: jest.fn().mockResolvedValue({ targets: [] }),
  };
  const registry = new Map<symbol | string, unknown>();

  const skip = new Set<symbol | string>(opts.skip ?? []);
  const maybeSet = (token: symbol | string, value: unknown) => {
    if (!skip.has(token)) registry.set(token, value);
  };

  maybeSet(AGENT_GENERATION_TOKENS.AGENT_GENERATION_ORCHESTRATOR, orchestrator);
  maybeSet(AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE, setupWizard);
  maybeSet(AGENT_GENERATION_TOKENS.ANALYSIS_STORAGE_SERVICE, storage);
  maybeSet(TOKENS.WEBVIEW_MANAGER, webviewManager);
  maybeSet(HARNESS_SYNC_TOKENS.PROPAGATION, propagation);
  maybeSet(HARNESS_SYNC_TOKENS.AGENT_SYNC_GATE, {
    enable: jest.fn().mockReturnValue(true),
  });
  // CodeExecutionMCP / EnhancedPromptsService are intentionally left OUT of
  // the default registry: the handler must proceed without them.

  const container = createMockContainer(registry);
  const checkpoints = new GenerationCheckpointService(
    logger as unknown as Logger,
    container as unknown as DependencyContainer,
  );
  const runs = new GenerationRunSupervisor(logger as unknown as Logger);

  const handlers = new WizardGenerationRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as RpcHandler,
    pluginLoader as unknown as PluginLoaderService,
    workspace as unknown as IWorkspaceProvider,
    container as unknown as DependencyContainer,
    sentry as unknown as SentryService,
    checkpoints,
    runs,
  );

  return {
    handlers,
    logger,
    rpcHandler,
    pluginLoader,
    workspace,
    container,
    registry,
    orchestrator,
    setupWizard,
    webviewManager,
    storage,
    propagation,
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

/** Wait for one Node macrotask turn — lets fire-and-forget promises settle. */
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

async function settle(): Promise<void> {
  for (let i = 0; i < 4; i++) await flushMicrotasks();
}

function completeBroadcasts(h: Harness): GenerationCompletePayload[] {
  return h.webviewManager.broadcastMessage.mock.calls
    .filter(([type]) => type === 'setup-wizard:generation-complete')
    .map(([, payload]) => payload as GenerationCompletePayload);
}

function manifestAt(
  h: Harness,
  analysisDir: string | null = null,
): GenerationCheckpointManifest {
  const found = h.storage.manifests.get(manifestKey(WORKSPACE, analysisDir));
  if (!found) throw new Error(`No manifest stored for ${analysisDir}`);
  return found;
}

function firstOptions(h: Harness): OrchestratorGenerationOptions {
  const [options] = h.orchestrator.generateAgents.mock.calls[0] as [
    OrchestratorGenerationOptions,
  ];
  return options;
}

/** An orchestrator that stops when its signal fires and settles with `summary`. */
function abortAwareOrchestrator(
  h: Harness,
  summary: (signal: AbortSignal) => GenerationSummary,
): void {
  h.orchestrator.generateAgents.mockImplementation(
    (options: OrchestratorGenerationOptions) =>
      new Promise((resolve) => {
        const signal = options.abortSignal;
        if (!signal) throw new Error('abortSignal was not threaded');
        const finish = () => resolve(Result.ok(summary(signal)));
        if (signal.aborted) finish();
        else signal.addEventListener('abort', finish, { once: true });
      }),
  );
}

/** An orchestrator that reports each outcome through the callback, then settles. */
function recordingOrchestrator(
  h: Harness,
  outcomes: GenerationAgentOutcome[],
  overrides: Partial<GenerationSummary> = {},
): void {
  h.orchestrator.generateAgents.mockImplementation(
    async (options: OrchestratorGenerationOptions) => {
      for (const o of outcomes) await options.onAgentOutcome?.(o);
      return Result.ok(makeSummary(outcomes, overrides));
    },
  );
}

function seedCheckpoint(
  h: Harness,
  agents: Record<
    string,
    GenerationCheckpointManifest['agents'][string]['status']
  >,
  overrides: Partial<GenerationCheckpointManifest> = {},
): void {
  const manifest: GenerationCheckpointManifest = {
    version: 1,
    runId: 'run-prev',
    analysisDirectory: ANALYSIS_DIR,
    createdAt: '2026-08-31T00:00:00.000Z',
    updatedAt: '2026-08-31T00:10:00.000Z',
    lifecycle: 'paused',
    outputDirectory: OUTPUT_DIR,
    selectedAgentIds: Object.keys(agents),
    input: { model: 'model-from-checkpoint', threshold: 70 },
    agents: Object.fromEntries(
      Object.entries(agents).map(([agentId, status]) => [
        agentId,
        {
          agentId,
          filePath: path.join(OUTPUT_DIR, `${agentId}.md`),
          status,
          rejectedSections: 1,
          tailoredSections: 2,
        },
      ]),
    ),
    ...overrides,
  };
  h.storage.manifests.set(manifestKey(WORKSPACE, ANALYSIS_DIR), manifest);
}

const BASE_SUBMIT_PARAMS: WizardSubmitSelectionParams = {
  selectedAgentIds: ['agent-a'],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WizardGenerationRpcHandlers', () => {
  describe('register()', () => {
    it('registers all three wizard generation RPC methods', () => {
      const h = makeHarness();
      h.handlers.register();

      expect(h.rpcHandler.getRegisteredMethods().sort()).toEqual(
        [
          'wizard:cancel',
          'wizard:retry-item',
          'wizard:submit-selection',
        ].sort(),
      );
    });
  });

  // -------------------------------------------------------------------------
  // wizard:submit-selection — boundary
  // -------------------------------------------------------------------------

  describe('wizard:submit-selection — boundary', () => {
    it('rejects when selectedAgentIds is empty (structured, no service resolved)', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'wizard:submit-selection',
        { selectedAgentIds: [] },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no agents selected/i);
      expect(h.container.resolve).not.toHaveBeenCalled();
    });

    it('rejects a traversal-y agent id as INVALID_PARAMS without a Sentry report', async () => {
      const h = makeHarness();
      h.handlers.register();

      const response = await callRaw(h, 'wizard:submit-selection', {
        selectedAgentIds: ['../../etc/passwd'],
      });

      expect(response.success).toBe(false);
      expect(response.errorCode).toBe('INVALID_PARAMS');
      expect(h.sentry.captureException).not.toHaveBeenCalled();
      expect(h.orchestrator.generateAgents).not.toHaveBeenCalled();
    });

    it('rejects when no workspace folder is open', async () => {
      const h = makeHarness({ workspaceRoot: '' });
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'wizard:submit-selection',
        BASE_SUBMIT_PARAMS,
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no workspace folder/i);
    });

    it('rejects an analysisDir outside <workspace>/.ptah/analysis as UNAUTHORIZED_WORKSPACE', async () => {
      const h = makeHarness();
      h.handlers.register();

      const response = await callRaw(h, 'wizard:submit-selection', {
        ...BASE_SUBMIT_PARAMS,
        analysisDir: `${WORKSPACE}/.ptah/analysis/../../secrets`,
      });

      expect(response.success).toBe(false);
      expect(response.errorCode).toBe('UNAUTHORIZED_WORKSPACE');
      expect(h.orchestrator.generateAgents).not.toHaveBeenCalled();
      expect(h.storage.writeGenerationManifest).not.toHaveBeenCalled();
    });

    it('passes a canonical in-root analysisDir to the orchestrator and stores the checkpoint beside it', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'wizard:submit-selection', {
        ...BASE_SUBMIT_PARAMS,
        analysisDir: ANALYSIS_DIR,
      });

      expect(firstOptions(h).analysisDir).toBe(ANALYSIS_DIR);
      expect(manifestAt(h, ANALYSIS_DIR).analysisDirectory).toBe(ANALYSIS_DIR);
    });

    it('drops analysisData that is not a ProjectAnalysisResult and warns, instead of failing the request', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean }>(
        h,
        'wizard:submit-selection',
        {
          ...BASE_SUBMIT_PARAMS,
          analysisData: { isMultiPhase: true, manifest: {}, phaseContents: {} },
        },
      );

      expect(result.success).toBe(true);
      expect(firstOptions(h).preComputedAnalysis).toBeUndefined();
      expect(
        h.logger.warn.mock.calls.some(([msg]) =>
          String(msg).includes('ignored analysisData'),
        ),
      ).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // wizard:submit-selection — launch
  // -------------------------------------------------------------------------

  describe('wizard:submit-selection — launch', () => {
    it('returns success immediately (fire-and-forget orchestration)', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean }>(
        h,
        'wizard:submit-selection',
        BASE_SUBMIT_PARAMS,
      );

      expect(result.success).toBe(true);
      expect(h.orchestrator.generateAgents).toHaveBeenCalledTimes(1);
    });

    it('writes the generation checkpoint with every agent pending BEFORE invoking the orchestrator', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'wizard:submit-selection', {
        selectedAgentIds: ['agent-a', 'agent-b'],
        threshold: 65,
        model: 'model-x',
      });

      const writeOrder =
        h.storage.writeGenerationManifest.mock.invocationCallOrder[0];
      const generateOrder =
        h.orchestrator.generateAgents.mock.invocationCallOrder[0];
      expect(writeOrder).toBeLessThan(generateOrder);

      const manifest = manifestAt(h);
      expect(manifest.lifecycle).toBe('running');
      expect(manifest.outputDirectory).toBe(OUTPUT_DIR);
      expect(manifest.selectedAgentIds).toEqual(['agent-a', 'agent-b']);
      expect(manifest.input).toEqual({ threshold: 65, model: 'model-x' });
      expect(Object.values(manifest.agents).map((a) => a.status)).toEqual([
        'pending',
        'pending',
      ]);
      expect(manifest.agents['agent-b'].filePath).toBe(
        path.join(OUTPUT_DIR, 'agent-b.md'),
      );
    });

    it('starts no work when the checkpoint cannot be written', async () => {
      const h = makeHarness();
      h.storage.writeGenerationManifest.mockRejectedValueOnce(
        new Error('disk full'),
      );
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'wizard:submit-selection',
        BASE_SUBMIT_PARAMS,
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/agent generation failed: disk full/i);
      expect(h.orchestrator.generateAgents).not.toHaveBeenCalled();
      // The run never became active, so the next submit is accepted.
      const second = await call<{ success: boolean }>(
        h,
        'wizard:submit-selection',
        BASE_SUBMIT_PARAMS,
      );
      expect(second.success).toBe(true);
    });

    it('leaves no timer holding the event loop open when the generation never settles (TASK_2026_320)', async () => {
      const created: NodeJS.Timeout[] = [];
      const realSetTimeout = global.setTimeout;
      const setTimeoutSpy = jest
        .spyOn(global, 'setTimeout')
        .mockImplementation(((...args: Parameters<typeof setTimeout>) => {
          const timer = realSetTimeout(...args);
          created.push(timer as unknown as NodeJS.Timeout);
          return timer;
        }) as unknown as typeof global.setTimeout);

      try {
        const h = makeHarness();
        h.handlers.register();

        await call(h, 'wizard:submit-selection', BASE_SUBMIT_PARAMS);

        expect(created.length).toBeGreaterThan(0);
        expect(created.filter((timer) => timer.hasRef())).toEqual([]);
      } finally {
        created.forEach((timer) => clearTimeout(timer));
        setTimeoutSpy.mockRestore();
      }
    });

    it('threads selectedAgentIds, an abort signal and the checkpoint callback into the orchestrator', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'wizard:submit-selection', {
        selectedAgentIds: ['agent-a', 'agent-b'],
      });

      const options = firstOptions(h);
      expect(options.userOverrides).toEqual(['agent-a', 'agent-b']);
      expect(options.workspacePath).toBe(WORKSPACE);
      expect(options.abortSignal).toBeInstanceOf(AbortSignal);
      expect(options.abortSignal?.aborted).toBe(false);
      expect(typeof options.onAgentOutcome).toBe('function');
    });

    it('rejects a concurrent submission while generation is in progress', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'wizard:submit-selection', BASE_SUBMIT_PARAMS);
      const second = await call<{ success: boolean; error?: string }>(
        h,
        'wizard:submit-selection',
        BASE_SUBMIT_PARAMS,
      );

      expect(second.success).toBe(false);
      expect(second.error).toMatch(/already in progress/i);
      expect(h.storage.writeGenerationManifest).toHaveBeenCalledTimes(1);
    });

    it('persists each agent outcome as it settles, finalizes the lifecycle, propagates once and broadcasts once', async () => {
      const h = makeHarness();
      recordingOrchestrator(h, [
        outcome('agent-a', 'written', { tailoredSections: 3 }),
        outcome('agent-b', 'unchanged'),
        outcome('agent-c', 'failed', { error: 'template missing' }),
      ]);
      h.handlers.register();

      await call(h, 'wizard:submit-selection', {
        selectedAgentIds: ['agent-a', 'agent-b', 'agent-c'],
      });
      await settle();

      const manifest = manifestAt(h);
      expect(manifest.lifecycle).toBe('completed');
      expect(manifest.agents['agent-a']).toMatchObject({
        status: 'written',
        tailoredSections: 3,
      });
      expect(manifest.agents['agent-b'].status).toBe('unchanged');
      expect(manifest.agents['agent-c']).toMatchObject({
        status: 'failed',
        error: 'template missing',
      });

      expect(h.propagation.propagate).toHaveBeenCalledTimes(1);
      expect(h.propagation.propagate).toHaveBeenCalledWith(
        WORKSPACE,
        'wizard:generation-complete',
      );

      const broadcasts = completeBroadcasts(h);
      expect(broadcasts).toHaveLength(1);
      expect(broadcasts[0]).toMatchObject({
        success: false,
        outputDirectory: OUTPUT_DIR,
        writtenCount: 1,
        unchangedCount: 1,
        failedCount: 1,
        tailoredSections: 3,
      });
      expect(broadcasts[0].agents.map((a) => a.status)).toEqual([
        'written',
        'unchanged',
        'failed',
      ]);
      expect(broadcasts[0].errors).toEqual(['agent-c: template missing']);
      expect(broadcasts[0]).not.toHaveProperty('generatedCount');

      // Active state cleared only after settlement: a new submit is accepted.
      const second = await call<{ success: boolean }>(
        h,
        'wizard:submit-selection',
        BASE_SUBMIT_PARAMS,
      );
      expect(second.success).toBe(true);
    });

    it('does not propagate when nothing was written', async () => {
      const h = makeHarness();
      recordingOrchestrator(h, [outcome('agent-a', 'unchanged')]);
      h.handlers.register();

      await call(h, 'wizard:submit-selection', BASE_SUBMIT_PARAMS);
      await settle();

      expect(h.propagation.propagate).not.toHaveBeenCalled();
      expect(completeBroadcasts(h)[0]).toMatchObject({
        success: true,
        unchangedCount: 1,
      });
    });

    it('a checkpoint that stops being readable mid-run stops later agents and is reported as a failure', async () => {
      const h = makeHarness();
      const seen: string[] = [];
      h.orchestrator.generateAgents.mockImplementation(
        async (options: OrchestratorGenerationOptions) => {
          // The orchestrator awaits every callback; a throw ends the run.
          seen.push('agent-a');
          await options.onAgentOutcome?.(outcome('agent-a', 'written'));
          h.storage.manifests.clear();
          seen.push('agent-b');
          await options.onAgentOutcome?.(outcome('agent-b', 'written'));
          seen.push('agent-c');
          return Result.ok(makeSummary([]));
        },
      );
      h.handlers.register();

      await call(h, 'wizard:submit-selection', {
        selectedAgentIds: ['agent-a', 'agent-b', 'agent-c'],
      });
      await settle();

      expect(seen).toEqual(['agent-a', 'agent-b']);
      const [payload] = completeBroadcasts(h);
      expect(payload.success).toBe(false);
      expect(payload.errors?.[0]).toMatch(/checkpoint is no longer readable/i);
    });

    it('still succeeds when optional services (MCP, enhanced prompts) are not registered', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean }>(
        h,
        'wizard:submit-selection',
        BASE_SUBMIT_PARAMS,
      );

      expect(result.success).toBe(true);
      expect(firstOptions(h).mcpServerRunning).toBe(false);
      expect(firstOptions(h).enhancedPromptContent).toBeUndefined();
    });

    it('orchestrator-resolution failure returns a structured error, reports Sentry and writes no checkpoint', async () => {
      const h = makeHarness({
        skip: [AGENT_GENERATION_TOKENS.AGENT_GENERATION_ORCHESTRATOR],
      });
      h.handlers.register();

      const response = await callRaw(h, 'wizard:submit-selection', {
        ...BASE_SUBMIT_PARAMS,
      });

      expect(response.success).toBe(true);
      const body = response.data as { success: boolean; error?: string };
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/agent generation failed/i);
      expect(h.sentry.captureException).toHaveBeenCalled();
      expect(h.storage.writeGenerationManifest).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Watchdog and cancel
  // -------------------------------------------------------------------------

  describe('watchdog and cancel', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('watchdog aborts the orchestrator, waits for it to settle, propagates the earlier write and broadcasts exactly one partial outcome', async () => {
      jest.useFakeTimers({
        doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'],
      });
      const h = makeHarness();
      abortAwareOrchestrator(h, () =>
        makeSummary(
          [
            outcome('agent-a', 'written'),
            outcome('agent-b', 'failed', {
              error: 'not generated: generation_timeout',
            }),
          ],
          { lifecycle: 'timed-out' },
        ),
      );
      h.handlers.register();

      await call(h, 'wizard:submit-selection', {
        selectedAgentIds: ['agent-a', 'agent-b'],
      });
      expect(completeBroadcasts(h)).toHaveLength(0);

      await jest.advanceTimersByTimeAsync(GENERATION_TIMEOUT_MS);
      await settle();

      const signal = firstOptions(h).abortSignal;
      expect(signal?.aborted).toBe(true);
      expect(String(signal?.reason)).toBe('generation_timeout');

      const broadcasts = completeBroadcasts(h);
      expect(broadcasts).toHaveLength(1);
      expect(broadcasts[0]).toMatchObject({
        success: false,
        writtenCount: 1,
        failedCount: 1,
        outputDirectory: OUTPUT_DIR,
      });
      expect(broadcasts[0].errors?.join('\n')).toMatch(/10-minute limit/);
      expect(h.propagation.propagate).toHaveBeenCalledTimes(1);
      expect(manifestAt(h).lifecycle).toBe('timed-out');
    });

    it('cancel is a pause: aborts the run, keeps the checkpoint, stays active until settlement, then propagates the earlier write', async () => {
      const h = makeHarness();
      let released!: () => void;
      const orchestratorStopped = new Promise<void>((r) => (released = r));
      h.orchestrator.generateAgents.mockImplementation(
        async (options: OrchestratorGenerationOptions) => {
          await options.onAgentOutcome?.(outcome('agent-a', 'written'));
          await new Promise<void>((resolve) => {
            options.abortSignal?.addEventListener('abort', () => resolve(), {
              once: true,
            });
          });
          // Simulate the orchestrator taking a moment to wind down.
          await orchestratorStopped;
          const outcomes = [
            outcome('agent-a', 'written'),
            outcome('agent-b', 'failed', {
              error: 'not generated: user_cancelled',
            }),
          ];
          await options.onAgentOutcome?.(outcomes[1]);
          return Result.ok(makeSummary(outcomes, { lifecycle: 'paused' }));
        },
      );
      h.handlers.register();

      await call(h, 'wizard:submit-selection', {
        selectedAgentIds: ['agent-a', 'agent-b'],
      });
      await settle();

      const cancel = await call<{
        cancelled: boolean;
        progressSaved?: boolean;
      }>(h, 'wizard:cancel', {});
      expect(cancel).toEqual({ cancelled: true, progressSaved: true });
      expect(String(firstOptions(h).abortSignal?.reason)).toBe(
        'user_cancelled',
      );

      // Not settled yet: the run still owns the slot.
      const during = await call<{ success: boolean; error?: string }>(
        h,
        'wizard:submit-selection',
        BASE_SUBMIT_PARAMS,
      );
      expect(during.success).toBe(false);
      expect(during.error).toMatch(/already in progress/i);
      expect(completeBroadcasts(h)).toHaveLength(0);

      released();
      await settle();

      const manifest = manifestAt(h);
      expect(manifest.lifecycle).toBe('paused');
      expect(manifest.agents['agent-a'].status).toBe('written');
      expect(manifest.agents['agent-b'].status).toBe('failed');
      expect(h.propagation.propagate).toHaveBeenCalledTimes(1);
      const broadcasts = completeBroadcasts(h);
      expect(broadcasts).toHaveLength(1);
      expect(broadcasts[0]).toMatchObject({
        success: false,
        writtenCount: 1,
        failedCount: 1,
      });
      expect(broadcasts[0].errors?.join('\n')).toMatch(/paused/i);

      const after = await call<{ success: boolean }>(
        h,
        'wizard:submit-selection',
        BASE_SUBMIT_PARAMS,
      );
      expect(after.success).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // wizard:submit-selection — resume
  // -------------------------------------------------------------------------

  describe('wizard:submit-selection — resume', () => {
    it('re-runs only pending/running/failed agents, normalizes a stale running record and carries written files forward as unchanged', async () => {
      const h = makeHarness();
      seedCheckpoint(h, {
        'agent-a': 'written',
        'agent-b': 'running',
        'agent-c': 'failed',
        'agent-d': 'unchanged',
      });
      recordingOrchestrator(h, [
        outcome('agent-b', 'written'),
        outcome('agent-c', 'written'),
      ]);
      h.handlers.register();

      const result = await call<{ success: boolean }>(
        h,
        'wizard:submit-selection',
        { resume: true, analysisDir: ANALYSIS_DIR },
      );
      expect(result.success).toBe(true);

      const options = firstOptions(h);
      expect(options.userOverrides).toEqual(['agent-b', 'agent-c']);
      // Inputs come from the checkpoint, not the request.
      expect(options.model).toBe('model-from-checkpoint');
      expect(options.threshold).toBe(70);
      expect(options.analysisDir).toBe(ANALYSIS_DIR);

      // The resume write normalized the stale `running` record before launch.
      const preLaunch = h.storage.writeGenerationManifest.mock
        .calls[0][2] as GenerationCheckpointManifest;
      expect(preLaunch.lifecycle).toBe('running');
      expect(preLaunch.agents['agent-b'].status).toBe('pending');
      expect(preLaunch.agents['agent-a'].status).toBe('written');

      await settle();

      const manifest = manifestAt(h, ANALYSIS_DIR);
      expect(manifest.runId).toBe('run-prev');
      expect(manifest.lifecycle).toBe('completed');
      expect(manifest.agents['agent-a'].status).toBe('written');
      expect(manifest.agents['agent-b'].status).toBe('written');
      expect(manifest.agents['agent-c'].status).toBe('written');

      const [payload] = completeBroadcasts(h);
      expect(payload).toMatchObject({
        success: true,
        writtenCount: 2,
        unchangedCount: 2,
        failedCount: 0,
      });
      expect(
        payload.agents.map((a) => `${a.agentId}:${a.status}`).sort(),
      ).toEqual([
        'agent-a:unchanged',
        'agent-b:written',
        'agent-c:written',
        'agent-d:unchanged',
      ]);
      expect(h.propagation.propagate).toHaveBeenCalledTimes(1);
    });

    it('discovers the latest resumable checkpoint when no analysisDir is supplied', async () => {
      const h = makeHarness();
      seedCheckpoint(h, { 'agent-a': 'failed' });
      h.storage.resumable = {
        slugDir: ANALYSIS_DIR,
        manifest: null,
        generation: manifestAt(h, ANALYSIS_DIR),
      };
      h.handlers.register();

      await call(h, 'wizard:submit-selection', { resume: true });

      expect(h.storage.findLatestResumableRun).toHaveBeenCalledWith(WORKSPACE);
      expect(firstOptions(h).userOverrides).toEqual(['agent-a']);
    });

    it('reports no resumable run when there is no checkpoint', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'wizard:submit-selection',
        { resume: true },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no resumable generation run/i);
      expect(h.orchestrator.generateAgents).not.toHaveBeenCalled();
    });

    it('refuses a checkpoint whose output directory leaves the workspace and leaves it on disk', async () => {
      const h = makeHarness();
      seedCheckpoint(
        h,
        { 'agent-a': 'pending' },
        { outputDirectory: '/elsewhere/agents' },
      );
      const before = structuredClone(manifestAt(h, ANALYSIS_DIR));
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'wizard:submit-selection',
        { resume: true, analysisDir: ANALYSIS_DIR },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no resumable generation run/i);
      expect(h.orchestrator.generateAgents).not.toHaveBeenCalled();
      expect(manifestAt(h, ANALYSIS_DIR)).toEqual(before);
    });

    it('settles immediately when every agent is already current: completes the checkpoint and broadcasts once, without the orchestrator', async () => {
      const h = makeHarness();
      seedCheckpoint(h, { 'agent-a': 'written', 'agent-b': 'unchanged' });
      h.handlers.register();

      const result = await call<{ success: boolean }>(
        h,
        'wizard:submit-selection',
        { resume: true, analysisDir: ANALYSIS_DIR },
      );

      expect(result.success).toBe(true);
      expect(h.orchestrator.generateAgents).not.toHaveBeenCalled();
      expect(manifestAt(h, ANALYSIS_DIR).lifecycle).toBe('completed');
      const broadcasts = completeBroadcasts(h);
      expect(broadcasts).toHaveLength(1);
      expect(broadcasts[0]).toMatchObject({
        success: true,
        writtenCount: 0,
        unchangedCount: 2,
        failedCount: 0,
      });
      // Nothing was written by this invocation, so nothing propagates.
      expect(h.propagation.propagate).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // wizard:cancel
  // -------------------------------------------------------------------------

  describe('wizard:cancel', () => {
    it('returns cancelled=false when nothing is running and no session exists', async () => {
      const h = makeHarness();
      h.setupWizard.getCurrentSession.mockReturnValue(null);
      h.handlers.register();

      const result = await call<{ cancelled: boolean }>(h, 'wizard:cancel', {});

      expect(result.cancelled).toBe(false);
      expect(h.setupWizard.cancelWizard).not.toHaveBeenCalled();
    });

    it('rejects a non-boolean saveProgress as INVALID_PARAMS', async () => {
      const h = makeHarness();
      h.handlers.register();

      const response = await callRaw(h, 'wizard:cancel', {
        saveProgress: 'no',
      });

      expect(response.success).toBe(false);
      expect(response.errorCode).toBe('INVALID_PARAMS');
    });

    it('delegates to SetupWizardService when a session is active', async () => {
      const h = makeHarness();
      h.setupWizard.getCurrentSession.mockReturnValue({ id: 'session-1' });
      h.setupWizard.cancelWizard.mockResolvedValue(Result.ok(undefined));
      h.handlers.register();

      const result = await call<{
        cancelled: boolean;
        sessionId?: string;
        progressSaved?: boolean;
      }>(h, 'wizard:cancel', { saveProgress: false });

      expect(result.cancelled).toBe(true);
      expect(result.sessionId).toBe('session-1');
      expect(result.progressSaved).toBe(false);
      expect(h.setupWizard.cancelWizard).toHaveBeenCalledWith(
        'session-1',
        false,
      );
    });

    it('defaults saveProgress to true when omitted', async () => {
      const h = makeHarness();
      h.setupWizard.getCurrentSession.mockReturnValue({ id: 'session-1' });
      h.handlers.register();

      await call(h, 'wizard:cancel', {});

      expect(h.setupWizard.cancelWizard).toHaveBeenCalledWith(
        'session-1',
        true,
      );
    });

    it('reports cancelled=true even when SetupWizardService returns Err', async () => {
      const h = makeHarness();
      h.setupWizard.getCurrentSession.mockReturnValue({ id: 'session-1' });
      h.setupWizard.cancelWizard.mockResolvedValue(
        Result.err(new Error('session already completed')),
      );
      h.handlers.register();

      const result = await call<{ cancelled: boolean; sessionId?: string }>(
        h,
        'wizard:cancel',
        {},
      );

      expect(result.cancelled).toBe(true);
      expect(result.sessionId).toBe('session-1');
    });

    it('returns cancelled=false and captures Sentry when SetupWizardService is not registered and nothing runs', async () => {
      const h = makeHarness({
        skip: [AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE],
      });
      h.handlers.register();

      const result = await call<{ cancelled: boolean }>(h, 'wizard:cancel', {});

      expect(result.cancelled).toBe(false);
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // wizard:retry-item
  // -------------------------------------------------------------------------

  describe('wizard:retry-item', () => {
    it('rejects a missing itemId as INVALID_PARAMS', async () => {
      const h = makeHarness();
      h.handlers.register();

      const response = await callRaw(h, 'wizard:retry-item', {});

      expect(response.success).toBe(false);
      expect(response.errorCode).toBe('INVALID_PARAMS');
      expect(h.orchestrator.generateAgents).not.toHaveBeenCalled();
    });

    it('rejects when no workspace folder is open', async () => {
      const h = makeHarness({ workspaceRoot: '' });
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'wizard:retry-item',
        { itemId: 'agent-a' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/no workspace folder/i);
    });

    it('resolves with success=true, propagates the write and broadcasts once when the orchestrator returns Ok', async () => {
      const h = makeHarness();
      recordingOrchestrator(h, [outcome('agent-a', 'written')]);
      h.handlers.register();

      const result = await call<{ success: boolean }>(h, 'wizard:retry-item', {
        itemId: 'agent-a',
      });

      expect(result.success).toBe(true);
      const options = firstOptions(h);
      expect(options.userOverrides).toEqual(['agent-a']);
      expect(options.workspacePath).toBe(WORKSPACE);
      expect(options.abortSignal).toBeInstanceOf(AbortSignal);
      expect(h.propagation.propagate).toHaveBeenCalledTimes(1);
      expect(completeBroadcasts(h)).toHaveLength(1);
      expect(completeBroadcasts(h)[0]).toMatchObject({
        success: true,
        writtenCount: 1,
      });
    });

    it('does not propagate a retry that wrote nothing', async () => {
      const h = makeHarness();
      recordingOrchestrator(h, [outcome('agent-a', 'unchanged')]);
      h.handlers.register();

      await call(h, 'wizard:retry-item', { itemId: 'agent-a' });

      expect(h.propagation.propagate).not.toHaveBeenCalled();
    });

    it('returns the orchestrator error message when the pipeline returns Err', async () => {
      const h = makeHarness();
      h.orchestrator.generateAgents.mockResolvedValue(
        Result.err(new Error('template missing')),
      );
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'wizard:retry-item',
        { itemId: 'agent-a' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('template missing');
      expect(completeBroadcasts(h)).toHaveLength(1);
      expect(completeBroadcasts(h)[0].success).toBe(false);
    });

    it('rejects a retry while a submit-selection generation is still running', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'wizard:submit-selection', BASE_SUBMIT_PARAMS);

      const retry = await call<{ success: boolean; error?: string }>(
        h,
        'wizard:retry-item',
        { itemId: 'agent-a' },
      );

      expect(retry.success).toBe(false);
      expect(retry.error).toMatch(/already in progress/i);
    });

    it('captures unexpected orchestrator throws to Sentry and returns a structured error', async () => {
      const h = makeHarness();
      h.orchestrator.generateAgents.mockRejectedValue(new Error('kaboom'));
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'wizard:retry-item',
        { itemId: 'agent-a' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/retry failed: kaboom/i);
      expect(h.sentry.captureException).toHaveBeenCalled();
    });

    it('reuses the last run options and updates the same checkpoint record', async () => {
      const h = makeHarness();
      recordingOrchestrator(h, [
        outcome('agent-a', 'written'),
        outcome('agent-b', 'failed', { error: 'template missing' }),
      ]);
      h.handlers.register();

      await call(h, 'wizard:submit-selection', {
        selectedAgentIds: ['agent-a', 'agent-b'],
        model: 'model-x',
        analysisDir: ANALYSIS_DIR,
      });
      await settle();
      expect(manifestAt(h, ANALYSIS_DIR).agents['agent-b'].status).toBe(
        'failed',
      );

      recordingOrchestrator(h, [outcome('agent-b', 'written')]);
      const result = await call<{ success: boolean }>(h, 'wizard:retry-item', {
        itemId: 'agent-b',
      });

      expect(result.success).toBe(true);
      const [, retryCall] = h.orchestrator.generateAgents.mock.calls as [
        unknown,
        [OrchestratorGenerationOptions],
      ];
      expect(retryCall[0].model).toBe('model-x');
      expect(retryCall[0].analysisDir).toBe(ANALYSIS_DIR);
      expect(retryCall[0].userOverrides).toEqual(['agent-b']);

      const manifest = manifestAt(h, ANALYSIS_DIR);
      expect(manifest.agents['agent-b'].status).toBe('written');
      expect(manifest.agents['agent-b']).not.toHaveProperty('error');
      expect(manifest.lifecycle).toBe('completed');
      expect(h.propagation.propagate).toHaveBeenCalledTimes(2);
      expect(completeBroadcasts(h)).toHaveLength(2);
    });
  });
});
