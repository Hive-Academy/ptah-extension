/**
 * Golden accounting for the stats-only projection (TASK_2026_411 B4).
 *
 * One parent transcript and one subagent transcript exercise every rule the
 * aggregator owns at once — duplicate lines for one API message, a compact
 * boundary, an init-model fallback, an untimestamped usage record, a malformed
 * line, mixed priced/unpriced models — and the expected totals are written out
 * by hand below so a regression shows up as a number, not a snapshot diff.
 */

import type { ModelPricing } from '@ptah-extension/shared';
import {
  SessionUsageLedgerBuilder,
  type SessionUsageLedger,
} from './session-usage-ledger';
import {
  aggregateSessionUsage,
  type PricingLookup,
} from './session-usage-aggregator';

const SESSION = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';
const T = (minute: number): number => Date.UTC(2026, 0, 1, 0, minute);
const iso = (ms: number): string => new Date(ms).toISOString();

const PRICES: Record<string, ModelPricing> = {
  'zz-priced-alpha': {
    inputCostPerToken: 0.001,
    outputCostPerToken: 0.002,
    cacheReadCostPerToken: 0.0001,
    cacheCreationCostPerToken: 0.0005,
  },
  'zz-priced-beta': { inputCostPerToken: 0.01, outputCostPerToken: 0.02 },
};
const lookup: PricingLookup = (model) => PRICES[model] ?? null;

function ledger(lines: readonly (object | string)[]): SessionUsageLedger {
  const builder = new SessionUsageLedgerBuilder();
  for (const line of lines) {
    builder.visit(typeof line === 'string' ? line : JSON.stringify(line));
  }
  return builder.build();
}

function assistant(
  id: string | undefined,
  model: string | undefined,
  timestamp: number | undefined,
  usage: Record<string, number>,
): object {
  return {
    type: 'assistant',
    sessionId: SESSION,
    ...(timestamp !== undefined && { timestamp: iso(timestamp) }),
    message: {
      role: 'assistant',
      ...(id && { id }),
      ...(model && { model }),
      content: [{ type: 'text', text: 'content is never retained' }],
      usage,
    },
  };
}

const PARENT = ledger([
  {
    type: 'user',
    sessionId: SESSION,
    timestamp: iso(T(0)),
    message: { role: 'user', content: 'a prompt that mentions "usage"' },
  },
  { type: 'system', subtype: 'init', model: 'zz-priced-alpha', timestamp: iso(T(0)) },
  // m1 streamed as two lines: the second carries the final output count.
  assistant('m1', 'zz-priced-alpha', T(1), {
    input_tokens: 100,
    output_tokens: 1,
    cache_read_input_tokens: 10,
    cache_creation_input_tokens: 5,
  }),
  assistant('m1', 'zz-priced-alpha', T(1) + 500, {
    input_tokens: 100,
    output_tokens: 40,
    cache_read_input_tokens: 10,
    cache_creation_input_tokens: 5,
  }),
  assistant('m2', 'zz-unpriced-omega', T(2), {
    input_tokens: 7,
    output_tokens: 3,
  }),
  '{"type":"assistant","message":{"usage":',
  { type: 'system', subtype: 'compact_boundary', timestamp: iso(T(3)) },
  assistant('m3', 'zz-priced-alpha', T(4), {
    input_tokens: 20,
    output_tokens: 10,
    cache_read_input_tokens: 2,
    cache_creation_input_tokens: 1,
  }),
  assistant('m4', 'zz-priced-alpha', undefined, {
    input_tokens: 1,
    output_tokens: 1,
  }),
  // No model of its own: priced as the init model.
  assistant('m5', undefined, T(5), { input_tokens: 3, output_tokens: 2 }),
]);

const SUBAGENT = ledger([
  { type: 'user', sessionId: SESSION, timestamp: iso(T(2)), message: { role: 'user', content: 'task' } },
  assistant('s1', 'zz-priced-beta', T(2), { input_tokens: 50, output_tokens: 5 }),
  assistant('s2', 'zz-priced-beta', T(6), {
    input_tokens: 1000,
    output_tokens: 1000,
  }),
]);

