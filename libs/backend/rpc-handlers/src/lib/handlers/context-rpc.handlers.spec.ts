/**
 * ContextRpcHandlers — unit specs.
 *
 * Surface under test: two RPC methods (`context:getAllFiles`,
 * `context:getFileSuggestions`) that proxy into ContextOrchestrationService.
 *
 * Behavioural contracts locked in here:
 *   - Registration: `register()` wires both methods into the mock RpcHandler.
 *   - Params pass-through: `includeImages` / `limit` / `query` are forwarded
 *     to the orchestration service verbatim — the handler MUST NOT mutate,
 *     default, or bound them (defaulting is the orchestration layer's job).
 *   - Undefined params: both handlers tolerate `undefined` / `{}` params and
 *     simply hand them through; the orchestration service decides the
 *     defaults.
 *   - Error wrapping: thrown service errors are captured to Sentry and
 *     re-thrown as a wrapped `Error("Failed to get all files: ...")` /
 *     `"Failed to get file suggestions: ..."` so the UI receives a
 *     human-readable message rather than a raw stack string.
 *
 * Mocking posture: direct constructor injection, narrow
 * `jest.Mocked<Pick<T,...>>` surfaces, no `as any` casts.
 *
 * Source-under-test:
 *   `libs/backend/rpc-handlers/src/lib/handlers/context-rpc.handlers.ts`
 */

import 'reflect-metadata';

import type { Logger, SentryService } from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  createMockSentryService,
  type MockRpcHandler,
  type MockSentryService,
} from '@ptah-extension/vscode-core/testing';
import type {
  ContextGetAllFilesParams,
  ContextGetFileSuggestionsParams,
} from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { ContextRpcHandlers } from './context-rpc.handlers';

// ---------------------------------------------------------------------------
// Narrow mock surfaces — only what the handler touches.
// ---------------------------------------------------------------------------

interface ContextOrchestrationService {
  getAllFiles(params: ContextGetAllFilesParams): Promise<unknown>;
  getFileSuggestions(params: ContextGetFileSuggestionsParams): Promise<unknown>;
}

type MockContextOrchestration = jest.Mocked<ContextOrchestrationService>;

