/**
 * SubagentRpcHandlers — unit specs.
 *
 * Surface under test: all RPC methods registered by SubagentRpcHandlers:
 *   - chat:subagent-query
 *   - subagent:send-message
 *   - subagent:stop
 *   - subagent:interrupt
 *   - subagent:background
 *   - subagent:history-page
 *
 * Behavioural contracts:
 *   - Registration: `register()` wires all six methods into the mock RpcHandler.
 *   - chat:subagent-query: three query modes (toolCallId, sessionId, all-resumable),
 *     plus SHAPE-ONLY Zod validation. The empty-sessionId rule is the handler's,
 *     not the schema's — see subagent-rpc.schema.ts.
 *   - subagent:send-message: delegates to dispatcher.sendToSubagent; validates params.
 *   - subagent:stop: delegates to dispatcher.stopSubagent; validates params.
 *   - subagent:interrupt: delegates to dispatcher.interruptSession; validates params.
 *   - subagent:background: delegates to dispatcher.backgroundTask; validates params.
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
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import type {
  FlatStreamEventUnion,
  SubagentCacheInfo,
  SubagentHistoryPageResult,
  SubagentRecord,
} from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import type { SubagentMessageDispatcher } from '@ptah-extension/agent-sdk';
import type {
  SessionHistoryReaderService,
  SessionMetadataStore,
} from '@ptah-extension/agent-sdk';
import { SubagentHistoryValidationError } from '@ptah-extension/agent-sdk';
import { SubagentRpcHandlers } from './subagent-rpc.handlers';
import { historyCursor } from './subagent-history-page';

// ---------------------------------------------------------------------------
// Narrow mock surfaces — only what the handler actually touches.
// ---------------------------------------------------------------------------

type MockSubagentRegistry = jest.Mocked<
  Pick<
    SubagentRegistryService,
    'get' | 'getResumable' | 'getResumableBySession' | 'dismissResumable'
  >
>;

function createMockSubagentRegistry(): MockSubagentRegistry {
  return {
    get: jest.fn(),
    getResumable: jest.fn().mockReturnValue([]),
    getResumableBySession: jest.fn().mockReturnValue([]),
    dismissResumable: jest.fn().mockReturnValue([]),
  };
}

type MockDispatcher = jest.Mocked<
  Pick<
    SubagentMessageDispatcher,
    'sendToSubagent' | 'stopSubagent' | 'interruptSession' | 'backgroundTask'
  >
>;

function createMockDispatcher(): MockDispatcher {
  return {
    sendToSubagent: jest.fn().mockResolvedValue(undefined),
    stopSubagent: jest.fn().mockResolvedValue(undefined),
    interruptSession: jest.fn().mockResolvedValue(undefined),
    backgroundTask: jest.fn().mockResolvedValue(true),
  };
}

function makeSubagentRecord(
  overrides: Partial<SubagentRecord> = {},
): SubagentRecord {
  return {
    toolCallId: 'toolu_abc123',
    agentType: 'software-architect',
    status: 'interrupted',
    startedAt: 1_700_000_000_000,
    parentSessionId: 'parent-session-uuid',
    agentId: 'adcecb2',
    ...overrides,
  } as SubagentRecord;
}

/**
 * Expected wire shape of a record with no `lastActivityAt` under the default
 * (`'auto'` -> 1h) TTL: cold, idle time unknown (0).
 */
function withUnknownActivity(
  record: SubagentRecord,
): SubagentRecord & { cacheInfo: SubagentCacheInfo } {
  return {
    ...record,
    cacheInfo: { cacheState: 'cold', effectiveTtl: '1h', idleMs: 0 },
  };
}

const TTL_ENV = 'CLAUDE_CODE_SUBAGENT_PROMPT_CACHE_TTL';
let savedTtlEnv: string | undefined;

beforeEach(() => {
  savedTtlEnv = process.env[TTL_ENV];
  delete process.env[TTL_ENV];
});

afterEach(() => {
  jest.restoreAllMocks();
  if (savedTtlEnv === undefined) {
    delete process.env[TTL_ENV];
  } else {
    process.env[TTL_ENV] = savedTtlEnv;
  }
});

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
  workspace: { getConfiguration: jest.Mock };
  historyReader: { readSubagentEvents: jest.Mock };
  metadataStore: { dismissResumableSubagents: jest.Mock };
}

