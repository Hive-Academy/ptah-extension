/**
 * Go import resolution (TASK_2026_559 implementation-plan-languages.md,
 * "Dependency graphs", Go row). Package edges: an import of a workspace
 * package links every graphed non-`_test.go` file of the package's
 * directory, disclosed as the `go:package-edges` approximation (the file
 * that declares what is used is not known without type information).
 *
 * - The longest module path that prefixes the import decides (the module
 *   selection is `go-context.ts`'s): a module under the root (the root
 *   `go.mod`, a `go.work` `use` module, a selected local `replace`) maps the
 *   rest of the path to a directory under the module's; a module proven
 *   outside the root (required, or replaced by a module version or a
 *   directory outside the root) makes the import `external`; a module whose
 *   selection is unknown makes it `unresolved-internal`, and wins ties.
 * - Otherwise a standard-library path (its first element is a standard
 *   package) is `external`; any other path is `external` only as far as the
 *   context knows (`contextDependent`: a `go.mod` the build did not read, in
 *   a nested module, could make it a workspace package).
 * - A workspace package directory with no graphed non-test file is
 *   `unresolved-internal`; so is a relative (GOPATH-mode) path that names
 *   none.
 *
 * Case rule (plan "Case rule"): an exact directory first; otherwise a unique
 * case-insensitive match, marked `caseFolded`; an ambiguous one is
 * `unresolved-internal`.
 *
 * Not modelled (why `graphEdges.referenceScopeComplete` is false): files of
 * one package use each other with no import; build tags and `GOOS`/`GOARCH`
 * suffixes (every file is included); cgo; the `vendor` directory (excluded
 * from discovery).
 */
import * as path from 'path';
import type { ImportInfo } from '../ast-analysis.interfaces';
import {
  MAX_TARGETS_PER_IMPORT,
  type ImportResolution,
  type ImportResolver,
} from './import-resolver';
import type { ResolverContext } from './resolver-context';

const EXTERNAL: ImportResolution = { kind: 'external', targets: [] };
const UNPROVEN_EXTERNAL: ImportResolution = {
  kind: 'external',
  targets: [],
  contextDependent: true,
};
const UNRESOLVED_INTERNAL: ImportResolution = {
  kind: 'unresolved-internal',
  targets: [],
};

/**
 * First path elements of the standard library (Go 1.24 `go list std`), plus
 * cgo's `C` pseudo-package. The Go toolchain reserves dotless first
 * elements for it, but a module may still be named without a dot, so the
 * list, not the missing dot, is the proof.
 */
const GO_STDLIB_ROOTS: ReadonlySet<string> = new Set([
  'C',
  'archive',
  'bufio',
  'builtin',
  'bytes',
  'cmp',
  'compress',
  'container',
  'context',
  'crypto',
  'database',
  'debug',
  'embed',
  'encoding',
  'errors',
  'expvar',
  'flag',
  'fmt',
  'go',
  'hash',
  'html',
  'image',
  'index',
  'internal',
  'io',
  'iter',
  'log',
  'maps',
  'math',
  'mime',
  'net',
  'os',
  'path',
  'plugin',
  'reflect',
  'regexp',
  'runtime',
  'slices',
  'sort',
  'strconv',
  'strings',
  'structs',
  'sync',
  'syscall',
  'testing',
  'text',
  'time',
  'unicode',
  'unique',
  'unsafe',
  'weak',
]);

export const GO_IMPORT_RESOLVER: ImportResolver = {
  resolve(
    imp: ImportInfo,
    fromFile: string,
    ctx: ResolverContext,
  ): ImportResolution {
    const importPath = imp.source;
    if (importPath === '') return UNRESOLVED_INTERNAL;
    if (importPath.startsWith('./') || importPath.startsWith('../')) {
      return (
        packageFiles(
          path.posix.join(path.posix.dirname(fromFile), importPath),
          ctx,
        ) ?? UNRESOLVED_INTERNAL
      );
    }
    const local = ctx.go.local.find((module) =>
      within(importPath, module.path),
    );
    const external = longestModule(importPath, ctx.go.external);
    const unknown = longestModule(importPath, ctx.go.unknown);
    // A module whose selection is unknown is never guessed: not an edge, not
    // external (the context carries `module-selection-unknown`).
    if (
      unknown !== undefined &&
      unknown.length >= Math.max(local?.path.length ?? 0, external?.length ?? 0)
    ) {
      return UNRESOLVED_INTERNAL;
    }
    if (local !== undefined && local.path.length >= (external?.length ?? 0)) {
      const rest = importPath.slice(local.path.length);
      return (
        packageFiles(path.posix.join(local.dir, rest), ctx) ??
        UNRESOLVED_INTERNAL
      );
    }
    if (external !== undefined) return EXTERNAL;
    return GO_STDLIB_ROOTS.has(importPath.split('/')[0])
      ? EXTERNAL
      : UNPROVEN_EXTERNAL;
  },
};

/** Whether `importPath` is `modulePath` or a package below it. */
function within(importPath: string, modulePath: string): boolean {
  return (
    importPath === modulePath ||
    (importPath.startsWith(modulePath) && importPath[modulePath.length] === '/')
  );
}

function longestModule(
  importPath: string,
  modules: ReadonlySet<string>,
): string | undefined {
  let longest: string | undefined;
  for (const modulePath of modules) {
    if (
      within(importPath, modulePath) &&
      modulePath.length > (longest?.length ?? -1)
    ) {
      longest = modulePath;
    }
  }
  return longest;
}

/**
 * Every graphed non-test Go file of package directory `dir`, at most
 * {@link MAX_TARGETS_PER_IMPORT} (`truncated` beyond); `undefined` when the
 * directory holds none.
 */
function packageFiles(
  dir: string,
  ctx: ResolverContext,
): ImportResolution | undefined {
  let files = goSources(ctx.filesByDirectory.get(dir));
  let caseFolded = false;
  if (files.length === 0) {
    const folded = dir.toLowerCase();
    const matches = [...ctx.filesByDirectory.keys()].filter(
      (candidate) =>
        candidate.toLowerCase() === folded &&
        goSources(ctx.filesByDirectory.get(candidate)).length > 0,
    );
    if (matches.length > 1) return UNRESOLVED_INTERNAL;
    if (matches.length === 0) return undefined;
    files = goSources(ctx.filesByDirectory.get(matches[0]));
    caseFolded = true;
  }
  const sorted = [...files].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const truncated = sorted.length > MAX_TARGETS_PER_IMPORT;
  return {
    kind: 'package',
    targets: truncated ? sorted.slice(0, MAX_TARGETS_PER_IMPORT) : sorted,
    approximation: 'go:package-edges',
    ...(truncated ? { truncated: true } : {}),
    ...(caseFolded ? { caseFolded: true } : {}),
  };
}

function goSources(files: readonly string[] | undefined): string[] {
  return (files ?? []).filter(
    (file) => file.endsWith('.go') && !file.endsWith('_test.go'),
  );
}
