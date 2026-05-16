/**
 * Unit tests for IndexingRpcHandlers.
 *
 * Verifies that each of the 8 RPC methods correctly delegates to
 * IndexingControlService and returns the expected result shape.
 * All dependencies are mocked — no real SQLite or CodeSymbolIndexer.
 */

import 'reflect-metadata';
import { container } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import { MEMORY_TOKENS } from '@ptah-extension/memory-curator';
import type { IndexingStatus } from '@ptah-extension/memory-curator';
import type { RpcMethodName } from '@ptah-extension/shared';
import { IndexingRpcHandlers } from './indexing-rpc.handlers';

// ---- Helpers -----------------------------------------------------------------

function makeStatus(overrides: Partial<IndexingStatus> = {}): IndexingStatus {
  return {
    state: 'never-indexed',
    workspaceFingerprint: 'fp-abc',
    gitHeadSha: null,
    currentGitHeadSha: null,
    lastIndexedAt: null,
    symbolsEnabled: true,
    memoryEnabled: true,
    symbolsCursor: null,
    disclosureAcknowledgedAt: null,
    lastDismissedStaleSha: null,
    errorMessage: null,
    ...overrides,
  };
}

// ---- Mock factories ----------------------------------------------------------

function makeLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    log: jest.fn(),
  };
}

function makeRpcHandler() {
  const methods = new Map<string, (params: unknown) => Promise<unknown>>();
  return {
    registerMethod: jest.fn(
      (name: string, fn: (p: unknown) => Promise<unknown>) => {
        methods.set(name, fn);
      },
    ),
    call: async (name: string, params: unknown) => {
      const fn = methods.get(name);
      if (!fn) throw new Error(`No handler for ${name}`);
      return fn(params);
    },
  };
}

function makeIndexingControlService(statusOverride?: Partial<IndexingStatus>) {
  return {
    getStatus: jest.fn().mockResolvedValue(makeStatus(statusOverride)),
    start: jest.fn().mockResolvedValue(undefined),
    pause: jest.fn(),
    resume: jest.fn().mockResolvedValue(undefined),
    cancel: jest.fn(),
    setPipelineEnabled: jest.fn().mockResolvedValue(undefined),
    dismissStale: jest.fn().mockResolvedValue(undefined),
    acknowledgeDisclosure: jest.fn().mockResolvedValue(undefined),
    markStale: jest.fn().mockResolvedValue(undefined),
    setSymbolWatcher: jest.fn(),
    startAutoIndex: jest.fn().mockResolvedValue(undefined),
    onProgress: jest.fn().mockReturnValue(() => undefined),
    evaluateBootStrategy: jest.fn().mockResolvedValue('skip'),
  };
}

// ---- Test setup -------------------------------------------------------------

function buildHandlers() {
  const logger = makeLogger();
  const rpcHandler = makeRpcHandler();
  const indexingControl = makeIndexingControlService();

  const childContainer = container.createChildContainer();
  childContainer.registerInstance(TOKENS.LOGGER, logger);
  childContainer.registerInstance(TOKENS.RPC_HANDLER, rpcHandler);
  childContainer.registerInstance(
    MEMORY_TOKENS.INDEXING_CONTROL,
    indexingControl,
  );
  childContainer.register(IndexingRpcHandlers, {
    useClass: IndexingRpcHandlers,
  });

  const handlers = childContainer.resolve(IndexingRpcHandlers);
  handlers.register();

  return { handlers, rpcHandler, indexingControl, logger };
}

// ---- Tests -------------------------------------------------------------------

