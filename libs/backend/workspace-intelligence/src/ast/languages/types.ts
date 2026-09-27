import type { SupportedLanguage } from '../ast.types';
import type { LanguageCapabilities } from '../language-registry';

export interface LanguageQueries {
  /** Query for function declarations, expressions, and arrow functions */
  functionQuery: string;
  /** Query for class declarations */
  classQuery: string;
  /** Query for import statements */
  importQuery: string;
  /** Query for export statements */
  exportQuery: string;
}

/**
 * Capabilities implemented outside the parser, declared per parsed language.
 * `parse` and `publicSymbols` are not declared: `language-registry.ts` derives
 * them from the grammar and the export query, so a module cannot claim either
 * without the parser having it. Where each declared value is implemented:
 * - outline: `OUTLINE_QUERIES` in vscode-lm-tools `code-outliner.adapter.ts`
 *   (every parsed language).
 * - enrichSummary: `ContextEnrichmentService` gate, which reads this
 *   capability (TS/JS/TSX: the declaration summary's node names).
 * - codeIndex: `CodeSymbolIndexer` (every parsed language).
 * - graphEdges: `DependencyGraphService` resolves relative TS/JS imports to
 *   files; other languages get no edges until Batches 33-36.
 * - definitionFallback: Electron `DECLARATION_QUERIES` (TS/JS/Python/Go/C#;
 *   C# since Batch 26b, proven against the shipped grammar by the Electron
 *   capability spec).
 * - syntaxDiagnostics: plan initial value (py/go/cs); the TS compiler already
 *   covers TS/JS. Consumed by the language-aware diagnostics provider (25a).
 */
export type DeclaredLanguageCapabilities = Omit<
  LanguageCapabilities,
  'parse' | 'publicSymbols'
>;

/**
 * One parsed language: everything the parser, the assembly in
 * `tree-sitter.config.ts` and the registry read for it.
 */
export interface LanguageModule {
  readonly id: SupportedLanguage;
  /** Extensions parsed with this grammar (lower-case, leading dot). */
  readonly extensions: readonly string[];
  /**
   * Source suffixes of this language that no consumer accepts yet: the
   * parser map, the code-symbol indexer and the graph glob all skip them today
   * (Batch 7 KI: `.mts/.cts/.mjs/.cjs` are aliased only inside the enrich
   * builder). They are recognised so a census counts them as `unsupported`
   * under their language instead of losing them (r1 S1), and they grant no
   * capability until a batch moves them into `extensions` together with its
   * consumers.
   */
  readonly recognitionOnlyExtensions: readonly string[];
  /** WASM grammar file, bundled by `scripts/copy-wasm.js`. */
  readonly grammarFile: string;
  readonly queries: LanguageQueries;
  readonly capabilities: DeclaredLanguageCapabilities;
}
