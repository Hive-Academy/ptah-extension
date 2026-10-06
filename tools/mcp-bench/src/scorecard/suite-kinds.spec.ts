import { z } from 'zod';
import {
  createSuiteKindRegistry,
  computeProjectionSha256,
  getRegisteredSuiteKinds,
  getSuiteKind,
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
});
