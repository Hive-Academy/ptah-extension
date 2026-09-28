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

  // CodeRabbit: no per-model evidence means a restore cannot be proven.
  it('zero base when the saved state has no per-model rows', () => {
    expect(resolveRunBase(saved(5, {}), run(3))).toBeNull();
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

    it('cost-state without model rows: prefix 10, saved $5, R1 3 -> 13', async () => {
      const { offer } = await resumedRun(
        prefix(10, { savedCostState: saved(5, {}) }),
      );
      expect(offer(run(3))?.totalCost).toBe(13);
    });

    it('snapshot is null while the prefix read is pending, then publishes the prefix', async () => {
      const owner = new SessionStatsOwnerService();
      let finish: (p: SessionStatsPrefix | null) => void = () => undefined;
      const pendingPrefix = new Promise<SessionStatsPrefix | null>((resolve) => {
        finish = resolve;
      });
      const preparing = owner.prepareRun(SESSION, {
        loadPrefix: () => pendingPrefix,
        loadSavedCostState: async () => null,
      });

      // A concurrent history read must fall back to the transcript aggregate.
      expect(owner.snapshot(SESSION)).toBeNull();

      finish(prefix(10));
      const prep = await preparing;
      expect(owner.snapshot(SESSION)?.totalCost).toBe(10);

      owner.beginRun(SESSION, prep.generation, 'run-1', prep.candidate);
      expect(
        owner.replaceRun(SESSION, prep.generation, 'run-1', run(3)).snapshot
          ?.totalCost,
      ).toBe(13);
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
  // Follow-up: the Time chip. SDK `duration_ms` is per turn, so a run adds it
  // only for results it accepts; the snapshot knows the session duration only
  // when the prefix duration is known (0 for a brand-new session).
  describe('durationMs', () => {
    const timed = (
      cost: number,
      input: number,
      durationMs: number,
    ): RunUsageResult => ({ ...run(cost, [{ input }]), durationMs });

    it('sums accepted turn durations for a new session: 1000 + 1500 = 2500', () => {
      const { owner, gen } = fresh();
      expect(owner.snapshot(SESSION)?.durationMs).toBe(0);

      owner.replaceRun(SESSION, gen, 'run-1', timed(1, 10, 1000));
      const second = owner.replaceRun(
        SESSION,
        gen,
        'run-1',
        timed(2, 20, 1500),
      );

      expect(second.snapshot?.durationMs).toBe(2500);
    });

    it('adds nothing for duplicate, rejected, invalid or zeroed error results', () => {
      const { owner, gen } = fresh();
      const offer = (r: RunUsageResult) =>
        owner.replaceRun(SESSION, gen, 'run-1', r);
      offer(timed(1, 10, 1000));
      offer(timed(2, 20, 1500));

      expect(offer(timed(2, 20, 700)).outcome).toBe('duplicate');
      expect(offer(timed(3, 5, 900)).outcome).toBe('rejected-non-monotonic');
      expect(
        offer({ ...run(Number.NaN, [{ input: 30 }]), durationMs: 800 }).outcome,
      ).toBe('rejected-invalid');
      expect(
        offer({
          ...run(0, [{ input: 0, output: 0, costUSD: 0 }], {
            isErrorResult: true,
          }),
          durationMs: 600,
        }).outcome,
      ).toBe('ignored-error');

      expect(owner.snapshot(SESSION)?.durationMs).toBe(2500);
    });

    it('does not add an accepted result whose duration is invalid', () => {
      const { owner, gen } = fresh();
      owner.replaceRun(SESSION, gen, 'run-1', timed(1, 10, 1000));
      const accepted = owner.replaceRun(
        SESSION,
        gen,
        'run-1',
        timed(2, 20, -5),
      );

      expect(accepted.outcome).toBe('accepted');
      expect(accepted.snapshot?.durationMs).toBe(1000);
      expect(
        owner.replaceRun(SESSION, gen, 'run-1', timed(3, 30, Number.NaN))
          .snapshot?.durationMs,
      ).toBe(1000);
    });

    it('is null for a resumed session even after accepted results', async () => {
      const owner = new SessionStatsOwnerService();
      const prep = await owner.prepareRun(SESSION, loaders(prefix(10)));
      owner.beginRun(SESSION, prep.generation, 'run-1', prep.candidate);

      const snapshot = owner.replaceRun(
        SESSION,
        prep.generation,
        'run-1',
        timed(3, 30, 1000),
      ).snapshot;

      expect(snapshot?.totalCost).toBe(13);
      expect(snapshot?.durationMs).toBeNull();
    });

    it('a stale-owner result changes nothing', () => {
      const { owner, gen } = fresh();
      owner.replaceRun(SESSION, gen, 'run-1', timed(1, 10, 1000));
      const { generation: replacement } = owner.startNew(SESSION);

      expect(
        owner.replaceRun(SESSION, gen, 'run-1', timed(2, 20, 5000)).outcome,
      ).toBe('stale-owner');
      owner.replaceRun(SESSION, replacement, 'run-1', timed(1, 10, 300));
      expect(owner.snapshot(SESSION)?.durationMs).toBe(300);
    });
  });

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
        turnCost: null,
        runCostDecreased: false,
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

// TASK_2026_575: `replaceRun().turnCost` is the accepted result's OWN spend —
// the run's net-of-base cumulative now minus the net-of-base cumulative of the
// previously accepted result — so the turn costs of a run add up to that
// run's contribution to the session total, and a cumulative figure is never
// handed out as one message's cost.
describe('SessionStatsOwnerService.replaceRun turnCost (TASK_2026_575)', () => {
  const RATE: ModelPricing = {
    inputCostPerToken: 0.01,
    outputCostPerToken: 0.1,
    cacheReadCostPerToken: 0.001,
  };

  function freshRun(runToken = 'run-1') {
    const owner = new SessionStatsOwnerService();
    const { generation } = owner.startNew(SESSION);
    owner.beginRun(SESSION, generation, runToken, null);
    const offer = (r: RunUsageResult, token = runToken) =>
      owner.replaceRun(SESSION, generation, token, r);
    return { owner, gen: generation, offer };
  }

  async function resumed(p: SessionStatsPrefix) {
    const owner = new SessionStatsOwnerService();
    const prep = await owner.prepareRun(SESSION, loaders(p));
    owner.beginRun(SESSION, prep.generation, 'run-1', prep.candidate);
    const offer = (r: RunUsageResult) =>
      owner.replaceRun(SESSION, prep.generation, 'run-1', r);
    return { owner, offer };
  }

  it('fresh reported run: each accepted result carries its own delta, never the cumulative', () => {
    const { offer } = freshRun();
    const first = offer(run(10, [{ input: 100 }]));
    const second = offer(run(15, [{ input: 150 }]));
    const third = offer(run(22, [{ input: 220 }]));

    expect([first.turnCost, second.turnCost, third.turnCost]).toEqual([
      10, 5, 7,
    ]);
    expect(third.snapshot?.totalCost).toBe(22);
    // The last message's cost is its turn, not the session total.
    expect(third.turnCost).not.toBe(third.snapshot?.totalCost);
  });

  it('restored reported base: turn costs sum to the snapshot total minus the prefix', async () => {
    const { offer } = await resumed(prefix(10, { savedCostState: SAVED_10 }));
    const results = [
      offer(run(13, [{ input: 130, output: 13, cacheRead: 50 }])),
      offer(run(15, [{ input: 150, output: 15, cacheRead: 50 }])),
      offer(run(18.5, [{ input: 185, output: 18, cacheRead: 60 }])),
    ];
    const turns = results.map((r) => r.turnCost);
    const total = results[2].snapshot?.totalCost ?? Number.NaN;

    // First result of the resumed run: the restored base (10) is not its spend.
    expect(turns[0]).toBe(3);
    expect(turns[1]).toBe(2);
    expect(turns[2]).toBeCloseTo(3.5, 6);
    expect(total).toBeCloseTo(18.5, 6);
    const sum = turns.reduce<number>((s, t) => s + (t ?? Number.NaN), 0);
    expect(sum).toBeCloseTo(total - 10, 6);
    expect(turns[2]).not.toBe(total);
  });

  it('restored unreported base: token deltas are repriced on both sides (net-of-base)', async () => {
    const { offer } = await resumed(prefix(10, { savedCostState: SAVED_10 }));
    // The SDK's own dollars (999) are not authoritative on this route.
    const first = offer(
      run(
        999,
        [
          {
            input: 130,
            output: 13,
            cacheRead: 50,
            costUSD: 999,
            pricing: RATE,
          },
        ],
        { unreported: true },
      ),
    );
    const second = offer(
      run(
        999,
        [
          {
            input: 150,
            output: 15,
            cacheRead: 60,
            costUSD: 999,
            pricing: RATE,
          },
        ],
        { unreported: true },
      ),
    );
    const net1 = 30 * 0.01 + 3 * 0.1 + 0 * 0.001;
    const net2 = 50 * 0.01 + 5 * 0.1 + 10 * 0.001;

    expect(first.turnCost).toBeCloseTo(net1, 6);
    expect(second.turnCost).toBeCloseTo(net2 - net1, 6);
    expect(second.snapshot?.totalCost).toBeCloseTo(10 + net2, 6);
    expect((first.turnCost ?? 0) + (second.turnCost ?? 0)).toBeCloseTo(
      (second.snapshot?.totalCost ?? 0) - 10,
      6,
    );
  });

  it('reset (base not restored): the first turn is the whole new cumulative', async () => {
    const { offer } = await resumed(prefix(10, { savedCostState: SAVED_10 }));
    // cacheRead 49 < saved 50: the process started from zero.
    const first = offer(run(3, [{ input: 130, output: 13, cacheRead: 49 }]));
    const second = offer(run(4, [{ input: 140, output: 14, cacheRead: 49 }]));

    expect(first.turnCost).toBe(3);
    expect(second.turnCost).toBe(1);
    expect(second.snapshot?.totalCost).toBe(14);
  });

  it('a new runToken is a new run measured against its own base', () => {
    const { owner, gen, offer } = freshRun('run-A');
    owner.beginRun(SESSION, gen, 'run-B', null);
    offer(run(10, [{ input: 100 }]), 'run-A');
    offer(run(15, [{ input: 150 }]), 'run-A');

    const b1 = offer(run(3, [{ input: 30 }]), 'run-B');
    const b2 = offer(run(4, [{ input: 40 }]), 'run-B');

    expect(b1.turnCost).toBe(3);
    expect(b2.turnCost).toBe(1);
    expect(b2.snapshot?.totalCost).toBe(19);
  });

  it('unpriced model: turn cost unknown (never 0), session total null, known subtotal kept', () => {
    const { offer } = freshRun();
    const priced = offer(
      run(2, [{ model: 'zz-a', costUSD: 2, pricing: RATE }], {
        unreported: true,
      }),
    );
    const mixed = offer(
      run(
        null,
        [
          { model: 'zz-a', input: 20, costUSD: 3, pricing: RATE },
          { model: 'zz-unpriced', costUSD: null, pricing: null },
        ],
        { unreported: true },
      ),
    );

    expect(priced.turnCost).toBe(2);
    expect(mixed.outcome).toBe('accepted');
    expect(mixed.turnCost).toBeNull();
    expect(mixed.snapshot?.totalCost).toBeNull();
    expect(mixed.snapshot?.knownCost).toBe(3);
  });

  it('reported run whose restored base has an unknown cost: turn cost unknown', async () => {
    const unknownBase: SavedCostState = {
      ...SAVED_10,
      hasUnknownModelCost: true,
    };
    const { offer } = await resumed(
      prefix(10, { savedCostState: unknownBase }),
    );
    const first = offer(run(13, [{ input: 130, output: 13, cacheRead: 50 }]));
    const second = offer(run(15, [{ input: 150, output: 15, cacheRead: 50 }]));

    expect(first.turnCost).toBeNull();
    expect(second.turnCost).toBeNull();
  });

  it('duplicate, rejected, invalid, ignored and stale results carry no turn cost', () => {
    const { owner, gen, offer } = freshRun();
    offer(run(10, [{ input: 100 }]));

    const duplicate = offer(run(10, [{ input: 100 }]));
    const shrunk = offer(run(12, [{ input: 90 }]));
    const invalid = offer(run(Number.NaN, [{ input: 120 }]));
    const zeroed = offer(
      run(0, [{ input: 0, output: 0, costUSD: 0 }], { isErrorResult: true }),
    );
    owner.startNew(SESSION); // replaces the owner: `gen` is now stale
    const stale = owner.replaceRun(
      SESSION,
      gen,
      'run-1',
      run(20, [{ input: 200 }]),
    );

    // A duplicate belongs to an already-published turn: it has no cost of
    // its own, and a 0 would overwrite that turn's real cost.
    expect(duplicate).toMatchObject({ outcome: 'duplicate', turnCost: null });
    expect(shrunk).toMatchObject({
      outcome: 'rejected-non-monotonic',
      turnCost: null,
    });
    expect(invalid).toMatchObject({
      outcome: 'rejected-invalid',
      turnCost: null,
    });
    expect(zeroed).toMatchObject({ outcome: 'ignored-error', turnCost: null });
    expect(stale).toMatchObject({ outcome: 'stale-owner', turnCost: null });
  });

  it('after a rejection the next accepted turn is measured from the last ACCEPTED result', () => {
    const { offer } = freshRun();
    offer(run(10, [{ input: 100 }]));
    offer(run(12, [{ input: 90 }])); // rejected-non-monotonic
    const next = offer(run(14, [{ input: 140 }]));

    expect(next.outcome).toBe('accepted');
    expect(next.turnCost).toBe(4);
    expect(next.snapshot?.totalCost).toBe(14);
  });

  it('rounds the first turn to 1e-6 like every later turn', () => {
    const { offer } = freshRun();
    const first = offer(run(0.0012345678, [{ input: 10 }]));
    const second = offer(run(0.0024691356, [{ input: 20 }]));

    expect(first.turnCost).toBe(0.001235);
    expect(second.turnCost).toBe(0.001235);
  });

  it('500 turns of non-terminating decimals: every turn rounded, drift within 1e-6 per turn', () => {
    const { offer } = freshRun();
    const turns: number[] = [];
    let last: ReturnType<typeof offer> | null = null;
    for (let k = 1; k <= 500; k++) {
      last = offer(run((k * 0.0137) / 3, [{ input: 10 * k }]));
      expect(last.outcome).toBe('accepted');
      turns.push(last.turnCost ?? Number.NaN);
    }
    const total = last?.snapshot?.totalCost ?? Number.NaN;
    const sum = turns.reduce((s, t) => s + t, 0);

    for (const t of turns) {
      expect(t).toBeGreaterThanOrEqual(0);
      expect(Math.round(t * 1e6) / 1e6).toBe(t);
    }
    // Documented tolerance: each turn is rounded to 1e-6, so the sum of a
    // run's turns may drift from its contribution by at most 1e-6 per turn.
    expect(Math.abs(sum - total)).toBeLessThanOrEqual(turns.length * 1e-6);
  });

  describe('a mid-run rate change (unreported, restored base)', () => {
    // The runtime pricing map can change during a run (a catalog hydration
    // re-registers rates) and every result is priced with the rate current at
    // that moment. Here the RAW cumulative still grows while the net-of-base
    // cost falls, because rates move in opposite directions across token
    // classes: input (all of it restored base) gets dearer while cache reads
    // (all of them this run's own) get cheaper. A plain rate drop is covered
    // below.
    const base = saved(0, {
      [MODEL]: { input: 1000, output: 0, cacheRead: 0 },
    });
    const RATE_1: ModelPricing = {
      inputCostPerToken: 0.001,
      outputCostPerToken: 0,
      cacheReadCostPerToken: 0.001,
    };
    // `output` is free at every rate here; growing it makes a later result a
    // new turn (identical tokens at a new rate would be a `duplicate`).
    const priced = (raw: number, rate: ModelPricing, output = 0) =>
      run(
        raw,
        [
          {
            input: 1000,
            output,
            cacheRead: 1000,
            costUSD: raw,
            pricing: rate,
          },
        ],
        { unreported: true },
      );

    it('a real decrease is an unknown turn cost, flagged for the caller, never 0', async () => {
      const { offer } = await resumed(prefix(10, { savedCostState: base }));
      const RATE_2: ModelPricing = {
        inputCostPerToken: 0.002,
        outputCostPerToken: 0,
        cacheReadCostPerToken: 0.0005,
      };
      const first = offer(priced(2, RATE_1)); // raw $2.00, own $1.00
      const second = offer(priced(2.5, RATE_2, 1)); // raw $2.50, own $0.50

      expect(first.turnCost).toBe(1);
      expect(first.runCostDecreased).toBe(false);
      expect(second.outcome).toBe('accepted');
      expect(second.turnCost).toBeNull();
      expect(second.runCostDecreased).toBe(true);
      // The snapshot keeps the rate card's current figure for the run.
      expect(second.snapshot?.totalCost).toBeCloseTo(10.5, 6);
    });

    it('a decrease within float noise (< 1e-6) is a zero turn, not flagged', async () => {
      const { offer } = await resumed(prefix(10, { savedCostState: base }));
      const NOISE: ModelPricing = {
        inputCostPerToken: 0.002,
        outputCostPerToken: 0,
        cacheReadCostPerToken: 0.001 - 4e-10, // own cost down by $4e-7
      };
      const first = offer(priced(2, RATE_1));
      const second = offer(priced(3, NOISE, 1));

      expect(first.turnCost).toBe(1);
      expect(second.outcome).toBe('accepted');
      expect(second.turnCost).toBe(0);
      expect(second.runCostDecreased).toBe(false);
    });
  });

  // R11 (TASK_2026_575 Batch 2b): on an `'unreported'` run the dollars are a
  // rate-card function of the tokens, so tokens alone decide monotonicity and
  // duplicates. A mid-run rate drop must never freeze the snapshot: the run's
  // total is priced at the rate card in force at its latest accepted result.
  describe('a mid-run rate drop on an unreported run never freezes the snapshot', () => {
    const R1: ModelPricing = { inputCostPerToken: 0.01, outputCostPerToken: 0.1 };
    const R2: ModelPricing = {
      inputCostPerToken: 0.005,
      outputCostPerToken: 0.05,
    };
    const at = (rate: ModelPricing, input: number, output: number) =>
      input * rate.inputCostPerToken + output * rate.outputCostPerToken;
    /** A cumulative unreported result priced at `rate`, as the transformer does. */
    const unreported = (
      rate: ModelPricing,
      input: number,
      output: number,
      durationMs = 1000,
    ): RunUsageResult => {
      const cost = at(rate, input, output);
      return {
        ...run(
          cost,
          [{ input, output, cacheRead: 0, costUSD: cost, pricing: rate }],
          { unreported: true },
        ),
        durationMs,
      };
    };

    it('(a) no base: the rate-drop turn is accepted with an unknown cost and the snapshot keeps advancing', () => {
      const { offer } = freshRun();
      const t1 = offer(unreported(R1, 100, 10)); // $2
      const t2 = offer(unreported(R1, 200, 20)); // $4
      const t3 = offer(unreported(R2, 300, 30)); // $3 at the cheaper rate
      const t4 = offer(unreported(R2, 400, 40)); // $4

      expect([t1.turnCost, t2.turnCost]).toEqual([2, 2]);
      expect(t3.outcome).toBe('accepted');
      expect(t3.turnCost).toBeNull();
      expect(t3.runCostDecreased).toBe(true);
      expect(t3.snapshot?.tokens).toMatchObject({ input: 300, output: 30 });
      expect(t3.snapshot?.durationMs).toBe(3000);
      expect(t3.snapshot?.totalCost).toBeCloseTo(at(R2, 300, 30), 6);

      expect(t4.outcome).toBe('accepted');
      expect(t4.turnCost).toBeCloseTo(at(R2, 100, 10), 6);
      expect(t4.runCostDecreased).toBe(false);
      expect(t4.snapshot?.tokens).toMatchObject({ input: 400, output: 40 });
      expect(t4.snapshot?.durationMs).toBe(4000);
      expect(t4.snapshot?.totalCost).toBeCloseTo(at(R2, 400, 40), 6);
    });

    it('(b) restored base: the net tokens are repriced at the new rate and the snapshot keeps advancing', async () => {
      const base = saved(10, { [MODEL]: { input: 100, output: 10 } });
      const { offer } = await resumed(prefix(10, { savedCostState: base }));
      // Raw cumulatives include the restored 100/10; the run's own spend is
      // the token difference repriced with the row's current rate.
      const t1 = offer(unreported(R1, 200, 20)); // net 100/10 = $2
      const t2 = offer(unreported(R1, 300, 30)); // net 200/20 = $4
      const t3 = offer(unreported(R2, 400, 40)); // net 300/30 at R2 = $3
      const t4 = offer(unreported(R2, 500, 50)); // net 400/40 at R2 = $4

      expect([t1.turnCost, t2.turnCost]).toEqual([2, 2]);
      expect(t3.outcome).toBe('accepted');
      expect(t3.turnCost).toBeNull();
      expect(t3.runCostDecreased).toBe(true);
      // Prefix 100 input + this run's net 300/30.
      expect(t3.snapshot?.tokens).toMatchObject({ input: 400, output: 30 });
      expect(t3.snapshot?.totalCost).toBeCloseTo(10 + at(R2, 300, 30), 6);

      expect(t4.outcome).toBe('accepted');
      expect(t4.turnCost).toBeCloseTo(at(R2, 100, 10), 6);
      expect(t4.runCostDecreased).toBe(false);
      expect(t4.snapshot?.tokens).toMatchObject({ input: 500, output: 40 });
      expect(t4.snapshot?.totalCost).toBeCloseTo(10 + at(R2, 400, 40), 6);
    });

    it('(c) identical tokens repriced at a new rate are a duplicate: no turn cost, snapshot unchanged', () => {
      const { offer } = freshRun();
      const first = offer(unreported(R1, 200, 20)); // $4
      const cheaper = offer(unreported(R2, 200, 20)); // same tokens, $2
      const dearer = offer(
        unreported({ inputCostPerToken: 0.02, outputCostPerToken: 0.2 }, 200, 20),
      ); // same tokens, $8

      for (const repriced of [cheaper, dearer]) {
        expect(repriced).toMatchObject({
          outcome: 'duplicate',
          turnCost: null,
          runCostDecreased: false,
        });
        // Priced at the rate in force at the latest ACCEPTED result.
        expect(repriced.snapshot?.totalCost).toBe(4);
        expect(repriced.snapshot?.revision).toBe(first.snapshot?.revision);
        expect(repriced.snapshot?.durationMs).toBe(1000);
      }
    });

    it('(d) a token counter going down is still rejected-non-monotonic', () => {
      const { offer } = freshRun();
      offer(unreported(R1, 200, 20));
      const shrunk = offer(unreported(R2, 190, 30));
      // The run's only model is missing from the next result.
      const dropped = offer(
        run(1, [{ model: 'zz-other', input: 500, output: 50, pricing: R2 }], {
          unreported: true,
        }),
      );

      expect(shrunk).toMatchObject({
        outcome: 'rejected-non-monotonic',
        turnCost: null,
      });
      expect(dropped.outcome).toBe('rejected-non-monotonic');
      expect(dropped.snapshot?.totalCost).toBe(4);
    });

    it('(e) a reported run whose SDK total goes down is still rejected-non-monotonic', () => {
      const { offer } = freshRun();
      offer(run(10, [{ input: 100 }]));
      const lower = offer(run(8, [{ input: 150 }]));
      const sameTokensNewTotal = offer(run(9, [{ input: 100 }]));

      expect(lower).toMatchObject({
        outcome: 'rejected-non-monotonic',
        turnCost: null,
      });
      // Reported dollars stay authoritative: same tokens, different total is
      // not a duplicate.
      expect(sameTokensNewTotal.outcome).toBe('rejected-non-monotonic');
      expect(lower.snapshot?.totalCost).toBe(10);
    });

    it('mixed cost sources keep the stricter dollar check', () => {
      const { offer } = freshRun();
      offer(unreported(R1, 200, 20)); // $4
      const reportedLower = offer(run(3, [{ input: 300, output: 30 }]));

      expect(reportedLower.outcome).toBe('rejected-non-monotonic');
    });
  });
});
