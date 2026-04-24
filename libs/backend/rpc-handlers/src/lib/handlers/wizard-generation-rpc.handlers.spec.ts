/**
 * WizardGenerationRpcHandlers — unit specs (TASK_2025_294 W2.B6).
 *
 * Surface under test: three RPC methods wiring the setup-wizard generation
 * pipeline to the webview (`wizard:submit-selection`, `wizard:cancel`,
 * `wizard:retry-item`). The handler uses LAZY DI resolution — it calls
 * `container.resolve(TOKEN)` per invocation rather than injecting
 * collaborators, so our spec drives a mock `DependencyContainer`.
 *
 * Behavioural contracts locked in here:
 *
 *   - Registration: `register()` wires all three methods into the mock
 *     RpcHandler.
 *
 *   - submit-selection: empty `selectedAgentIds` → immediate error (no
 *     orchestrator resolve). Concurrent submission while `isGenerating=true`
 *     is rejected. No workspace → structured error. On the happy path the
 *     handler returns `{ success: true }` IMMEDIATELY (fire-and-forget) and
 *     defers the orchestration run to the background. The `isGenerating` flag
 *     flips to true at submit time and back to false once the background run
 *     finishes (success OR failure).
 *
 *   - submit-selection concurrency: a second submission while the first is
 *     still in-flight gets rejected with the "already in progress" message.
 *
 *   - submit-selection best-effort deps: if `LicenseService` / `CodeExecutionMCP`
 *     / `EnhancedPromptsService` are not registered, the handler STILL
 *     proceeds — these are non-fatal.
 *
 *   - cancel: safe when nothing is running (`{ cancelled: false }`). When a
 *     session exists it delegates to `SetupWizardService.cancelWizard()` and
 *     resets the `isGenerating` flag regardless of the cancel result. On cancel
 *     exception Sentry is notified and the flag is still reset.
 *
 *   - retry-item: empty itemId / concurrent generation / missing workspace all
 *     short-circuit. Happy path awaits the orchestrator and surfaces its
 *     `Result` — success → `{ success: true }`, failure → `{ success: false,
 *     error }`. The stored `lastGenerationOptions` are reused as the base, with
 *     `userOverrides` narrowed to the single retry item.
 *
 * Mocking posture: direct constructor injection for the inject-time deps,
 * mock `DependencyContainer` for the lazy-resolve deps. Narrow
 * `jest.Mocked<Pick<T, ...>>` surfaces; no `as any`.
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
// 'import.meta' outside a module").
//
// We short-circuit the parser module *before* the SUT is imported so the
// module graph never reaches the import.meta statement. Nothing in this
// spec exercises the parser service — it's pulled in only because it lives
// in the same barrel as the enums agent-generation actually uses. Matches
// the pattern in `setup-rpc.handlers.spec.ts`.
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
import type {
  LicenseService,
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
import type { OrchestratorGenerationOptions } from '@ptah-extension/agent-generation';
import type { PluginLoaderService } from '@ptah-extension/agent-sdk';
import {
  Result,
  type WizardSubmitSelectionParams,
} from '@ptah-extension/shared';
import { TOKENS } from '@ptah-extension/vscode-core';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

// ---------------------------------------------------------------------------
// Token re-declaration via `Symbol.for` — avoids a value import of
// `@ptah-extension/agent-generation` / `@ptah-extension/agent-sdk` barrels
// (see jest.mock above). The global `Symbol.for` registry guarantees these
// symbols are IDENTICAL to the ones the SUT resolves at runtime.
//
// Must stay in sync with:
//   - `libs/backend/agent-generation/src/lib/di/tokens.ts`
//   - `libs/backend/agent-sdk/src/lib/di/tokens.ts`
// ---------------------------------------------------------------------------
const AGENT_GENERATION_TOKENS = {
  AGENT_GENERATION_ORCHESTRATOR: Symbol.for(
    'AgentGenerationOrchestratorService',
  ),
  SETUP_WIZARD_SERVICE: Symbol.for('SetupWizardService'),
} as const;

const SDK_TOKENS = {
  SDK_ENHANCED_PROMPTS_SERVICE: Symbol.for('SdkEnhancedPromptsService'),
  SDK_PLUGIN_LOADER: Symbol.for('SdkPluginLoader'),
} as const;

import { WizardGenerationRpcHandlers } from './wizard-generation-rpc.handlers';

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

/**
 * Structural fake for the orchestrator service — the handler does not import
 * the concrete class, so we match its local `OrchestratorServiceInterface`.
 */
