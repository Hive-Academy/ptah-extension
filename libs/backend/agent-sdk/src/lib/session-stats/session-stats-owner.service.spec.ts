/**
 * SessionStatsOwnerService — the single backend authority for one session's
 * lifetime accounting (TASK_2026_533).
 *
 * The owner keeps a FIXED history prefix plus the LATEST cumulative result of
 * each query run, keyed by the run's registry token. A newer result for a run
 * replaces the stored one only when it continues the run's running total; any
 * other result is rejected atomically (Ptah never sends `/clear` to the SDK,
 * so a total never resets inside a run). Whether a resumed run restored the
 * transcript's saved
 * `cost-state` is detected per run (`resolveRunBase`) and removed
 * (`subtractRunBase`). These specs use plain numbers so a regression reads as
 * "28" or "43", not "18".
 */

import 'reflect-metadata';

import type { ModelPricing } from '@ptah-extension/shared';
import {
  SessionStatsOwnerService,
  resolveRunBase,
  subtractRunBase,
  type RunPreparationLoaders,
  type RunUsageResult,
  type SavedCostState,
  type SessionStatsPrefix,
} from './session-stats-owner.service';

const SESSION = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000533';
const MODEL = 'zz-model-primary';

interface Row {
  model?: string;
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheCreation?: number;
  costUSD?: number | null;
  pricing?: ModelPricing | null;
}

function run(
  cost: number | null,
  rows: readonly Row[] = [{}],
  options: { isErrorResult?: boolean; unreported?: boolean } = {},
): RunUsageResult {
  return {
    totalCost: cost,
    costSource: options.unreported ? 'unreported' : 'reported',
    isErrorResult: options.isErrorResult ?? false,
    models: rows.map((r) => ({
      model: r.model ?? MODEL,
      inputTokens: r.input ?? 10,
      outputTokens: r.output ?? 10,
      cacheRead: r.cacheRead ?? 0,
      cacheCreation: r.cacheCreation ?? 0,
      costUSD: r.costUSD === undefined ? cost : r.costUSD,
      ...(r.pricing !== undefined && { pricing: r.pricing }),
    })),
  };
}

function saved(
  total: number | null,
  models: Record<string, Partial<Record<'input' | 'output' | 'cacheRead' | 'cacheCreation', number>> & { costUSD?: number | null }>,
): SavedCostState {
  return {
    totalCostUSD: total,
    hasUnknownModelCost: false,
    models: Object.fromEntries(
      Object.entries(models).map(([model, m]) => [
        model,
        {
          input: m.input ?? 0,
          output: m.output ?? 0,
          cacheRead: m.cacheRead ?? 0,
          cacheCreation: m.cacheCreation ?? 0,
          costUSD: m.costUSD === undefined ? total : m.costUSD,
        },
      ]),
    ),
  };
}

function prefix(
  cost: number | null,
  options: {
    tokens?: number;
    subagentIds?: readonly string[];
    savedCostState?: SavedCostState | null;
  } = {},
): SessionStatsPrefix {
  const tokens = options.tokens ?? 100;
  return {
    stats: {
      sessionId: SESSION,
      model: MODEL,
      totalCost: cost,
      knownCost: cost,
      tokens: { input: tokens, output: 0, cacheRead: 0, cacheCreation: 0 },
      tokenCount: tokens,
      messageCount: 4,
      modelUsageList: [
        {
          model: MODEL,
          inputTokens: tokens,
          outputTokens: 0,
          cacheRead: 0,
          cacheCreation: 0,
          costUSD: cost,
        },
      ],
      status: 'ok',
      coverage: 'complete',
      untimestampedCount: 0,
      pricingCoverage: cost === null ? 'none' : 'full',
      scope: 'session',
    },
    subagentIds: options.subagentIds ?? [],
    savedCostState: options.savedCostState ?? null,
  };
}

