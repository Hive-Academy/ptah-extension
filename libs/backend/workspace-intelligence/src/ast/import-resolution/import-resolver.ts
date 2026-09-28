/**
 * The import-resolution seam of the dependency graph (TASK_2026_559
 * implementation-plan-languages.md, "Dependency graphs" → "Resolver dispatch
 * (32b)"). Each language module registers an {@link ImportResolver}
 * (`LanguageModule.importResolver`), and `DependencyGraphService` dispatches
 * on the importing file's language.
 */
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
}

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
}

/** Most targets one import expands to (plan "Bounds": per-import expansion). */
export const MAX_TARGETS_PER_IMPORT = 200;
