/**
 * SubagentRpcHandlers — unit specs (TASK_2025_294 W2.B4).
 *
 * Surface under test: the single `chat:subagent-query` RPC method and its
 * three query modes (toolCallId, sessionId, and all-resumable).
 *
 * Behavioural contracts locked in here:
 *   - Registration: `register()` wires the single method into the mock
 *     RpcHandler.
 *   - toolCallId query mode: returns `[record]` when the registry has an
 *     entry, `[]` when it doesn't. MUST NOT fall through to the session
 *     or all-resumable branches — specificity wins.
 *   - sessionId query mode: delegates to
 *     `registry.getResumableBySession(sessionId)` and returns the result
 *     as-is.
 *   - No-params query mode: delegates to `registry.getResumable()` and
 *     returns the result as-is.
 *   - Failure posture: any thrown error from the registry is captured to
 *     Sentry and surfaced as `{ subagents: [] }` — the handler MUST NOT
 *     bubble exceptions to the RPC boundary (the frontend relies on a
 *     stable `subagents` array shape).
 *
 * Mocking posture: direct constructor injection, narrow
 * `jest.Mocked<Pick<T, ...>>` surfaces, no `as any` casts.
 *
 * Source-under-test:
 *   `libs/backend/rpc-handlers/src/lib/handlers/subagent-rpc.handlers.ts`
 */

import 'reflect-metadata';

import type {
  Logger,
  RpcHandler,
  SentryService,
  SubagentRegistryService,
} from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  createMockSentryService,
  type MockRpcHandler,
  type MockSentryService,
} from '@ptah-extension/vscode-core/testing';
import type { SubagentRecord } from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { SubagentRpcHandlers } from './subagent-rpc.handlers';

// ---------------------------------------------------------------------------
// Narrow mock surfaces — only what the handler actually touches.
// ---------------------------------------------------------------------------

type MockSubagentRegistry = jest.Mocked<
  Pick<
    SubagentRegistryService,
    'get' | 'getResumable' | 'getResumableBySession'
  >
>;

function createMockSubagentRegistry(): MockSubagentRegistry {
  return {
    get: jest.fn(),
    getResumable: jest.fn().mockReturnValue([]),
    getResumableBySession: jest.fn().mockReturnValue([]),
  };
}

function makeSubagentRecord(
  overrides: Partial<SubagentRecord> = {},
): SubagentRecord {
  return {
    toolCallId: 'toolu_abc123',
    sessionId: 'parent-session-uuid',
    agentType: 'software-architect',
    status: 'interrupted',
    startedAt: 1_700_000_000_000,
    parentSessionId: 'parent-session-uuid',
    agentId: 'adcecb2',
    ...overrides,
  } as SubagentRecord;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  handlers: SubagentRpcHandlers;
  logger: MockLogger;
  rpcHandler: MockRpcHandler;
  registry: MockSubagentRegistry;
  sentry: MockSentryService;
}

