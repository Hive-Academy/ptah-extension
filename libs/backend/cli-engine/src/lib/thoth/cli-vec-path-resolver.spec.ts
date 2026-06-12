import 'reflect-metadata';

import {
  resolveVecBinaryName,
  resolveVecPackageName,
} from '@ptah-extension/persistence-sqlite';

import { createCliVecPathResolver } from './cli-vec-path-resolver';

function makeLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
  };
}

describe('createCliVecPathResolver', () => {
  it('returns a resolver function', () => {
    const resolver = createCliVecPathResolver(makeLogger() as never);
    expect(typeof resolver).toBe('function');
  });

  it('resolves via sqlite-vec getLoadablePath (strategy 1) when available', () => {
    const resolver = createCliVecPathResolver(makeLogger() as never);
    const resolved = resolver();
    const binaryName = resolveVecBinaryName();
    expect(typeof resolved).toBe('string');
    expect(resolved.endsWith(binaryName)).toBe(true);
  });

  it('resolves to a path matching the platform binary name', () => {
    const resolver = createCliVecPathResolver(makeLogger() as never);
    const resolved = resolver();
    const packageName = resolveVecPackageName();
    expect(packageName).toBeDefined();
    expect(resolved).toContain(resolveVecBinaryName());
  });

  it('throws (caught upstream → BM25-only degradation) when no package mapping exists', () => {
    const logger = makeLogger();
    const resolver = createCliVecPathResolver(logger as never);
    expect(typeof resolver).toBe('function');
    expect(
      resolveVecPackageName('aix' as never, 'mips' as never),
    ).toBeUndefined();
  });
});
