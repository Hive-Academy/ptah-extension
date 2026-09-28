/**
 * TS/JS import resolution (TASK_2026_559 implementation-plan-languages.md,
 * "Dependency graphs", TS/JS row): relative specifiers with the extension and
 * index probes the graph has always used, then the tsconfig `paths` and
 * `baseUrl` the build's {@link ResolverContext} read from the root
 * `tsconfig*.json`. One target per import (`file` granularity).
 *
 * Case rule (plan "Case rule"): an exact node key first; otherwise a unique
 * case-insensitive match, marked `caseFolded`; an ambiguous one is
 * `unresolved-internal`. No file system is assumed case-insensitive.
 */
import { builtinModules } from 'module';
import * as path from 'path';
import type { ImportInfo } from '../ast-analysis.interfaces';
import type { ImportResolution, ImportResolver } from './import-resolver';
import type { ResolverContext, TsconfigPathRule } from './resolver-context';

/** Extensions tried after the specifier itself, in order. */
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/** Directory index files tried last, in order. */
const INDEX_FILES = ['index.ts', 'index.js'];

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

export const TS_JS_IMPORT_RESOLVER: ImportResolver = {
  resolve(
    imp: ImportInfo,
    fromFile: string,
    ctx: ResolverContext,
  ): ImportResolution {
    const specifier = imp.source;
    if (specifier.startsWith('.')) {
      const base = path.posix.join(path.posix.dirname(fromFile), specifier);
      return lookupModule(base, ctx) ?? UNRESOLVED_INTERNAL;
    }
    const aliasRules = bestPathRules(specifier, ctx.tsconfigPaths);
    if (aliasRules.length > 0) {
      // Claimed by an alias: a workspace module, found or not.
      for (const { rule, captured } of aliasRules) {
        for (const target of rule.targets) {
          const found = lookupModule(
            path.posix.join(rule.baseDir, target.replace('*', captured)),
            ctx,
          );
          if (found !== undefined) return found;
        }
      }
      return UNRESOLVED_INTERNAL;
    }
    if (specifier.startsWith('/') || specifier.startsWith('#')) {
      // An absolute path or a package.json `imports` entry: the workspace's.
      return UNRESOLVED_INTERNAL;
    }
    for (const baseUrl of ctx.baseUrls) {
      const found = lookupModule(path.posix.join(baseUrl, specifier), ctx);
      if (found !== undefined) return found;
    }
    const packageName = packageNameOf(specifier);
    if (ctx.localPackages.has(packageName)) {
      // Declared as a local package (`file:`, `link:`, `workspace:`): a
      // workspace module. Its directory is probed as a module (index files);
      // a `main`/`exports` entry point is not read.
      const dir = ctx.localPackages.get(packageName);
      const found =
        dir === undefined
          ? undefined
          : lookupModule(
              path.posix.join(dir, specifier.slice(packageName.length)),
              ctx,
            );
      return found ?? UNRESOLVED_INTERNAL;
    }
    // A builtin, or a package the root package.json declares from a
    // registry, is proven external; any other bare specifier most likely is
    // too, but a mapping the context does not read could make it a
    // workspace file.
    return isBuiltinModule(specifier) || ctx.externalPackages.has(packageName)
      ? EXTERNAL
      : UNPROVEN_EXTERNAL;
  },
};

/** A Node builtin: `node:` prefixed, or a bare builtin name (`fs/promises`). */
function isBuiltinModule(specifier: string): boolean {
  return (
    specifier.startsWith('node:') ||
    builtinModules.includes(specifier) ||
    builtinModules.includes(specifier.split('/')[0])
  );
}

/** The package a bare specifier names: `@scope/name` or `name`. */
function packageNameOf(specifier: string): string {
  const segments = specifier.split('/');
  return specifier.startsWith('@')
    ? segments.slice(0, 2).join('/')
    : segments[0];
}

/**
 * The `paths` rules TypeScript would use for `specifier`: those of the best
 * matching pattern (an exact pattern, else the longest prefix before `*`),
 * in context order, each with the text `*` captured.
 */
function bestPathRules(
  specifier: string,
  rules: readonly TsconfigPathRule[],
): Array<{ rule: TsconfigPathRule; captured: string }> {
  let bestRank = -1;
  let best: Array<{ rule: TsconfigPathRule; captured: string }> = [];
  for (const rule of rules) {
    const captured = matchPattern(specifier, rule.pattern);
    if (captured === undefined) continue;
    const wildcard = rule.pattern.indexOf('*');
    // Exact patterns outrank every wildcard pattern.
    const rank = wildcard === -1 ? Number.MAX_SAFE_INTEGER : wildcard;
    if (rank > bestRank) {
      bestRank = rank;
      best = [];
    }
    if (rank === bestRank) best.push({ rule, captured });
  }
  return best;
}

/**
 * The text a `paths` pattern captures from `specifier` (`''` for an exact
 * pattern), or `undefined` when it does not match. Examples:
 * `@ptah-extension/*` captures `shared` from `@ptah-extension/shared`.
 */
function matchPattern(specifier: string, pattern: string): string | undefined {
  const wildcard = pattern.indexOf('*');
  if (wildcard === -1) return specifier === pattern ? '' : undefined;
  const prefix = pattern.substring(0, wildcard);
  const suffix = pattern.substring(wildcard + 1);
  if (
    specifier.length < prefix.length + suffix.length ||
    !specifier.startsWith(prefix) ||
    !specifier.endsWith(suffix)
  ) {
    return undefined;
  }
  return specifier.substring(prefix.length, specifier.length - suffix.length);
}

/**
 * The graphed file `base` names as a module: `base` itself, then with each
 * extension, then its directory index. Exact matches win over every
 * case-insensitive one; otherwise the first probe with a case-insensitive
 * match decides (unique: `caseFolded`; ambiguous: `unresolved-internal`).
 * `undefined` when no probe matches at all.
 */
function lookupModule(
  base: string,
  ctx: ResolverContext,
): ImportResolution | undefined {
  const probes = [
    base,
    ...RESOLVE_EXTENSIONS.map((ext) => base + ext),
    ...INDEX_FILES.map((index) => `${base}/${index}`),
  ];
  for (const probe of probes) {
    if (ctx.knownFiles.has(probe)) return { kind: 'file', targets: [probe] };
  }
  for (const probe of probes) {
    const matches = ctx.filesByFoldedPath.get(probe.toLowerCase());
    if (matches === undefined || matches.length === 0) continue;
    return matches.length === 1
      ? { kind: 'file', targets: [matches[0]], caseFolded: true }
      : UNRESOLVED_INTERNAL;
  }
  return undefined;
}
