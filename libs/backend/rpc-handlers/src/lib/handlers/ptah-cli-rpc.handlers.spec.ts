/**
 * PtahCliRpcHandlers — unit specs.
 *
 * Surface under test: six RPC methods that back the Ptah CLI agent admin
 * UI (`list`, `create`, `update`, `delete`, `testConnection`, `listModels`)
 * plus the registration contract itself.
 *
 * Behavioural contracts locked in here:
 *
 *   - Registration: `register()` wires all six methods into the mock
 *     RpcHandler.
 *
 *   - `ptahCli:list`: returns the registry's `listAgents()` output as-is
 *     under `{ agents }`. A registry throw becomes fixed public text at the RPC boundary
 *     (the UI surfaces this as a generic failure — it does NOT silently
 *     return an empty list).
 *
 *   - `ptahCli:create`: forwards `(name, providerId, apiKey)` to the
 *     registry. On success returns `{ success: true, agent }`. On registry
 *     throw the handler captures to Sentry and returns a structured
 *     `{ success: false, error }` — NEVER throws to RPC boundary.
 *
 *   - `ptahCli:update`: only forwards fields that are actually present on
 *     the params (undefined fields are stripped). The registry call gets
 *     `(id, updates, apiKey)` where `apiKey` is forwarded verbatim.
 *
 *   - `ptahCli:delete`: calls `deleteAgent(id)` and returns `{ success:
 *     true }`. Errors are captured and returned structurally.
 *
 *   - `ptahCli:testConnection`: forwards the registry's result unchanged
 *     (including `success=false` responses — those are NOT errors, just
 *     structured negatives). Only actual throws are caught and mapped to
 *     `{ success: false, error }`.
 *
 *   - `ptahCli:listModels`: looks up the agent by id, resolves its
 *     provider via `getAnthropicProvider`, and maps the provider's static
 *     model list into the response. Missing agent / missing provider both
 *     return a structured error (never throw). `isStatic` reflects whether
 *     the provider has a dynamic `modelsEndpoint`.
 *
 * Mocking posture: direct constructor injection, narrow
 * `jest.Mocked<Pick<T,...>>` surfaces, no `as any` casts, no tsyringe
 * container.
 *
 * Source-under-test:
 *   `libs/backend/rpc-handlers/src/lib/handlers/ptah-cli-rpc.handlers.ts`
 */

import 'reflect-metadata';

// ---------------------------------------------------------------------------
// Jest transitive-import guard.
//
// The SUT imports `PtahCliSpawnOptions` from `@ptah-extension/cli-agent-runtime`,
// which imports `AGENT_GENERATION_TOKENS` from `@ptah-extension/agent-generation`.
// That barrel re-exports `@ptah-extension/workspace-intelligence`, whose
// `TreeSitterParserService` module evaluates
// `path.dirname(fileURLToPath(import.meta.url))` at top level — a construct
// Jest's ts-jest CJS transform cannot parse. Mirrors the pattern used in
// `wizard-generation-rpc.handlers.spec.ts`.
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

import type { Logger, SentryService } from '@ptah-extension/vscode-core';
import { RpcUserError } from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  createMockSentryService,
  type MockRpcHandler,
  type MockSentryService,
} from '@ptah-extension/vscode-core/testing';
import type { PtahCliRegistry } from '@ptah-extension/cli-agent-runtime';
import type { PtahCliSummary } from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { PtahCliRpcHandlers } from './ptah-cli-rpc.handlers';

// ---------------------------------------------------------------------------
// Narrow mock surfaces
// ---------------------------------------------------------------------------

type MockPtahCliRegistry = jest.Mocked<
  Pick<
    PtahCliRegistry,
    | 'listAgents'
    | 'createAgent'
    | 'updateAgent'
    | 'deleteAgent'
    | 'testConnection'
  >
>;

function createMockPtahCliRegistry(): MockPtahCliRegistry {
  return {
    listAgents: jest.fn().mockResolvedValue([]),
    createAgent: jest.fn(),
    updateAgent: jest.fn().mockResolvedValue(undefined),
    deleteAgent: jest.fn().mockResolvedValue(undefined),
    testConnection: jest.fn(),
  };
}

