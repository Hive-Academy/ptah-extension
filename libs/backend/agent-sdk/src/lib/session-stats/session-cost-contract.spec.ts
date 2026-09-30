/**
 * Session cost contract — live-vs-disk parity and end-to-end `[1m]` pricing
 * (TASK_2026_575 Batch 6, scope decisions 2, 5, 6(d)(e); research-addendum.md
 * Q1, Q3).
 *
 * Q1 established that the SDK's cumulative `modelUsage` / `total_cost_usd`
 * already include Task-subagent spend (main loop + subagents + sidechains),
 * while the disk aggregator independently re-derives the same figure by
 * summing the parent transcript's own per-message usage PLUS each subagent
 * transcript's own usage. Both paths should converge on the same dollar
 * total for the same underlying usage; `recordAgent` must only ever change
 * the agent COUNT, never cost.
 *
 * GUARD TESTS (R10): every case below describes behaviour that is already
 * correct on this branch, so none of them can fail-first against base. Each
 * was proven to actually bite by a deliberate mutation of the production
 * file it guards, run once to observe the failing assertion, then reverted
 * exactly (`git diff HEAD -- <file>` clean). The mutations are recorded in
 * test-report.md, never left in this file or in production code.
 */

import 'reflect-metadata';

import {
  calculateMessageCost,
  findModelPricing,
  resetPricingMapForTesting,
  updatePricingMap,
  type ModelPricing,
} from '@ptah-extension/shared';
import {
  SessionStatsOwnerService,
  type RunModelUsage,
  type RunUsageResult,
} from './session-stats-owner.service';
import { aggregateSessionUsage, type PricingLookup } from './session-usage-aggregator';
import {
  SessionUsageLedgerBuilder,
  type SessionUsageLedger,
} from './session-usage-ledger';

const SESSION = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000575';
const SESSION_RESTART = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000576';

const MODEL_A = 'zz-contract-parent';
const MODEL_B = 'zz-contract-sub';

const RATE_A: ModelPricing = {
  inputCostPerToken: 0.000003,
  outputCostPerToken: 0.000015,
};
const RATE_B: ModelPricing = {
  inputCostPerToken: 0.000001,
  outputCostPerToken: 0.000005,
};

const lookup: PricingLookup = (model) => {
  if (model === MODEL_A) return RATE_A;
  if (model === MODEL_B) return RATE_B;
  return null;
};

function ledger(lines: readonly object[]): SessionUsageLedger {
  const builder = new SessionUsageLedgerBuilder();
  for (const line of lines) builder.visit(JSON.stringify(line));
  return builder.build();
}

function assistantLine(
  id: string,
  model: string,
  usage: Record<string, number>,
): object {
  return {
    type: 'assistant',
    sessionId: SESSION,
    timestamp: new Date(2026, 0, 1).toISOString(),
    message: {
      role: 'assistant',
      id,
      model,
      content: [{ type: 'text', text: 'content is never retained' }],
      usage,
    },
  };
}

/**
 * One row of a live cumulative `modelUsage`-style result, unreported route.
 * Mirrors `stream-transformer.ts:573-609`: on the unreported route each row's
 * `costUSD` is priced from its OWN (cumulative-so-far) tokens at build time —
 * `subtractRunBase` only reprices the delta when a non-null base is
 * subtracted; with a null base it returns the result unchanged, so a row must
 * already carry its own priced cost.
 */
function row(
  model: string,
  input: number,
  output: number,
  pricing: ModelPricing | null,
): RunModelUsage {
  const costUSD = pricing
    ? calculateMessageCost(model, { input, output }, pricing)
    : null;
  return {
    model,
    inputTokens: input,
    outputTokens: output,
    cacheRead: 0,
    cacheCreation: 0,
    costUSD,
    pricing,
  };
}

/**
 * Mirrors `stream-transformer.ts:656-669`: the run's top-level `totalCost` is
 * the sum of its rows' `costUSD`, or `null` when any row is unpriced.
 */
function unreportedResult(models: readonly RunModelUsage[]): RunUsageResult {
  const totalCost = models.some((m) => m.costUSD === null)
    ? null
    : models.reduce((sum, m) => sum + (m.costUSD ?? 0), 0);
  return { totalCost, costSource: 'unreported', models };
}

