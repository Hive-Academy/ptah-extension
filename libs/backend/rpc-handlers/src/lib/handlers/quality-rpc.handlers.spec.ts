/**
 * QualityRpcHandlers — unit specs.
 *
 * Surface under test: three RPC methods
 * (`quality:getAssessment`, `quality:getHistory`, `quality:export`) that bridge
 * the frontend quality dashboard to `IProjectIntelligenceService` /
 * `IQualityHistoryService` / `IQualityExportService`.
 *
 * Behavioural contracts locked in here:
 *
 *   - Registration: `register()` wires all three methods into the mock
 *     RpcHandler.
 *
 *   - getAssessment: requires an open workspace. `forceRefresh=true` invalidates
 *     the cache BEFORE calling `getIntelligence()`. The handler infers
 *     `fromCache=true` when the call returns in <50ms AND `forceRefresh` was
 *     not set — so the spec seeds that timing by having `getIntelligence`
 *     resolve synchronously. Fresh (non-cached) results are also recorded in
 *     history, and a failure in history recording MUST NOT block the response
 *     (best-effort side-effect).
 *
 *   - getHistory: forwards the optional `limit` parameter through to the
 *     history service and returns `{ entries }`.
 *
 *   - export: rejects invalid formats via the inline allow-list, rejects empty
 *     workspace, hands the right filename/mime/buffer to
 *     `ISaveDialogProvider.showSaveAndWrite`, and reports `saved=false` when
 *     the dialog returns null (user cancelled). Filename carries a YYYY-MM-DD
 *     datestamp.
 *
 *   - Error paths: handlers THROW from their RPC method (not a structured
 *     `{ success: false }` response). The mock RpcHandler serialises the throw
 *     into `{ success:false, error }` — we assert against that shape. Sentry
 *     MUST receive every non-validation exception.
 *
 * Mocking posture: direct constructor injection, narrow
 * `jest.Mocked<Pick<T, ...>>` surfaces, no `as any` casts.
 *
 * Source-under-test:
 *   `libs/backend/rpc-handlers/src/lib/handlers/quality-rpc.handlers.ts`
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
import type {
  ISaveDialogProvider,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  createMockWorkspaceProvider,
  type MockWorkspaceProvider,
} from '@ptah-extension/platform-core/testing';
import type {
  IProjectIntelligenceService,
  IQualityExportService,
  IQualityHistoryService,
} from '@ptah-extension/workspace-intelligence';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

import { QualityRpcHandlers } from './quality-rpc.handlers';

// ---------------------------------------------------------------------------
// Narrow mock surfaces
// ---------------------------------------------------------------------------

type MockIntelligenceService = jest.Mocked<
  Pick<IProjectIntelligenceService, 'getIntelligence' | 'invalidateCache'>
>;

function createMockIntelligenceService(): MockIntelligenceService {
  return {
    getIntelligence: jest.fn(),
    invalidateCache: jest.fn(),
  } as unknown as MockIntelligenceService;
}

type MockHistoryService = jest.Mocked<
  Pick<IQualityHistoryService, 'recordAssessment' | 'getHistory'>
>;

function createMockHistoryService(): MockHistoryService {
  return {
    recordAssessment: jest.fn().mockResolvedValue(undefined),
    getHistory: jest.fn().mockReturnValue([]),
  };
}

type MockExportService = jest.Mocked<
  Pick<IQualityExportService, 'exportMarkdown' | 'exportJson' | 'exportCsv'>
>;

function createMockExportService(): MockExportService {
  return {
    exportMarkdown: jest.fn().mockReturnValue('# Quality Report'),
    exportJson: jest.fn().mockReturnValue('{"score":42}'),
    exportCsv: jest.fn().mockReturnValue('type,severity\n'),
  };
}

type MockSaveDialog = jest.Mocked<
  Pick<ISaveDialogProvider, 'showSaveAndWrite'>
>;

function createMockSaveDialog(): MockSaveDialog {
  return { showSaveAndWrite: jest.fn() };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Minimal ProjectIntelligence fixture — only the fields the handler reads on
 * the hot path (`qualityAssessment.score`, `qualityAssessment.antiPatterns`).
 * Everything else is stubbed with the permissive `unknown` cast because the
 * handler treats it as an opaque pass-through to the export service.
 */
