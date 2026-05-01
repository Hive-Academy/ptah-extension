/**
 * SessionRpcHandlers — unit specs (TASK_2025_294 W2.B4).
 *
 * Surface under test: seven RPC methods exposing the session metadata
 * store and the SDK session history reader to the webview
 * (`session:list`, `session:load`, `session:delete`, `session:rename`,
 * `session:validate`, `session:cli-sessions`, `session:stats-batch`).
 *
 * Behavioural contracts locked in here:
 *   - Registration: `register()` wires all seven methods into the mock
 *     RpcHandler.
 *   - Workspace authorization: `session:list` and `session:validate` both
 *     reject workspace paths that are not members of the active workspace
 *     folder set. This is a SECURITY control — the webview MUST NOT be
 *     able to enumerate sessions under arbitrary directories.
 *   - `session:list` pagination: respects `limit` / `offset`, computes
 *     `hasMore` from `offset + limit < total`, and projects metadata
 *     into the `ChatSessionSummary` response shape (including the
 *     conditional `tokenUsage` when totals are non-zero).
 *   - `session:load`: metadata-only validation path. Throws when session
 *     metadata is missing; returns the session id with empty arrays
 *     when present (actual messages flow through `chat:resume`, not
 *     through this handler).
 *   - `session:rename`: validates the trimmed name is 1..200 chars and
 *     that the session exists BEFORE mutating the store. Missing
 *     sessions return `{ success:false, error }` — never throw.
 *   - `session:delete`: returns `{ success:true }` when the metadata
 *     store accepts the delete. When the metadata lookup fails, the
 *     handler degrades to `{ success:false, error }` and captures the
 *     exception — it does not bubble.
 *   - `session:cli-sessions`: filters out ghost `ptah-cli` entries
 *     without a `ptahCliId` (legacy `recoverMissingCliSessions()`
 *     artifacts — see the handler header). Real entries with
 *     `ptahCliId` pass through; other cli types pass through as-is.
 *   - `session:stats-batch`: maps success/empty/error per session using
 *     `SessionHistoryReaderService.readSessionHistory()` and exposes
 *     the optional `cliAgents` list from metadata.
 *
 * Mocking posture: direct constructor injection, narrow
 * `jest.Mocked<Pick<T, ...>>` surfaces, no `as any` casts.
 *
 * Source-under-test:
 *   `libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts`
 */

import 'reflect-metadata';

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
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  createMockWorkspaceProvider,
  type MockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';
import type {
  SessionMetadataStore,
  SessionHistoryReaderService,
  SdkAgentAdapter,
} from '@ptah-extension/agent-sdk';
import type { CliSessionReference, SessionId } from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { SessionRpcHandlers } from './session-rpc.handlers';

// ---------------------------------------------------------------------------
// Narrow mock surfaces — only what the handler actually touches.
// ---------------------------------------------------------------------------

type MockMetadataStore = jest.Mocked<
  Pick<SessionMetadataStore, 'get' | 'getForWorkspace' | 'delete' | 'rename'>
>;

function createMockMetadataStore(): MockMetadataStore {
  return {
    get: jest.fn(),
    getForWorkspace: jest.fn().mockResolvedValue([]),
    delete: jest.fn().mockResolvedValue(undefined),
    rename: jest.fn().mockResolvedValue(undefined),
  };
}

type MockHistoryReader = jest.Mocked<
  Pick<SessionHistoryReaderService, 'readSessionHistory'>
>;

function createMockHistoryReader(): MockHistoryReader {
  return {
    readSessionHistory: jest.fn(),
  } as unknown as MockHistoryReader;
}

type MockSdkAdapter = jest.Mocked<
  Pick<SdkAgentAdapter, 'forkSession' | 'rewindFiles'>
>;

function createMockSdkAdapter(): MockSdkAdapter {
  return {
    forkSession: jest.fn(),
    rewindFiles: jest.fn(),
  } as unknown as MockSdkAdapter;
}

