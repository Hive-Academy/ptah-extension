/**
 * The import-resolution seam of the dependency graph (TASK_2026_559
 * implementation-plan-languages.md, "Dependency graphs" → "Resolver dispatch
 * (32b)"). Each language module registers an {@link ImportResolver}
 * (`LanguageModule.importResolver`), and `DependencyGraphService` dispatches
 * on the importing file's language.
 */
import type { Approximation } from '@ptah-extension/platform-core';
import type { ImportInfo } from '../ast-analysis.interfaces';
import type { ResolverContext } from './resolver-context';

/**
 * What an import resolved to:
 * - `file` / `package` / `namespace`: graphed files, at the granularity of
 *   the language's `graphEdges` capability (a Go package import names every
 *   file of the package's directory, for example);
 * - `external`: outside the workspace (a package, a builtin);
 * - `unresolved-internal`: meant for the workspace, but no graphed file
 *   matched (a missing file, an ambiguous case-folded match).
 */
export type ImportResolutionKind =
  'file' | 'package' | 'namespace' | 'external' | 'unresolved-internal';

/** One import's resolution. */
export interface ImportResolution {
  readonly kind: ImportResolutionKind;
  /**
   * Graph node keys the import links to, at most
   * {@link MAX_TARGETS_PER_IMPORT}; empty for `external` and
   * `unresolved-internal`.
   */
  readonly targets: readonly string[];
  /** More targets matched than {@link MAX_TARGETS_PER_IMPORT}; the rest were cut. */
  readonly truncated?: true;
  /** A target was found only through a unique case-insensitive match. */
  readonly caseFolded?: true;
  /**
   * `external` only as far as the context knows: nothing it read proves the
   * module is outside the workspace (a bundler alias, a nested tsconfig or a
   * workspace package could map it to a file), so the build's resolution
   * context is `partial`.
   */
  readonly contextDependent?: true;
  /**
   * The targets stand for the import at a coarser grain than the file that
   * declares what is used (a Go import links every file of the package:
   * `go:package-edges`). Disclosed in the graph's coverage when it links.
   */
  readonly approximation?: GraphEdgeApproximation;
  /**
   * Requested members (Python `from m import a, b`) that no graphed file or
   * module provides, although others resolved: each counts as an
   * `unresolved-internal` import beside the targets (review r1 R33-01).
   */
  readonly unresolvedMembers?: number;
  /**
   * The import resolved inside the workspace to nothing another file
   * declares (a C# namespace only the importing file declares, or one that
   * holds only nested namespaces): no edge, and not unresolved. Only with a
   * resolved `kind` and empty `targets`.
   */
  readonly linksNothing?: true;
}

/** Approximations a resolver can attach to the edges it returns. */
export type GraphEdgeApproximation = Extract<
  Approximation,
  'go:package-edges' | 'csharp:namespace-edges'
>;

/** Resolves the imports of one language. Pure: reads only `ctx`. */
export interface ImportResolver {
  /**
   * @param imp - The import as extracted (a re-export source arrives as an
   *   import of that module).
   * @param fromFile - Graph node key of the importing file.
   * @param ctx - Built once per graph build (`buildResolverContext`).
   */
  resolve(
    imp: ImportInfo,
    fromFile: string,
    ctx: ResolverContext,
  ): ImportResolution;
  /**
   * Imports declared elsewhere that are in scope for `fromFile` too (C#
   * global usings: every file of the declaring project). The graph resolves
   * each for `fromFile` and links its targets.
   */
  implicitImports?(
    fromFile: string,
    ctx: ResolverContext,
  ): readonly ImplicitImport[];
}

/** An import in scope for a file that did not write it. */
export interface ImplicitImport {
  readonly imp: ImportInfo;
  /**
   * Declared by no graphed file (a C# project manifest's `<Using>` item): the
   * graph tallies it (external, unresolved, truncated) the first time it
   * resolves it. Otherwise the declaring file's own import is the tally.
   */
  readonly declaredOutsideGraph?: true;
}

/** Most targets one import expands to (plan "Bounds": per-import expansion). */
export const MAX_TARGETS_PER_IMPORT = 200;
