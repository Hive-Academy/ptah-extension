/**
 * AutocompleteRpcHandlers — unit specs.
 *
 * Surface under test: two RPC methods (`autocomplete:agents`,
 * `autocomplete:commands`) that proxy into AgentDiscoveryService and
 * CommandDiscoveryService.
 *
 * Behavioural contracts locked in here:
 *   - Registration: `register()` wires both methods into the mock RpcHandler
 *     and logs the method names for observability.
 *   - Query fallback: `autocomplete:agents` and `autocomplete:commands` both
 *     forward `params.query || ''` to the downstream service — a missing
 *     / empty query must reach the service as the empty string (so it can
 *     choose to return "top N results" rather than error).
 *   - maxResults pass-through: when provided, `maxResults` is forwarded
 *     verbatim to the downstream service without clamping.
 *   - Error wrapping: thrown service errors are captured to Sentry and
 *     re-thrown as a wrapped `Error("Failed to search agents: ...")` /
 *     `"Failed to search commands: ..."` so the RPC boundary sees a
 *     human-readable message rather than the raw service error.
 *
 * Mocking posture: direct constructor injection, narrow
 * `jest.Mocked<Pick<T,...>>` surfaces, no `as any` casts.
 *
 * Source-under-test:
 *   `libs/backend/rpc-handlers/src/lib/handlers/autocomplete-rpc.handlers.ts`
 */

import 'reflect-metadata';

import type { Logger, SentryService } from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  createMockSentryService,
  type MockRpcHandler,
  type MockSentryService,
} from '@ptah-extension/vscode-core/testing';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { AutocompleteRpcHandlers } from './autocomplete-rpc.handlers';

// ---------------------------------------------------------------------------
// Narrow mock surfaces — only what the handler touches.
// ---------------------------------------------------------------------------

interface AgentDiscoveryService {
  searchAgents(request: {
    query: string;
    maxResults?: number;
  }): Promise<unknown>;
}

interface CommandDiscoveryService {
  searchCommands(request: {
    query: string;
    maxResults?: number;
  }): Promise<unknown>;
}

type MockAgentDiscovery = jest.Mocked<AgentDiscoveryService>;
type MockCommandDiscovery = jest.Mocked<CommandDiscoveryService>;

function createMockAgentDiscovery(): MockAgentDiscovery {
  return {
    searchAgents: jest.fn().mockResolvedValue({ agents: [] }),
  };
}

function createMockCommandDiscovery(): MockCommandDiscovery {
  return {
    searchCommands: jest.fn().mockResolvedValue({ commands: [] }),
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  handlers: AutocompleteRpcHandlers;
  logger: MockLogger;
  rpcHandler: MockRpcHandler;
  agentDiscovery: MockAgentDiscovery;
  commandDiscovery: MockCommandDiscovery;
  sentry: MockSentryService;
}

function makeHarness(): Harness {
  const logger = createMockLogger();
  const rpcHandler = createMockRpcHandler();
  const agentDiscovery = createMockAgentDiscovery();
  const commandDiscovery = createMockCommandDiscovery();
  const sentry = createMockSentryService();

  const handlers = new AutocompleteRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as import('@ptah-extension/vscode-core').RpcHandler,
    agentDiscovery,
    commandDiscovery,
    sentry as unknown as SentryService,
  );

  return {
    handlers,
    logger,
    rpcHandler,
    agentDiscovery,
    commandDiscovery,
    sentry,
  };
}

/** Drive an RPC method by name through the MockRpcHandler wiring. */
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