describe('SessionUsageLedgerBuilder', () => {
  it('keeps one record per message id with the last counters, and no content', () => {
    expect(PARENT.records).toHaveLength(5);
    expect(PARENT.records[0]).toEqual({
      timestampMs: T(1),
      model: 'zz-priced-alpha',
      input: 100,
      output: 40,
      cacheRead: 10,
      cacheCreation: 5,
      assistant: true,
      hasUsage: true,
    });
    expect(JSON.stringify(PARENT)).not.toContain('content is never retained');
    expect(PARENT.currentContextStart).toBe(2);
    expect(PARENT.initModel).toBe('zz-priced-alpha');
    expect(PARENT.firstSessionId).toBe(SESSION);
  });

  it('keeps a known counter when a later duplicate line omits it', () => {
    const built = ledger([
      assistant('m', 'x', T(0), { input_tokens: 9, output_tokens: 1 }),
      assistant('m', 'x', T(0), { output_tokens: 4 }),
    ]);
    expect(built.records).toHaveLength(1);
    expect(built.records[0]).toMatchObject({ input: 9, output: 4 });
  });

  it('treats a malformed counter as absent instead of dropping the record', () => {
    const built = ledger([
      assistant('m', 'x', T(0), {
        input_tokens: 5,
        output_tokens: -3,
      }),
    ]);
    expect(built.records[0]).toMatchObject({ input: 5, output: 0, hasUsage: true });
  });
});

describe('aggregateSessionUsage — golden accounting', () => {
  it('current-context: parent after its last boundary plus a never-compacted subagent in full', () => {
    const entry = aggregateSessionUsage(
      {
        sessionId: SESSION,
        parent: PARENT,
        subagents: [SUBAGENT],
        unreadableSubagents: 0,
        scope: { kind: 'current-context' },
      },
      lookup,
    );

    expect(entry.status).toBe('ok');
    expect(entry.tokens).toEqual({
      input: 20 + 1 + 3 + 50 + 1000,
      output: 10 + 1 + 2 + 5 + 1000,
      cacheRead: 2,
      cacheCreation: 1,
    });
    expect(entry.messageCount).toBe(3);
    expect(entry.agentSessionCount).toBe(1);
    expect(entry.coverage).toBe('complete');
    expect(entry.untimestampedCount).toBe(0);
    expect(entry.pricingCoverage).toBe('full');
    // alpha: 24 in, 13 out, 2 cache read, 1 cache creation; beta: 1050 in, 1005 out.
    const alpha = 24 * 0.001 + 13 * 0.002 + 2 * 0.0001 + 1 * 0.0005;
    const beta = 1050 * 0.01 + 1005 * 0.02;
    expect(entry.totalCost).toBeCloseTo(alpha + beta, 6);
    expect(entry.model).toBe('zz-priced-beta');
    expect(entry.modelUsageList?.map((m) => m.model)).toEqual([
      'zz-priced-beta',
      'zz-priced-alpha',
    ]);
  });

  it('range: timestamped parent and subagent usage in [since, until), boundaries ignored', () => {
    const entry = aggregateSessionUsage(
      {
        sessionId: SESSION,
        parent: PARENT,
        subagents: [SUBAGENT],
        unreadableSubagents: 0,
        scope: { kind: 'range', since: T(1), until: T(6) },
      },
      lookup,
    );

    // m1 + m2 + m3 + m5 from the parent, s1 from the subagent. m4 has no
    // timestamp; s2 sits exactly on `until` and is excluded.
    expect(entry.tokens).toEqual({
      input: 100 + 7 + 20 + 3 + 50,
      output: 40 + 3 + 10 + 2 + 5,
      cacheRead: 12,
      cacheCreation: 6,
    });
    expect(entry.messageCount).toBe(4);
    expect(entry.untimestampedCount).toBe(1);
    expect(entry.coverage).toBe('partial');
    expect(entry.pricingCoverage).toBe('partial');
    const alpha = 123 * 0.001 + 52 * 0.002 + 12 * 0.0001 + 6 * 0.0005;
    const beta = 50 * 0.01 + 5 * 0.02;
    expect(entry.totalCost).toBeCloseTo(alpha + beta, 6);
    expect(entry.modelUsageList).toEqual([
      { model: 'zz-priced-beta', inputTokens: 50, outputTokens: 5, costUSD: expect.closeTo(beta, 6) },
      { model: 'zz-priced-alpha', inputTokens: 123, outputTokens: 52, costUSD: expect.closeTo(alpha, 6) },
      { model: 'zz-unpriced-omega', inputTokens: 7, outputTokens: 3, costUSD: null },
    ]);
  });

  it('reports a null cost and no pricing coverage when no counted model has a rate', () => {
    const entry = aggregateSessionUsage(
      {
        sessionId: SESSION,
        parent: PARENT,
        subagents: [],
        unreadableSubagents: 0,
        scope: { kind: 'current-context' },
      },
      () => null,
    );
    expect(entry.status).toBe('ok');
    expect(entry.totalCost).toBeNull();
    expect(entry.pricingCoverage).toBe('none');
  });

  it('marks coverage partial when a member subagent transcript was unreadable', () => {
    const entry = aggregateSessionUsage(
      {
        sessionId: SESSION,
        parent: PARENT,
        subagents: [SUBAGENT],
        unreadableSubagents: 1,
        scope: { kind: 'current-context' },
      },
      lookup,
    );
    expect(entry.coverage).toBe('partial');
    expect(entry.agentSessionCount).toBe(2);
  });

  it('is empty when a compaction left no usage in the current context', () => {
    const compacted = ledger([
      assistant('old', 'zz-priced-alpha', T(0), { input_tokens: 5, output_tokens: 5 }),
      { type: 'system', subtype: 'compact_boundary', timestamp: iso(T(1)) },
    ]);
    const entry = aggregateSessionUsage(
      {
        sessionId: SESSION,
        parent: compacted,
        subagents: [],
        unreadableSubagents: 0,
        scope: { kind: 'current-context' },
      },
      lookup,
    );
    expect(entry.status).toBe('empty');
    expect(entry.tokens.input).toBe(0);
    expect(entry.totalCost).toBeNull();
  });

  it('counts usage with no model anywhere as unpriced tokens', () => {
    const modelless = ledger([
      assistant('a', 'zz-priced-alpha', T(0), { input_tokens: 10, output_tokens: 0 }),
      { type: 'user', sessionId: SESSION, timestamp: iso(T(1)), message: { role: 'user', usage: { input_tokens: 4, output_tokens: 0 } } },
    ]);
    const entry = aggregateSessionUsage(
      {
        sessionId: SESSION,
        parent: modelless,
        subagents: [],
        unreadableSubagents: 0,
        scope: { kind: 'current-context' },
      },
      lookup,
    );
    expect(entry.tokens.input).toBe(14);
    expect(entry.pricingCoverage).toBe('partial');
    expect(entry.totalCost).toBeCloseTo(10 * 0.001, 6);
  });
});