function makeIntelligence(
  overrides: { score?: number; antiPatternCount?: number } = {},
) {
  const score = overrides.score ?? 75;
  const antiPatterns = Array.from(
    { length: overrides.antiPatternCount ?? 0 },
    (_, i) => ({ type: `pattern-${i}` }),
  );
  return {
    qualityAssessment: {
      score,
      antiPatterns,
      gaps: [],
      strengths: [],
    },
    workspaceContext: { projectType: 'unknown' },
    prescriptiveGuidance: { recommendations: [] },
  } as unknown as Awaited<
    ReturnType<IProjectIntelligenceService['getIntelligence']>
  >;
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

interface Harness {
  handlers: QualityRpcHandlers;
  logger: MockLogger;
  rpcHandler: MockRpcHandler;
  intelligence: MockIntelligenceService;
  history: MockHistoryService;
  exporter: MockExportService;
  workspace: MockWorkspaceProvider;
  saveDialog: MockSaveDialog;
  sentry: MockSentryService;
}

function makeHarness(
  opts: { workspaceRoot?: string | undefined } = {},
): Harness {
  const logger = createMockLogger();
  const rpcHandler = createMockRpcHandler();
  const intelligence = createMockIntelligenceService();
  const history = createMockHistoryService();
  const exporter = createMockExportService();
  const workspace = createMockWorkspaceProvider({
    folders:
      opts.workspaceRoot === undefined
        ? ['/fake/workspace']
        : opts.workspaceRoot === ''
          ? []
          : [opts.workspaceRoot],
  });
  const saveDialog = createMockSaveDialog();
  const sentry = createMockSentryService();

  const handlers = new QualityRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as RpcHandler,
    intelligence as unknown as IProjectIntelligenceService,
    history as unknown as IQualityHistoryService,
    exporter as unknown as IQualityExportService,
    workspace as unknown as IWorkspaceProvider,
    saveDialog as unknown as ISaveDialogProvider,
    sentry as unknown as SentryService,
  );

  return {
    handlers,
    logger,
    rpcHandler,
    intelligence,
    history,
    exporter,
    workspace,
    saveDialog,
    sentry,
  };
}