function makeHarness(): Harness {
  const logger = createMockLogger();
  const rpcHandler = createMockRpcHandler();
  const registry = createMockSubagentRegistry();
  const sentry = createMockSentryService();

  const handlers = new SubagentRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as RpcHandler,
    registry as unknown as SubagentRegistryService,
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

describe('SubagentRpcHandlers', () => {
  describe('register()', () => {
    it('registers the single chat:subagent-query method', () => {
      const h = makeHarness();
      h.handlers.register();

      expect(h.rpcHandler.getRegisteredMethods()).toEqual([
        'chat:subagent-query',
      ]);
    });
  });

  // -------------------------------------------------------------------------
  // chat:subagent-query — by toolCallId
  // -------------------------------------------------------------------------

  describe('chat:subagent-query by toolCallId', () => {
    it('returns [record] when the registry has an entry for the toolCallId', async () => {
      const h = makeHarness();
      const record = makeSubagentRecord({ toolCallId: 'toolu_match' });
      h.registry.get.mockReturnValue(record);
      h.handlers.register();

      const result = await call<{ subagents: SubagentRecord[] }>(
        h,
        'chat:subagent-query',
        { toolCallId: 'toolu_match' },
      );

      expect(result.subagents).toEqual([record]);
      expect(h.registry.get).toHaveBeenCalledWith('toolu_match');
      // Specificity contract: must NOT fall through to the other branches.
      expect(h.registry.getResumable).not.toHaveBeenCalled();
      expect(h.registry.getResumableBySession).not.toHaveBeenCalled();
    });

    it('returns [] when the registry has no entry for the toolCallId', async () => {
      const h = makeHarness();
      h.registry.get.mockReturnValue(null);
      h.handlers.register();

      const result = await call<{ subagents: SubagentRecord[] }>(
        h,
        'chat:subagent-query',
        { toolCallId: 'toolu_missing' },
      );

      expect(result.subagents).toEqual([]);
      expect(h.registry.get).toHaveBeenCalledWith('toolu_missing');
      expect(h.registry.getResumable).not.toHaveBeenCalled();
      expect(h.registry.getResumableBySession).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // chat:subagent-query — by sessionId
  // -------------------------------------------------------------------------

  describe('chat:subagent-query by sessionId', () => {
    it('delegates to getResumableBySession(sessionId) when only sessionId is provided', async () => {
      const h = makeHarness();
      const records = [
        makeSubagentRecord({ toolCallId: 'toolu_a' }),
        makeSubagentRecord({ toolCallId: 'toolu_b' }),
      ];
      h.registry.getResumableBySession.mockReturnValue(records);
      h.handlers.register();

      const result = await call<{ subagents: SubagentRecord[] }>(
        h,
        'chat:subagent-query',
        { sessionId: 'parent-session-uuid' },
      );

      expect(result.subagents).toEqual(records);
      expect(h.registry.getResumableBySession).toHaveBeenCalledWith(
        'parent-session-uuid',
      );
      // Specificity contract: toolCallId branch is not entered, and we did
      // not fall through to the all-resumable branch.
      expect(h.registry.get).not.toHaveBeenCalled();
      expect(h.registry.getResumable).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // chat:subagent-query — all resumable
  // -------------------------------------------------------------------------

  describe('chat:subagent-query with no params', () => {
    it('delegates to getResumable() when neither toolCallId nor sessionId is provided', async () => {
      const h = makeHarness();
      const records = [
        makeSubagentRecord({ toolCallId: 'toolu_1', parentSessionId: 's1' }),
        makeSubagentRecord({ toolCallId: 'toolu_2', parentSessionId: 's2' }),
      ];
      h.registry.getResumable.mockReturnValue(records);
      h.handlers.register();

      const result = await call<{ subagents: SubagentRecord[] }>(
        h,
        'chat:subagent-query',
        {},
      );

      expect(result.subagents).toEqual(records);
      expect(h.registry.getResumable).toHaveBeenCalledTimes(1);
      expect(h.registry.get).not.toHaveBeenCalled();
      expect(h.registry.getResumableBySession).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // chat:subagent-query — failure posture
  // -------------------------------------------------------------------------

  describe('chat:subagent-query failure posture', () => {
    it('returns { subagents: [] } and captures to Sentry when registry.get throws', async () => {
      const h = makeHarness();
      h.registry.get.mockImplementation(() => {
        throw new Error('registry boom');
      });
      h.handlers.register();

      const result = await call<{ subagents: SubagentRecord[] }>(
        h,
        'chat:subagent-query',
        { toolCallId: 'toolu_any' },
      );

      expect(result.subagents).toEqual([]);
      expect(h.sentry.captureException).toHaveBeenCalled();
    });

    it('returns { subagents: [] } when getResumableBySession throws', async () => {
      const h = makeHarness();
      h.registry.getResumableBySession.mockImplementation(() => {
        throw new Error('session query boom');
      });
      h.handlers.register();

      const result = await call<{ subagents: SubagentRecord[] }>(
        h,
        'chat:subagent-query',
        { sessionId: 's1' },
      );

      expect(result.subagents).toEqual([]);
      expect(h.sentry.captureException).toHaveBeenCalled();
    });

    it('returns { subagents: [] } when getResumable throws', async () => {
      const h = makeHarness();
      h.registry.getResumable.mockImplementation(() => {
        throw new Error('resumable query boom');
      });
      h.handlers.register();

      const result = await call<{ subagents: SubagentRecord[] }>(
        h,
        'chat:subagent-query',
        {},
      );

      expect(result.subagents).toEqual([]);
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });
});
