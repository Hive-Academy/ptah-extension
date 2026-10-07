import { z } from 'zod';

import {
  createSuiteSchema,
  suiteCoreSchema,
  suiteSchema,
} from './scorecard.types';
import { createSuiteKindRegistry, type SuiteView } from './suite-kinds';

/** The smallest suite the core accepts: no baselines, no deltas, kind not registered anywhere. */
const minimalSuite: SuiteView<unknown> = {
  kind: 'memory-skills',
  details: { anything: ['the core does not parse details'] },
  claim: { source: 'code', ref: 'memory.ts:1' },
  groundTruth: { id: 'set', version: '1', method: 'seeded' },
  baselines: [],
  deltas: {},
  cost: {
    source: 'none',
    calls: 0,
    latency_ms: { p50: null, p95: null },
    error_rate: null,
    tokens: {},
  },
  verdict: 'pass',
};

const messages = (result: { error?: z.ZodError }): string[] =>
  result.error?.issues.map((issue) => issue.message) ?? [];

describe('suiteCoreSchema', () => {
  it('parses a minimal suite of any kind without a registry', () => {
    expect(suiteCoreSchema.parse(minimalSuite)).toEqual(minimalSuite);
  });

  it('keeps the kind-independent checks', () => {
    const result = suiteCoreSchema.safeParse({
      ...minimalSuite,
      verdict: 'na',
      baselines: [
        { id: 'native', label: 'native', metrics: {} },
        { id: 'native', label: 'again', metrics: {} },
      ],
      deltas: { rg: {} },
    });

    expect(messages(result)).toEqual([
      'duplicate baseline id: native',
      'delta names unknown baseline: rg',
      'na suites require naReason',
    ]);
  });

  it('rejects a missing field', () => {
    const withoutCost: Partial<SuiteView<unknown>> = { ...minimalSuite };
    delete withoutCost.cost;
    expect(suiteCoreSchema.safeParse(withoutCost).success).toBe(false);
  });
});

describe('createSuiteSchema', () => {
  it('rejects an unknown kind that the core accepts', () => {
    const result = suiteSchema.safeParse(minimalSuite);

    expect(messages(result)).toEqual([
      'unregistered suite kind: memory-skills',
    ]);
  });

  it('reports core and kind issues together', () => {
    const result = suiteSchema.safeParse({
      ...minimalSuite,
      deltas: { x: {} },
    });

    expect(messages(result)).toEqual(
      expect.arrayContaining([
        'delta names unknown baseline: x',
        'unregistered suite kind: memory-skills',
      ]),
    );
  });

  it('parses details with the registered kind of its registry', () => {
    const registry = createSuiteKindRegistry();
    registry.registerSuiteKind(
      'memory-skills',
      z.object({ anything: z.array(z.string()) }),
    );
    const schema = createSuiteSchema(registry);

    expect(schema.safeParse(minimalSuite).success).toBe(true);
    expect(
      messages(schema.safeParse({ ...minimalSuite, details: { anything: 1 } })),
    ).toHaveLength(1);
    expect(
      schema.safeParse({ ...minimalSuite, details: { anything: 1 } }).error
        ?.issues[0].path,
    ).toEqual(['details', 'anything']);
  });
});