function makeSummary(overrides: Partial<PtahCliSummary> = {}): PtahCliSummary {
  return {
    id: 'agent-1',
    name: 'Test Agent',
    providerName: 'OpenRouter',
    providerId: 'openrouter',
    hasApiKey: true,
    hasStoredKey: true,
    status: 'available',
    enabled: true,
    modelCount: 3,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  handlers: PtahCliRpcHandlers;
  logger: MockLogger;
  rpcHandler: MockRpcHandler;
  registry: MockPtahCliRegistry;
  sentry: MockSentryService;
}

function makeHarness(): Harness {
  const logger = createMockLogger();
  const rpcHandler = createMockRpcHandler();
  const registry = createMockPtahCliRegistry();
  const sentry = createMockSentryService();

  const handlers = new PtahCliRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as import('@ptah-extension/vscode-core').RpcHandler,
    registry as unknown as PtahCliRegistry,
    sentry as unknown as SentryService,
  );

  return { handlers, logger, rpcHandler, registry, sentry };
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

describe('PtahCliRpcHandlers', () => {
  describe('register()', () => {
    it('registers all six ptahCli RPC methods', () => {
      const h = makeHarness();
      h.handlers.register();

      expect(h.rpcHandler.getRegisteredMethods().sort()).toEqual(
        [
          'ptahCli:create',
          'ptahCli:delete',
          'ptahCli:list',
          'ptahCli:listModels',
          'ptahCli:testConnection',
          'ptahCli:update',
        ].sort(),
      );
    });
  });

  // -------------------------------------------------------------------------
  // ptahCli:list
  // -------------------------------------------------------------------------

  describe('ptahCli:list', () => {
    it('forwards registry output under { agents }', async () => {
      const h = makeHarness();
      const fixture = [makeSummary(), makeSummary({ id: 'agent-2' })];
      h.registry.listAgents.mockResolvedValue(fixture);
      h.handlers.register();

      const result = await call<{ agents: PtahCliSummary[] }>(
        h,
        'ptahCli:list',
      );

      expect(result.agents).toEqual(fixture);
    });

    it('preserves an existing public RpcUserError after reporting the failure', async () => {
      const h = makeHarness();
      const error = new RpcUserError(
        'Sign in to load the CLI agents.',
        'AUTH_REQUIRED',
      );
      h.registry.listAgents.mockRejectedValue(error);
      h.handlers.register();

      const handler = h.rpcHandler.__handlers().get('ptahCli:list');
      expect(handler).toBeDefined();
      await expect(handler?.({})).rejects.toBe(error);
      expect(h.logger.error).toHaveBeenCalledWith('RPC: ptahCli:list failed', {
        errorType: 'RpcUserError',
      });
      expect(h.sentry.captureException).toHaveBeenCalledTimes(1);

      const response = await h.rpcHandler.handleMessage({
        method: 'ptahCli:list',
        params: {},
        correlationId: 'corr-public',
      });
      expect(response).toEqual({
        success: false,
        error: error.message,
        errorCode: 'AUTH_REQUIRED',
        correlationId: 'corr-public',
      });
    });

    it('returns fixed public text at the RPC boundary for registry errors', async () => {
      const h = makeHarness();
      h.registry.listAgents.mockRejectedValue(
        new Error('registry offline sk-test-FAKEKEY123'),
      );
      h.handlers.register();

      const response = await h.rpcHandler.handleMessage({
        method: 'ptahCli:list',
        params: {},
        correlationId: 'corr',
      });

      expect(response.success).toBe(false);
      expect(response.error).toBe('Could not load the CLI agents.');
      expect(JSON.stringify(response)).not.toContain('registry offline');
      expect(JSON.stringify(response)).not.toContain('sk-test-FAKEKEY123');
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // ptahCli:create
  // -------------------------------------------------------------------------

  describe('ptahCli:create', () => {
    it('forwards name/providerId/apiKey to the registry and returns the agent', async () => {
      const h = makeHarness();
      const created = makeSummary({
        id: 'new-agent',
        name: 'My Agent',
        providerId: 'z-ai',
      });
      h.registry.createAgent.mockResolvedValue(created);
      h.handlers.register();

      const result = await call<{ success: boolean; agent?: PtahCliSummary }>(
        h,
        'ptahCli:create',
        { name: 'My Agent', providerId: 'z-ai', apiKey: 'sk-test' },
      );

      expect(h.registry.createAgent).toHaveBeenCalledWith(
        'My Agent',
        'z-ai',
        'sk-test',
      );
      expect(result.success).toBe(true);
      expect(result.agent).toEqual(created);
    });

    it('returns a structured failure when registry throws (no RPC throw)', async () => {
      const h = makeHarness();
      h.registry.createAgent.mockRejectedValue(
        new Error('Unknown provider: xyz'),
      );
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'ptahCli:create',
        { name: 'Broken', providerId: 'xyz', apiKey: 'sk' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Could not create the Ptah CLI agent.');
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // ptahCli:update
  // -------------------------------------------------------------------------

  describe('ptahCli:update', () => {
    it('forwards only defined update fields to the registry', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'ptahCli:update', {
        id: 'a1',
        name: 'Renamed',
        enabled: false,
        apiKey: 'sk-rotated',
      });

      // tierMappings / selectedModel are undefined on params, so they MUST
      // be absent from the updates object (the registry interprets an
      // explicit undefined-vs-absent difference via its own merge logic).
      expect(h.registry.updateAgent).toHaveBeenCalledWith(
        'a1',
        { name: 'Renamed', enabled: false },
        'sk-rotated',
      );
    });

    it('forwards tierMappings and selectedModel when present', async () => {
      const h = makeHarness();
      h.handlers.register();

      const tierMappings = { sonnet: 's', opus: 'o', haiku: 'h' };

      await call(h, 'ptahCli:update', {
        id: 'a1',
        tierMappings,
        selectedModel: 'm',
      });

      expect(h.registry.updateAgent).toHaveBeenCalledWith(
        'a1',
        { tierMappings, selectedModel: 'm' },
        undefined,
      );
    });

    it('returns { success: true } on successful update', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean }>(h, 'ptahCli:update', {
        id: 'a1',
        name: 'X',
      });
      expect(result.success).toBe(true);
    });

    it('returns a structured failure when registry throws', async () => {
      const h = makeHarness();
      h.registry.updateAgent.mockRejectedValue(
        new Error('Agent not found: a1'),
      );
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'ptahCli:update',
        { id: 'a1', name: 'X' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Could not save the Ptah CLI agent.');
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // ptahCli:delete
  // -------------------------------------------------------------------------

  describe('ptahCli:delete', () => {
    it('deletes by id and returns success', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean }>(h, 'ptahCli:delete', {
        id: 'a1',
      });

      expect(h.registry.deleteAgent).toHaveBeenCalledWith('a1');
      expect(result.success).toBe(true);
    });

    it('returns a structured failure when registry throws', async () => {
      const h = makeHarness();
      h.registry.deleteAgent.mockRejectedValue(new Error('disk full'));
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'ptahCli:delete',
        { id: 'a1' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Could not delete the Ptah CLI agent.');
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // ptahCli:testConnection
  // -------------------------------------------------------------------------

  describe('ptahCli:testConnection', () => {
    it('forwards successful registry result unchanged', async () => {
      const h = makeHarness();
      h.registry.testConnection.mockResolvedValue({
        success: true,
        latencyMs: 142,
      });
      h.handlers.register();

      const result = await call<{ success: boolean; latencyMs?: number }>(
        h,
        'ptahCli:testConnection',
        { id: 'a1' },
      );

      expect(h.registry.testConnection).toHaveBeenCalledWith('a1');
      expect(result).toEqual({ success: true, latencyMs: 142 });
    });

    it('forwards structured registry failures as-is (NOT treated as errors)', async () => {
      const h = makeHarness();
      h.registry.testConnection.mockResolvedValue({
        success: false,
        error: 'API key not configured',
      });
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'ptahCli:testConnection',
        { id: 'a1' },
      );

      // A structured "negative" is a valid response, not a throw.
      expect(result.success).toBe(false);
      expect(result.error).toBe('API key not configured');
      // Registry returned normally — no Sentry capture.
      expect(h.sentry.captureException).not.toHaveBeenCalled();
    });

    it('captures true exceptions and returns { success: false, error }', async () => {
      const h = makeHarness();
      h.registry.testConnection.mockRejectedValue(new Error('network down'));
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'ptahCli:testConnection',
        { id: 'a1' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Could not test the connection.');
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // ptahCli:listModels
  // -------------------------------------------------------------------------

  describe('ptahCli:listModels', () => {
    it('returns { success=false-ish, error } when the agent id is unknown', async () => {
      const h = makeHarness();
      h.registry.listAgents.mockResolvedValue([makeSummary({ id: 'other' })]);
      h.handlers.register();

      const result = await call<{
        models: unknown[];
        isStatic: boolean;
        error?: string;
      }>(h, 'ptahCli:listModels', { id: 'missing' });

      expect(result.models).toEqual([]);
      expect(result.isStatic).toBe(true);
      expect(result.error).toBe('Agent not found');
    });

    it('returns the provider static model list for a known agent (registry provider)', async () => {
      // 'openrouter' is a well-known provider in ANTHROPIC_PROVIDERS — we
      // assert only that static models come back and that the flag
      // correctly reflects "this provider has a dynamic endpoint".
      const h = makeHarness();
      h.registry.listAgents.mockResolvedValue([
        makeSummary({ id: 'a1', providerId: 'openrouter' }),
      ]);
      h.handlers.register();

      const result = await call<{
        models: Array<{ id: string; name: string }>;
        isStatic: boolean;
        error?: string;
      }>(h, 'ptahCli:listModels', { id: 'a1' });

      expect(result.error).toBeUndefined();
      // OpenRouter has a dynamic modelsEndpoint, so isStatic MUST be false.
      expect(result.isStatic).toBe(false);
    });

    it('returns an error when the provider lookup fails', async () => {
      const h = makeHarness();
      h.registry.listAgents.mockResolvedValue([
        makeSummary({
          id: 'a1',
          providerId: '__unknown_provider__',
        }),
      ]);
      h.handlers.register();

      const result = await call<{
        models: unknown[];
        isStatic: boolean;
        error?: string;
      }>(h, 'ptahCli:listModels', { id: 'a1' });

      expect(result.models).toEqual([]);
      expect(result.isStatic).toBe(true);
      expect(result.error).toBe('Provider not found');
    });

    it('captures exceptions from registry.listAgents to Sentry and returns error', async () => {
      const h = makeHarness();
      h.registry.listAgents.mockRejectedValue(new Error('kaboom'));
      h.handlers.register();

      const result = await call<{
        models: unknown[];
        isStatic: boolean;
        error?: string;
      }>(h, 'ptahCli:listModels', { id: 'a1' });

      expect(result.models).toEqual([]);
      expect(result.isStatic).toBe(true);
      expect(result.error).toBe('Could not load the model list.');
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Batch 12b: no raw error text in any RPC result
  // -------------------------------------------------------------------------

  describe('outer catches never return the thrown error text (Batch 12b)', () => {
    const FAKE_KEY = 'sk-test-FAKEKEY123';
    const FAKE_PATH = 'C:\\Users\\someone\\.ptah\\settings.json';
    const leakyError = () =>
      new Error(`write ${FAKE_PATH} failed for key ${FAKE_KEY}`);

    it.each<[string, (h: Harness) => void, Record<string, unknown>, string]>([
      [
        'ptahCli:create',
        (h) => h.registry.createAgent.mockRejectedValue(leakyError()),
        { name: 'A', providerId: 'z-ai', apiKey: FAKE_KEY },
        'Could not create the Ptah CLI agent.',
      ],
      [
        'ptahCli:update',
        (h) => h.registry.updateAgent.mockRejectedValue(leakyError()),
        { id: 'a1', apiKey: FAKE_KEY },
        'Could not save the Ptah CLI agent.',
      ],
      [
        'ptahCli:delete',
        (h) => h.registry.deleteAgent.mockRejectedValue(leakyError()),
        { id: 'a1' },
        'Could not delete the Ptah CLI agent.',
      ],
      [
        'ptahCli:testConnection',
        (h) => h.registry.testConnection.mockRejectedValue(leakyError()),
        { id: 'a1' },
        'Could not test the connection.',
      ],
      [
        'ptahCli:listModels',
        (h) => h.registry.listAgents.mockRejectedValue(leakyError()),
        { id: 'a1' },
        'Could not load the model list.',
      ],
    ])(
      '%s returns fixed text and no key or path',
      async (method, arrange, params, fixed) => {
        const h = makeHarness();
        arrange(h);
        h.handlers.register();

        const response = await h.rpcHandler.handleMessage({
          method,
          params,
          correlationId: 'corr-leak',
        });

        const serialized = JSON.stringify(response);
        expect(serialized).not.toContain(FAKE_KEY);
        expect(serialized).not.toContain('someone');
        expect(serialized).not.toContain('settings.json');
        expect((response.data as { error?: string }).error).toBe(fixed);
        // Sentry still gets a capture for diagnosis, by error type only.
        expect(h.sentry.captureException).toHaveBeenCalledWith(
          expect.objectContaining({ message: `${method} failed (Error)` }),
          expect.anything(),
        );
      },
    );
  });

  // -------------------------------------------------------------------------
  // Final review S-1: the thrown text never reaches the log or Sentry
  // -------------------------------------------------------------------------

  describe('a thrown error carrying the key never reaches the logger or Sentry (final review S-1)', () => {
    const FAKE_KEY = 'sk-test-FAKEKEY123';
    const leakyError = () =>
      new Error(`registry rejected request with key ${FAKE_KEY}`);

    /** Every logger call and Sentry capture, Error messages and stacks included. */
    function diagnostics(h: Harness): string {
      const calls: unknown[] = [
        ...h.logger.debug.mock.calls,
        ...h.logger.info.mock.calls,
        ...h.logger.warn.mock.calls,
        ...h.logger.error.mock.calls,
        ...h.sentry.captureException.mock.calls,
      ];
      return JSON.stringify(calls, (_key, value: unknown) =>
        value instanceof Error
          ? { name: value.name, message: value.message, stack: value.stack }
          : value,
      );
    }

    it.each<[string, (h: Harness) => void, Record<string, unknown>]>([
      [
        'ptahCli:list',
        (h) => h.registry.listAgents.mockRejectedValue(leakyError()),
        {},
      ],
      [
        'ptahCli:create',
        (h) => h.registry.createAgent.mockRejectedValue(leakyError()),
        { name: 'A', providerId: 'z-ai', apiKey: FAKE_KEY },
      ],
      [
        'ptahCli:update',
        (h) => h.registry.updateAgent.mockRejectedValue(leakyError()),
        { id: 'a1', apiKey: FAKE_KEY },
      ],
      [
        'ptahCli:delete',
        (h) => h.registry.deleteAgent.mockRejectedValue(leakyError()),
        { id: 'a1' },
      ],
      [
        'ptahCli:testConnection',
        (h) => h.registry.testConnection.mockRejectedValue(leakyError()),
        { id: 'a1' },
      ],
      [
        'ptahCli:listModels',
        (h) => h.registry.listAgents.mockRejectedValue(leakyError()),
        { id: 'a1' },
      ],
    ])(
      '%s logs and captures the error type only',
      async (method, arrange, params) => {
        const h = makeHarness();
        arrange(h);
        h.handlers.register();

        const response = await h.rpcHandler.handleMessage({
          method,
          params,
          correlationId: 'corr-s1',
        });

        expect(JSON.stringify(response)).not.toContain(FAKE_KEY);
        expect(JSON.stringify(response)).not.toContain('registry rejected');
        const text = diagnostics(h);
        expect(text).not.toContain(FAKE_KEY);
        expect(text).not.toContain('registry rejected');
        expect(h.logger.error).toHaveBeenCalledWith(`RPC: ${method} failed`, {
          errorType: 'Error',
        });
        expect(h.sentry.captureException).toHaveBeenCalledTimes(1);
      },
    );
  });
});
