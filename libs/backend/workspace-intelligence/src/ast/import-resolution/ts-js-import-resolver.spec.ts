/**
 * Specs for the TS/JS import resolver (TASK_2026_559 Batch 32b): relative
 * probes, tsconfig `paths` precedence, `baseUrl`, the case rule, and how an
 * unresolved specifier is classified.
 */
import type { ImportInfo } from '../ast-analysis.interfaces';
import type { ResolverContext, TsconfigPathRule } from './resolver-context';
import { TS_JS_IMPORT_RESOLVER } from './ts-js-import-resolver';

const ROOT = 'D:/ws';
const FROM = `${ROOT}/src/app/main.ts`;

function context(
  files: readonly string[],
  mapping: {
    paths?: readonly TsconfigPathRule[];
    baseUrls?: readonly string[];
    externalPackages?: readonly string[];
    localPackages?: Readonly<Record<string, string | undefined>>;
  } = {},
): ResolverContext {
  const filesByFoldedPath = new Map<string, string[]>();
  for (const file of files) {
    const folded = file.toLowerCase();
    filesByFoldedPath.set(folded, [
      ...(filesByFoldedPath.get(folded) ?? []),
      file,
    ]);
  }
  return {
    root: ROOT,
    knownFiles: new Set(files),
    filesByFoldedPath,
    tsconfigPaths: mapping.paths ?? [],
    baseUrls: mapping.baseUrls ?? [],
    externalPackages: new Set(mapping.externalPackages ?? []),
    localPackages: new Map(Object.entries(mapping.localPackages ?? {})),
    // Read by the Python and Go resolvers only.
    filesByDirectory: new Map(),
    directories: new Set(),
    directoriesByFoldedPath: new Map(),
    python: {
      sourceRoots: [],
      packageDirs: new Map(),
      dependencies: new Set(),
      localDependencies: new Map(),
    },
    go: { local: [], external: new Set(), unknown: new Set() },
    gaps: [],
    manifestsRead: 0,
  };
}

function resolve(source: string, ctx: ResolverContext) {
  return TS_JS_IMPORT_RESOLVER.resolve({ source } as ImportInfo, FROM, ctx);
}

describe('TS_JS_IMPORT_RESOLVER — relative specifiers', () => {
  it.each([
    ['./util', `${ROOT}/src/app/util.ts`],
    ['./view', `${ROOT}/src/app/view.tsx`],
    ['../lib', `${ROOT}/src/lib/index.ts`],
    ['./legacy.js', `${ROOT}/src/app/legacy.js`],
  ])('%s resolves to %s', (source, file) => {
    const ctx = context([
      `${ROOT}/src/app/util.ts`,
      `${ROOT}/src/app/view.tsx`,
      `${ROOT}/src/lib/index.ts`,
      `${ROOT}/src/app/legacy.js`,
    ]);
    expect(resolve(source, ctx)).toEqual({ kind: 'file', targets: [file] });
  });

  it('a missing relative module is unresolved-internal', () => {
    expect(resolve('./missing', context([]))).toEqual({
      kind: 'unresolved-internal',
      targets: [],
    });
  });
});

describe('TS_JS_IMPORT_RESOLVER — case rule', () => {
  const util = `${ROOT}/src/app/util.ts`;
  const Util = `${ROOT}/src/app/Util.ts`;

  it('an exact match wins over case-folded ones', () => {
    expect(resolve('./util', context([util, Util]))).toEqual({
      kind: 'file',
      targets: [util],
    });
  });

  it('a unique case-folded match is used and marked', () => {
    expect(resolve('./UTIL', context([util]))).toEqual({
      kind: 'file',
      targets: [util],
      caseFolded: true,
    });
  });

  it('an ambiguous case-folded match is unresolved-internal', () => {
    expect(resolve('./UTIL', context([util, Util]))).toEqual({
      kind: 'unresolved-internal',
      targets: [],
    });
  });

  it('an exact later probe wins over a case-folded earlier one', () => {
    // `./Lib` case-folds to lib.ts, but Lib/index.ts is an exact probe.
    const lib = `${ROOT}/src/app/lib.ts`;
    const index = `${ROOT}/src/app/Lib/index.ts`;
    expect(resolve('./Lib', context([lib, index]))).toEqual({
      kind: 'file',
      targets: [index],
    });
  });
});

