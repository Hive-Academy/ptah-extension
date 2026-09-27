/**
 * Tree-sitter configuration, assembled from the per-language modules in
 * `./languages/` (one `<id>.language.ts` per parsed language). Each module
 * owns its extensions, grammar file and queries; this file only builds the
 * lookup maps the parser and its consumers read.
 */
import { SupportedLanguage } from './ast.types';
import { LANGUAGE_MODULES } from './languages';
import type { LanguageQueries } from './languages/types';
export type { SupportedLanguage, LanguageQueries };

const MODULES = Object.values(LANGUAGE_MODULES);

export const EXTENSION_LANGUAGE_MAP: Readonly<
  Record<string, SupportedLanguage>
> = Object.fromEntries(
  MODULES.flatMap((module) =>
    module.extensions.map((extension) => [extension, module.id] as const),
  ),
);

/**
 * WASM grammar file loaded for each parsed language (bundled by
 * `scripts/copy-wasm.js`). `language-registry.ts` reads the same modules for
 * `grammarFile`. `TreeSitterParserService` loads each language's file from
 * this map on first use (Batch 29a2); `grammar-manifest.spec.ts` pins it to
 * the manifest's active grammar rows.
 */
export const GRAMMAR_FILE_MAP: Readonly<Record<SupportedLanguage, string>> =
  Object.fromEntries(
    MODULES.map((module) => [module.id, module.grammarFile] as const),
  ) as Record<SupportedLanguage, string>;

/**
 * Language-specific query configurations.
 * Function/import/export queries are shared across JS/TS. Class queries differ
 * because tree-sitter-typescript wraps the base class in an extends_clause node
 * that does not exist in tree-sitter-javascript; TypeScript's export query adds
 * the TS-only declaration suffix for the same reason. Python, Go and C# have no
 * export statements, so their exportQuery is empty (skipped by analyzeSource).
 */
export const LANGUAGE_QUERIES_MAP: Readonly<
  Record<SupportedLanguage, LanguageQueries>
> = Object.fromEntries(
  MODULES.map((module) => [module.id, module.queries] as const),
) as Record<SupportedLanguage, LanguageQueries>;