function makeHarness(): Harness {
  const logger = createMockLogger();
  const rpcHandler = createMockRpcHandler();
  const registry = createMockSubagentRegistry();
  const sentry = createMockSentryService();
  const dispatcher = createMockDispatcher();
  const workspace = { getConfiguration: jest.fn().mockReturnValue('auto') };
  const historyReader = {
    readSubagentEvents: jest.fn().mockResolvedValue({
      status: 'ok',
      agentId: 'agent-1',
      events: [],
      truncated: false,
    }),
  };

  const metadataStore = {
    dismissResumableSubagents: jest.fn().mockResolvedValue(undefined),
  };

  const handlers = new SubagentRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as RpcHandler,
    registry as unknown as SubagentRegistryService,
    sentry as unknown as SentryService,
    dispatcher as unknown as SubagentMessageDispatcher,
    workspace as unknown as IWorkspaceProvider,
    historyReader as Pick<
      SessionHistoryReaderService,
      'readSubagentEvents'
    > as SessionHistoryReaderService,
    metadataStore as unknown as SessionMetadataStore,
  );

  return {
    handlers,
    logger,
    rpcHandler,
    registry,
    sentry,
    dispatcher,
    workspace,
    historyReader,
    metadataStore,
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SubagentRpcHandlers', () => {
  describe('register()', () => {
    it('registers all seven methods', () => {
      const h = makeHarness();
      h.handlers.register();

      const methods = h.rpcHandler.getRegisteredMethods();
      expect(methods).toContain('chat:subagent-query');
      expect(methods).toContain('chat:dismiss-resumable-subagents');
      expect(methods).toContain('subagent:send-message');
      expect(methods).toContain('subagent:stop');
      expect(methods).toContain('subagent:interrupt');
      expect(methods).toContain('subagent:background');
      expect(methods).toContain('subagent:history-page');
      expect(methods).toHaveLength(7);
    });
  });

  describe('chat:dismiss-resumable-subagents', () => {
    it('dismisses in the registry and persists the dismissed records', async () => {
      const h = makeHarness();
      const dismissed = { ...makeSubagentRecord(), dismissed: true };
      h.registry.dismissResumable.mockReturnValue([dismissed]);
      h.handlers.register();

      const result = await call<{ success: boolean }>(
        h,
        'chat:dismiss-resumable-subagents',
        { sessionId: 'sess-1', toolCallIds: ['toolu_1'] },
      );

      expect(result).toEqual({ success: true });
      expect(h.registry.dismissResumable).toHaveBeenCalledWith('sess-1', [
        'toolu_1',
      ]);
      expect(h.metadataStore.dismissResumableSubagents).toHaveBeenCalledWith(
        'sess-1',
        [dismissed],
      );
    });

    it('skips the metadata write when nothing matched', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean }>(
        h,
        'chat:dismiss-resumable-subagents',
        { sessionId: 'sess-1', toolCallIds: ['unknown'] },
      );

      expect(result).toEqual({ success: true });
      expect(h.metadataStore.dismissResumableSubagents).not.toHaveBeenCalled();
    });

    it('rejects an empty sessionId without touching the registry', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'chat:dismiss-resumable-subagents',
        { sessionId: '', toolCallIds: ['toolu_1'] },
      );

      expect(result.success).toBe(false);
      expect(result.error).toEqual(expect.any(String));
      expect(h.registry.dismissResumable).not.toHaveBeenCalled();
    });

    it('reports a failed metadata write', async () => {
      const h = makeHarness();
      h.registry.dismissResumable.mockReturnValue([makeSubagentRecord()]);
      h.metadataStore.dismissResumableSubagents.mockRejectedValue(
        new Error('write failed'),
      );
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'chat:dismiss-resumable-subagents',
        { sessionId: 'sess-1', toolCallIds: ['toolu_1'] },
      );

      expect(result).toEqual({ success: false, error: 'write failed' });
      expect(h.logger.error).toHaveBeenCalled();
    });
  });

  describe('chat:subagent-query hides dismissed records', () => {
    it('returns [] for a dismissed record queried by toolCallId', async () => {
      const h = makeHarness();
      h.registry.get.mockReturnValue({
        ...makeSubagentRecord({ toolCallId: 'toolu_d' }),
        dismissed: true,
      });
      h.handlers.register();

      const result = await call<{ subagents: SubagentRecord[] }>(
        h,
        'chat:subagent-query',
        { toolCallId: 'toolu_d' },
      );

      expect(result.subagents).toEqual([]);
    });
  });

  describe('subagent:history-page', () => {
    const event = (
      id: string,
      delta = 'x'.repeat(650),
    ): FlatStreamEventUnion => ({
      eventType: 'text_delta',
      id,
      messageId: 'message',
      timestamp: 1,
      blockIndex: 0,
      delta,
    });
    const read = (events: FlatStreamEventUnion[]) => ({
      status: 'ok',
      agentId: 'agent-1',
      events,
      truncated: false,
    });

    it('reads a page and preserves status', async () => {
      const h = makeHarness();
      h.handlers.register();
      const page = await call<{
        status: string;
        done: boolean;
        events: unknown[];
      }>(h, 'subagent:history-page', {
        sessionId: 'session-1',
        toolCallId: 'tool-1',
      });
      expect(h.historyReader.readSubagentEvents).toHaveBeenCalledWith(
        'session-1',
        'tool-1',
        undefined,
      );
      expect(page).toMatchObject({ status: 'ok', done: true, events: [] });
    });

    it.each(['../', 'bad/id', ''])(
      'rejects unsafe agentId %s before reading',
      async (agentId) => {
        const h = makeHarness();
        h.handlers.register();
        await expect(
          call(h, 'subagent:history-page', {
            sessionId: 'session-1',
            toolCallId: 'tool-1',
            agentId,
          }),
        ).rejects.toThrow();
        expect(h.historyReader.readSubagentEvents).not.toHaveBeenCalled();
      },
    );

    it('maps read failure to a path-free user error and logs identifiers', async () => {
      const h = makeHarness();
      h.historyReader.readSubagentEvents.mockRejectedValue(
        new Error('C:\\secret\\agent.jsonl'),
      );
      h.handlers.register();
      await expect(
        call(h, 'subagent:history-page', {
          sessionId: 'session-1',
          toolCallId: 'tool-1',
        }),
      ).rejects.toThrow('Could not read agent output');
      expect(h.logger.error).toHaveBeenCalled();
    });

    it('rejects a malformed cursor before reading', async () => {
      const h = makeHarness();
      h.handlers.register();
      for (const cursor of ['../', '1', 'v1.e2hhY2tlZCIsImJvZ3VzIl0']) {
        const response = await h.rpcHandler.handleMessage({
          method: 'subagent:history-page',
          params: { sessionId: 'session-1', toolCallId: 'tool-1', cursor },
          correlationId: 'malformed',
        });
        expect(response).toMatchObject({
          success: false,
          errorCode: 'INVALID_PARAMS',
        });
      }
      expect(h.historyReader.readSubagentEvents).not.toHaveBeenCalled();
    });

    it('resumes after the same event when history grows between calls', async () => {
      const h = makeHarness();
      const first = event('first');
      const second = event('second');
      h.historyReader.readSubagentEvents
        .mockResolvedValueOnce(read([first, second]))
        .mockResolvedValueOnce(read([first, second, event('appended')]));
      h.handlers.register();
      const params = {
        sessionId: 'session-1',
        toolCallId: 'tool-1',
        maxBytes: 1024,
      };
      const page1 = await call<SubagentHistoryPageResult>(
        h,
        'subagent:history-page',
        params,
      );
      expect(page1.nextCursor).toBe(historyCursor(first));
      const page2 = await call<SubagentHistoryPageResult>(
        h,
        'subagent:history-page',
        { ...params, cursor: page1.nextCursor },
      );
      expect(page2.events[0].id).toBe('second');
    });

    it('resumes after a stable anchor when a same-id continuation replaces a completion', async () => {
      const h = makeHarness();
      const first = event('first');
      const completion = {
        eventType: 'message_complete',
        id: 'old-complete',
        messageId: 'message',
        timestamp: 2,
      } as const;
      h.historyReader.readSubagentEvents
        .mockResolvedValueOnce(read([first, completion]))
        .mockResolvedValueOnce(
          read([
            first,
            event('continuation'),
            { ...completion, id: 'new-complete' },
          ]),
        );
      h.handlers.register();
      const params = {
        sessionId: 'session-1',
        toolCallId: 'tool-1',
        maxBytes: 1024,
      };
      const page1 = await call<SubagentHistoryPageResult>(
        h,
        'subagent:history-page',
        params,
      );
      const page2 = await call<SubagentHistoryPageResult>(
        h,
        'subagent:history-page',
        { ...params, cursor: page1.nextCursor },
      );
      expect(page2.events[0].id).toBe('continuation');
    });

    it('returns HISTORY_CURSOR_STALE when the anchor disappears', async () => {
      const h = makeHarness();
      h.historyReader.readSubagentEvents.mockResolvedValue(
        read([event('other')]),
      );
      h.handlers.register();
      const response = await h.rpcHandler.handleMessage({
        method: 'subagent:history-page',
        params: {
          sessionId: 'session-1',
          toolCallId: 'tool-1',
          cursor: historyCursor(event('pruned')),
        },
        correlationId: 'stale-anchor',
      });
      expect(response).toMatchObject({
        success: false,
        errorCode: 'HISTORY_CURSOR_STALE',
      });
    });

    it('returns not-found when the transcript is pruned between pages', async () => {
      const h = makeHarness();
      h.historyReader.readSubagentEvents.mockResolvedValue({
        status: 'not-found',
        agentId: 'agent-1',
        events: [],
        truncated: false,
      });
      h.handlers.register();
      const page = await call<SubagentHistoryPageResult>(
        h,
        'subagent:history-page',
        {
          sessionId: 'session-1',
          toolCallId: 'tool-1',
          cursor: historyCursor(event('first')),
        },
      );
      expect(page).toMatchObject({
        status: 'not-found',
        events: [],
        done: true,
      });
    });

    it('maps a reader validation error to INVALID_PARAMS', async () => {
      const h = makeHarness();
      h.historyReader.readSubagentEvents.mockRejectedValue(
        new SubagentHistoryValidationError('Invalid agent id'),
      );
      h.handlers.register();
      const response = await h.rpcHandler.handleMessage({
        method: 'subagent:history-page',
        params: { sessionId: 'session-1', toolCallId: 'tool-1' },
        correlationId: 'invalid-reader',
      });
      expect(response).toMatchObject({
        success: false,
        errorCode: 'INVALID_PARAMS',
      });
    });

    it('does not classify an unrelated error by its message', async () => {
      const h = makeHarness();
      h.historyReader.readSubagentEvents.mockRejectedValue(
        new Error('Invalid agent id'),
      );
      h.handlers.register();
      const response = await h.rpcHandler.handleMessage({
        method: 'subagent:history-page',
        params: { sessionId: 'session-1', toolCallId: 'tool-1' },
        correlationId: 'untyped-error',
      });
      expect(response).toMatchObject({
        success: false,
        errorCode: 'PERSISTENCE_UNAVAILABLE',
      });
    });

    it('rejects a page that repeats the request cursor', async () => {
      const h = makeHarness();
      const first = event('duplicate');
      h.historyReader.readSubagentEvents.mockResolvedValue(
        read([first, first, event('later')]),
      );
      h.handlers.register();
      const response = await h.rpcHandler.handleMessage({
        method: 'subagent:history-page',
        params: {
          sessionId: 'session-1',
          toolCallId: 'tool-1',
          cursor: historyCursor(first),
          maxBytes: 1024,
        },
        correlationId: 'repeated-cursor',
      });
      expect(response).toMatchObject({
        success: false,
        errorCode: 'HISTORY_CURSOR_STALE',
      });
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

      expect(result.subagents).toEqual([withUnknownActivity(record)]);
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

      expect(result.subagents).toEqual(records.map(withUnknownActivity));
      expect(h.registry.getResumableBySession).toHaveBeenCalledWith(
        'parent-session-uuid',
      );
      // Specificity contract: toolCallId branch is not entered, and we did
      // not fall through to the all-resumable branch.
      expect(h.registry.get).not.toHaveBeenCalled();
      expect(h.registry.getResumable).not.toHaveBeenCalled();
    });

    // TASK_2026_295 — an empty sessionId used to be falsy, so the scoped
    // branch was skipped and the handler fell through to the UNSCOPED
    // all-resumable branch. That offered this session the chance to resume
    // another session's interrupted subagents.
    it('returns no subagents for an empty sessionId instead of falling through to all-resumable', async () => {
      const h = makeHarness();
      h.registry.getResumable.mockReturnValue([
        makeSubagentRecord({
          toolCallId: 'toolu_other',
          parentSessionId: 's2',
        }),
      ]);
      h.handlers.register();

      const result = await call<{ subagents: SubagentRecord[] }>(
        h,
        'chat:subagent-query',
        { sessionId: '' },
      );

      expect(result.subagents).toEqual([]);
      expect(h.registry.getResumable).not.toHaveBeenCalled();
      expect(h.registry.getResumableBySession).not.toHaveBeenCalled();
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

      expect(result.subagents).toEqual(records.map(withUnknownActivity));
      expect(h.registry.getResumable).toHaveBeenCalledTimes(1);
      expect(h.registry.get).not.toHaveBeenCalled();
      expect(h.registry.getResumableBySession).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // chat:subagent-query — cacheInfo (N2)
  // -------------------------------------------------------------------------

  describe('chat:subagent-query cacheInfo', () => {
    const NOW = 1_800_000_000_000;
    const MIN = 60_000;

    it('reports warm and cold against the configured TTL', async () => {
      const h = makeHarness();
      jest.spyOn(Date, 'now').mockReturnValue(NOW);
      h.workspace.getConfiguration.mockReturnValue('5m');
      h.registry.getResumableBySession.mockReturnValue([
        makeSubagentRecord({
          toolCallId: 'toolu_warm',
          lastActivityAt: NOW - 2 * MIN,
        }),
        makeSubagentRecord({
          toolCallId: 'toolu_cold',
          lastActivityAt: NOW - 5 * MIN,
        }),
      ]);
      h.handlers.register();

      const result = await call<{
        subagents: Array<SubagentRecord & { cacheInfo?: SubagentCacheInfo }>;
      }>(h, 'chat:subagent-query', { sessionId: 'parent-session-uuid' });

      expect(result.subagents.map((s) => s.cacheInfo)).toEqual([
        { cacheState: 'warm', effectiveTtl: '5m', idleMs: 2 * MIN },
        { cacheState: 'cold', effectiveTtl: '5m', idleMs: 5 * MIN },
      ]);
      expect(h.workspace.getConfiguration).toHaveBeenCalledWith(
        'ptah',
        'agentOrchestration.subagentPromptCacheTtl',
        'auto',
      );
    });

    it('uses the host env TTL when it is valid', async () => {
      const h = makeHarness();
      jest.spyOn(Date, 'now').mockReturnValue(NOW);
      h.workspace.getConfiguration.mockReturnValue('5m');
      process.env[TTL_ENV] = '1h';
      h.registry.get.mockReturnValue(
        makeSubagentRecord({ lastActivityAt: NOW - 30 * MIN }),
      );
      h.handlers.register();

      const result = await call<{
        subagents: Array<{ cacheInfo?: SubagentCacheInfo }>;
      }>(h, 'chat:subagent-query', { toolCallId: 'toolu_abc123' });

      expect(result.subagents[0].cacheInfo).toEqual({
        cacheState: 'warm',
        effectiveTtl: '1h',
        idleMs: 30 * MIN,
      });
    });

    it('does not read the TTL setting when no record is returned', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'chat:subagent-query', {});

      expect(h.workspace.getConfiguration).not.toHaveBeenCalled();
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
  // chat:subagent-query — malformed params (TASK_2026_296)
  //
  // The schema validates SHAPE. A wrong-typed id is refused there; a
  // present-but-empty one is not its business and reaches the handler rule
  // above. Both must end in an empty list, never in a throw and never in the
  // unscoped all-resumable branch.
  // -------------------------------------------------------------------------

  describe('chat:subagent-query malformed params', () => {
    it('does not throw out of the handler when sessionId is not a string', async () => {
      const h = makeHarness();
      h.registry.getResumable.mockReturnValue([
        makeSubagentRecord({
          toolCallId: 'toolu_other',
          parentSessionId: 's2',
        }),
      ]);
      h.handlers.register();

      const result = await call<{ subagents: SubagentRecord[] }>(
        h,
        'chat:subagent-query',
        { sessionId: 123 },
      );

      expect(result.subagents).toEqual([]);
      // A malformed scope must not become an unscoped query either.
      expect(h.registry.getResumable).not.toHaveBeenCalled();
      expect(h.registry.getResumableBySession).not.toHaveBeenCalled();
      expect(h.sentry.captureException).toHaveBeenCalled();
    });

    it('does not throw out of the handler when toolCallId is not a string', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ subagents: SubagentRecord[] }>(
        h,
        'chat:subagent-query',
        { toolCallId: { nope: true } },
      );

      expect(result.subagents).toEqual([]);
      expect(h.registry.get).not.toHaveBeenCalled();
    });

    // `.passthrough()`, not `.strict()` — an outdated webview sending an extra
    // field must still get its answer.
    it('answers normally when an unknown extra field is present', async () => {
      const h = makeHarness();
      const records = [
        makeSubagentRecord({ toolCallId: 'toolu_1', parentSessionId: 's1' }),
      ];
      h.registry.getResumable.mockReturnValue(records);
      h.handlers.register();

      const result = await call<{ subagents: SubagentRecord[] }>(
        h,
        'chat:subagent-query',
        { someFutureField: 'from a newer webview' },
      );

      expect(result.subagents).toEqual(records.map(withUnknownActivity));
      expect(h.registry.getResumable).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // subagent:send-message
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
  // subagent:stop
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
  // subagent:interrupt
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

  // -------------------------------------------------------------------------
  // subagent:background
  // -------------------------------------------------------------------------

  describe('subagent:background', () => {
    it('delegates to dispatcher.backgroundTask and returns { backgrounded }', async () => {
      const h = makeHarness();
      h.dispatcher.backgroundTask.mockResolvedValue(true);
      h.handlers.register();

      const result = await call<{ backgrounded: boolean }>(
        h,
        'subagent:background',
        { sessionId: 'sess-abc', toolUseId: 'toolu_fg' },
      );

      expect(result).toEqual({ backgrounded: true });
      expect(h.dispatcher.backgroundTask).toHaveBeenCalledWith(
        'sess-abc',
        'toolu_fg',
      );
    });

    it('omits toolUseId (backgrounds all) when not provided', async () => {
      const h = makeHarness();
      h.dispatcher.backgroundTask.mockResolvedValue(true);
      h.handlers.register();

      const result = await call<{ backgrounded: boolean }>(
        h,
        'subagent:background',
        { sessionId: 'sess-abc' },
      );

      expect(result).toEqual({ backgrounded: true });
      expect(h.dispatcher.backgroundTask).toHaveBeenCalledWith(
        'sess-abc',
        undefined,
      );
    });

    it('returns { backgrounded: false } when no foreground task matched', async () => {
      const h = makeHarness();
      h.dispatcher.backgroundTask.mockResolvedValue(false);
      h.handlers.register();

      const result = await call<{ backgrounded: boolean }>(
        h,
        'subagent:background',
        { sessionId: 'sess-abc', toolUseId: 'toolu_none' },
      );

      expect(result).toEqual({ backgrounded: false });
    });

    it('rejects when sessionId is empty', async () => {
      const h = makeHarness();
      h.handlers.register();

      await expect(
        call(h, 'subagent:background', { sessionId: '' }),
      ).rejects.toThrow();
    });

    it('propagates dispatcher errors', async () => {
      const h = makeHarness();
      h.dispatcher.backgroundTask.mockRejectedValue(
        new Error('session not active'),
      );
      h.handlers.register();

      await expect(
        call(h, 'subagent:background', { sessionId: 'sess-abc' }),
      ).rejects.toThrow();
    });
  });
});
