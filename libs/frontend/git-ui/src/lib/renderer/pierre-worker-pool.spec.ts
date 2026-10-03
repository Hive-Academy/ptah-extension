import { TestBed } from '@angular/core/testing';
import type { PierreWorkerPoolService as PoolServiceType } from './pierre-worker-pool';

/**
 * `@pierre/diffs` is ESM-only and not transformed by this project's Jest
 * config, so the pool singleton is replaced by a double that records how it
 * was configured and lets each test decide whether initialization succeeds.
 */
const pierreWorker = {
  initialize: jest.fn<Promise<void>, []>(),
  created: [] as Array<{
    poolOptions: { workerFactory: () => Worker; poolSize?: number };
    highlighterOptions: Record<string, unknown>;
  }>,
  terminate: jest.fn(),
};

jest.mock('@pierre/diffs', () => ({
  DEFAULT_THEMES: { dark: 'pierre-dark', light: 'pierre-light' },
  registerCustomLanguage: jest.fn(),
  registerCustomTheme: jest.fn(),
}));

jest.mock('@pierre/diffs/worker', () => ({
  getOrCreateWorkerPoolSingleton: (
    props: (typeof pierreWorker.created)[number],
  ) => {
    pierreWorker.created.push(props);
    return { initialize: pierreWorker.initialize };
  },
  terminateWorkerPoolSingleton: pierreWorker.terminate,
}));

class FakeWorker {
  static created: Array<{ url: string; options?: WorkerOptions }> = [];
  constructor(url: string, options?: WorkerOptions) {
    FakeWorker.created.push({ url, options });
  }
}

const globals = globalThis as unknown as Record<string, unknown>;

describe('PierreWorkerPoolService', () => {
  let service: PoolServiceType;
  let fetchMock: jest.Mock;
  let warn: jest.SpyInstance;
  const original = {
    Worker: globals['Worker'],
    fetch: globals['fetch'],
    createObjectURL: URL.createObjectURL,
    revokeObjectURL: URL.revokeObjectURL,
  };

  async function flush(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  beforeEach(async () => {
    pierreWorker.created = [];
    pierreWorker.initialize.mockReset().mockResolvedValue(undefined);
    pierreWorker.terminate.mockReset();
    FakeWorker.created = [];
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve('self.onmessage = () => {};'),
    });
    globals['Worker'] = FakeWorker;
    globals['fetch'] = fetchMock;
    URL.createObjectURL = jest.fn(() => 'blob:pierre-worker');
    URL.revokeObjectURL = jest.fn();
    warn = jest.spyOn(console, 'warn').mockImplementation();

    const { PierreWorkerPoolService } = await import('./pierre-worker-pool');
    TestBed.resetTestingModule();
    service = TestBed.inject(PierreWorkerPoolService);
  });

  afterEach(() => {
    globals['Worker'] = original.Worker;
    globals['fetch'] = original.fetch;
    URL.createObjectURL = original.createObjectURL;
    URL.revokeObjectURL = original.revokeObjectURL;
    warn.mockRestore();
  });

  it('fetches the worker script once and starts every worker from one Blob URL', async () => {
    expect(service.state()).toEqual({ status: 'loading' });
    service.start();
    service.start();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('assets/pierre/worker-portable.js');
    expect(pierreWorker.created).toHaveLength(1);
    const [{ poolOptions, highlighterOptions }] = pierreWorker.created;
    expect(highlighterOptions).toMatchObject({
      preferredHighlighter: 'shiki-js',
      lineDiffType: 'word',
    });
    poolOptions.workerFactory();
    expect(FakeWorker.created).toEqual([
      { url: 'blob:pierre-worker', options: { name: 'pierre-diffs' } },
    ]);
    const state = service.state();
    expect(state.status).toBe('ready');
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back (no pool) and logs once when the worker script cannot be fetched', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve(''),
    });
    service.start();
    service.start();
    await flush();

    expect(service.state()).toEqual({ status: 'unavailable' });
    expect(pierreWorker.created).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('terminates the pool and falls back when the workers fail to start', async () => {
    pierreWorker.initialize.mockRejectedValue(new Error('worker crashed'));
    service.start();
    await flush();

    expect(service.state()).toEqual({ status: 'unavailable' });
    expect(pierreWorker.terminate).toHaveBeenCalledTimes(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:pierre-worker');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('falls back without fetching when the document has no Worker', async () => {
    delete globals['Worker'];
    service.start();
    await flush();

    expect(service.state()).toEqual({ status: 'unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