/** Loaders that serve a fixed transcript: `p` and its saved cost-state. */
function loaders(p: SessionStatsPrefix | null): RunPreparationLoaders {
  return {
    loadPrefix: async () => p,
    loadSavedCostState: async () => p?.savedCostState ?? null,
  };
}

/** Prefix cost 10 whose transcript saved a running total of 10. */
const SAVED_10 = saved(10, { [MODEL]: { input: 100, output: 10, cacheRead: 50 } });

describe('resolveRunBase', () => {
  it('restored when the first result covers every saved model in every class', () => {
    const first = run(13, [{ input: 130, output: 13, cacheRead: 50 }]);
    expect(resolveRunBase(SAVED_10, first)).toBe(SAVED_10);
  });

  it('still restored when the first result adds a model the saved state lacks', () => {
    const first = run(14, [
      { input: 130, output: 13, cacheRead: 50, costUSD: 13 },
      { model: 'zz-new-model', input: 5, output: 5, costUSD: 1 },
    ]);
    expect(resolveRunBase(SAVED_10, first)).toBe(SAVED_10);
  });

  it('reset when the first result is below the saved state in one class only', () => {
    const first = run(13, [{ input: 130, output: 13, cacheRead: 49 }]);
    expect(resolveRunBase(SAVED_10, first)).toBeNull();
  });

  it('reset when a saved model with usage is missing from the first result', () => {
    const first = run(3, [{ model: 'zz-other', input: 500, output: 50 }]);
    expect(resolveRunBase(SAVED_10, first)).toBeNull();
  });

  it('zero base without a saved state', () => {
    expect(resolveRunBase(null, run(3))).toBeNull();
  });
});

describe('subtractRunBase', () => {
  it('reported: subtracts tokens per class and dollars per row and total', () => {
    const own = subtractRunBase(
      run(13, [{ input: 130, output: 13, cacheRead: 50 }]),
      SAVED_10,
    );
    expect(own.totalCost).toBe(3);
    expect(own.models).toEqual([
      {
        model: MODEL,
        inputTokens: 30,
        outputTokens: 3,
        cacheRead: 0,
        cacheCreation: 0,
        costUSD: 3,
      },
    ]);
  });

  it('reported: unknown dollars on either side stay unknown', () => {
    const unknownSaved: SavedCostState = { ...SAVED_10, hasUnknownModelCost: true };
    expect(
      subtractRunBase(run(13, [{ input: 130, output: 13, cacheRead: 50 }]), unknownSaved)
        .totalCost,
    ).toBeNull();
  });

  it('unreported: reprices the token difference with the row rate', () => {
    const rate: ModelPricing = {
      inputCostPerToken: 0.01,
      outputCostPerToken: 0.1,
      cacheReadCostPerToken: 0.001,
    };
    const own = subtractRunBase(
      run(
        999,
        [{ input: 130, output: 13, cacheRead: 150, costUSD: 999, pricing: rate }],
        { unreported: true },
      ),
      SAVED_10,
    );
    const expected = 30 * 0.01 + 3 * 0.1 + 100 * 0.001;
    expect(own.models[0].costUSD).toBeCloseTo(expected, 6);
    expect(own.totalCost).toBeCloseTo(expected, 6);
  });

  it('zero base leaves the result untouched', () => {
    const result = run(3);
    expect(subtractRunBase(result, null)).toBe(result);
  });
});

