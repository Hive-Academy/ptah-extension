/**
 * SubagentRpcHandlers — unit specs (Phase 2 update).
 *
 * Surface under test: all RPC methods registered by SubagentRpcHandlers:
 *   - chat:subagent-query  (original)
 *   - subagent:send-message (Phase 2)
 *   - subagent:stop         (Phase 2)
 *   - subagent:interrupt    (Phase 2)
 *
 * Behavioural contracts:
 *   - Registration: `register()` wires all four methods into the mock RpcHandler.
 *   - chat:subagent-query: three query modes (toolCallId, sessionId, all-resumable).
 *   - subagent:send-message: delegates to dispatcher.sendToSubagent; validates params.
 *   - subagent:stop: delegates to dispatcher.stopSubagent; validates params.
 *   - subagent:interrupt: delegates to dispatcher.interruptSession; validates params.
 *   - Failure posture: registry errors return { subagents: [] } and capture to Sentry.
 *     Dispatcher errors propagate as RPC failures (not silently swallowed).
 *
 * Mocking posture: direct constructor injection, narrow Mocked<Pick<T, ...>> surfaces.
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

import type { SubagentMessageDispatcher } from '@ptah-extension/agent-sdk';
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

type MockDispatcher = jest.Mocked<
  Pick<
    SubagentMessageDispatcher,
    'sendToSubagent' | 'stopSubagent' | 'interruptSession'
  >
>;

function createMockDispatcher(): MockDispatcher {
  return {
    sendToSubagent: jest.fn().mockResolvedValue(undefined),
    stopSubagent: jest.fn().mockResolvedValue(undefined),
    interruptSession: jest.fn().mockResolvedValue(undefined),
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
  dispatcher: MockDispatcher;
}

function makeHarness(): Harness {
  const logger = createMockLogger();
  const rpcHandler = createMockRpcHandler();
  const registry = createMockSubagentRegistry();
  const sentry = createMockSentryService();
  const dispatcher = createMockDispatcher();

  const handlers = new SubagentRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as RpcHandler,
    registry as unknown as SubagentRegistryService,
    sentry as unknown as SentryService,
    dispatcher as unknown as SubagentMessageDispatcher,
  );

  return { handlers, logger, rpcHandler, registry, sentry, dispatcher };
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
    it('registers all four methods', () => {
      const h = makeHarness();
      h.handlers.register();

      const methods = h.rpcHandler.getRegisteredMethods();
      expect(methods).toContain('chat:subagent-query');
      expect(methods).toContain('subagent:send-message');
      expect(methods).toContain('subagent:stop');
      expect(methods).toContain('subagent:interrupt');
      expect(methods).toHaveLength(4);
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

  // -------------------------------------------------------------------------
  // subagent:send-message (Phase 2)
  // -------------------------------------------------------------------------

  describe('subagent:send-message', () => {
    it('delegates to dispatcher.sendToSubagent and returns { ok: true }', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ ok: boolean }>(h, 'subagent:send-message', {
        sessionId: 'sess-abc',
        parentToolUseId: 'toolu_xyz',
        text: 'hello subagent',
      });

      expect(result).toEqual({ ok: true });
      expect(h.dispatcher.sendToSubagent).toHaveBeenCalledWith(
        'sess-abc',
        'toolu_xyz',
        'hello subagent',
      );
    });

    it('rejects when params are invalid (empty sessionId)', async () => {
      const h = makeHarness();
      h.handlers.register();

      await expect(
        call(h, 'subagent:send-message', {
          sessionId: '',
          parentToolUseId: 'toolu_xyz',
          text: 'hello',
        }),
      ).rejects.toThrow();
    });

    it('propagates dispatcher errors', async () => {
      const h = makeHarness();
      h.dispatcher.sendToSubagent.mockRejectedValue(
        new Error('session not active'),
      );
      h.handlers.register();

      await expect(
        call(h, 'subagent:send-message', {
          sessionId: 'sess-abc',
          parentToolUseId: 'toolu_xyz',
          text: 'hello',
        }),
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // subagent:stop (Phase 2)
  // -------------------------------------------------------------------------

  describe('subagent:stop', () => {
    it('delegates to dispatcher.stopSubagent and returns { ok: true }', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ ok: boolean }>(h, 'subagent:stop', {
        sessionId: 'sess-abc',
        taskId: 'task-123',
      });

      expect(result).toEqual({ ok: true });
      expect(h.dispatcher.stopSubagent).toHaveBeenCalledWith(
        'sess-abc',
        'task-123',
      );
    });

    it('rejects when params are invalid (missing taskId)', async () => {
      const h = makeHarness();
      h.handlers.register();

      await expect(
        call(h, 'subagent:stop', { sessionId: 'sess-abc' }),
      ).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // subagent:interrupt (Phase 2)
  // -------------------------------------------------------------------------

  describe('subagent:interrupt', () => {
    it('delegates to dispatcher.interruptSession and returns { ok: true }', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ ok: boolean }>(h, 'subagent:interrupt', {
        sessionId: 'sess-abc',
      });

      expect(result).toEqual({ ok: true });
      expect(h.dispatcher.interruptSession).toHaveBeenCalledWith('sess-abc');
    });

    it('rejects when sessionId is empty', async () => {
      const h = makeHarness();
      h.handlers.register();

      await expect(
        call(h, 'subagent:interrupt', { sessionId: '' }),
      ).rejects.toThrow();
    });
  });
});