describe('TS_JS_IMPORT_RESOLVER — tsconfig paths and baseUrl', () => {
  const shared = `${ROOT}/libs/shared/src/index.ts`;
  const special = `${ROOT}/libs/special/main.ts`;

  it('resolves through the best matching pattern (exact, then longest prefix)', () => {
    const ctx = context([shared, special], {
      paths: [
        { pattern: '@x/*', targets: ['libs/*/src/index.ts'], baseDir: ROOT },
        { pattern: '@x/sp*', targets: ['libs/special/main'], baseDir: ROOT },
        { pattern: '@x/shared', targets: ['libs/shared/src'], baseDir: ROOT },
      ],
    });

    expect(resolve('@x/shared', ctx)).toEqual({
      kind: 'file',
      targets: [shared],
    });
    expect(resolve('@x/special', ctx)).toEqual({
      kind: 'file',
      targets: [special],
    });
  });

  it('tries every target of the pattern in order', () => {
    const ctx = context([shared], {
      paths: [
        {
          pattern: '@x/*',
          targets: ['missing/*', 'libs/*/src'],
          baseDir: ROOT,
        },
      ],
    });
    expect(resolve('@x/shared', ctx)).toEqual({
      kind: 'file',
      targets: [shared],
    });
  });

  it('an alias-claimed specifier with no file is unresolved-internal', () => {
    const ctx = context([], {
      paths: [{ pattern: '@x/*', targets: ['libs/*'], baseDir: ROOT }],
    });
    expect(resolve('@x/gone', ctx).kind).toBe('unresolved-internal');
  });

  it('a pattern needs its whole prefix and suffix', () => {
    const ctx = context([`${ROOT}/styles/a.ts`], {
      paths: [{ pattern: '~*.css', targets: ['styles/*'], baseDir: ROOT }],
    });
    expect(resolve('~a.css', ctx)).toEqual({
      kind: 'file',
      targets: [`${ROOT}/styles/a.ts`],
    });
    expect(resolve('~.cs', ctx)).toMatchObject({ kind: 'external' });
  });

  it('resolves a bare specifier under a baseUrl', () => {
    const helper = `${ROOT}/src/utils/helper.ts`;
    const ctx = context([helper], { baseUrls: [`${ROOT}/src`] });
    expect(resolve('utils/helper', ctx)).toEqual({
      kind: 'file',
      targets: [helper],
    });
  });
});

describe('TS_JS_IMPORT_RESOLVER — unresolved specifiers', () => {
  const ctx = context([], { externalPackages: ['lodash', '@scope/pkg'] });

  it.each([
    ['#internal', 'unresolved-internal'],
    ['/abs/x', 'unresolved-internal'],
  ] as const)('%s is unresolved-internal', (source, kind) => {
    expect(resolve(source, ctx)).toEqual({ kind, targets: [] });
  });

  // Proven external: a builtin, or a package the root package.json declares.
  it.each([
    'node:fs',
    'fs',
    'fs/promises',
    'lodash',
    'lodash/fp',
    '@scope/pkg/sub',
  ])('%s is external', (source) => {
    expect(resolve(source, ctx)).toEqual({ kind: 'external', targets: [] });
  });

  // r1 B2: most likely a package, but nothing read proves it.
  it.each(['react', '@scope/other', 'utils/b', '@/components/Foo'])(
    '%s is external only as far as the context knows',
    (source) => {
      expect(resolve(source, ctx)).toEqual({
        kind: 'external',
        targets: [],
        contextDependent: true,
      });
    },
  );
});

// R32B-02: a local package specification is never proof of externality.
describe('TS_JS_IMPORT_RESOLVER — local packages', () => {
  const entry = `${ROOT}/packages/local/index.ts`;
  const deep = `${ROOT}/packages/local/src/deep.ts`;
  const ctx = context([entry, deep], {
    localPackages: { local: `${ROOT}/packages/local`, shared: undefined },
  });

  it('resolves a file: package to its directory index', () => {
    expect(resolve('local', ctx)).toEqual({ kind: 'file', targets: [entry] });
  });

  it('resolves a subpath of a file: package', () => {
    expect(resolve('local/src/deep', ctx)).toEqual({
      kind: 'file',
      targets: [deep],
    });
  });

  it('counts a local package it cannot locate as unresolved-internal', () => {
    expect(resolve('shared', ctx)).toEqual({
      kind: 'unresolved-internal',
      targets: [],
    });
    expect(resolve('local/missing', ctx)).toEqual({
      kind: 'unresolved-internal',
      targets: [],
    });
  });
});
