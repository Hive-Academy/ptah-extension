import type { GenericAstNode, SupportedLanguage } from '../ast.types';
import type { ImportInfo, ImportKind } from '../ast-analysis.interfaces';
import type { LanguageCapabilities } from '../language-registry';
import type { ImportResolver } from '../import-resolution/import-resolver';

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
 * - graphEdges: `DependencyGraphService`, through the module's
 *   `importResolver` (TS/JS: relative paths, tsconfig `paths`/`baseUrl`;
 *   Python: files, Go: packages, since Batch 33); other languages get no
 *   edges until Batches 34-36.
 * - definitionFallback: Electron `DECLARATION_QUERIES` (TS/JS/Python/Go/C#;
 *   C# since Batch 26b, proven against the shipped grammar by the Electron
 *   capability spec).
 * - syntaxDiagnostics: py/go/cs (plan initial value), java/rust (Batch 30),
 *   php/ruby/cpp (Batch 31), kotlin (Batch 30k); the TS compiler already covers TS/JS. Consumed by the language-aware
 *   diagnostics provider (25a), which parses with the language's grammar.
 */
export type DeclaredLanguageCapabilities = Omit<
  LanguageCapabilities,
  'parse' | 'publicSymbols'
>;

/**
 * One import as a language decodes it from a statement. The analysis service
 * adds what depends on the statement's position: `line` and `scopePath`.
 */
export type ExtractedImport = Pick<
  ImportInfo,
  | 'source'
  | 'importedSymbols'
  | 'importedSymbolAliases'
  | 'relativeLevel'
  | 'alias'
  | 'isStatic'
> & { kind: ImportKind };

/**
 * The Batch 32a extraction contract for one language
 * (`AstAnalysisService.analyzeSource`).
 *
 * Imports: the language's `importQuery` adds statement-only patterns that
 * capture each whole import statement as `@import.statement`. The service
 * hands each distinct statement node (converted to depth 3) to
 * `extractImports` once, in source order. The `@import.source` patterns stay
 * as they were for the execute_code `ast.queryImports` decoder, which skips
 * a match without `@import.source`.
 *
 * Declarations: `declarationQuery` runs as one more entry of the same
 * `queryMulti` call. Each pattern captures the declared name as
 * `@declaration.name` and the declaring node as `@declaration.<kind>`
 * (`package` | `namespace` | `module`), or `@declaration.<kind>.file` when
 * the declaration covers the rest of the file (C# `namespace N;`, Java/Go
 * `package`). Nested names are joined with `scopeSeparator`.
 */
export interface LanguageExtraction {
  readonly extractImports: (statement: GenericAstNode) => ExtractedImport[];
  readonly declarations?: {
    readonly query: string;
    readonly scopeSeparator: string;
  };
}

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
  /**
   * Absent for TS/JS/TSX, whose imports keep the shared capture decoder and
   * their earlier output shape.
   */
  readonly extraction?: LanguageExtraction;
  /**
   * Turns this language's imports into graph targets (Batch 32b): the
   * dependency graph dispatches on the importing file's language. Absent
   * means the graph cannot resolve the language's imports; a language
   * declaring `graphEdges` without one has every import counted unresolved.
   */
  readonly importResolver?: ImportResolver;
  readonly capabilities: DeclaredLanguageCapabilities;
}