interface OrchestratorFake {
  generateAgents: jest.Mock;
}

function createMockOrchestrator(): OrchestratorFake {
  return {
    // Default: never resolve. Individual tests override via mockResolvedValue.
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
 * Build a `jest.Mocked<DependencyContainer>` that routes `resolve(token)` to
 * the supplied map. Tokens not in the map throw — mirroring tsyringe's
 * behaviour for unregistered tokens so the handler's best-effort branches
 * exercise their catch blocks.
 */
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
    folders:
      opts.workspaceRoot === ''
        ? []
        : [opts.workspaceRoot ?? '/fake/workspace'],
  });
  const sentry = createMockSentryService();

  // Build registry of lazily-resolved services
  const orchestrator = createMockOrchestrator();
  const setupWizard = createMockSetupWizard();
  const webviewManager = createMockWebviewManager();
  const registry = new Map<symbol | string, unknown>();

  const skip = new Set<symbol | string>(opts.skip ?? []);
  const maybeSet = (token: symbol | string, value: unknown) => {
    if (!skip.has(token)) registry.set(token, value);
  };

  maybeSet(AGENT_GENERATION_TOKENS.AGENT_GENERATION_ORCHESTRATOR, orchestrator);
  maybeSet(AGENT_GENERATION_TOKENS.SETUP_WIZARD_SERVICE, setupWizard);
  maybeSet(TOKENS.WEBVIEW_MANAGER, webviewManager);
  // Intentionally leave LicenseService / CodeExecutionMCP /
  // EnhancedPromptsService / CliDetectionService OUT of the default registry.
  // The handler wraps their resolutions in try/catch and must proceed without
  // them — this exercises the "best-effort" code path.

  const container = createMockContainer(registry);

  const handlers = new WizardGenerationRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as RpcHandler,
    pluginLoader as unknown as PluginLoaderService,
    workspace as unknown as IWorkspaceProvider,
    container as unknown as DependencyContainer,
    sentry as unknown as SentryService,
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

/** Wait for one Node microtask drain — lets fire-and-forget promises settle. */
async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

