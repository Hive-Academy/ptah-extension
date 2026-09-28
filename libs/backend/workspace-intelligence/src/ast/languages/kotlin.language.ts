/**
 * Kotlin language module (Batch 30k). `.kt` and `.kts` parse with the
 * vendored `tree-sitter-kotlin.wasm` (`@tree-sitter-grammars/tree-sitter-kotlin`
 * 1.1.0, ABI 14; `assets/tree-sitter/`, provenance in
 * `assets/tree-sitter/PROVENANCE.kotlin.json`). Every node and field name
 * below is proven against that grammar by `kotlin-grammar.integration.spec.ts`
 * (a wrong name gives zero captures and no error, so it must not be written
 * from memory).
 *
 * `exportQuery` is empty and `graphEdges` is null: Kotlin graph support is
 * not required (User Decision 19), so this module claims neither
 * `publicSymbols` nor `graphEdges`.
 *
 * Grammar limit (upstream issues tree-sitter-kotlin #12 and #13, open in
 * 1.1.0): valid Kotlin whose class body ends with a member on the closing
 * brace's line (`object Keys { const val A = 1 }`) needs error recovery. Such
 * a file is `recovered`, never a clean parse, so the code index counts it as
 * `failed` (reason `parse`). The syntax check names the limit on every Kotlin
 * answer ({@link KOTLIN_GRAMMAR_LIMIT}) and, when the grammar recovered
 * without a located error, reports the file as not validated rather than as
 * invalid ({@link KOTLIN_UNLOCATED_RECOVERY_TEXT}; Batch 30k r1 R30K-02). A
 * member separator (`{ const val A = 1; }`) or a line break avoids it.
 */
import type { LanguageModule } from './types';

/** The approximation every Kotlin syntax answer discloses. */
export const KOTLIN_GRAMMAR_LIMIT = 'kotlin:grammar-limit';

/**
 * Why a Kotlin file the grammar could only recover, with no located error,
 * is not validated: the recovery is what a valid one-line class body causes.
 */
export const KOTLIN_UNLOCATED_RECOVERY_TEXT =
  'Syntax not validated: the Kotlin grammar (tree-sitter-kotlin 1.1.0) needed error recovery but located no error; valid one-line class bodies such as `object K { val a = 1 }` do this (kotlin:grammar-limit), so no syntax error is claimed.';

/**
 * Top-level, member, local and extension functions are all
 * `function_declaration`; an extension's receiver type precedes the `name`
 * field, so the name is still the declared one. Secondary constructors and
 * `init` blocks have no name of their own and are covered by their class.
 */
const KOTLIN_FUNCTION_QUERY = `
(function_declaration
  name: (identifier) @function.name
  (function_value_parameters) @function.params) @function.declaration
`;

/**
 * Classes (including `interface`, `enum class`, `data class`,
 * `annotation class` and `fun interface`, which are all
 * `class_declaration`) and named objects.
 */
const KOTLIN_CLASS_QUERY = `
(class_declaration
  name: (identifier) @class.name) @class.declaration

(object_declaration
  name: (identifier) @class.name) @class.declaration
`;

/**
 * `import a.b.C` reports `a.b.C`; `import a.b.C as D` reports `a.b.C` with
 * the alias `D` as the imported name; `import a.b.*` reports the package
 * `a.b` with the imported symbol `*`. One pattern with an optional imported
 * name (the anonymous `*` token or the alias identifier) matches each import
 * exactly once, whatever comments it holds (Batch 30k r1 R30K-03). A block
 * comment inside the path (between `a.` and `b.C`) is dropped by the
 * extractor, so the path equals its comment-free form.
 */
const KOTLIN_IMPORT_QUERY = `
(import
  (qualified_identifier) @import.source
  ["*" (identifier)]? @import.named)
`;

export const KOTLIN_LANGUAGE: LanguageModule = {
  id: 'kotlin',
  extensions: ['.kt', '.kts'],
  recognitionOnlyExtensions: [],
  grammarFile: 'tree-sitter-kotlin.wasm',
  queries: {
    functionQuery: KOTLIN_FUNCTION_QUERY,
    classQuery: KOTLIN_CLASS_QUERY,
    importQuery: KOTLIN_IMPORT_QUERY,
    exportQuery: '',
  },
  capabilities: {
    outline: true,
    enrichSummary: false,
    codeIndex: true,
    // No Kotlin graph key (User Decision 19).
    graphEdges: null,
    // The Electron index-free declaration scan has no Kotlin query.
    definitionFallback: false,
    syntaxDiagnostics: true,
  },
};
