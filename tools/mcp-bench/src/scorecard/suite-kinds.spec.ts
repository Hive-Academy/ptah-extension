import { z } from 'zod';
import {
  createSuiteKindRegistry,
  computeProjectionSha256,
  GROUND_TRUTH_METHODS,
  getRegisteredSuiteKinds,
  getSuiteKind,
  type GroundTruthMethod,
  type SuiteView,
} from './suite-kinds';
import './scorecard.types';
describe('suite kind registry', () => {
  it('registers retrieval before scorecards parse', () => {
    expect(getSuiteKind('retrieval')).toBeDefined();
    expect(getRegisteredSuiteKinds()).toContain('retrieval');
  });
  it('isolates duplicate registration checks for callers', () => {
    const registry = createSuiteKindRegistry();
    registry.registerSuiteKind('example', z.object({}));
    expect(() => registry.registerSuiteKind('example', z.object({}))).toThrow(
      'suite kind already registered: example',
    );
    expect(registry.getRegisteredSuiteKinds()).toEqual(['example']);
  });
  it('returns a copy of the registered list', () => {
    const kinds = getRegisteredSuiteKinds();
    kinds.push('mutated');
    expect(getRegisteredSuiteKinds()).not.toContain('mutated');
  });
  it('hashes canonical projections independent of object key order', () => {
    const first = computeProjectionSha256({
      b: [2, { z: true, a: 'x' }],
      a: 1,
    });
    const reordered = computeProjectionSha256({
      a: 1,
      b: [2, { a: 'x', z: true }],
    });
    const changed = computeProjectionSha256({
      a: 2,
      b: [2, { a: 'x', z: true }],
    });
    expect(first).toBe(reordered);
    expect(first).not.toBe(changed);
  });
  it('rejects non-finite projection values', () => {
    expect(() => computeProjectionSha256({ score: Number.NaN })).toThrow(
      'projection cannot contain non-finite numbers',
    );
  });
  it('exposes model-panel on the shared method list and the suite view', () => {
    expect(GROUND_TRUTH_METHODS).toEqual([
      'generated',
      'labelled',
      'seeded',
      'git-history',
      'model-panel',
    ]);
    const method: GroundTruthMethod = 'model-panel';
    const view: SuiteView<unknown> = {
      kind: 'memory-skills',
      displayLabel: 'a'.repeat(80),
      details: {},
      claim: { source: 'code', ref: 'memory.ts:1' },
      groundTruth: { id: 'set', version: '1', method, panel: 'panel-a' },
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
    expect(view.groundTruth.method).toBe('model-panel');
    expect(view.groundTruth.panel).toBe('panel-a');
    expect(view.displayLabel).toHaveLength(80);
  });
});