/** Drive an RPC method through the MockRpcHandler wiring. */
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
  return (await h.rpcHandler.handleMessage({
    method,
    params: params as Record<string, unknown>,
    correlationId: `corr-${method}`,
  })) as { success: boolean; data?: unknown; error?: string };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QualityRpcHandlers', () => {
  describe('register()', () => {
    it('registers all three quality RPC methods', () => {
      const h = makeHarness();
      h.handlers.register();

      expect(h.rpcHandler.getRegisteredMethods().sort()).toEqual(
        [
          'quality:getAssessment',
          'quality:getHistory',
          'quality:export',
        ].sort(),
      );
    });
  });

  // -------------------------------------------------------------------------
  // quality:getAssessment
  // -------------------------------------------------------------------------

  describe('quality:getAssessment', () => {
    it('rejects when no workspace folder is open', async () => {
      const h = makeHarness({ workspaceRoot: '' });
      h.handlers.register();

      const response = await callRaw(h, 'quality:getAssessment', {});

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/no workspace folder open/i);
      expect(h.intelligence.getIntelligence).not.toHaveBeenCalled();
      expect(h.sentry.captureException).toHaveBeenCalled();
    });

    it('invalidates the cache first when forceRefresh=true', async () => {
      const h = makeHarness({ workspaceRoot: '/proj' });
      h.intelligence.getIntelligence.mockResolvedValue(makeIntelligence());
      h.handlers.register();

      await call(h, 'quality:getAssessment', { forceRefresh: true });

      // Call order matters — invalidate must happen before getIntelligence.
      const invalidateOrder =
        h.intelligence.invalidateCache.mock.invocationCallOrder[0];
      const getOrder =
        h.intelligence.getIntelligence.mock.invocationCallOrder[0];
      expect(invalidateOrder).toBeLessThan(getOrder);
      expect(h.intelligence.invalidateCache).toHaveBeenCalledWith('/proj');
    });

    it('does NOT invalidate cache when forceRefresh is omitted', async () => {
      const h = makeHarness({ workspaceRoot: '/proj' });
      h.intelligence.getIntelligence.mockResolvedValue(makeIntelligence());
      h.handlers.register();

      await call(h, 'quality:getAssessment', {});

      expect(h.intelligence.invalidateCache).not.toHaveBeenCalled();
    });

    it('records fresh (non-cached) results in history', async () => {
      const h = makeHarness({ workspaceRoot: '/proj' });
      // Simulate a "fresh" call that takes more than 50ms so the handler's
      // call-duration heuristic marks fromCache=false.
      h.intelligence.getIntelligence.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(makeIntelligence({ score: 88 })), 60),
          ),
      );
      h.handlers.register();

      const result = await call<{ fromCache: boolean }>(
        h,
        'quality:getAssessment',
        { forceRefresh: true },
      );

      expect(result.fromCache).toBe(false);
      expect(h.history.recordAssessment).toHaveBeenCalledTimes(1);
    });

    it('skips history recording when the result was cached', async () => {
      const h = makeHarness({ workspaceRoot: '/proj' });
      // No forceRefresh + fast return (<50ms) → fromCache=true.
      h.intelligence.getIntelligence.mockResolvedValue(makeIntelligence());
      h.handlers.register();

      const result = await call<{ fromCache: boolean }>(
        h,
        'quality:getAssessment',
        {},
      );

      expect(result.fromCache).toBe(true);
      expect(h.history.recordAssessment).not.toHaveBeenCalled();
    });

    it('does NOT fail the response when history recording throws', async () => {
      const h = makeHarness({ workspaceRoot: '/proj' });
      h.intelligence.getIntelligence.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(makeIntelligence()), 60),
          ),
      );
      h.history.recordAssessment.mockRejectedValue(new Error('disk full'));
      h.handlers.register();

      const result = await call<{ fromCache: boolean }>(
        h,
        'quality:getAssessment',
        { forceRefresh: true },
      );

      // Response still succeeds — history is best-effort.
      expect(result.fromCache).toBe(false);
      // And the warning must be logged so the failure is observable in triage.
      expect(h.logger.warn).toHaveBeenCalled();
    });

    it('captures unexpected intelligence-service failures to Sentry', async () => {
      const h = makeHarness({ workspaceRoot: '/proj' });
      h.intelligence.getIntelligence.mockRejectedValue(new Error('boom'));
      h.handlers.register();

      const response = await callRaw(h, 'quality:getAssessment', {});

      expect(response.success).toBe(false);
      expect(response.error).toBe('boom');
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // quality:getHistory
  // -------------------------------------------------------------------------

  describe('quality:getHistory', () => {
    it('forwards the limit parameter and wraps the result', async () => {
      const h = makeHarness();
      h.history.getHistory.mockReturnValue([
        {
          id: 'entry-1',
          timestamp: 1_700_000_000_000,
          score: 80,
          antiPatternCount: 2,
        } as unknown as ReturnType<IQualityHistoryService['getHistory']>[0],
      ]);
      h.handlers.register();

      const result = await call<{ entries: Array<{ id: string }> }>(
        h,
        'quality:getHistory',
        { limit: 5 },
      );

      expect(h.history.getHistory).toHaveBeenCalledWith(5);
      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].id).toBe('entry-1');
    });

    it('passes undefined through when no limit is provided', async () => {
      const h = makeHarness();
      h.handlers.register();

      await call(h, 'quality:getHistory', {});

      expect(h.history.getHistory).toHaveBeenCalledWith(undefined);
    });

    it('captures history-service failures to Sentry', async () => {
      const h = makeHarness();
      h.history.getHistory.mockImplementation(() => {
        throw new Error('storage corrupt');
      });
      h.handlers.register();

      const response = await callRaw(h, 'quality:getHistory', {});

      expect(response.success).toBe(false);
      expect(response.error).toBe('storage corrupt');
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // quality:export
  // -------------------------------------------------------------------------

  describe('quality:export', () => {
    it.each(['markdown', 'json', 'csv'] as const)(
      'accepts the "%s" format and routes to the correct exporter',
      async (format) => {
        const h = makeHarness({ workspaceRoot: '/proj' });
        h.intelligence.getIntelligence.mockResolvedValue(makeIntelligence());
        h.saveDialog.showSaveAndWrite.mockResolvedValue('/tmp/out.ext');
        h.handlers.register();

        const result = await call<{
          content: string;
          filename: string;
          mimeType: string;
          saved: boolean;
          filePath?: string;
        }>(h, 'quality:export', { format });

        expect(result.saved).toBe(true);
        expect(result.filePath).toBe('/tmp/out.ext');
        const extension =
          format === 'markdown' ? 'md' : format === 'json' ? 'json' : 'csv';
        expect(result.filename).toMatch(
          new RegExp(`^quality-report-\\d{4}-\\d{2}-\\d{2}\\.${extension}$`),
        );
        const mime =
          format === 'markdown'
            ? 'text/markdown'
            : format === 'json'
              ? 'application/json'
              : 'text/csv';
        expect(result.mimeType).toBe(mime);
      },
    );

    it.each(['xml', '', undefined, 'pdf'])(
      'rejects invalid format %p',
      async (format) => {
        const h = makeHarness({ workspaceRoot: '/proj' });
        h.handlers.register();

        const response = await callRaw(h, 'quality:export', { format });

        expect(response.success).toBe(false);
        expect(response.error).toMatch(/invalid export format/i);
        expect(h.exporter.exportMarkdown).not.toHaveBeenCalled();
        expect(h.saveDialog.showSaveAndWrite).not.toHaveBeenCalled();
      },
    );

    it('rejects when no workspace is open', async () => {
      const h = makeHarness({ workspaceRoot: '' });
      h.handlers.register();

      const response = await callRaw(h, 'quality:export', {
        format: 'markdown',
      });

      expect(response.success).toBe(false);
      expect(response.error).toMatch(/no workspace folder/i);
      expect(h.intelligence.getIntelligence).not.toHaveBeenCalled();
    });

    it('hands the generated content to the save dialog as a Buffer', async () => {
      const h = makeHarness({ workspaceRoot: '/proj' });
      h.intelligence.getIntelligence.mockResolvedValue(makeIntelligence());
      h.exporter.exportJson.mockReturnValue('{"custom":true}');
      h.saveDialog.showSaveAndWrite.mockResolvedValue('/tmp/quality.json');
      h.handlers.register();

      await call(h, 'quality:export', { format: 'json' });

      expect(h.saveDialog.showSaveAndWrite).toHaveBeenCalledTimes(1);
      const [opts] = h.saveDialog.showSaveAndWrite.mock.calls[0];
      expect(opts.title).toBe('Save Quality Report');
      expect(opts.filters).toEqual({ 'JSON Files': ['json'] });
      expect(Buffer.isBuffer(opts.content)).toBe(true);
      expect((opts.content as Buffer).toString('utf-8')).toBe(
        '{"custom":true}',
      );
    });

    it('reports saved=false when the user cancels the save dialog', async () => {
      const h = makeHarness({ workspaceRoot: '/proj' });
      h.intelligence.getIntelligence.mockResolvedValue(makeIntelligence());
      h.saveDialog.showSaveAndWrite.mockResolvedValue(null);
      h.handlers.register();

      const result = await call<{ saved: boolean; filePath?: string }>(
        h,
        'quality:export',
        { format: 'csv' },
      );

      expect(result.saved).toBe(false);
      expect(result.filePath).toBeUndefined();
    });

    it('captures unexpected exporter failures to Sentry', async () => {
      const h = makeHarness({ workspaceRoot: '/proj' });
      h.intelligence.getIntelligence.mockResolvedValue(makeIntelligence());
      h.exporter.exportMarkdown.mockImplementation(() => {
        throw new Error('render error');
      });
      h.handlers.register();

      const response = await callRaw(h, 'quality:export', {
        format: 'markdown',
      });

      expect(response.success).toBe(false);
      expect(response.error).toBe('render error');
      expect(h.sentry.captureException).toHaveBeenCalled();
    });
  });
});
