import { rerankFused, type Reranker } from './memory-rerank';
import { HostCallSkippedError } from './search-worker-host-embedder';
import type { CuratorLogger } from './sqlite-reader-deps.types';

function makeLogger(): jest.Mocked<CuratorLogger> {
  return { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

const fused = [1, 2, 3, 4, 5].map((rowid) => ({ row: { rowid, text: `text ${rowid}` }, score: 1 / rowid }));

function reranker(rerank: Reranker['rerank']): Reranker {
  return { rerank };
}

describe('rerankFused', () => {
  afterEach(() => jest.useRealTimers());

  it('reorders the fused rows by the reranker', async () => {
    const result = await rerankFused(
      reranker(async () => [{ id: '5', score: 0.9 }, { id: '1', score: 0.1 }]),
      'q', fused, 5, undefined, makeLogger(),
    );
    expect(result.outcome).toBe('reranked');
    expect(result.fused.map((e) => e.row.rowid)).toEqual([5, 1]);
  });

  it('skips with too little time left: RRF order, partial, no rerank call', async () => {
    const rerank = jest.fn<ReturnType<Reranker['rerank']>, Parameters<Reranker['rerank']>>(async () => []);
    const logger = makeLogger();
    const result = await rerankFused(reranker(rerank), 'q', fused, 5, performance.now() + 900, logger);
    expect(result).toEqual({ fused, outcome: 'partial' });
    expect(rerank).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('keeps the RRF order without a warning when the host sheds the rerank', async () => {
    const logger = makeLogger();
    const result = await rerankFused(
      reranker(async () => {
        throw new HostCallSkippedError('host reranker busy');
      }),
      'q', fused, 5, performance.now() + 4_000, logger,
    );
    expect(result).toEqual({ fused, outcome: 'partial' });
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('reranker busy'));
  });

  it('bounds the rerank by the deadline and reports a cut pass as partial', async () => {
    jest.useFakeTimers();
    const logger = makeLogger();
    const pending = rerankFused(
      reranker(() => new Promise(() => undefined)),
      'q', fused, 5, performance.now() + 2_000, logger,
    );
    jest.advanceTimersByTime(1_800);
    await expect(pending).resolves.toEqual({ fused, outcome: 'partial' });
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('missed deadline'));
  });
});

