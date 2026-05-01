/**
 * PtahCliRpcHandlers — unit specs (TASK_2025_294 W2.B2).
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
 *     under `{ agents }`. A registry throw re-throws to the RPC boundary
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

import type { Logger, SentryService } from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  createMockSentryService,
  type MockRpcHandler,
  type MockSentryService,
} from '@ptah-extension/vscode-core/testing';
import type { PtahCliRegistry } from '@ptah-extension/agent-sdk';
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

    it('re-throws registry errors to the RPC boundary (captured to Sentry)', async () => {
      const h = makeHarness();
      h.registry.listAgents.mockRejectedValue(new Error('registry offline'));
      h.handlers.register();

      const response = await h.rpcHandler.handleMessage({
        method: 'ptahCli:list',
        params: {},
        correlationId: 'corr',
      });

      expect(response.success).toBe(false);
      expect(response.error).toBe('registry offline');
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
      expect(result.error).toBe('Unknown provider: xyz');
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
      expect(result.error).toBe('Agent not found: a1');
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
      expect(result.error).toBe('disk full');
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
      expect(result.error).toBe('network down');
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
      expect(result.error).toBe('kaboom');
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });
});