describe('IndexingRpcHandlers', () => {
  describe('METHODS tuple', () => {
    it('satisfies readonly RpcMethodName[] (compile-time verified by satisfies keyword)', () => {
      // If the satisfies constraint fails the file won't compile. This runtime
      // check is belt-and-suspenders to confirm the tuple is populated.
      expect(IndexingRpcHandlers.METHODS).toHaveLength(8);
      const expected: readonly RpcMethodName[] = [
        'indexing:getStatus',
        'indexing:start',
        'indexing:pause',
        'indexing:resume',
        'indexing:cancel',
        'indexing:setPipelineEnabled',
        'indexing:dismissStale',
        'indexing:acknowledgeDisclosure',
      ];
      expect(IndexingRpcHandlers.METHODS).toEqual(expected);
    });

    it('registers exactly 8 RPC methods', () => {
      const { rpcHandler } = buildHandlers();
      expect(rpcHandler.registerMethod).toHaveBeenCalledTimes(8);
    });
  });

  describe('indexing:getStatus', () => {
    it('returns IndexingStatusWire from IndexingControlService.getStatus', async () => {
      const { rpcHandler, indexingControl } = buildHandlers();
      indexingControl.getStatus.mockResolvedValueOnce(
        makeStatus({ state: 'indexed', lastIndexedAt: 1234567890 }),
      );

      const result = await rpcHandler.call('indexing:getStatus', {
        workspaceRoot: '/workspace',
      });

      expect(indexingControl.getStatus).toHaveBeenCalledWith('/workspace');
      expect(result).toMatchObject({
        status: {
          state: 'indexed',
          lastIndexedAt: 1234567890,
        },
      });
    });

    it('returns empty status when workspaceRoot is missing', async () => {
      const { rpcHandler } = buildHandlers();
      const result = await rpcHandler.call('indexing:getStatus', {});
      expect(result).toMatchObject({ status: { state: 'never-indexed' } });
    });
  });

  describe('indexing:start', () => {
    it('delegates to IndexingControlService.start and returns accepted:true', async () => {
      const { rpcHandler, indexingControl, handlers } = buildHandlers();
      indexingControl.getStatus.mockResolvedValueOnce(
        makeStatus({ state: 'indexing' }),
      );
      handlers.setRunDeps({
        runSymbols: jest.fn().mockResolvedValue(undefined),
      });

      const result = await rpcHandler.call('indexing:start', {
        workspaceRoot: '/workspace',
      });

      expect(result).toMatchObject({ accepted: true, state: 'indexing' });
    });

    it('passes force:true when requested (Re-index button path)', async () => {
      const { rpcHandler, indexingControl, handlers } = buildHandlers();
      indexingControl.getStatus.mockResolvedValueOnce(
        makeStatus({ state: 'indexing' }),
      );
      const runSymbols = jest.fn().mockResolvedValue(undefined);
      handlers.setRunDeps({ runSymbols });

      await rpcHandler.call('indexing:start', {
        workspaceRoot: '/workspace',
        force: true,
      });

      // Allow the fire-and-forget promise to settle
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(indexingControl.start).toHaveBeenCalledWith(
        undefined,
        '/workspace',
        expect.anything(),
        { force: true },
      );
    });

    it('passes pipeline filter when provided', async () => {
      const { rpcHandler, indexingControl, handlers } = buildHandlers();
      indexingControl.getStatus.mockResolvedValueOnce(
        makeStatus({ state: 'indexing' }),
      );
      handlers.setRunDeps({
        runSymbols: jest.fn().mockResolvedValue(undefined),
      });

      await rpcHandler.call('indexing:start', {
        workspaceRoot: '/workspace',
        pipeline: 'symbols',
      });

      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(indexingControl.start).toHaveBeenCalledWith(
        'symbols',
        '/workspace',
        expect.anything(),
        { force: undefined },
      );
    });

    it('returns accepted:false when runDeps not set', async () => {
      const { rpcHandler } = buildHandlers();
      // handlers.setRunDeps is NOT called
      const result = await rpcHandler.call('indexing:start', {
        workspaceRoot: '/workspace',
      });
      expect(result).toMatchObject({ accepted: false });
    });

    it('returns accepted:false when workspaceRoot is missing', async () => {
      const { rpcHandler } = buildHandlers();
      const result = await rpcHandler.call('indexing:start', {});
      expect(result).toMatchObject({ accepted: false });
    });
  });

  describe('indexing:pause', () => {
    it('calls IndexingControlService.pause and returns accepted:true', async () => {
      const { rpcHandler, indexingControl } = buildHandlers();

      const result = await rpcHandler.call('indexing:pause', {});

      expect(indexingControl.pause).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ accepted: true, state: 'paused' });
    });

    it('returns accepted:false when pause throws', async () => {
      const { rpcHandler, indexingControl } = buildHandlers();
      indexingControl.pause.mockImplementationOnce(() => {
        throw new Error('no active run');
      });

      const result = await rpcHandler.call('indexing:pause', {});
      expect(result).toMatchObject({ accepted: false, state: 'error' });
    });
  });

  describe('indexing:resume', () => {
    it('calls IndexingControlService.resume and returns accepted:true', async () => {
      const { rpcHandler, indexingControl, handlers } = buildHandlers();
      indexingControl.getStatus.mockResolvedValueOnce(
        makeStatus({ state: 'indexing' }),
      );
      handlers.setRunDeps({
        runSymbols: jest.fn().mockResolvedValue(undefined),
      });

      const result = await rpcHandler.call('indexing:resume', {
        workspaceRoot: '/workspace',
      });

      expect(result).toMatchObject({ accepted: true, state: 'indexing' });
    });

    it('returns accepted:false when runDeps not set', async () => {
      const { rpcHandler } = buildHandlers();
      const result = await rpcHandler.call('indexing:resume', {
        workspaceRoot: '/workspace',
      });
      expect(result).toMatchObject({ accepted: false });
    });

    it('returns accepted:false when workspaceRoot is missing', async () => {
      const { rpcHandler } = buildHandlers();
      const result = await rpcHandler.call('indexing:resume', {});
      expect(result).toMatchObject({ accepted: false });
    });
  });

  describe('indexing:cancel', () => {
    it('calls IndexingControlService.cancel and returns accepted:true', async () => {
      const { rpcHandler, indexingControl } = buildHandlers();

      const result = await rpcHandler.call('indexing:cancel', {});

      expect(indexingControl.cancel).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({ accepted: true, state: 'never-indexed' });
    });

    it('returns accepted:false when cancel throws', async () => {
      const { rpcHandler, indexingControl } = buildHandlers();
      indexingControl.cancel.mockImplementationOnce(() => {
        throw new Error('unexpected');
      });

      const result = await rpcHandler.call('indexing:cancel', {});
      expect(result).toMatchObject({ accepted: false, state: 'error' });
    });
  });

  describe('indexing:setPipelineEnabled', () => {
    it('calls IndexingControlService.setPipelineEnabled and returns updated flags', async () => {
      const { rpcHandler, indexingControl } = buildHandlers();
      indexingControl.getStatus.mockResolvedValueOnce(
        makeStatus({ symbolsEnabled: false, memoryEnabled: true }),
      );

      const result = await rpcHandler.call('indexing:setPipelineEnabled', {
        workspaceRoot: '/workspace',
        pipeline: 'symbols',
        enabled: false,
      });

      expect(indexingControl.setPipelineEnabled).toHaveBeenCalledWith(
        'symbols',
        false,
        '/workspace',
      );
      expect(result).toMatchObject({
        applied: true,
        symbolsEnabled: false,
        memoryEnabled: true,
      });
    });

    it('returns applied:false when params are missing', async () => {
      const { rpcHandler } = buildHandlers();
      const result = await rpcHandler.call('indexing:setPipelineEnabled', {});
      expect(result).toMatchObject({ applied: false });
    });
  });

  describe('indexing:dismissStale', () => {
    it('calls IndexingControlService.dismissStale and returns dismissed SHA', async () => {
      const { rpcHandler, indexingControl } = buildHandlers();
      indexingControl.getStatus.mockResolvedValueOnce(
        makeStatus({ lastDismissedStaleSha: 'abc123' }),
      );

      const result = await rpcHandler.call('indexing:dismissStale', {
        workspaceRoot: '/workspace',
      });

      expect(indexingControl.dismissStale).toHaveBeenCalledWith('/workspace');
      expect(result).toMatchObject({ accepted: true, dismissedSha: 'abc123' });
    });

    it('returns accepted:false when workspaceRoot is missing', async () => {
      const { rpcHandler } = buildHandlers();
      const result = await rpcHandler.call('indexing:dismissStale', {});
      expect(result).toMatchObject({ accepted: false });
    });
  });

  describe('indexing:acknowledgeDisclosure', () => {
    it('calls IndexingControlService.acknowledgeDisclosure and returns timestamp', async () => {
      const { rpcHandler, indexingControl } = buildHandlers();
      const ts = Date.now();
      indexingControl.getStatus.mockResolvedValueOnce(
        makeStatus({ disclosureAcknowledgedAt: ts }),
      );

      const result = await rpcHandler.call('indexing:acknowledgeDisclosure', {
        workspaceRoot: '/workspace',
      });

      expect(indexingControl.acknowledgeDisclosure).toHaveBeenCalledWith(
        '/workspace',
      );
      expect(result).toMatchObject({ accepted: true, acknowledgedAt: ts });
    });

    it('returns accepted:false when workspaceRoot is missing', async () => {
      const { rpcHandler } = buildHandlers();
      const result = await rpcHandler.call(
        'indexing:acknowledgeDisclosure',
        {},
      );
      expect(result).toMatchObject({ accepted: false });
    });
  });
});
