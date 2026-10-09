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

const retrievalSuite: SuiteView<unknown> = {
  ...minimalSuite,
  kind: 'retrieval',
  details: {
    tool: 'tool',
    questions: 1,
    primaryMetric: 'hit@1',
    decidingBaseline: 'native',
    metrics: { 'hit@1': 0.8 },
    failures: [],
  },
  baselines: [{ id: 'native', label: 'native', metrics: { 'hit@1': 0.3 } }],
  deltas: { native: { 'hit@1': 0.5 } },
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
  it('validates retrieval verdict references and deltas', () => {
    expect(suiteSchema.safeParse(retrievalSuite).success).toBe(true);
    const missingMetric = structuredClone(retrievalSuite);
    delete (missingMetric.details as { metrics: Record<string, number | null> })
      .metrics['hit@1'];
    expect(messages(suiteSchema.safeParse(missingMetric))).toContain(
      'primaryMetric must resolve to a tool metric',
    );
    const unknownBaseline = structuredClone(retrievalSuite);
    (unknownBaseline.details as { decidingBaseline: string }).decidingBaseline =
      'missing';
    expect(messages(suiteSchema.safeParse(unknownBaseline))).toContain(
      'decidingBaseline must resolve to a baseline metric',
    );
    const wrongDelta = structuredClone(retrievalSuite);
    const nativeDelta = wrongDelta.deltas['native'];
    if (nativeDelta === undefined)
      throw new Error('fixture must include native');
    nativeDelta['hit@1'] = 0.4;
    expect(messages(suiteSchema.safeParse(wrongDelta))).toContain(
      'delta must equal tool minus baseline',
    );
    const nullMetric = structuredClone(retrievalSuite);
    delete (nullMetric.details as { primaryMetric?: string }).primaryMetric;
    delete (nullMetric.details as { decidingBaseline?: string })
      .decidingBaseline;
    (nullMetric.details as { metrics: Record<string, number | null> }).metrics[
      'hit@1'
    ] = null;
    const nullNativeDelta = nullMetric.deltas['native'];
    if (nullNativeDelta === undefined)
      throw new Error('fixture must include native');
    nullNativeDelta['hit@1'] = null;
    expect(suiteSchema.safeParse(nullMetric).success).toBe(true);
    const costDelta = structuredClone(retrievalSuite);
    const costNativeDelta = costDelta.deltas['native'];
    if (costNativeDelta === undefined)
      throw new Error('fixture must include native');
    costNativeDelta['calls_per_answer'] = 0.1234;
    expect(suiteSchema.safeParse(costDelta).success).toBe(true);
  });

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

  it('accepts model-panel only with a panel, and bounds displayLabel', () => {
    const panelSuite: SuiteView<unknown> = {
      ...minimalSuite,
      displayLabel: 'a'.repeat(80),
      groundTruth: {
        id: 'set',
        version: '1',
        method: 'model-panel',
        panel: 'memory-skills-panel',
      },
    };
    expect(suiteCoreSchema.parse(panelSuite)).toEqual(panelSuite);
    expect(
      messages(
        suiteCoreSchema.safeParse({
          ...minimalSuite,
          groundTruth: {
            id: 'set',
            version: '1',
            method: 'model-panel',
          },
        }),
      ),
    ).toEqual(['model-panel ground truth requires panel']);
    expect(
      messages(
        suiteCoreSchema.safeParse({
          ...minimalSuite,
          groundTruth: {
            ...minimalSuite.groundTruth,
            panel: 'memory-skills-panel',
          },
        }),
      ),
    ).toEqual(['panel is only valid for model-panel ground truth']);
    expect(
      suiteCoreSchema.safeParse({ ...minimalSuite, displayLabel: '' }).success,
    ).toBe(false);
    expect(
      suiteCoreSchema.safeParse({
        ...minimalSuite,
        displayLabel: 'a'.repeat(81),
      }).success,
    ).toBe(false);
    expect(
      suiteCoreSchema.safeParse({
        ...minimalSuite,
        displayLabel: 'a'.repeat(80),
      }).success,
    ).toBe(true);
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
