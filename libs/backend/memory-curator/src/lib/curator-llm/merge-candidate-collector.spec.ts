import type { Logger } from '@ptah-extension/vscode-core';
import type { ExtractedMemoryDraft } from './curator-llm.interface';
import {
  MergeCandidateCollector,
  TIER2_MAX_QUERIES,
  TIER2_PER_DRAFT_LIMIT,
  TIER2_QUERY_MAX_CHARS,
  TIER2_COOLDOWN_AFTER_TIMEOUT_MS,
  TIER2_PASS_BUDGET_MS,
  TIER2_QUERY_TIMEOUT_MS,
  TIER2_TOTAL_LIMIT,
} from './merge-candidate-collector';
import type { MemoryStore } from '../memory.store';
import type { MemorySearchService } from '../memory-search.service';
import type {
  Memory,
  MemorySearchHit,
  MemorySearchResponse,
} from '../memory.types';
import { chunkId, memoryId } from '../memory.types';

type Candidate = { id: string; subject: string | null; content: string };

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function draft(subject: string | null, content: string): ExtractedMemoryDraft {
  return { kind: 'fact', subject, content, salienceHint: 0.5 };
}

function hit(
  id: string,
  workspaceRoot: string | null,
  subject: string | null = `subject ${id}`,
): MemorySearchHit {
  const memory = {
    id: memoryId(id),
    workspaceRoot,
    subject,
    content: `content ${id}`,
  } as unknown as Memory;
  return {
    memory,
    chunk: {
      id: chunkId(`${id}-c0`),
      memoryId: memoryId(id),
      ord: 0,
      text: `content ${id}`,
      tokenCount: 1,
      createdAt: 0,
    },
    score: 1,
    bm25Rank: 1,
    vecRank: null,
  };
}

function makeStore(tier1: readonly Candidate[]): {
  store: MemoryStore;
  findMergeCandidates: jest.Mock;
  recordUse: jest.Mock;
} {
  const findMergeCandidates = jest.fn(() => tier1);
  const recordUse = jest.fn();
  return {
    store: { findMergeCandidates, recordUse } as unknown as MemoryStore,
    findMergeCandidates,
    recordUse,
  };
}

function makeSearch(
  impl: (
    query: string,
    topK: number,
    scope: string | null | undefined,
  ) => Promise<MemorySearchResponse>,
): { search: MemorySearchService; searchRich: jest.Mock } {
  const searchRich = jest.fn(impl);
  return {
    search: { searchRich } as unknown as MemorySearchService,
    searchRich,
  };
}

const TIER1: readonly Candidate[] = [
  { id: 't1-a', subject: 'alpha', content: 'alpha content' },
  { id: 't1-b', subject: 'alpha', content: 'alpha more' },
];