const BASE_SUBMIT_PARAMS: WizardSubmitSelectionParams = {
  selectedAgentIds: ['agent-a'],
} as WizardSubmitSelectionParams;

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
  // wizard:submit-selection
  // -------------------------------------------------------------------------

  describe('wizard:submit-selection', () => {
    it('rejects when selectedAgentIds is empty', async () => {
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

    it('returns success immediately (fire-and-forget orchestration)', async () => {
      const h = makeHarness();
      // Orchestrator never resolves — if the handler awaited it, the RPC
      // response would never return and the test would time out.
      h.handlers.register();

      const result = await call<{ success: boolean }>(
        h,
        'wizard:submit-selection',
        BASE_SUBMIT_PARAMS,
      );

      expect(result.success).toBe(true);
      // Orchestrator WAS invoked (in the background) — just not awaited.
      expect(h.orchestrator.generateAgents).toHaveBeenCalledTimes(1);
    });

    it('passes selectedAgentIds through as userOverrides to the orchestrator', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'wizard:submit-selection', {
        ...BASE_SUBMIT_PARAMS,
        selectedAgentIds: ['agent-a', 'agent-b'],
      });

      const [options] = h.orchestrator.generateAgents.mock.calls[0] as [
        OrchestratorGenerationOptions,
      ];
      expect(options.userOverrides).toEqual(['agent-a', 'agent-b']);
      expect(options.workspacePath).toBe('/fake/workspace');
    });

    it('rejects a concurrent submission while generation is in progress', async () => {
      const h = makeHarness();
      h.handlers.register();

      // First submission — background promise never resolves.
      await call(h, 'wizard:submit-selection', BASE_SUBMIT_PARAMS);

      // Second submission must be rejected with the concurrency message.
      const second = await call<{ success: boolean; error?: string }>(
        h,
        'wizard:submit-selection',
        BASE_SUBMIT_PARAMS,
      );

      expect(second.success).toBe(false);
      expect(second.error).toMatch(/already in progress/i);
    });

    it('resets the isGenerating flag after the background pipeline resolves', async () => {
      const h = makeHarness();
      const summary = {
        successful: 1,
        failed: 0,
        warnings: [],
        enhancedPromptsUsed: false,
      };
      h.orchestrator.generateAgents.mockResolvedValue(Result.ok(summary));
      h.handlers.register();

      await call(h, 'wizard:submit-selection', BASE_SUBMIT_PARAMS);
      // Let the fire-and-forget orchestrator promise settle.
      await flushMicrotasks();
      await flushMicrotasks();

      // A subsequent submission must now be accepted, proving isGenerating
      // was reset to false.
      const second = await call<{ success: boolean }>(
        h,
        'wizard:submit-selection',
        BASE_SUBMIT_PARAMS,
      );
      expect(second.success).toBe(true);
    });

    it('still succeeds when LicenseService is not registered (best-effort)', async () => {
      // Default harness intentionally omits LicenseService. The happy-path
      // return confirms the handler's try/catch around license resolution
      // didn't surface as a user-visible failure.
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean }>(
        h,
        'wizard:submit-selection',
        BASE_SUBMIT_PARAMS,
      );

      expect(result.success).toBe(true);
    });

    it('orchestrator-resolution failure returns a structured error (never throws)', async () => {
      const h = makeHarness({
        skip: [AGENT_GENERATION_TOKENS.AGENT_GENERATION_ORCHESTRATOR],
      });
      h.handlers.register();

      const response = await h.rpcHandler.handleMessage({
        method: 'wizard:submit-selection',
        params: BASE_SUBMIT_PARAMS as unknown as Record<string, unknown>,
        correlationId: 'corr',
      });

      expect(response.success).toBe(true);
      const body = response.data as { success: boolean; error?: string };
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/agent generation failed/i);
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // wizard:cancel
  // -------------------------------------------------------------------------

  describe('wizard:cancel', () => {
    it('returns cancelled=false when no active session exists', async () => {
      const h = makeHarness();
      h.setupWizard.getCurrentSession.mockReturnValue(null);
      h.handlers.register();

      const result = await call<{ cancelled: boolean }>(h, 'wizard:cancel', {});

      expect(result.cancelled).toBe(false);
      expect(h.setupWizard.cancelWizard).not.toHaveBeenCalled();
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

      // Handler intentionally reports success — the flag is reset and the
      // session may have already self-completed. Downstream only cares that
      // the wizard is no longer running.
      expect(result.cancelled).toBe(true);
      expect(result.sessionId).toBe('session-1');
    });

    it('returns cancelled=false and captures Sentry when SetupWizardService is not registered', async () => {
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
    it('rejects when itemId is missing', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'wizard:retry-item',
        {},
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/item id is required/i);
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

    it('resolves with success=true when the orchestrator returns Ok', async () => {
      const h = makeHarness();
      h.orchestrator.generateAgents.mockResolvedValue(
        Result.ok({
          successful: 1,
          failed: 0,
          warnings: [],
          durationMs: 123,
          enhancedPromptsUsed: false,
        }),
      );
      h.handlers.register();

      const result = await call<{ success: boolean }>(h, 'wizard:retry-item', {
        itemId: 'agent-a',
      });

      expect(result.success).toBe(true);
      const [options] = h.orchestrator.generateAgents.mock.calls[0] as [
        OrchestratorGenerationOptions,
      ];
      // Retry narrows userOverrides to exactly the one failed item.
      expect(options.userOverrides).toEqual(['agent-a']);
      expect(options.workspacePath).toBe('/fake/workspace');
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
    });

    it('rejects a retry while a submit-selection generation is still running', async () => {
      const h = makeHarness();
      // Orchestrator default pends forever — first submit locks the flag.
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
  });
});

// Silence potential "unused import" for SDK_TOKENS — the import exists to
// document the plugin-loader contract the handler uses (via the constructor
// injection), even if no assertion here references SDK_TOKENS directly.
void SDK_TOKENS;