describe('SessionStatsOwnerService', () => {
  /** A new owner (brand-new session) with one registered run. */
  function fresh(runToken = 'run-1'): {
    owner: SessionStatsOwnerService;
    gen: number;
  } {
    const owner = new SessionStatsOwnerService();
    const { generation } = owner.startNew(SESSION);
    owner.beginRun(SESSION, generation, runToken, null);
    return { owner, gen: generation };
  }

  it('replaces cumulative results within a run and adds separate runs once', () => {
    const { owner, gen } = fresh('run-A');
    owner.beginRun(SESSION, gen, 'run-B', null);

    expect(
      owner.replaceRun(SESSION, gen, 'run-A', run(10, [{ input: 10 }])).outcome,
    ).toBe('accepted');
    expect(
      owner.replaceRun(SESSION, gen, 'run-A', run(15, [{ input: 20 }])).outcome,
    ).toBe('accepted');
    expect(
      owner.replaceRun(SESSION, gen, 'run-A', run(15, [{ input: 20 }])).outcome,
    ).toBe('duplicate');
    const afterB = owner.replaceRun(
      SESSION,
      gen,
      'run-B',
      run(3, [{ input: 10 }]),
    );

    // 15 (latest of run A) + 3 (run B). Adding every result gives 28 or 43.
    expect(afterB.snapshot?.totalCost).toBe(18);
    expect(afterB.snapshot?.tokens.input).toBe(20 + 10);
    expect(afterB.snapshot?.scope).toBe('session');
  });

  describe('history prefix + resumed run', () => {
    async function resumedRun(p: SessionStatsPrefix | null) {
      const owner = new SessionStatsOwnerService();
      const prep = await owner.prepareRun(SESSION, loaders(p));
      owner.beginRun(SESSION, prep.generation, 'run-1', prep.candidate);
      const offer = (r: RunUsageResult) =>
        owner.replaceRun(SESSION, prep.generation, 'run-1', r).snapshot;
      return { owner, prep, offer };
    }

    it('restored: prefix 10, cost-state 10, R1 13 -> 13, then 15 -> 15', async () => {
      const { offer } = await resumedRun(prefix(10, { savedCostState: SAVED_10 }));
      expect(
        offer(run(13, [{ input: 130, output: 13, cacheRead: 50 }]))?.totalCost,
      ).toBe(13);
      expect(
        offer(run(15, [{ input: 150, output: 15, cacheRead: 50 }]))?.totalCost,
      ).toBe(15);
    });

    it('reset: prefix 10, cost-state 10, R1 3 -> 13', async () => {
      const { offer } = await resumedRun(prefix(10, { savedCostState: SAVED_10 }));
      expect(offer(run(3, [{ input: 30, output: 3 }]))?.totalCost).toBe(13);
    });

    it('no cost-state: prefix 10, R1 3 -> 13', async () => {
      const { offer } = await resumedRun(prefix(10));
      expect(offer(run(3))?.totalCost).toBe(13);
    });

    it('restored with a model new in R1 still subtracts the saved state', async () => {
      const { offer } = await resumedRun(prefix(10, { savedCostState: SAVED_10 }));
      const snapshot = offer(
        run(14, [
          { input: 130, output: 13, cacheRead: 50, costUSD: 13 },
          { model: 'zz-new-model', input: 5, output: 5, costUSD: 1 },
        ]),
      );
      expect(snapshot?.totalCost).toBe(14);
    });

    it('R1 below the cost-state in one class only is a reset', async () => {
      const { offer } = await resumedRun(prefix(10, { savedCostState: SAVED_10 }));
      expect(
        offer(run(13, [{ input: 130, output: 13, cacheRead: 49 }]))?.totalCost,
      ).toBe(23);
    });

    it('an unreadable prefix is partial with no total, keeping the known subtotal', async () => {
      const { offer } = await resumedRun(null);
      const snapshot = offer(run(3));
      expect(snapshot?.totalCost).toBeNull();
      expect(snapshot?.knownCost).toBe(3);
      expect(snapshot?.coverage).toBe('partial');
    });
  });

  // Review F1: a later run's restore candidate is the RAW cost-state on disk
  // when that run is prepared — never the previous run's in-memory value and
  // never a normalized (rate-card) dollar figure.
  describe('restore candidate per run (review F1)', () => {
    const DISK_100_10 = saved(10, { [MODEL]: { input: 100, costUSD: 10 } });

    it('run B restores the disk state run A never saved: lifetime 170/$17', async () => {
      const owner = new SessionStatsOwnerService();
      let disk: SavedCostState | null = DISK_100_10;
      const load = {
        loadPrefix: async () =>
          prefix(10, { tokens: 100, savedCostState: DISK_100_10 }),
        loadSavedCostState: async () => disk,
      };

      const a = await owner.prepareRun(SESSION, load);
      owner.beginRun(SESSION, a.generation, 'run-A', a.candidate);
      owner.replaceRun(
        SESSION,
        a.generation,
        'run-A',
        run(15, [{ input: 150, output: 0 }]),
      );
      // Run A's process ended without writing a new cost-state.
      disk = DISK_100_10;

      const b = await owner.prepareRun(SESSION, load);
      owner.beginRun(SESSION, b.generation, 'run-B', b.candidate);
      const snapshot = owner.replaceRun(
        SESSION,
        b.generation,
        'run-B',
        run(12, [{ input: 120, output: 0 }]),
      ).snapshot;

      expect(b.candidate).toBe(DISK_100_10);
      expect(snapshot?.tokens.input).toBe(170);
      expect(snapshot?.totalCost).toBe(17);
    });

    it('an unreported run then a reported run: $13, not $10', async () => {
      const owner = new SessionStatsOwnerService();
      // Run A (unreported route) priced 100 tokens at $10 from the rate card;
      // the SDK itself saved $0 for them.
      const diskAfterA = saved(0, { [MODEL]: { input: 100, costUSD: 0 } });
      let disk: SavedCostState | null = null;
      const load = {
        loadPrefix: async () => prefix(0, { tokens: 0 }),
        loadSavedCostState: async () => disk,
      };

      const a = await owner.prepareRun(SESSION, load);
      owner.beginRun(SESSION, a.generation, 'run-A', a.candidate);
      owner.replaceRun(
        SESSION,
        a.generation,
        'run-A',
        run(10, [{ input: 100, output: 0 }], { unreported: true }),
      );
      disk = diskAfterA;

      const b = await owner.prepareRun(SESSION, load);
      owner.beginRun(SESSION, b.generation, 'run-B', b.candidate);
      const snapshot = owner.replaceRun(
        SESSION,
        b.generation,
        'run-B',
        run(3, [{ input: 130, output: 0 }]),
      ).snapshot;

      expect(snapshot?.totalCost).toBe(13);
    });
  });

  // Review F2: a model that grew while another vanished is an incomplete
  // map, not a reset.
  it('rejects a truncated map atomically, then recovers: 150/$15 -> 150/$15 -> 170/$17', () => {
    const { owner, gen } = fresh();
    const offer = (r: RunUsageResult) =>
      owner.replaceRun(SESSION, gen, 'run-1', r);
    const both = offer(
      run(15, [
        { model: 'A', input: 100, output: 0, costUSD: 10 },
        { model: 'B', input: 50, output: 0, costUSD: 5 },
      ]),
    ).snapshot;

    const truncated = offer(
      run(16, [{ model: 'A', input: 110, output: 0, costUSD: 11 }]),
    );
    expect(truncated.outcome).toBe('rejected-non-monotonic');
    expect(truncated.firstRejection).toBe(true);
    expect(truncated.snapshot).toBe(both);
    expect(truncated.snapshot?.tokens.input).toBe(150);
    expect(truncated.snapshot?.totalCost).toBe(15);

    const recovered = offer(
      run(17, [
        { model: 'A', input: 120, output: 0, costUSD: 12 },
        { model: 'B', input: 50, output: 0, costUSD: 5 },
      ]),
    ).snapshot;
    expect(recovered?.tokens.input).toBe(170);
    expect(recovered?.totalCost).toBe(17);
  });

  // Re-review N1: counters that move in mixed directions inside one run are
  // not a reset (Ptah never sends `/clear` to the SDK) — reject atomically.
  it('rejects mixed counter movement, then accepts the next grown result: 10/100/$11 -> 10/100/$11 -> 30/120/$15', () => {
    const { owner, gen } = fresh();
    const offer = (r: RunUsageResult) =>
      owner.replaceRun(SESSION, gen, 'run-1', r);
    offer(run(11, [{ input: 10, output: 100 }]));

    const mixed = offer(run(2.1, [{ input: 20, output: 1 }]));
    expect(mixed.outcome).toBe('rejected-non-monotonic');
    expect(mixed.snapshot?.tokens).toMatchObject({ input: 10, output: 100 });
    expect(mixed.snapshot?.totalCost).toBe(11);

    const grown = offer(run(15, [{ input: 30, output: 120 }])).snapshot;
    expect(grown?.tokens).toMatchObject({ input: 30, output: 120 });
    expect(grown?.totalCost).toBe(15);
  });

  // Re-review residual F2: an unchanged surviving row with a missing model is
  // a truncated map, not a reset.
  it('rejects a truncated map whose surviving row is unchanged: 150/$15, then 170/$17', () => {
    const { owner, gen } = fresh();
    const offer = (r: RunUsageResult) =>
      owner.replaceRun(SESSION, gen, 'run-1', r);
    offer(
      run(15, [
        { model: 'A', input: 100, output: 0, costUSD: 10 },
        { model: 'B', input: 50, output: 0, costUSD: 5 },
      ]),
    );

    const truncated = offer(
      run(10, [{ model: 'A', input: 100, output: 0, costUSD: 10 }]),
    );
    expect(truncated.outcome).toBe('rejected-non-monotonic');
    // Reported (logged) once per run, not on every rejected result.
    expect(truncated.firstRejection).toBe(true);
    expect(
      offer(run(10, [{ model: 'A', input: 100, output: 0, costUSD: 10 }]))
        .firstRejection,
    ).toBe(false);
    expect(truncated.snapshot?.tokens.input).toBe(150);
    expect(truncated.snapshot?.totalCost).toBe(15);

    const recovered = offer(
      run(17, [
        { model: 'A', input: 120, output: 0, costUSD: 12 },
        { model: 'B', input: 50, output: 0, costUSD: 5 },
      ]),
    ).snapshot;
    expect(recovered?.tokens.input).toBe(170);
    expect(recovered?.totalCost).toBe(17);
  });

  // Review F3: known-missing usage is never a total, and a later complete
  // cumulative result for the run recovers it.
  describe('incomplete runs (review F3)', () => {
    it('a gap nulls the total, keeps the priced subtotal, and recovers', () => {
      const { owner, gen } = fresh();
      owner.replaceRun(SESSION, gen, 'run-1', run(5, [{ input: 50 }]));

      const gap = owner.markRunIncomplete(SESSION, gen, 'run-1');
      expect(gap?.totalCost).toBeNull();
      expect(gap?.knownCost).toBe(5);
      expect(gap?.pricingCoverage).not.toBe('full');
      expect(gap?.coverage).toBe('partial');

      const recovered = owner.replaceRun(
        SESSION,
        gen,
        'run-1',
        run(6, [{ input: 60 }]),
      ).snapshot;
      expect(recovered?.totalCost).toBe(6);
      expect(recovered?.coverage).toBe('complete');
      expect(recovered?.pricingCoverage).toBe('full');
    });
  });

  it('ignores a zeroed error/startup result', () => {
    const { owner, gen } = fresh();
    owner.replaceRun(SESSION, gen, 'run-1', run(15, [{ input: 150 }]));
    const before = owner.snapshot(SESSION);

    const zeroed = owner.replaceRun(
      SESSION,
      gen,
      'run-1',
      run(0, [{ input: 0, output: 0, costUSD: 0 }], { isErrorResult: true }),
    );

    expect(zeroed.outcome).toBe('ignored-error');
    expect(owner.snapshot(SESSION)).toBe(before);
  });

  it('retains accepted state for empty and malformed results', () => {
    const { owner, gen } = fresh();
    const offer = (r: RunUsageResult) =>
      owner.replaceRun(SESSION, gen, 'run-1', r).outcome;
    offer(
      run(5, [
        { model: 'zz-a', input: 50, costUSD: 4 },
        { model: 'zz-b', input: 5, costUSD: 1 },
      ]),
    );
    const accepted = owner.snapshot(SESSION);

    expect(offer(run(0, []))).toBe('rejected-invalid');
    expect(
      offer(
        run(6, [
          { model: 'zz-a', input: 60, cacheCreation: -1, costUSD: 5 },
          { model: 'zz-b', input: 5, costUSD: 1 },
        ]),
      ),
    ).toBe('rejected-invalid');
    expect(
      offer(
        run(Number.NaN, [
          { model: 'zz-a', input: 60, costUSD: 5 },
          { model: 'zz-b', input: 5, costUSD: 1 },
        ]),
      ),
    ).toBe('rejected-invalid');

    expect(owner.snapshot(SESSION)).toBe(accepted);
  });

  it('accepts a complete result that adds an unpriced model and nulls the total', () => {
    const { owner, gen } = fresh();
    owner.replaceRun(
      SESSION,
      gen,
      'run-1',
      run(2, [{ model: 'zz-a', costUSD: 2 }]),
    );

    const result = owner.replaceRun(
      SESSION,
      gen,
      'run-1',
      run(null, [
        { model: 'zz-a', costUSD: 2 },
        { model: 'zz-unpriced', costUSD: null },
      ]),
    );

    expect(result.outcome).toBe('accepted');
    expect(result.snapshot?.totalCost).toBeNull();
    expect(result.snapshot?.knownCost).toBe(2);
    expect(result.snapshot?.pricingCoverage).toBe('partial');
  });

  it('keeps a reported zero as a known zero', () => {
    const { owner, gen } = fresh();
    const result = owner.replaceRun(SESSION, gen, 'run-1', run(0));
    expect(result.snapshot?.totalCost).toBe(0);
    expect(result.snapshot?.pricingCoverage).toBe('full');
  });

  it('does not let a proven-empty prefix poison a priced run', () => {
    const { owner, gen } = fresh();
    expect(owner.snapshot(SESSION)).toMatchObject({
      status: 'empty',
      totalCost: null,
      tokenCount: 0,
    });
    expect(
      owner.replaceRun(SESSION, gen, 'run-1', run(3)).snapshot?.totalCost,
    ).toBe(3);
  });

  it('loads the cold prefix once even for concurrent launches', async () => {
    const owner = new SessionStatsOwnerService();
    let loads = 0;
    let release!: (p: SessionStatsPrefix) => void;
    const gate = new Promise<SessionStatsPrefix>((resolve) => {
      release = resolve;
    });
    const load = {
      loadPrefix: async (): Promise<SessionStatsPrefix> => {
        loads++;
        return gate;
      },
      loadSavedCostState: async () => null,
    };

    const a = owner.prepareRun(SESSION, load);
    const b = owner.prepareRun(SESSION, load);
    release(prefix(10, { savedCostState: SAVED_10 }));
    const [prepA, prepB] = await Promise.all([a, b]);

    expect(loads).toBe(1);
    expect(prepA.candidate).toBe(SAVED_10);
    expect(prepB.candidate).toBe(SAVED_10);
    expect(owner.snapshot(SESSION)?.totalCost).toBe(10);
  });

  it('counts aliases for five agents as five', async () => {
    const owner = new SessionStatsOwnerService();
    await owner.prepareRun(
      SESSION,
      loaders(prefix(1, { subagentIds: ['agent-a1', 'agent-a2', 'a2'] })),
    );

    owner.recordAgent(SESSION, 'a1'); // start hook for a transcript-known agent
    owner.recordAgent(SESSION, 'a3');
    owner.recordAgent(SESSION, 'agent-a3'); // file-name alias of the same agent
    owner.recordAgent(SESSION, 'a4');
    owner.recordAgent(SESSION, 'a5');
    owner.recordAgent(SESSION, 'a5'); // stop hook for the same agent
    owner.recordAgent(SESSION, '   ');

    expect(owner.snapshot(SESSION)?.agentSessionCount).toBe(5);
  });

  it('moves a provisional key to the canonical id without cloning', () => {
    const owner = new SessionStatsOwnerService();
    const { generation } = owner.startNew('tab-1');
    owner.rebind('tab-1', SESSION, generation);
    owner.replaceRun(SESSION, generation, 'run-1', run(3));

    expect(owner.snapshot('tab-1')).toBeNull();
    expect(owner.snapshot(SESSION)).toMatchObject({
      sessionId: SESSION,
      totalCost: 3,
    });
  });

  it('publishes immutable snapshots with an increasing revision', () => {
    const { owner, gen } = fresh();
    const first = owner.replaceRun(SESSION, gen, 'run-1', run(1)).snapshot;
    const second = owner.replaceRun(SESSION, gen, 'run-1', run(2)).snapshot;
    expect(Object.isFrozen(first)).toBe(true);
    expect(second?.revision).toBeGreaterThan(first?.revision ?? 0);
    expect(owner.replaceRun(SESSION, gen, 'run-1', run(2)).snapshot).toBe(
      second,
    );
  });

  // Review F5: owner generations and run epochs across async teardown.
  describe('owner generations (review F5)', () => {
    it('a late result after release cannot resurrect the owner; the next prepareRun seeds normally', async () => {
      const { owner, gen } = fresh();
      owner.replaceRun(SESSION, gen, 'run-1', run(1));
      const lease = owner.leaseOf(SESSION);
      expect(lease && owner.release(lease)).toBe(true);

      const late = owner.replaceRun(SESSION, gen, 'run-1', run(2));
      expect(late).toEqual({
        outcome: 'stale-owner',
        snapshot: null,
        firstRejection: false,
      });
      expect(owner.markRunIncomplete(SESSION, gen, 'run-1')).toBeNull();
      expect(owner.snapshot(SESSION)).toBeNull();

      const prep = await owner.prepareRun(SESSION, loaders(prefix(7)));
      expect(prep.generation).not.toBe(gen);
      expect(owner.snapshot(SESSION)?.totalCost).toBe(7);
    });

    it('an old teardown after a replacement leaves the replacement intact', async () => {
      const owner = new SessionStatsOwnerService();
      const first = await owner.prepareRun(SESSION, loaders(prefix(10)));
      owner.beginRun(SESSION, first.generation, 'run-old', first.candidate);
      // Teardown of the old query captures the owner, then awaits.
      const captured = owner.leaseOf(SESSION);

      // Meanwhile a replacement run is prepared on the same session.
      const second = await owner.prepareRun(SESSION, loaders(prefix(10)));
      owner.beginRun(SESSION, second.generation, 'run-new', second.candidate);
      owner.replaceRun(SESSION, second.generation, 'run-new', run(3));

      // The old teardown completes.
      expect(captured && owner.release(captured)).toBe(false);
      expect(owner.snapshot(SESSION)?.totalCost).toBe(13);
    });

    // Re-review residual F5: the lease follows its owner across a rebind.
    it('releases the captured owner after a provisional-to-canonical rebind', () => {
      const owner = new SessionStatsOwnerService();
      const { generation } = owner.startNew('tab-1');
      const captured = owner.leaseOf('tab-1');
      owner.rebind('tab-1', SESSION, generation);

      expect(captured && owner.release(captured)).toBe(true);
      expect(owner.snapshot(SESSION)).toBeNull();
    });

    it('a teardown of a replaced owner (new session on the key) is a no-op', () => {
      const owner = new SessionStatsOwnerService();
      owner.startNew(SESSION);
      const captured = owner.leaseOf(SESSION);
      const { generation } = owner.startNew(SESSION);
      owner.replaceRun(SESSION, generation, 'run-1', run(4));

      expect(captured && owner.release(captured)).toBe(false);
      expect(owner.snapshot(SESSION)?.totalCost).toBe(4);
    });
  });
});