/**
 * b4 code-logic review, failure mode 1: a subagent compacts its own context,
 * so under `current-context` its pre-compaction usage is excluded exactly as
 * the parent's is. `range` still counts every timestamped record.
 */
describe('aggregateSessionUsage — subagent compaction', () => {
  const PARENT_ONLY = ledger([
    assistant('p1', 'zz-priced-alpha', T(0), { input_tokens: 1, output_tokens: 1 }),
  ]);
  const COMPACTED_SUBAGENT = ledger([
    { type: 'user', sessionId: SESSION, timestamp: iso(T(1)), message: { role: 'user', content: 'task' } },
    assistant('c1', 'zz-priced-beta', T(1), { input_tokens: 400, output_tokens: 40 }),
    { type: 'system', subtype: 'compact_boundary', timestamp: iso(T(2)) },
    assistant('c2', 'zz-priced-beta', T(3), { input_tokens: 9, output_tokens: 1 }),
  ]);
  type Scope = Parameters<typeof aggregateSessionUsage>[0]['scope'];
  const aggregate = (subagents: readonly SessionUsageLedger[], scope: Scope) =>
    aggregateSessionUsage(
      { sessionId: SESSION, parent: PARENT_ONLY, subagents, unreadableSubagents: 0, scope },
      lookup,
    );

  it('records where the subagent compacted', () => {
    expect(COMPACTED_SUBAGENT.records).toHaveLength(2);
    expect(COMPACTED_SUBAGENT.currentContextStart).toBe(1);
  });

  it('current-context: counts a subagent only after its own last boundary', () => {
    const entry = aggregate([COMPACTED_SUBAGENT], { kind: 'current-context' });

    expect(entry.tokens).toEqual({ input: 1 + 9, output: 1 + 1, cacheRead: 0, cacheCreation: 0 });
    expect(entry.agentSessionCount).toBe(1);
    expect(entry.messageCount).toBe(1);
    const beta = 9 * 0.01 + 1 * 0.02;
    expect(entry.modelUsageList).toContainEqual({
      model: 'zz-priced-beta',
      inputTokens: 9,
      outputTokens: 1,
      costUSD: expect.closeTo(beta, 6),
    });
    expect(entry.totalCost).toBeCloseTo(1 * 0.001 + 1 * 0.002 + beta, 6);
  });

  it('current-context: counts every record of a subagent that never compacted', () => {
    const entry = aggregate([SUBAGENT], { kind: 'current-context' });

    expect(entry.tokens.input).toBe(1 + 50 + 1000);
    expect(entry.tokens.output).toBe(1 + 5 + 1000);
  });

  it('current-context: applies each subagent its own boundary independently', () => {
    const entry = aggregate([COMPACTED_SUBAGENT, SUBAGENT], { kind: 'current-context' });

    expect(entry.tokens.input).toBe(1 + 9 + 50 + 1000);
    expect(entry.agentSessionCount).toBe(2);
  });

  it('range: ignores a subagent boundary and counts every timestamped record', () => {
    const entry = aggregate([COMPACTED_SUBAGENT], { kind: 'range', since: T(0), until: T(10) });

    expect(entry.tokens.input).toBe(1 + 400 + 9);
    expect(entry.tokens.output).toBe(1 + 40 + 1);
    expect(entry.coverage).toBe('complete');
  });
});