function createMockContextOrchestration(): MockContextOrchestration {
  return {
    getAllFiles: jest.fn().mockResolvedValue({ files: [] }),
    getFileSuggestions: jest.fn().mockResolvedValue({ files: [] }),
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  handlers: ContextRpcHandlers;
  logger: MockLogger;
  rpcHandler: MockRpcHandler;
  orchestration: MockContextOrchestration;
  sentry: MockSentryService;
}

function makeHarness(): Harness {
  const logger = createMockLogger();
  const rpcHandler = createMockRpcHandler();
  const orchestration = createMockContextOrchestration();
  const sentry = createMockSentryService();

  const handlers = new ContextRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as import('@ptah-extension/vscode-core').RpcHandler,
    orchestration,
    sentry as unknown as SentryService,
  );

  return { handlers, logger, rpcHandler, orchestration, sentry };
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

describe('ContextRpcHandlers', () => {
  describe('register()', () => {
    it('registers both context RPC methods', () => {
      const h = makeHarness();
      h.handlers.register();

      expect(h.rpcHandler.getRegisteredMethods().sort()).toEqual(
        ['context:getAllFiles', 'context:getFileSuggestions'].sort(),
      );
    });
  });

  // -------------------------------------------------------------------------
  // context:getAllFiles
  // -------------------------------------------------------------------------

  describe('context:getAllFiles', () => {
    it('forwards includeImages + limit to the orchestration service verbatim', async () => {
      const h = makeHarness();
      const files = [
        {
          uri: 'file:///a.ts',
          fsPath: '/a.ts',
          relativePath: 'a.ts',
          fileName: 'a.ts',
          fileType: 'ts',
          size: 10,
          lastModified: 0,
          isDirectory: false,
        },
      ];
      h.orchestration.getAllFiles.mockResolvedValue({ files });
      h.handlers.register();

      const result = await call<{ files: typeof files }>(
        h,
        'context:getAllFiles',
        {
          includeImages: true,
          limit: 250,
        },
      );

      expect(result.files).toEqual(files);
      expect(h.orchestration.getAllFiles).toHaveBeenCalledWith({
        includeImages: true,
        limit: 250,
      });
    });

    it('tolerates omitted params (orchestration picks the defaults)', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'context:getAllFiles', {});

      // Handler MUST NOT inject defaults — that is the orchestration layer's
      // job. Assert the empty object is handed through exactly.
      expect(h.orchestration.getAllFiles).toHaveBeenCalledWith({});
    });

    it('wraps orchestration errors with a human-readable prefix and captures to Sentry', async () => {
      const h = makeHarness();
      h.orchestration.getAllFiles.mockRejectedValue(
        new Error('fs denied: workspace closed'),
      );
      h.handlers.register();

      const response = await h.rpcHandler.handleMessage({
        method: 'context:getAllFiles',
        params: {},
        correlationId: 'corr',
      });

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/failed to get all files/i);
      expect(response.error).toMatch(/workspace closed/);
      expect(h.sentry.captureException).toHaveBeenCalled();
    });

    it('handles non-Error throws without losing the error signal', async () => {
      const h = makeHarness();
      h.orchestration.getAllFiles.mockRejectedValue('raw-string-throw');
      h.handlers.register();

      const response = await h.rpcHandler.handleMessage({
        method: 'context:getAllFiles',
        params: {},
        correlationId: 'corr',
      });

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/failed to get all files/i);
      expect(response.error).toMatch(/raw-string-throw/);
    });
  });

  // -------------------------------------------------------------------------
  // context:getFileSuggestions
  // -------------------------------------------------------------------------

  describe('context:getFileSuggestions', () => {
    it('forwards query + limit to the orchestration service verbatim', async () => {
      const h = makeHarness();
      const files = [
        {
          uri: 'file:///b.ts',
          fsPath: '/b.ts',
          relativePath: 'b.ts',
          fileName: 'b.ts',
          fileType: 'ts',
          size: 10,
          lastModified: 0,
          isDirectory: false,
        },
      ];
      h.orchestration.getFileSuggestions.mockResolvedValue({ files });
      h.handlers.register();

      const result = await call<{ files: typeof files }>(
        h,
        'context:getFileSuggestions',
        {
          query: 'b.',
          limit: 5,
        },
      );

      expect(result.files).toEqual(files);
      expect(h.orchestration.getFileSuggestions).toHaveBeenCalledWith({
        query: 'b.',
        limit: 5,
      });
    });

    it('tolerates omitted params (orchestration decides the default query)', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'context:getFileSuggestions', {});

      expect(h.orchestration.getFileSuggestions).toHaveBeenCalledWith({});
    });

    it('wraps orchestration errors with a human-readable prefix and captures to Sentry', async () => {
      const h = makeHarness();
      h.orchestration.getFileSuggestions.mockRejectedValue(
        new Error('index not ready'),
      );
      h.handlers.register();

      const response = await h.rpcHandler.handleMessage({
        method: 'context:getFileSuggestions',
        params: { query: 'x' },
        correlationId: 'corr',
      });

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/failed to get file suggestions/i);
      expect(response.error).toMatch(/index not ready/);
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // TASK_2026_200 — explicit workspace scoping (criterion 9) + Zod boundary
  // -------------------------------------------------------------------------

  describe('workspaceRoot scoping', () => {
    it('forwards workspaceRoot to the orchestration service on context:getAllFiles', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'context:getAllFiles', {
        includeImages: false,
        limit: 1000,
        workspaceRoot: 'D:\\proj-b',
      });

      expect(h.orchestration.getAllFiles).toHaveBeenCalledWith({
        includeImages: false,
        limit: 1000,
        workspaceRoot: 'D:\\proj-b',
      });
    });

    it('forwards workspaceRoot to the orchestration service on context:getFileSuggestions', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'context:getFileSuggestions', {
        query: 'auth',
        workspaceRoot: '/proj-b',
      });

      expect(h.orchestration.getFileSuggestions).toHaveBeenCalledWith({
        query: 'auth',
        workspaceRoot: '/proj-b',
      });
    });

    it('omitting workspaceRoot leaves the payload untouched (optional-param regression guard)', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'context:getAllFiles', { limit: 50 });

      const [payload] = h.orchestration.getAllFiles.mock.calls[0];
      expect(payload).toEqual({ limit: 50 });
      expect('workspaceRoot' in payload).toBe(false);
    });
  });

  describe('Zod boundary rejection', () => {
    it.each([
      ['empty string', ''],
      ['number', 42],
      ['null', null],
      ['array', ['D:\\x']],
    ])(
      'rejects a %s workspaceRoot on context:getAllFiles without calling orchestration',
      async (_label, workspaceRoot) => {
        const h = makeHarness();
        h.handlers.register();

        const response = await h.rpcHandler.handleMessage({
          method: 'context:getAllFiles',
          params: { workspaceRoot } as Record<string, unknown>,
          correlationId: 'corr',
        });

        expect(response.success).toBe(false);
        expect(response.error).toMatch(/invalid context:getAllFiles/i);
        // Rejected at the boundary — the service must never see it.
        expect(h.orchestration.getAllFiles).not.toHaveBeenCalled();
      },
    );

    it('rejects a malformed workspaceRoot on context:getFileSuggestions without calling orchestration', async () => {
      const h = makeHarness();
      h.handlers.register();

      const response = await h.rpcHandler.handleMessage({
        method: 'context:getFileSuggestions',
        params: { workspaceRoot: '' },
        correlationId: 'corr',
      });

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/invalid context:getFileSuggestions/i);
      expect(h.orchestration.getFileSuggestions).not.toHaveBeenCalled();
    });

    it('does not report a caller-side validation failure to Sentry as a backend error', async () => {
      const h = makeHarness();
      h.handlers.register();

      await h.rpcHandler.handleMessage({
        method: 'context:getAllFiles',
        params: { workspaceRoot: '' },
        correlationId: 'corr',
      });

      expect(h.sentry.captureException).not.toHaveBeenCalled();
    });
  });
});