/** Factory for minimal metadata fixtures — only fields the handler reads. */
interface MetadataFixture {
  sessionId: string;
  name: string;
  workspaceId: string;
  createdAt: number;
  lastActiveAt: number;
  totalCost: number;
  totalTokens: { input: number; output: number };
  cliSessions?: CliSessionReference[];
}

function makeMetadata(
  overrides: Partial<MetadataFixture> = {},
): MetadataFixture {
  return {
    sessionId: 'sess-uuid-1',
    name: 'My Session',
    workspaceId: '/fake/workspace',
    createdAt: 1_700_000_000_000,
    lastActiveAt: 1_700_000_500_000,
    totalCost: 0,
    totalTokens: { input: 0, output: 0 },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const WORKSPACE = '/fake/workspace';
/** Valid UUID-shaped session id passing the handler's `/^[0-9a-f-]{36}$/i` guard. */
const VALID_SESSION_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
/** Valid userMessageId passing the handler's 1-100 chars + no path-separator guard. */
const VALID_USER_MESSAGE_ID = 'msg_01HXYZABCDEF';

interface Harness {
  handlers: SessionRpcHandlers;
  logger: MockLogger;
  rpcHandler: MockRpcHandler;
  metadataStore: MockMetadataStore;
  historyReader: MockHistoryReader;
  workspace: MockWorkspaceProvider;
  sentry: MockSentryService;
  sdkAdapter: MockSdkAdapter;
}

function makeHarness(opts: { workspaceFolders?: string[] } = {}): Harness {
  const logger = createMockLogger();
  const rpcHandler = createMockRpcHandler();
  const metadataStore = createMockMetadataStore();
  const historyReader = createMockHistoryReader();
  const workspace = createMockWorkspaceProvider({
    folders: opts.workspaceFolders ?? [WORKSPACE],
  });
  const sentry = createMockSentryService();
  const sdkAdapter = createMockSdkAdapter();

  const handlers = new SessionRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as RpcHandler,
    metadataStore as unknown as SessionMetadataStore,
    historyReader as unknown as SessionHistoryReaderService,
    sentry as unknown as SentryService,
    workspace as unknown as IWorkspaceProvider,
    sdkAdapter as unknown as SdkAgentAdapter,
  );

  return {
    handlers,
    logger,
    rpcHandler,
    metadataStore,
    historyReader,
    workspace,
    sentry,
    sdkAdapter,
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

describe('SessionRpcHandlers', () => {
  describe('register()', () => {
    it('registers all session RPC methods (incl. fork + rewind)', () => {
      const h = makeHarness();
      h.handlers.register();

      expect(h.rpcHandler.getRegisteredMethods().sort()).toEqual(
        [
          'session:cli-sessions',
          'session:delete',
          'session:forkSession',
          'session:list',
          'session:load',
          'session:rename',
          'session:rewindFiles',
          'session:stats-batch',
          'session:validate',
        ].sort(),
      );
    });
  });

  // -------------------------------------------------------------------------
  // session:list
  // -------------------------------------------------------------------------

  describe('session:list', () => {
    it('rejects workspace paths outside the active workspace (security guard)', async () => {
      const h = makeHarness({ workspaceFolders: [WORKSPACE] });
      h.handlers.register();

      const response = await callRaw(h, 'session:list', {
        workspacePath: '/not/authorized',
        limit: 10,
        offset: 0,
      });

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/workspace-not-authorized/);
      expect(h.metadataStore.getForWorkspace).not.toHaveBeenCalled();
    });

    it('paginates metadataStore.getForWorkspace() results and sets hasMore correctly', async () => {
      const h = makeHarness();
      const items = Array.from({ length: 5 }, (_, i) =>
        makeMetadata({
          sessionId: `sess-${i}`,
          name: `Session ${i}`,
          lastActiveAt: 1_700_000_000_000 + i,
        }),
      );
      h.metadataStore.getForWorkspace.mockResolvedValue(items);
      h.handlers.register();

      const page1 = await call<{
        sessions: Array<{ id: string; name: string }>;
        total: number;
        hasMore: boolean;
      }>(h, 'session:list', {
        workspacePath: WORKSPACE,
        limit: 2,
        offset: 0,
      });

      expect(page1.total).toBe(5);
      expect(page1.hasMore).toBe(true);
      expect(page1.sessions).toHaveLength(2);
      expect(page1.sessions[0].id).toBe('sess-0');

      const lastPage = await call<{
        sessions: Array<{ id: string }>;
        total: number;
        hasMore: boolean;
      }>(h, 'session:list', {
        workspacePath: WORKSPACE,
        limit: 2,
        offset: 4,
      });

      expect(lastPage.total).toBe(5);
      expect(lastPage.hasMore).toBe(false);
      expect(lastPage.sessions).toHaveLength(1);
    });

    it('uses default limit=10 / offset=0 when params omit them', async () => {
      const h = makeHarness();
      h.metadataStore.getForWorkspace.mockResolvedValue([
        makeMetadata({ sessionId: 'sess-1' }),
      ]);
      h.handlers.register();

      const result = await call<{
        sessions: Array<{ id: string }>;
        total: number;
      }>(h, 'session:list', { workspacePath: WORKSPACE });

      expect(result.total).toBe(1);
      expect(result.sessions).toHaveLength(1);
    });

    it('includes tokenUsage only when metadata has non-zero token totals', async () => {
      const h = makeHarness();
      h.metadataStore.getForWorkspace.mockResolvedValue([
        makeMetadata({
          sessionId: 'sess-zero',
          totalTokens: { input: 0, output: 0 },
        }),
        makeMetadata({
          sessionId: 'sess-nonzero',
          totalTokens: { input: 100, output: 50 },
        }),
      ]);
      h.handlers.register();

      const result = await call<{
        sessions: Array<{
          id: string;
          tokenUsage?: { input: number; output: number };
        }>;
      }>(h, 'session:list', { workspacePath: WORKSPACE });

      const zero = result.sessions.find((s) => s.id === 'sess-zero');
      const nonzero = result.sessions.find((s) => s.id === 'sess-nonzero');
      expect(zero?.tokenUsage).toBeUndefined();
      expect(nonzero?.tokenUsage).toEqual({ input: 100, output: 50 });
    });

    it('wraps metadataStore errors with "Failed to list sessions:" and reports to Sentry', async () => {
      const h = makeHarness();
      h.metadataStore.getForWorkspace.mockRejectedValue(new Error('disk gone'));
      h.handlers.register();

      const response = await callRaw(h, 'session:list', {
        workspacePath: WORKSPACE,
      });

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/Failed to list sessions/);
      expect(response.error).toMatch(/disk gone/);
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // session:load
  // -------------------------------------------------------------------------

  describe('session:load', () => {
    it('returns sessionId with empty arrays when metadata exists (validation-only)', async () => {
      const h = makeHarness();
      h.metadataStore.get.mockResolvedValue(
        makeMetadata({ sessionId: 'sess-load' }) as never,
      );
      h.handlers.register();

      const result = await call<{
        sessionId: SessionId;
        messages: unknown[];
        agentSessions: unknown[];
      }>(h, 'session:load', { sessionId: 'sess-load' });

      expect(result.sessionId).toBe('sess-load');
      expect(result.messages).toEqual([]);
      expect(result.agentSessions).toEqual([]);
    });

    it('fails with "Session not found" when metadata is absent', async () => {
      const h = makeHarness();
      h.metadataStore.get.mockResolvedValue(null);
      h.handlers.register();

      const response = await callRaw(h, 'session:load', {
        sessionId: 'sess-missing',
      });

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/Session not found/);
      expect(response.error).toMatch(/sess-missing/);
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // session:rename
  // -------------------------------------------------------------------------

  describe('session:rename', () => {
    it('rejects an empty / whitespace-only name before touching the store', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'session:rename',
        { sessionId: 'sess-1', name: '   ' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/between 1 and 200/);
      expect(h.metadataStore.get).not.toHaveBeenCalled();
      expect(h.metadataStore.rename).not.toHaveBeenCalled();
    });

    it('rejects names longer than 200 characters', async () => {
      const h = makeHarness();
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'session:rename',
        { sessionId: 'sess-1', name: 'a'.repeat(201) },
      );

      expect(result.success).toBe(false);
      expect(h.metadataStore.rename).not.toHaveBeenCalled();
    });

    it('returns "Session not found" when metadata lookup is null', async () => {
      const h = makeHarness();
      h.metadataStore.get.mockResolvedValue(null);
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'session:rename',
        { sessionId: 'sess-missing', name: 'New Name' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('Session not found');
      expect(h.metadataStore.rename).not.toHaveBeenCalled();
    });

    it('trims the name and delegates to metadataStore.rename on success', async () => {
      const h = makeHarness();
      h.metadataStore.get.mockResolvedValue(
        makeMetadata({ sessionId: 'sess-1' }) as never,
      );
      h.handlers.register();

      const result = await call<{ success: boolean }>(h, 'session:rename', {
        sessionId: 'sess-1',
        name: '  Shiny New Name  ',
      });

      expect(result.success).toBe(true);
      expect(h.metadataStore.rename).toHaveBeenCalledWith(
        'sess-1',
        'Shiny New Name',
      );
    });

    it('returns structured failure (not throw) when the store throws', async () => {
      const h = makeHarness();
      h.metadataStore.get.mockResolvedValue(
        makeMetadata({ sessionId: 'sess-1' }) as never,
      );
      h.metadataStore.rename.mockRejectedValue(new Error('storage locked'));
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'session:rename',
        { sessionId: 'sess-1', name: 'New' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('storage locked');
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // session:delete
  // -------------------------------------------------------------------------

  describe('session:delete', () => {
    it('returns success=true after deleting metadata (file deletion is best-effort)', async () => {
      const h = makeHarness();
      // No workspacePath in metadata → skips the filesystem branch entirely.
      h.metadataStore.get.mockResolvedValue(
        makeMetadata({
          sessionId: 'sess-del',
          workspaceId: '',
        }) as never,
      );
      h.handlers.register();

      const result = await call<{ success: boolean }>(h, 'session:delete', {
        sessionId: 'sess-del',
      });

      expect(result.success).toBe(true);
      expect(h.metadataStore.delete).toHaveBeenCalledWith('sess-del');
    });

    it('returns structured failure (not throw) when metadataStore.get explodes', async () => {
      const h = makeHarness();
      h.metadataStore.get.mockRejectedValue(new Error('disk gone'));
      h.handlers.register();

      const result = await call<{ success: boolean; error?: string }>(
        h,
        'session:delete',
        { sessionId: 'sess-any' },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('disk gone');
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // session:validate
  // -------------------------------------------------------------------------

  describe('session:validate', () => {
    it('rejects unauthorized workspace paths with exists=false (no throw)', async () => {
      const h = makeHarness({ workspaceFolders: [WORKSPACE] });
      h.handlers.register();

      const result = await call<{ exists: boolean }>(h, 'session:validate', {
        sessionId: 'sess-1',
        workspacePath: '/not/authorized',
      });

      expect(result.exists).toBe(false);
    });

    it('returns exists=false when the session file is not present on disk', async () => {
      // We cannot easily stub fs here, but the happy path without a real
      // ~/.claude/projects directory returns exists=false via the internal
      // findSessionFile() best-effort branch.
      const h = makeHarness({ workspaceFolders: [WORKSPACE] });
      h.handlers.register();

      const result = await call<{ exists: boolean }>(h, 'session:validate', {
        sessionId: 'sess-definitely-not-on-disk',
        workspacePath: WORKSPACE,
      });

      expect(result.exists).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // session:cli-sessions
  // -------------------------------------------------------------------------

  describe('session:cli-sessions', () => {
    it('returns [] when metadata is missing', async () => {
      const h = makeHarness();
      h.metadataStore.get.mockResolvedValue(null);
      h.handlers.register();

      const result = await call<{ cliSessions: CliSessionReference[] }>(
        h,
        'session:cli-sessions',
        { sessionId: 'sess-missing' },
      );

      expect(result.cliSessions).toEqual([]);
    });

    it('returns [] when metadata has no cliSessions', async () => {
      const h = makeHarness();
      h.metadataStore.get.mockResolvedValue(
        makeMetadata({ sessionId: 'sess-empty' }) as never,
      );
      h.handlers.register();

      const result = await call<{ cliSessions: CliSessionReference[] }>(
        h,
        'session:cli-sessions',
        { sessionId: 'sess-empty' },
      );

      expect(result.cliSessions).toEqual([]);
    });

    it('filters out ghost ptah-cli entries lacking a ptahCliId', async () => {
      const h = makeHarness();
      const realCli: CliSessionReference = {
        cli: 'ptah-cli',
        ptahCliId: 'real-cli-id',
      } as CliSessionReference;
      const ghostCli = {
        cli: 'ptah-cli',
        // no ptahCliId — synthesized by the removed recoverMissingCliSessions()
      } as CliSessionReference;
      const gemini = { cli: 'gemini' } as CliSessionReference;

      h.metadataStore.get.mockResolvedValue(
        makeMetadata({
          sessionId: 'sess-cli',
          cliSessions: [realCli, ghostCli, gemini],
        }) as never,
      );
      h.handlers.register();

      const result = await call<{ cliSessions: CliSessionReference[] }>(
        h,
        'session:cli-sessions',
        { sessionId: 'sess-cli' },
      );

      // Real ptah-cli stays; ghost is filtered; non-ptah-cli passes through.
      expect(result.cliSessions).toEqual([realCli, gemini]);
    });

    it('returns [] and captures to Sentry when the store throws (never bubbles)', async () => {
      const h = makeHarness();
      h.metadataStore.get.mockRejectedValue(new Error('store boom'));
      h.handlers.register();

      const result = await call<{ cliSessions: CliSessionReference[] }>(
        h,
        'session:cli-sessions',
        { sessionId: 'sess-any' },
      );

      expect(result.cliSessions).toEqual([]);
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // session:stats-batch
  // -------------------------------------------------------------------------

  describe('session:stats-batch', () => {
    it('returns status=ok stats for sessions the history reader resolves', async () => {
      const h = makeHarness();
      h.historyReader.readSessionHistory.mockResolvedValue({
        events: [],
        stats: {
          totalCost: 1.23,
          tokens: {
            input: 100,
            output: 50,
            cacheRead: 10,
            cacheCreation: 5,
          },
          messageCount: 7,
        },
      } as never);
      h.metadataStore.get.mockResolvedValue(
        makeMetadata({
          sessionId: 'sess-ok',
          cliSessions: [
            { cli: 'gemini' } as CliSessionReference,
            { cli: 'codex' } as CliSessionReference,
          ],
        }) as never,
      );
      h.handlers.register();

      const result = await call<{
        sessionStats: Array<{
          sessionId: string;
          status: 'ok' | 'empty' | 'error';
          totalCost: number;
          messageCount: number;
          cliAgents?: string[];
        }>;
      }>(h, 'session:stats-batch', {
        sessionIds: ['sess-ok'],
        workspacePath: WORKSPACE,
      });

      expect(result.sessionStats).toHaveLength(1);
      expect(result.sessionStats[0].sessionId).toBe('sess-ok');
      expect(result.sessionStats[0].status).toBe('ok');
      expect(result.sessionStats[0].totalCost).toBe(1.23);
      expect(result.sessionStats[0].messageCount).toBe(7);
      // Deduped CLI agent list from metadata.
      expect(result.sessionStats[0].cliAgents?.sort()).toEqual([
        'codex',
        'gemini',
      ]);
    });

    it('returns status=empty when the history reader returns no stats', async () => {
      const h = makeHarness();
      h.historyReader.readSessionHistory.mockResolvedValue({
        events: [],
        stats: null,
      } as never);
      h.metadataStore.get.mockResolvedValue(null);
      h.handlers.register();

      const result = await call<{
        sessionStats: Array<{
          sessionId: string;
          status: 'ok' | 'empty' | 'error';
          totalCost: number;
          messageCount: number;
          cliAgents?: string[];
        }>;
      }>(h, 'session:stats-batch', {
        sessionIds: ['sess-empty'],
        workspacePath: WORKSPACE,
      });

      expect(result.sessionStats[0].status).toBe('empty');
      expect(result.sessionStats[0].totalCost).toBe(0);
      expect(result.sessionStats[0].messageCount).toBe(0);
      expect(result.sessionStats[0].cliAgents).toEqual([]);
    });

    it('returns status=error when the history reader throws (never bubbles)', async () => {
      const h = makeHarness();
      h.historyReader.readSessionHistory.mockRejectedValue(
        new Error('jsonl parse failed'),
      );
      h.metadataStore.get.mockResolvedValue(null);
      h.handlers.register();

      const result = await call<{
        sessionStats: Array<{
          sessionId: string;
          status: 'ok' | 'empty' | 'error';
        }>;
      }>(h, 'session:stats-batch', {
        sessionIds: ['sess-error'],
        workspacePath: WORKSPACE,
      });

      expect(result.sessionStats[0].status).toBe('error');
    });

    it('processes many sessions without losing any (5x concurrency batching)', async () => {
      const h = makeHarness();
      // Stats reader returns a canonical ok shape for every session id.
      h.historyReader.readSessionHistory.mockImplementation(
        async (_sessionId: string) =>
          ({
            events: [],
            stats: {
              totalCost: 0.01,
              tokens: {
                input: 1,
                output: 1,
                cacheRead: 0,
                cacheCreation: 0,
              },
              messageCount: 1,
            },
          }) as never,
      );
      h.metadataStore.get.mockResolvedValue(null);
      h.handlers.register();

      const sessionIds = Array.from({ length: 12 }, (_, i) => `sess-${i}`);
      const result = await call<{
        sessionStats: Array<{ sessionId: string }>;
      }>(h, 'session:stats-batch', { sessionIds, workspacePath: WORKSPACE });

      expect(result.sessionStats).toHaveLength(12);
      expect(new Set(result.sessionStats.map((s) => s.sessionId))).toEqual(
        new Set(sessionIds),
      );
    });
  });

  // -------------------------------------------------------------------------
  // session:forkSession
  // -------------------------------------------------------------------------

  describe('session:forkSession', () => {
    it('delegates to SdkAgentAdapter.forkSession and remaps sessionId → newSessionId', async () => {
      const h = makeHarness();
      h.metadataStore.get.mockResolvedValue(
        makeMetadata({
          sessionId: VALID_SESSION_ID,
          workspaceId: WORKSPACE,
        }) as never,
      );
      h.sdkAdapter.forkSession.mockResolvedValue({
        sessionId: 'forked-uuid',
      } as never);
      h.handlers.register();

      const result = await call<{ newSessionId: string }>(
        h,
        'session:forkSession',
        {
          sessionId: VALID_SESSION_ID,
          upToMessageId: VALID_USER_MESSAGE_ID,
          title: 'Branch A',
        },
      );

      expect(h.sdkAdapter.forkSession).toHaveBeenCalledWith(
        VALID_SESSION_ID,
        VALID_USER_MESSAGE_ID,
        'Branch A',
      );
      expect(result.newSessionId).toBe('forked-uuid');
    });

    it('forwards undefined upToMessageId / title (optional params)', async () => {
      const h = makeHarness();
      h.metadataStore.get.mockResolvedValue(
        makeMetadata({
          sessionId: VALID_SESSION_ID,
          workspaceId: WORKSPACE,
        }) as never,
      );
      h.sdkAdapter.forkSession.mockResolvedValue({
        sessionId: 'forked-uuid',
      } as never);
      h.handlers.register();

      await call(h, 'session:forkSession', { sessionId: VALID_SESSION_ID });

      expect(h.sdkAdapter.forkSession).toHaveBeenCalledWith(
        VALID_SESSION_ID,
        undefined,
        undefined,
      );
    });

    it('captures + wraps adapter errors with "Failed to fork session:"', async () => {
      const h = makeHarness();
      h.metadataStore.get.mockResolvedValue(
        makeMetadata({
          sessionId: VALID_SESSION_ID,
          workspaceId: WORKSPACE,
        }) as never,
      );
      h.sdkAdapter.forkSession.mockRejectedValue(new Error('sdk boom'));
      h.handlers.register();

      const response = await callRaw(h, 'session:forkSession', {
        sessionId: VALID_SESSION_ID,
      });

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/Failed to fork session/);
      expect(response.error).toMatch(/sdk boom/);
      expect(h.sentry.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          errorSource: 'SessionRpcHandlers.registerForkSession',
        }),
      );
    });

    it('rejects fork with non-UUID sessionId (invalid-session-id code)', async () => {
      const h = makeHarness();
      h.handlers.register();

      const response = await callRaw(h, 'session:forkSession', {
        sessionId: 'not-a-uuid',
      });

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/invalid-session-id/);
      expect(h.sdkAdapter.forkSession).not.toHaveBeenCalled();
    });

    it('rejects fork when the session workspace is not in the active folders', async () => {
      const h = makeHarness({ workspaceFolders: [WORKSPACE] });
      // Metadata exists but points at a workspace not currently open.
      h.metadataStore.get.mockResolvedValue(
        makeMetadata({
          sessionId: VALID_SESSION_ID,
          workspaceId: '/some/other/workspace',
        }) as never,
      );
      h.handlers.register();

      const response = await callRaw(h, 'session:forkSession', {
        sessionId: VALID_SESSION_ID,
      });

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/unauthorized-workspace/);
      expect(h.sdkAdapter.forkSession).not.toHaveBeenCalled();
    });

    it('sanitizes fork title — strips Windows-illegal chars before calling adapter', async () => {
      const h = makeHarness();
      h.metadataStore.get.mockResolvedValue(
        makeMetadata({
          sessionId: VALID_SESSION_ID,
          workspaceId: WORKSPACE,
        }) as never,
      );
      h.sdkAdapter.forkSession.mockResolvedValue({
        sessionId: 'forked-uuid',
      } as never);
      h.handlers.register();

      await call(h, 'session:forkSession', {
        sessionId: VALID_SESSION_ID,
        title: 'bad/name:with*illegal?"chars<>|\\',
      });

      // All [\\/:*?"<>|] removed → "badnamewithillegalchars"
      expect(h.sdkAdapter.forkSession).toHaveBeenCalledWith(
        VALID_SESSION_ID,
        undefined,
        'badnamewithillegalchars',
      );
    });
  });

  // -------------------------------------------------------------------------
  // session:rewindFiles
  // -------------------------------------------------------------------------

  describe('session:rewindFiles', () => {
    it('delegates to SdkAgentAdapter.rewindFiles and returns the SDK result shape', async () => {
      const h = makeHarness();
      h.metadataStore.get.mockResolvedValue(
        makeMetadata({
          sessionId: VALID_SESSION_ID,
          workspaceId: WORKSPACE,
        }) as never,
      );
      h.sdkAdapter.rewindFiles.mockResolvedValue({
        canRewind: true,
        filesChanged: ['/a.ts', '/b.ts'],
        insertions: 10,
        deletions: 4,
      } as never);
      h.handlers.register();

      const result = await call<{
        canRewind: boolean;
        filesChanged?: string[];
        insertions?: number;
        deletions?: number;
      }>(h, 'session:rewindFiles', {
        sessionId: VALID_SESSION_ID,
        userMessageId: VALID_USER_MESSAGE_ID,
        dryRun: true,
      });

      expect(h.sdkAdapter.rewindFiles).toHaveBeenCalledWith(
        VALID_SESSION_ID,
        VALID_USER_MESSAGE_ID,
        true,
      );
      expect(result.canRewind).toBe(true);
      expect(result.filesChanged).toEqual(['/a.ts', '/b.ts']);
      expect(result.insertions).toBe(10);
      expect(result.deletions).toBe(4);
    });

    it('returns canRewind=false + error verbatim when checkpointing is disabled', async () => {
      const h = makeHarness();
      h.metadataStore.get.mockResolvedValue(
        makeMetadata({
          sessionId: VALID_SESSION_ID,
          workspaceId: WORKSPACE,
        }) as never,
      );
      h.sdkAdapter.rewindFiles.mockResolvedValue({
        canRewind: false,
        error: 'File checkpointing is disabled for this session',
      } as never);
      h.handlers.register();

      const result = await call<{ canRewind: boolean; error?: string }>(
        h,
        'session:rewindFiles',
        { sessionId: VALID_SESSION_ID, userMessageId: VALID_USER_MESSAGE_ID },
      );

      expect(result.canRewind).toBe(false);
      expect(result.error).toMatch(/checkpointing is disabled/);
    });

    it('translates the SDK\'s "not active" constraint into a stable session-not-active code', async () => {
      const h = makeHarness();
      h.metadataStore.get.mockResolvedValue(
        makeMetadata({
          sessionId: VALID_SESSION_ID,
          workspaceId: WORKSPACE,
        }) as never,
      );
      h.sdkAdapter.rewindFiles.mockRejectedValue(
        new Error(
          'Cannot rewind files: session dead-id is not active or has no live Query handle.',
        ),
      );
      h.handlers.register();

      const response = await callRaw(h, 'session:rewindFiles', {
        sessionId: VALID_SESSION_ID,
        userMessageId: VALID_USER_MESSAGE_ID,
      });

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/^session-not-active:/);
      expect(h.sentry.captureException).toHaveBeenCalledWith(
        expect.any(Error),
        expect.objectContaining({
          errorSource: 'SessionRpcHandlers.registerRewindFiles',
        }),
      );
    });

    it('wraps generic adapter errors with "Failed to rewind files:"', async () => {
      const h = makeHarness();
      h.metadataStore.get.mockResolvedValue(
        makeMetadata({
          sessionId: VALID_SESSION_ID,
          workspaceId: WORKSPACE,
        }) as never,
      );
      h.sdkAdapter.rewindFiles.mockRejectedValue(new Error('disk full'));
      h.handlers.register();

      const response = await callRaw(h, 'session:rewindFiles', {
        sessionId: VALID_SESSION_ID,
        userMessageId: VALID_USER_MESSAGE_ID,
      });

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/Failed to rewind files/);
      expect(response.error).toMatch(/disk full/);
    });

    it('rejects rewind when userMessageId contains a forward-slash path separator', async () => {
      const h = makeHarness();
      h.metadataStore.get.mockResolvedValue(
        makeMetadata({
          sessionId: VALID_SESSION_ID,
          workspaceId: WORKSPACE,
        }) as never,
      );
      h.handlers.register();

      const response = await callRaw(h, 'session:rewindFiles', {
        sessionId: VALID_SESSION_ID,
        userMessageId: 'msg/with/slashes',
      });

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/invalid-user-message-id/);
      expect(h.sdkAdapter.rewindFiles).not.toHaveBeenCalled();
    });
  });
});