describe('session cost contract — live-vs-disk parity (scope 6e)', () => {
  // Test isolation for the global runtime pricing map (`findModelPricing`'s
  // backing store) — only the `[1m]` case below registers into it.
  afterEach(() => {
    resetPricingMapForTesting();
  });

  it('owner totalCost from cumulative modelUsage (parent + subagent) equals the disk aggregate of the equivalent parent+subagent ledgers', () => {
    // Disk side: parent transcript has three of its OWN (per-call, not
    // cumulative) usage lines; the subagent transcript has one.
    const parent = ledger([
      assistantLine('m1', MODEL_A, { input_tokens: 100, output_tokens: 50 }),
      assistantLine('m2', MODEL_A, { input_tokens: 80, output_tokens: 40 }),
      assistantLine('m3', MODEL_A, { input_tokens: 60, output_tokens: 20 }),
    ]);
    const subagent = ledger([
      assistantLine('s1', MODEL_B, { input_tokens: 200, output_tokens: 100 }),
    ]);
    const disk = aggregateSessionUsage(
      {
        sessionId: SESSION,
        parent,
        subagents: [subagent],
        unreadableSubagents: 0,
        subagentIds: ['agent-s1'],
        scope: { kind: 'session' },
      },
      lookup,
    );
    expect(disk.totalCost).not.toBeNull();

    // Live side: the SDK's `modelUsage` is CUMULATIVE per query and already
    // includes subagent spend (Q1) — drive the owner with several results
    // that grow the same way a real run would: parent-only, then parent +
    // subagent once the Task subagent finishes, then final.
    const owner = new SessionStatsOwnerService();
    const lease = owner.startNew(SESSION);
    owner.beginRun(SESSION, lease.generation, 'run-1', null);

    const r1 = owner.replaceRun(
      SESSION,
      lease.generation,
      'run-1',
      unreportedResult([row(MODEL_A, 100, 50, RATE_A)]),
    );
    const r2 = owner.replaceRun(
      SESSION,
      lease.generation,
      'run-1',
      unreportedResult([
        row(MODEL_A, 180, 90, RATE_A),
        row(MODEL_B, 200, 100, RATE_B),
      ]),
    );
    const r3 = owner.replaceRun(
      SESSION,
      lease.generation,
      'run-1',
      unreportedResult([
        row(MODEL_A, 240, 110, RATE_A),
        row(MODEL_B, 200, 100, RATE_B),
      ]),
    );
    expect([r1.outcome, r2.outcome, r3.outcome]).toEqual([
      'accepted',
      'accepted',
      'accepted',
    ]);

    const snapshot = owner.snapshot(SESSION);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.totalCost).not.toBeNull();

    // Parity: same underlying usage, same rate card, both paths converge.
    expect(snapshot?.totalCost).toBeCloseTo(disk.totalCost as number, 6);
    expect(snapshot?.tokens).toEqual(disk.tokens);

    // Σ turnCost telescopes to the session total within 1e-6 per turn (3 turns).
    const sumTurnCost =
      (r1.turnCost ?? 0) + (r2.turnCost ?? 0) + (r3.turnCost ?? 0);
    expect(r1.turnCost).not.toBeNull();
    expect(r2.turnCost).not.toBeNull();
    expect(r3.turnCost).not.toBeNull();
    expect(Math.abs(sumTurnCost - (snapshot?.totalCost as number))).toBeLessThanOrEqual(
      3 * 1e-6 + 1e-9,
    );

    // recordAgent changes the badge COUNT only — never cost or tokens.
    const before = owner.snapshot(SESSION);
    const changed = owner.recordAgent(SESSION, 'agent-s1');
    const after = owner.snapshot(SESSION);
    // `startNew` seeded no prefix subagent ids, so this owner's `agentIds`
    // set is empty until now — a genuinely new identity via the live hook.
    expect(changed).toBe(true);
    expect(after?.agentSessionCount).toBe((before?.agentSessionCount ?? 0) + 1);
    expect(after?.totalCost).toBe(before?.totalCost);
    expect(after?.tokens).toEqual(before?.tokens);
  });

  /**
   * `findModelPricing` + `SessionStatsOwnerService` integration only: this
   * proves a `[1m]`-tagged id resolves to the base model's rate and that the
   * resolved rate flows correctly through `subtractRunBase`/`acceptedTurnCost`
   * once it is handed to the owner as a `RunModelUsage.pricing` value built by
   * hand — it does NOT exercise the transformer's own wiring (`modelResolver
   * .resolveForCost` -> `findModelPricing` -> `calculateMessageCost` inside
   * `StreamTransformer.transform`). That wiring is covered end to end by
   * `stream-transformer.spec.ts`'s `'a [1m]-tagged modelUsage key prices at
   * the base model rate on the unreported route (scope 6d)'` case.
   */
  it('findModelPricing resolves a [1m]-tagged id to the base rate, and SessionStatsOwnerService prices it correctly', () => {
    // `findModelPricing` reads the GLOBAL runtime pricing map, unlike the
    // local `lookup` used by the ledger-aggregator cases above.
    updatePricingMap({ [MODEL_A]: RATE_A });
    const taggedModel = `${MODEL_A}[1m]`;
    const resolved = findModelPricing(taggedModel);
    expect(resolved).not.toBeNull();
    expect(resolved).toEqual(RATE_A);

    const owner = new SessionStatsOwnerService();
    const lease = owner.startNew(SESSION);
    owner.beginRun(SESSION, lease.generation, 'run-1m', null);
    const outcome = owner.replaceRun(
      SESSION,
      lease.generation,
      'run-1m',
      unreportedResult([row(taggedModel, 1000, 500, resolved)]),
    );

    expect(outcome.outcome).toBe('accepted');
    expect(outcome.turnCost).not.toBeNull();
    const expected = 1000 * RATE_A.inputCostPerToken + 500 * RATE_A.outputCostPerToken;
    expect(outcome.turnCost).toBeCloseTo(expected, 6);

    const snapshot = owner.snapshot(SESSION);
    expect(snapshot?.totalCost).not.toBeNull();
    expect(snapshot?.totalCost).toBeCloseTo(expected, 6);
  });

  it('multi-run case: a resumed process restores the saved base, and the owner total matches the disk total of the combined (pre + post restart) ledger', async () => {
    // Pre-restart transcript: one assistant turn, model A.
    const preLedger = ledger([
      assistantLine('m0', MODEL_A, { input_tokens: 50, output_tokens: 20 }),
    ]);
    const prefixEntry = aggregateSessionUsage(
      {
        sessionId: SESSION_RESTART,
        parent: preLedger,
        subagents: [],
        unreadableSubagents: 0,
        subagentIds: [],
        scope: { kind: 'session' },
      },
      lookup,
    );
    expect(prefixEntry.totalCost).not.toBeNull();

    // Full transcript (pre-restart turn + the turn made after the restart).
    const fullLedger = ledger([
      assistantLine('m0', MODEL_A, { input_tokens: 50, output_tokens: 20 }),
      assistantLine('m1', MODEL_A, { input_tokens: 100, output_tokens: 50 }),
    ]);
    const fullEntry = aggregateSessionUsage(
      {
        sessionId: SESSION_RESTART,
        parent: fullLedger,
        subagents: [],
        unreadableSubagents: 0,
        subagentIds: [],
        scope: { kind: 'session' },
      },
      lookup,
    );
    expect(fullEntry.totalCost).not.toBeNull();

    const owner = new SessionStatsOwnerService();
    const savedCostState = {
      totalCostUSD: prefixEntry.totalCost,
      hasUnknownModelCost: false,
      models: {
        [MODEL_A]: {
          input: 50,
          output: 20,
          cacheRead: 0,
          cacheCreation: 0,
          costUSD: prefixEntry.totalCost,
        },
      },
    };
    const prep = await owner.prepareRun(SESSION_RESTART, {
      loadPrefix: async () => ({
        stats: prefixEntry,
        subagentIds: [],
        savedCostState,
      }),
      loadSavedCostState: async () => savedCostState,
    });
    owner.beginRun(SESSION_RESTART, prep.generation, 'run-resumed', prep.candidate);

    // The resumed process's first result: CUMULATIVE since restore (150/70),
    // reported route (the SDK's own dollar total, here made consistent with
    // the same rate card so the parity assertion is meaningful).
    const outcome = owner.replaceRun(SESSION_RESTART, prep.generation, 'run-resumed', {
      totalCost: fullEntry.totalCost,
      costSource: 'reported',
      models: [
        {
          model: MODEL_A,
          inputTokens: 150,
          outputTokens: 70,
          cacheRead: 0,
          cacheCreation: 0,
          costUSD: fullEntry.totalCost,
        },
      ],
    });

    expect(outcome.outcome).toBe('accepted');
    expect(outcome.turnCost).not.toBeNull();
    const expectedTurnCost = (fullEntry.totalCost as number) - (prefixEntry.totalCost as number);
    expect(outcome.turnCost).toBeCloseTo(expectedTurnCost, 6);

    const snapshot = owner.snapshot(SESSION_RESTART);
    expect(snapshot?.totalCost).toBeCloseTo(fullEntry.totalCost as number, 6);
  });
});