describe('MergeCandidateCollector', () => {
  it('puts tier 1 first in its own order and drops tier-2 duplicates of tier-1 ids', async () => {
    const { store, findMergeCandidates } = makeStore(TIER1);
    const { search, searchRich } = makeSearch(async () => ({
      hits: [hit('t1-b', '/ws'), hit('s-1', '/ws'), hit('s-1', '/ws')],
      bm25Only: false,
    }));
    const collector = new MergeCandidateCollector(makeLogger(), store, search);

    const out = await collector.collect(
      [draft('alpha', 'first'), draft(null, 'second')],
      '/ws',
    );

    expect(findMergeCandidates).toHaveBeenCalledWith(['alpha'], '/ws');
    expect(out.candidates.map((c) => c.id)).toEqual(['t1-a', 't1-b', 's-1']);
    expect(out.candidates[2]).toEqual({
      id: 's-1',
      subject: 'subject s-1',
      content: 'content s-1',
    });
    expect(out.tier1Count).toBe(2);
    expect(out.tier2Count).toBe(1);
    expect(out.tier2Queries).toBe(2);
    expect(out.tier2Skipped).toBeNull();
    expect(searchRich).toHaveBeenNthCalledWith(
      1,
      'alpha first',
      TIER2_PER_DRAFT_LIMIT,
      '/ws',
    );
    expect(searchRich).toHaveBeenNthCalledWith(
      2,
      'second',
      TIER2_PER_DRAFT_LIMIT,
      '/ws',
    );
  });

  it('bounds 40 drafts x 10 hits to 10 queries, 25 tier-2 rows and 5 per draft', async () => {
    const { store } = makeStore(TIER1);
    let call = 0;
    const perQuery: number[] = [];
    const { search, searchRich } = makeSearch(async () => {
      const q = call++;
      return {
        hits: Array.from({ length: 10 }, (_, i) => hit(`q${q}-h${i}`, '/ws')),
        bm25Only: false,
      };
    });
    const collector = new MergeCandidateCollector(makeLogger(), store, search);
    const drafts = Array.from({ length: 40 }, (_, i) =>
      draft('alpha', `draft ${i}`),
    );

    const out = await collector.collect(drafts, '/ws');

    expect(searchRich.mock.calls.length).toBeLessThanOrEqual(TIER2_MAX_QUERIES);
    expect(out.tier2Queries).toBe(searchRich.mock.calls.length);
    expect(out.tier2Count).toBeLessThanOrEqual(TIER2_TOTAL_LIMIT);
    expect(out.tier2Count).toBe(TIER2_TOTAL_LIMIT);
    for (const c of out.candidates.slice(TIER1.length)) {
      perQuery.push(Number(c.id.slice(1, c.id.indexOf('-'))));
    }
    const counts = new Map<number, number>();
    for (const q of perQuery) counts.set(q, (counts.get(q) ?? 0) + 1);
    for (const n of counts.values()) {
      expect(n).toBeLessThanOrEqual(TIER2_PER_DRAFT_LIMIT);
    }
    expect(out.candidates.slice(0, TIER1.length)).toEqual(TIER1);
  });

  it('never issues more than TIER2_MAX_QUERIES when hits are all duplicates', async () => {
    const { store } = makeStore(TIER1);
    const { search, searchRich } = makeSearch(async () => ({
      hits: [hit('t1-a', '/ws')],
      bm25Only: false,
    }));
    const collector = new MergeCandidateCollector(makeLogger(), store, search);

    const out = await collector.collect(
      Array.from({ length: 40 }, (_, i) => draft('alpha', `d${i}`)),
      '/ws',
    );

    expect(searchRich).toHaveBeenCalledTimes(TIER2_MAX_QUERIES);
    expect(out.tier2Count).toBe(0);
  });

  it('clips the query to TIER2_QUERY_MAX_CHARS', async () => {
    const { store } = makeStore(TIER1);
    const { search, searchRich } = makeSearch(async () => ({
      hits: [],
      bm25Only: false,
    }));
    const collector = new MergeCandidateCollector(makeLogger(), store, search);

    await collector.collect([draft('alpha', 'x'.repeat(2_000))], '/ws');

    const query = searchRich.mock.calls[0][0] as string;
    expect(query.length).toBe(TIER2_QUERY_MAX_CHARS);
    expect(query.startsWith('alpha x')).toBe(true);
  });

  it('passes a null scope to both tiers as null and keeps only null-workspace hits', async () => {
    const { store, findMergeCandidates } = makeStore(TIER1);
    const { search, searchRich } = makeSearch(async () => ({
      hits: [hit('other', '/ws'), hit('mine', null)],
      bm25Only: false,
    }));
    const collector = new MergeCandidateCollector(makeLogger(), store, search);

    const out = await collector.collect([draft('alpha', 'c')], null);

    expect(findMergeCandidates).toHaveBeenCalledWith(['alpha'], null);
    expect(searchRich).toHaveBeenCalledWith(
      'alpha c',
      TIER2_PER_DRAFT_LIMIT,
      null,
    );
    expect(out.candidates.map((c) => c.id)).toEqual(['t1-a', 't1-b', 'mine']);
  });

  it('maps an undefined scope to null for both tiers', async () => {
    const { store, findMergeCandidates } = makeStore(TIER1);
    const { search, searchRich } = makeSearch(async () => ({
      hits: [],
      bm25Only: false,
    }));
    const collector = new MergeCandidateCollector(makeLogger(), store, search);

    await collector.collect([draft('alpha', 'c')], undefined);

    expect(findMergeCandidates).toHaveBeenCalledWith(['alpha'], null);
    expect(searchRich).toHaveBeenCalledWith(
      'alpha c',
      TIER2_PER_DRAFT_LIMIT,
      null,
    );
  });

  it('drops a hit from another workspace even when the search returns it', async () => {
    const { store } = makeStore(TIER1);
    const { search } = makeSearch(async () => ({
      hits: [hit('foreign', '/other'), hit('unscoped', null), hit('ok', '/ws')],
      bm25Only: false,
    }));
    const collector = new MergeCandidateCollector(makeLogger(), store, search);

    const out = await collector.collect([draft('alpha', 'c')], '/ws');

    expect(out.candidates.map((c) => c.id)).toEqual(['t1-a', 't1-b', 'ok']);
  });

  it('skips tier 2 for a blank workspace root and never widens to every workspace', async () => {
    const { store, findMergeCandidates } = makeStore(TIER1);
    const { search, searchRich } = makeSearch(async () => ({
      hits: [hit('x', '')],
      bm25Only: false,
    }));
    const collector = new MergeCandidateCollector(makeLogger(), store, search);

    const out = await collector.collect([draft('alpha', 'c')], '');

    expect(findMergeCandidates).toHaveBeenCalledWith(['alpha'], '');
    expect(searchRich).not.toHaveBeenCalled();
    expect(out.candidates).toEqual(TIER1);
    expect(out.tier2Skipped).toBe('blank-workspace');
  });

  it('returns tier 1 only with no search service', async () => {
    const { store } = makeStore(TIER1);
    const collector = new MergeCandidateCollector(makeLogger(), store, null);

    const out = await collector.collect([draft('alpha', 'c')], '/ws');

    expect(out.candidates).toEqual(TIER1);
    expect(out.tier2Skipped).toBe('no-search');
    expect(out.tier2Queries).toBe(0);
  });

  it('propagates bm25Only when any tier-2 query ran without vectors', async () => {
    const { store } = makeStore(TIER1);
    let n = 0;
    const { search } = makeSearch(async () => ({
      hits: [],
      bm25Only: n++ === 1,
    }));
    const collector = new MergeCandidateCollector(makeLogger(), store, search);

    const out = await collector.collect(
      [draft('alpha', 'a'), draft('alpha', 'b'), draft('alpha', 'c')],
      '/ws',
    );

    expect(out.bm25Only).toBe(true);
  });

  it('keeps tier 1 and the rows collected before a searchRich throw, warns once and stops', async () => {
    const { store } = makeStore(TIER1);
    const logger = makeLogger();
    let n = 0;
    const { search, searchRich } = makeSearch(async () => {
      if (n++ === 1) throw new Error('embedder down');
      return { hits: [hit('s-1', '/ws')], bm25Only: false };
    });
    const collector = new MergeCandidateCollector(logger, store, search);

    const out = await collector.collect(
      [draft('alpha', 'a'), draft('alpha', 'b'), draft('alpha', 'c')],
      '/ws',
    );

    expect(searchRich).toHaveBeenCalledTimes(2);
    expect(out.candidates.map((c) => c.id)).toEqual(['t1-a', 't1-b', 's-1']);
    expect(out.tier2Skipped).toBe('error');
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('D4 = B: an empty tier 1 returns [] with tier1-empty and zero searchRich calls', async () => {
    const { store } = makeStore([]);
    const { search, searchRich } = makeSearch(async () => ({
      hits: [hit('s-1', '/ws')],
      bm25Only: false,
    }));
    const collector = new MergeCandidateCollector(makeLogger(), store, search);

    const out = await collector.collect([draft('alpha', 'a')], '/ws');

    expect(out.candidates).toEqual([]);
    expect(out.tier2Skipped).toBe('tier1-empty');
    expect(out.tier2Queries).toBe(0);
    expect(searchRich).not.toHaveBeenCalled();
  });

  it('D4 = B: drafts without subjects skip tier 1 and so skip tier 2', async () => {
    const { store, findMergeCandidates } = makeStore(TIER1);
    const { search, searchRich } = makeSearch(async () => ({
      hits: [],
      bm25Only: false,
    }));
    const collector = new MergeCandidateCollector(makeLogger(), store, search);

    const out = await collector.collect([draft(null, 'a')], '/ws');

    expect(findMergeCandidates).not.toHaveBeenCalled();
    expect(searchRich).not.toHaveBeenCalled();
    expect(out.tier2Skipped).toBe('tier1-empty');
  });

  it('keeps the rows of settled queries and stops issuing queries after an abort', async () => {
    const { store } = makeStore(TIER1);
    const controller = new AbortController();
    let calls = 0;
    const { search, searchRich } = makeSearch(() => {
      calls++;
      if (calls > 1) {
        // The second query is in flight when the pass aborts.
        setTimeout(() => controller.abort(), 0);
        return new Promise<MemorySearchResponse>(() => undefined);
      }
      return Promise.resolve({ hits: [hit('s-1', '/ws')], bm25Only: false });
    });
    const collector = new MergeCandidateCollector(makeLogger(), store, search);

    const out = await collector.collect(
      [draft('alpha', 'a'), draft('alpha', 'b'), draft('alpha', 'c')],
      '/ws',
      controller.signal,
    );

    expect(searchRich).toHaveBeenCalledTimes(2);
    expect(out.candidates.map((c) => c.id)).toEqual(['t1-a', 't1-b', 's-1']);
    expect(out.tier2Skipped).toBeNull();
  });

  describe('a hung search', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('times out a hung query, keeps what was collected, and stays closed to tier 2 until the query settles AND the cooldown ends', async () => {
      const { store } = makeStore(TIER1);
      const logger = makeLogger();
      let n = 0;
      let settleHung: () => void = () => undefined;
      const { search, searchRich } = makeSearch(() => {
        n++;
        if (n === 2) {
          return new Promise<MemorySearchResponse>((resolve) => {
            settleHung = () => resolve({ hits: [], bm25Only: false });
          });
        }
        return Promise.resolve({
          hits: [hit(`s-${n}`, '/ws')],
          bm25Only: false,
        });
      });
      // Fake timers also drive Date.now, so the injected clock follows them.
      const collector = new MergeCandidateCollector(logger, store, search, () =>
        Date.now(),
      );

      let settled = false;
      const pending = collector
        .collect(
          [draft('alpha', 'a'), draft('alpha', 'b'), draft('alpha', 'c')],
          '/ws',
        )
        .finally(() => {
          settled = true;
        });
      await jest.advanceTimersByTimeAsync(TIER2_QUERY_TIMEOUT_MS - 1);
      expect(settled).toBe(false);
      await jest.advanceTimersByTimeAsync(1);
      const out = await pending;

      expect(searchRich).toHaveBeenCalledTimes(2);
      expect(out.tier2Skipped).toBe('timeout');
      expect(out.candidates.map((c) => c.id)).toEqual(['t1-a', 't1-b', 's-1']);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect((logger.warn as jest.Mock).mock.calls[0][1]).toMatchObject({
        cause: 'timeout',
        deadlineMs: TIER2_QUERY_TIMEOUT_MS,
      });
      expect(jest.getTimerCount()).toBe(0);

      // The abandoned query is outstanding: the next pass issues nothing.
      const calls = searchRich.mock.calls.length;
      const during = await collector.collect([draft('alpha', 'd')], '/ws');
      expect(during.tier2Skipped).toBe('abandoned-pending');
      expect(during.tier2Queries).toBe(0);
      expect(during.candidates).toEqual(TIER1);

      // The cooldown clock alone does not close the breaker.
      await jest.advanceTimersByTimeAsync(TIER2_COOLDOWN_AFTER_TIMEOUT_MS);
      const stillPending = await collector.collect(
        [draft('alpha', 'e')],
        '/ws',
      );
      expect(stillPending.tier2Skipped).toBe('abandoned-pending');
      expect(searchRich).toHaveBeenCalledTimes(calls);
      expect(
        (logger.info as jest.Mock).mock.calls.filter((c) =>
          String(c[0]).includes('cooldown over'),
        ),
      ).toHaveLength(0);

      // Settled and elapsed: the breaker closes, logs once, and tier 2 runs.
      settleHung();
      await jest.advanceTimersByTimeAsync(0);
      const after = await collector.collect([draft('alpha', 'f')], '/ws');
      expect(after.tier2Skipped).toBeNull();
      expect(after.tier2Queries).toBe(1);
      const closed = (logger.info as jest.Mock).mock.calls.filter((c) =>
        String(c[0]).includes('cooldown over'),
      );
      expect(closed).toHaveLength(1);
      await collector.collect([draft('alpha', 'g')], '/ws');
      expect(
        (logger.info as jest.Mock).mock.calls.filter((c) =>
          String(c[0]).includes('cooldown over'),
        ),
      ).toHaveLength(1);
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('keeps the cooldown after the abandoned query settles until its time has elapsed', async () => {
      const { store } = makeStore(TIER1);
      let settleHung: () => void = () => undefined;
      let n = 0;
      const { search, searchRich } = makeSearch(() => {
        n++;
        if (n === 1) {
          return new Promise<MemorySearchResponse>((resolve) => {
            settleHung = () => resolve({ hits: [], bm25Only: false });
          });
        }
        return Promise.resolve({ hits: [], bm25Only: false });
      });
      const collector = new MergeCandidateCollector(
        makeLogger(),
        store,
        search,
        () => Date.now(),
      );

      const first = collector.collect([draft('alpha', 'a')], '/ws');
      await jest.advanceTimersByTimeAsync(TIER2_QUERY_TIMEOUT_MS);
      expect((await first).tier2Skipped).toBe('timeout');

      settleHung();
      await jest.advanceTimersByTimeAsync(0);
      const early = await collector.collect([draft('alpha', 'b')], '/ws');
      expect(early.tier2Skipped).toBe('cooldown');
      expect(searchRich).toHaveBeenCalledTimes(1);

      await jest.advanceTimersByTimeAsync(TIER2_COOLDOWN_AFTER_TIMEOUT_MS);
      const later = await collector.collect([draft('alpha', 'c')], '/ws');
      expect(later.tier2Skipped).toBeNull();
      expect(later.tier2Queries).toBe(1);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('spends the pass budget across slow queries that settle, capping the last deadline by what remains', async () => {
      const { store } = makeStore(TIER1);
      const logger = makeLogger();
      const slowMs = TIER2_QUERY_TIMEOUT_MS - 1_000;
      let n = 0;
      const { search, searchRich } = makeSearch(() => {
        const id = `slow-${++n}`;
        return new Promise<MemorySearchResponse>((resolve) =>
          setTimeout(
            () => resolve({ hits: [hit(id, '/ws')], bm25Only: false }),
            slowMs,
          ),
        );
      });
      const collector = new MergeCandidateCollector(logger, store, search, () =>
        Date.now(),
      );
      const start = Date.now();
      let settledAt = 0;
      const pending = collector
        .collect(
          Array.from({ length: 10 }, (_, i) => draft('alpha', `d${i}`)),
          '/ws',
        )
        .finally(() => {
          settledAt = Date.now();
        });
      await jest.advanceTimersByTimeAsync(TIER2_PASS_BUDGET_MS + 60_000);
      const out = await pending;

      // Every settled query fits whole; the one in flight when the budget ran
      // out is cut at exactly the budget, not at its own full deadline.
      const whole = Math.floor(TIER2_PASS_BUDGET_MS / slowMs);
      expect(searchRich).toHaveBeenCalledTimes(whole + 1);
      expect(out.tier2Count).toBe(whole);
      expect(out.tier2Skipped).toBe('budget');
      expect(settledAt - start).toBe(TIER2_PASS_BUDGET_MS);
      const remaining = TIER2_PASS_BUDGET_MS - whole * slowMs;
      expect(remaining).toBeLessThan(TIER2_QUERY_TIMEOUT_MS);
      expect((logger.warn as jest.Mock).mock.calls[0][1]).toMatchObject({
        cause: 'budget',
        deadlineMs: remaining,
      });
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('the pass budget with a manual clock', () => {
    it('stops between queries once the budget is spent, without opening the breaker', async () => {
      const { store } = makeStore(TIER1);
      const logger = makeLogger();
      let clock = 1_000_000;
      const { search, searchRich } = makeSearch(async () => {
        clock += TIER2_PASS_BUDGET_MS / 2;
        return { hits: [], bm25Only: false };
      });
      const collector = new MergeCandidateCollector(
        logger,
        store,
        search,
        () => clock,
      );

      const out = await collector.collect(
        Array.from({ length: 5 }, (_, i) => draft('alpha', `d${i}`)),
        '/ws',
      );

      expect(searchRich).toHaveBeenCalledTimes(2);
      expect(out.tier2Queries).toBe(2);
      expect(out.tier2Skipped).toBe('budget');
      expect(logger.warn).not.toHaveBeenCalled();

      // No query was abandoned, so the next pass is not in cooldown.
      const next = await collector.collect([draft('alpha', 'x')], '/ws');
      expect(next.tier2Skipped).not.toBe('cooldown');
      expect(next.tier2Queries).toBe(1);
    });
  });

  describe('a hung search (continued)', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('stops at an abort while a query is in flight, releases its timer and listener, and holds tier 2 until that query settles', async () => {
      const { store } = makeStore(TIER1);
      const logger = makeLogger();
      const controller = new AbortController();
      const removeListener = jest.spyOn(
        controller.signal,
        'removeEventListener',
      );
      let calls = 0;
      let settleAbandoned: () => void = () => undefined;
      const { search, searchRich } = makeSearch(() => {
        calls++;
        if (calls === 1) {
          return new Promise<MemorySearchResponse>((resolve) => {
            settleAbandoned = () => resolve({ hits: [], bm25Only: false });
          });
        }
        return Promise.resolve({ hits: [], bm25Only: false });
      });
      const collector = new MergeCandidateCollector(logger, store, search);

      const pending = collector.collect(
        [draft('alpha', 'a'), draft('alpha', 'b')],
        '/ws',
        controller.signal,
      );
      await jest.advanceTimersByTimeAsync(10);
      controller.abort();
      const out = await pending;

      expect(searchRich).toHaveBeenCalledTimes(1);
      expect(out.candidates).toEqual(TIER1);
      expect(out.tier2Skipped).toBeNull();
      expect(removeListener).toHaveBeenCalledWith(
        'abort',
        expect.any(Function),
      );
      expect(jest.getTimerCount()).toBe(0);
      // An abort does not open the time cooldown.
      expect(logger.warn).not.toHaveBeenCalled();

      // The aborted query is still running: the next pass issues nothing.
      const held = await collector.collect([draft('alpha', 'c')], '/ws');
      expect(held.tier2Skipped).toBe('abandoned-pending');
      expect(held.tier2Queries).toBe(0);
      expect(searchRich).toHaveBeenCalledTimes(1);

      settleAbandoned();
      await jest.advanceTimersByTimeAsync(0);
      const next = await collector.collect([draft('alpha', 'd')], '/ws');
      expect(next.tier2Queries).toBe(1);
      expect(next.tier2Skipped).toBeNull();
      expect(jest.getTimerCount()).toBe(0);
    });

    it('observes a rejection that lands after the deadline', async () => {
      const { store } = makeStore(TIER1);
      let rejectLate: (e: Error) => void = () => undefined;
      const { search } = makeSearch(
        () =>
          new Promise<MemorySearchResponse>((_resolve, reject) => {
            rejectLate = reject;
          }),
      );
      const unhandled = jest.fn();
      process.on('unhandledRejection', unhandled);
      try {
        const collector = new MergeCandidateCollector(
          makeLogger(),
          store,
          search,
        );
        const pending = collector.collect([draft('alpha', 'a')], '/ws');
        await jest.advanceTimersByTimeAsync(TIER2_QUERY_TIMEOUT_MS);
        const out = await pending;
        rejectLate(new Error('late failure'));
        jest.useRealTimers();
        await new Promise((r) => setImmediate(r));

        expect(out.tier2Skipped).toBe('timeout');
        expect(unhandled).not.toHaveBeenCalled();
      } finally {
        process.off('unhandledRejection', unhandled);
      }
    });
  });

  it('issues no query when the signal is already aborted', async () => {
    const { store } = makeStore(TIER1);
    const controller = new AbortController();
    controller.abort();
    const { search, searchRich } = makeSearch(async () => ({
      hits: [],
      bm25Only: false,
    }));
    const collector = new MergeCandidateCollector(makeLogger(), store, search);

    const out = await collector.collect(
      [draft('alpha', 'a')],
      '/ws',
      controller.signal,
    );

    expect(searchRich).not.toHaveBeenCalled();
    expect(out.candidates).toEqual(TIER1);
  });

  it('never records a use of any candidate', async () => {
    const { store, recordUse } = makeStore(TIER1);
    const { search } = makeSearch(async () => ({
      hits: [hit('s-1', '/ws'), hit('s-2', '/ws')],
      bm25Only: false,
    }));
    const collector = new MergeCandidateCollector(makeLogger(), store, search);

    await collector.collect([draft('alpha', 'a')], '/ws');

    expect(recordUse).not.toHaveBeenCalled();
  });
});
