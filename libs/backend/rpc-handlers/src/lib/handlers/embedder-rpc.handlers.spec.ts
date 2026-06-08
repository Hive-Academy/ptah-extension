/**
 * Specs for EmbedderRpcHandlers.
 *
 * Coverage matrix:
 *   embedder:status — happy path snapshot mapping
 *   embedder:retry  — ensureReady succeeds -> ok:true
 *   embedder:retry  — ensureReady throws  -> ok:false, sanitised message
 *   METHODS constant — both names present
 */

import 'reflect-metadata';
import { EmbedderRpcHandlers } from './embedder-rpc.handlers';

function makeLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function makeRpcHandler() {
  const registered = new Map<string, (params: unknown) => Promise<unknown>>();
  return {
    registerMethod: jest.fn(
      (name: string, handler: (p: unknown) => Promise<unknown>) => {
        registered.set(name, handler);
      },
    ),
    _call: async (name: string, params: unknown): Promise<unknown> => {
      const h = registered.get(name);
      if (!h) throw new Error(`No handler for ${name}`);
      return h(params);
    },
  };
}

interface EmbedderSnapshot {
  ready: boolean;
  downloading: boolean;
  progress?: number;
  error?: { message: string; code?: string };
}

function makeEmbedderStatus(
  initial: Partial<EmbedderSnapshot> & { ready: boolean },
) {
  let snapshot: EmbedderSnapshot = {
    ready: initial.ready,
    downloading: initial.downloading ?? false,
    ...(initial.progress !== undefined ? { progress: initial.progress } : {}),
    ...(initial.error ? { error: initial.error } : {}),
  };
  return {
    getStatus: jest.fn(() => snapshot),
    ensureReady: jest.fn(async () => undefined),
    setSnapshot(next: EmbedderSnapshot) {
      snapshot = next;
    },
  };
}

describe('EmbedderRpcHandlers', () => {
  let logger: ReturnType<typeof makeLogger>;
  let rpcHandler: ReturnType<typeof makeRpcHandler>;
  let embedderStatus: ReturnType<typeof makeEmbedderStatus>;

  beforeEach(() => {
    logger = makeLogger();
    rpcHandler = makeRpcHandler();
    embedderStatus = makeEmbedderStatus({ ready: true });
  });

  it('embedder:status returns the snapshot mapped to wire shape', async () => {
    embedderStatus.setSnapshot({
      ready: false,
      downloading: true,
      progress: 0.5,
    } as EmbedderSnapshot);
    const handler = new EmbedderRpcHandlers(
      logger as never,
      rpcHandler as never,
      embedderStatus as never,
    );
    handler.register();
    const result = (await rpcHandler._call('embedder:status', {})) as {
      status: { ready: boolean; downloading: boolean; progress?: number };
    };
    expect(result.status.ready).toBe(false);
    expect(result.status.downloading).toBe(true);
    expect(result.status.progress).toBe(0.5);
  });

  it('embedder:retry calls ensureReady and reports ok:true when ready', async () => {
    const handler = new EmbedderRpcHandlers(
      logger as never,
      rpcHandler as never,
      embedderStatus as never,
    );
    handler.register();
    const result = (await rpcHandler._call('embedder:retry', {})) as {
      ok: boolean;
      message: string;
    };
    expect(embedderStatus.ensureReady).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(true);
    expect(result.message).toContain('ready');
  });

  it('embedder:retry returns ok:false with sanitised message when ensureReady throws', async () => {
    embedderStatus.ensureReady.mockRejectedValueOnce(
      new Error(
        'Failed to fetch model from C:\\Users\\jane\\.cache\\huggingface',
      ),
    );
    embedderStatus.setSnapshot({
      ready: false,
      downloading: false,
      error: { message: 'fetch failed' },
    } as EmbedderSnapshot);
    const handler = new EmbedderRpcHandlers(
      logger as never,
      rpcHandler as never,
      embedderStatus as never,
    );
    handler.register();
    const result = (await rpcHandler._call('embedder:retry', {})) as {
      ok: boolean;
      message: string;
    };
    expect(result.ok).toBe(false);
    expect(result.message).toContain('Embedder retry failed');
    expect(result.message).not.toContain('jane');
    expect(result.message).toContain('[path redacted]');
  });

  it('METHODS contains both method names', () => {
    expect(EmbedderRpcHandlers.METHODS).toContain('embedder:status');
    expect(EmbedderRpcHandlers.METHODS).toContain('embedder:retry');
  });
});