describe('AutocompleteRpcHandlers', () => {
  describe('register()', () => {
    it('registers both autocomplete RPC methods', () => {
      const h = makeHarness();
      h.handlers.register();

      expect(h.rpcHandler.getRegisteredMethods().sort()).toEqual(
        ['autocomplete:agents', 'autocomplete:commands'].sort(),
      );
    });
  });

  // -------------------------------------------------------------------------
  // autocomplete:agents
  // -------------------------------------------------------------------------

  describe('autocomplete:agents', () => {
    it('forwards a populated query and maxResults to AgentDiscoveryService', async () => {
      const h = makeHarness();
      const agents = [{ name: 'debugger', description: 'debug stuff' }];
      h.agentDiscovery.searchAgents.mockResolvedValue({ agents });
      h.handlers.register();

      const result = await call<{ agents: Array<{ name: string }> }>(
        h,
        'autocomplete:agents',
        { query: 'debug', maxResults: 5 },
      );

      expect(result.agents).toEqual(agents);
      expect(h.agentDiscovery.searchAgents).toHaveBeenCalledWith({
        query: 'debug',
        maxResults: 5,
      });
    });

    it('coerces a missing query to the empty string for the downstream service', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'autocomplete:agents', {});

      expect(h.agentDiscovery.searchAgents).toHaveBeenCalledWith({
        query: '',
        maxResults: undefined,
      });
    });

    it('coerces an empty-string query to the empty string (no undefined leak)', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'autocomplete:agents', { query: '' });

      expect(h.agentDiscovery.searchAgents).toHaveBeenCalledWith({
        query: '',
        maxResults: undefined,
      });
    });

    it('wraps downstream errors with a human-readable prefix and captures to Sentry', async () => {
      const h = makeHarness();
      h.agentDiscovery.searchAgents.mockRejectedValue(
        new Error('index corrupt'),
      );
      h.handlers.register();

      const response = await h.rpcHandler.handleMessage({
        method: 'autocomplete:agents',
        params: { query: 'x' },
        correlationId: 'corr',
      });

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/failed to search agents/i);
      expect(response.error).toMatch(/index corrupt/);
      expect(h.sentry.captureException).toHaveBeenCalled();
    });

    it('handles non-Error throws (string / object) without crashing the wrapper', async () => {
      const h = makeHarness();
      h.agentDiscovery.searchAgents.mockRejectedValue('boom-as-string');
      h.handlers.register();

      const response = await h.rpcHandler.handleMessage({
        method: 'autocomplete:agents',
        params: { query: 'x' },
        correlationId: 'corr',
      });

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/failed to search agents/i);
      // String(error) surfacing is the handler contract — the UI maps that to
      // a toast; a crash at this layer would black-hole the failure.
      expect(response.error).toMatch(/boom-as-string/);
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // autocomplete:commands
  // -------------------------------------------------------------------------

  describe('autocomplete:commands', () => {
    it('forwards a populated query and maxResults to CommandDiscoveryService', async () => {
      const h = makeHarness();
      const commands = [{ name: '/help', description: 'show help' }];
      h.commandDiscovery.searchCommands.mockResolvedValue({ commands });
      h.handlers.register();

      const result = await call<{ commands: Array<{ name: string }> }>(
        h,
        'autocomplete:commands',
        { query: 'hel', maxResults: 10 },
      );

      expect(result.commands).toEqual(commands);
      expect(h.commandDiscovery.searchCommands).toHaveBeenCalledWith({
        query: 'hel',
        maxResults: 10,
      });
    });

    it('coerces a missing query to the empty string for the downstream service', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'autocomplete:commands', {});

      expect(h.commandDiscovery.searchCommands).toHaveBeenCalledWith({
        query: '',
        maxResults: undefined,
      });
    });

    it('wraps downstream errors with a human-readable prefix and captures to Sentry', async () => {
      const h = makeHarness();
      h.commandDiscovery.searchCommands.mockRejectedValue(
        new Error('registry offline'),
      );
      h.handlers.register();

      const response = await h.rpcHandler.handleMessage({
        method: 'autocomplete:commands',
        params: {},
        correlationId: 'corr',
      });

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/failed to search commands/i);
      expect(response.error).toMatch(/registry offline/);
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });
});
