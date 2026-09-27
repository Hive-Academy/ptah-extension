/**
 * Electron IDE Capabilities
 *
 * Implements IIDECapabilities for the Electron desktop runtime using the
 * existing Tree-sitter symbol index (workspace-intelligence + memory-curator)
 * instead of a language server. Registering this under IDE_CAPABILITIES_TOKEN
 * unlocks the ptah_lsp_references / ptah_lsp_definitions / ptah_get_dirty_files
 * MCP tools (gated on hasIDECapabilities in protocol-dispatcher.ts).
 *
 * Resolution is NAME-BASED, not type-aware, but sharpened with three Tier-1
 * precision passes that reuse existing services:
 *   - getDefinition / getTypeDefinition: resolve the identifier under the cursor
 *     to its declaration(s) via the SQLite symbol index (ICodeSymbolReader),
 *     then disambiguate multiple same-named candidates using the cursor file's
 *     own imports (declaration in the same file, or in the imported module, wins).
 *     When the index has no candidate (empty, stale, or no reader), fall back to
 *     a Tree-sitter scan for a top-level declaration in the cursor file, then in
 *     the ONE workspace file the cursor file's relative import of the
 *     identifier resolves to. That file is read only when its canonical
 *     (realpath) location lies inside the canonical workspace root, so a
 *     junction or symlink never leads the read outside the workspace.
 *   - getReferences: word-boundary scan of workspace source files for the
 *     identifier, with two precision passes:
 *       (1) narrowing gate (TASK_2026_559 Batch 26b): the scan is scoped to
 *           the declaration file(s) + their transitive dependents only when
 *           THIS workspace's graph proves, for this query, that its
 *           dependents bound every reference: every language in the graph's
 *           census has `referenceScopeComplete`, the graph coverage is clean
 *           (complete census, nothing unsupported/unrecognised/failed/capped,
 *           clean import resolution with no edge cap), and the symbol index
 *           names declarations (from a page that was not full) that are nodes
 *           of that same graph. The certificate is re-checked after the scan;
 *           if the graph changed, the answer is a text scan instead. TS/JS
 *           graphs do not claim `referenceScopeComplete` (global scripts,
 *           re-exports, `require`, dynamic import and aliases have no edge),
 *           so today they always get the text scan;
 *       (2) drop matches that fall inside comments and literal string text
 *           via Tree-sitter (interpolated expressions are kept).
 *     Otherwise it runs a bounded scan of every recognised source file
 *     (`text-scan`) outside the default vendor excludes and the workspace
 *     ignore files. Every cap and every skipped file (unreadable, over 1 MiB,
 *     unreadable tree part) is reported as `truncated`; an ignored file is
 *     out of scope, not skipped.
 *   - getDefinitionReport / getReferencesReport: the same lookups, reporting
 *     the mechanism that answered (`symbol-index`, `declaration-scan`,
 *     `graph-scoped-scan`, `text-scan`), the registry language of the queried
 *     file, whether that mechanism supports it, and any cap that was hit. A
 *     lookup that cannot run (no identifier, unreadable file, no workspace
 *     root), or whose analysis failed (parse or query failure, unreadable
 *     import target), is an error there, never an empty answer. An empty
 *     declaration scan is `truncated` (it reads at most two files); a full
 *     symbol-index page is `truncated` too, whatever the pick.
 *   - getHover: surface the matched symbol's index entry text.
 *   - getSignatureHelp: unsupported name-based — returns null.
 *
 * Editor state is sourced from the renderer-backed ElectronEditorProvider
 * (active file only). Code actions/refactors require a language server and are
 * therefore graceful no-ops here.
 */

import { promises as nodeFs } from 'node:fs';
import * as path from 'node:path';
import {
  IncompleteFileSearchError,
  LANGUAGE_IDS,
  isCleanAnswer,
  type IEditorProvider,
  type IFileSystemProvider,
  type IWorkspaceProvider,
  type LanguageCoverage,
  type LanguageId,
} from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';
import type { ICodeSymbolReader } from '@ptah-extension/memory-contracts';
import {
  DEFAULT_WORKSPACE_EXCLUDES,
  LANGUAGE_REGISTRY,
  extensionHasCapability,
  languageForExtension,
  recognisedSourceExtensions,
  type DependencyGraphService,
  type IgnorePatternResolverService,
  type AstAnalysisService,
  type TreeSitterParserService,
  type SupportedLanguage,
} from '@ptah-extension/workspace-intelligence';
import type {
  IIDECapabilities,
  Location,
  LspLocationReport,
  LspMechanism,
  HoverInfo,
  SignatureHelp,
  ActiveEditorInfo,
  CodeAction,
  VisibleRange,
} from '@ptah-extension/vscode-lm-tools';

/** Max symbol-index candidates fetched when resolving a definition. */
const DEFINITION_TOP_K = 25;
/** Hard cap on reference locations returned (bounds workspace scan cost). */
const MAX_REFERENCE_MATCHES = 500;
/**
 * Hard cap on files discovered and read by a text scan (discovery asks for
 * one more, so its presence alone says files were left out).
 */
const MAX_FILES_SCANNED = 8000;
/**
 * Larger files are skipped by the reference scan, and the skip is disclosed
 * as `truncated` (the same 1 MiB the workspace indexer uses).
 */
const MAX_SCAN_FILE_BYTES = 1024 * 1024;
/**
 * Extensions the reference text scan reads: every source extension the
 * language registry recognises (capability-bearing, recognition-only and
 * recognised-only languages alike), so a reference from a language without a
 * grammar (Java, Kotlin, Rust, ...) is still found by name.
 */
const SCAN_EXTENSIONS: readonly string[] = recognisedSourceExtensions();

/** Script extensions an import specifier may carry or omit (ESM `./x.js` → `x.ts`). */
const MODULE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
];
/**
 * Probe order for an extensionless relative module, following TypeScript's
 * own order: the module file's sources, then its declaration file, then the
 * directory index's sources, then the index declaration file.
 */
const MODULE_FILE_SUFFIXES = [
  ...MODULE_EXTENSIONS,
  '.d.ts',
  ...MODULE_EXTENSIONS.map((ext) => `/index${ext}`),
  '/index.d.ts',
];

/** TypeScript declaration nodes, each capturing its name as `@name`. */
const TS_DECLARATIONS = `[
  (class_declaration name: (_) @name)
  (abstract_class_declaration name: (_) @name)
  (interface_declaration name: (_) @name)
  (type_alias_declaration name: (_) @name)
  (enum_declaration name: (_) @name)
  (function_declaration name: (_) @name)
  (generator_function_declaration name: (_) @name)
  (function_signature name: (_) @name)
  (internal_module name: (_) @name)
  (module name: (_) @name)
  (lexical_declaration (variable_declarator name: (identifier) @name))
  (variable_declaration (variable_declarator name: (identifier) @name))
]`;

/** JavaScript declaration nodes, each capturing its name as `@name`. */
const JS_DECLARATIONS = `[
  (class_declaration name: (_) @name)
  (function_declaration name: (_) @name)
  (generator_function_declaration name: (_) @name)
  (lexical_declaration (variable_declarator name: (identifier) @name))
  (variable_declaration (variable_declarator name: (identifier) @name))
]`;

/**
 * C# type declarations, each capturing its name as `@name`. `record_declaration`
 * covers `record`, `record class` and `record struct`. Node names proven
 * against the shipped `tree-sitter-c-sharp.wasm` (Batch 26b real-grammar spec).
 */
const CSHARP_DECLARATIONS = `[
  (class_declaration name: (identifier) @name)
  (interface_declaration name: (identifier) @name)
  (struct_declaration name: (identifier) @name)
  (enum_declaration name: (identifier) @name)
  (record_declaration name: (identifier) @name)
  (delegate_declaration name: (identifier) @name)
]`;

/** Any parse error in the file makes a declaration answer uncertain. */
const ERROR_PATTERN = '(ERROR) @error';

/**
 * Per-language Tree-sitter queries for TOP-LEVEL declarations (direct
 * children of the root, optionally behind `export` / `declare`). Parsing the
 * file, rather than matching lines, keeps declaration-shaped text inside
 * comments, strings and template literals, and declarations nested in a
 * function body, from answering a definition lookup.
 */
const DECLARATION_QUERIES: Partial<Record<SupportedLanguage, string>> = {
  typescript: [
    `(program ${TS_DECLARATIONS})`,
    `(program (export_statement ${TS_DECLARATIONS}))`,
    `(program (ambient_declaration ${TS_DECLARATIONS}))`,
    `(program (export_statement (ambient_declaration ${TS_DECLARATIONS})))`,
    '(program (expression_statement (internal_module name: (_) @name)))',
    ERROR_PATTERN,
  ].join('\n'),
  javascript: [
    `(program ${JS_DECLARATIONS})`,
    `(program (export_statement ${JS_DECLARATIONS}))`,
    ERROR_PATTERN,
  ].join('\n'),
  python: [
    `(module [
      (function_definition name: (_) @name)
      (class_definition name: (_) @name)
      (decorated_definition definition: [
        (function_definition name: (_) @name)
        (class_definition name: (_) @name)
      ])
    ])`,
    ERROR_PATTERN,
  ].join('\n'),
  go: [
    `(source_file [
      (function_declaration name: (_) @name)
      (method_declaration name: (_) @name)
      (type_declaration (type_spec name: (_) @name))
      (type_declaration (type_alias name: (_) @name))
      (var_declaration (var_spec name: (_) @name))
      (const_declaration (const_spec name: (_) @name))
    ])`,
    ERROR_PATTERN,
  ].join('\n'),
  // Top-level C# types: directly in the file (global or file-scoped
  // namespace, whose members are siblings of its declaration) or in a block
  // namespace at any depth. A namespace body holds no statements, so a type
  // nested in a class or declared in a method never matches.
  csharp: [
    `(compilation_unit ${CSHARP_DECLARATIONS})`,
    `(namespace_declaration body: (declaration_list ${CSHARP_DECLARATIONS}))`,
    ERROR_PATTERN,
  ].join('\n'),
};

/**
 * Outcome of a declaration scan: the 0-based position of the declared name,
 * `null` when the file parses cleanly and declares nothing by that name,
 * `'unsupported'` when there is no declaration query for the language, or
 * `'uncertain'` when the file cannot be parsed reliably (a failed query or a
 * parse error in the file).
 */
type DeclarationScan =
  | { line: number; column: number }
  | null
  | 'unsupported'
  | 'uncertain';

/** Module file to read: the reported (lexical) path and its canonical path. */
interface ModuleFile {
  file: string;
  readPath: string;
}

/** Canonicalises a filesystem path, following every link (fs.realpath). */
type RealpathFn = (filePath: string) => Promise<string>;

/** Identifier characters for symbol-at-position extraction. */
const IDENTIFIER_RE = /[A-Za-z0-9_$]/;

/**
 * Per-language Tree-sitter queries capturing comment + string-literal nodes,
 * used to exclude textual reference matches that aren't real code identifiers.
 * Languages absent here skip filtering (matches are kept as-is).
 *
 * A string that can hold code (a TS/JS template, a Python f-string, a C#
 * interpolated string) excludes only its literal text: an expression inside
 * `${...}` / `{...}` is a real reference (Batch 26b r1 B6). Node names proven
 * against the shipped grammars.
 */
const COMMENT_STRING_QUERIES: Partial<Record<SupportedLanguage, string>> = {
  typescript: '[(comment) @x (string) @x (template_string (string_fragment) @x)]',
  javascript: '[(comment) @x (string) @x (template_string (string_fragment) @x)]',
  python: '[(comment) @x (string (string_content) @x)]',
  go: '[(comment) @x (interpreted_string_literal) @x (raw_string_literal) @x]',
  csharp:
    '[(comment) @x (string_literal) @x (verbatim_string_literal) @x ' +
    '(raw_string_literal) @x (character_literal) @x ' +
    '(interpolated_string_expression (string_content) @x)]',
};

/** Excluded node range (0-based rows/columns), end-exclusive on column. */
interface ExcludedRange {
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
}

/**
 * A lookup that could not answer: it could not run (no identifier, no root,
 * unreadable cursor file) or its analysis failed (a parse or query failure,
 * an unreadable import target). The array APIs answer it with `[]`, as
 * before; the report APIs raise it as an error so it is never read as "the
 * symbol has none".
 */
interface LookupUnavailable {
  readonly unavailable: string;
}

type LookupResult = LspLocationReport | LookupUnavailable;

function isUnavailable(result: LookupResult): result is LookupUnavailable {
  return 'unavailable' in result;
}

function locationsOf(result: LookupResult): Location[] {
  return isUnavailable(result) ? [] : result.locations;
}

function reportOf(result: LookupResult): LspLocationReport {
  if (isUnavailable(result)) {
    throw new Error(`Lookup could not answer: ${result.unavailable}`);
  }
  return result;
}

/**
 * Outcome of the index-free declaration scan (Batch 26b r1 B1):
 * - `found`: the declaration(s);
 * - `not-found`: every file it read parsed cleanly without one. The scan
 *   reads only the cursor file and at most one relative import target, so
 *   this is bounded, never proof of absence (reported as `truncated`);
 * - `unsupported`: no reliable declaration query for the cursor language
 *   (reported as `languageSupported: false`);
 * - `failed`: a file it needed could not be read or parsed reliably.
 */
type FallbackOutcome =
  | { readonly kind: 'found'; readonly locations: Location[] }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'failed'; readonly reason: string };

/** Exact-name index candidates, and whether the index page was full. */
interface IndexCandidates {
  readonly locations: Location[];
  /**
   * The raw index page reached its size limit, so more same-named
   * declarations may exist beyond it (Batch 26b r1 M1).
   */
  readonly saturated: boolean;
}

/** What reading one file for matches achieved. */
type FileScanStatus = 'scanned' | 'unreadable' | 'too-large';

/**
 * The narrowing decision for one query: the files to scan, and the exact
 * coverage object it was certified against, which is re-checked after the
 * scan (Batch 26b r1 B3).
 */
interface NarrowedScope {
  readonly files: string[];
  readonly certified: LanguageCoverage;
}

export class ElectronIDECapabilities implements IIDECapabilities {
  constructor(
    private readonly symbolReader: ICodeSymbolReader | undefined,
    private readonly fs: IFileSystemProvider,
    private readonly ignoreResolver: IgnorePatternResolverService,
    private readonly workspaceProvider: IWorkspaceProvider,
    private readonly editorProvider: IEditorProvider,
    private readonly dependencyGraph: DependencyGraphService,
    private readonly astAnalysis: AstAnalysisService,
    private readonly treeSitter: TreeSitterParserService,
    private readonly logger: Logger,
    private readonly realpath: RealpathFn = (filePath) =>
      nodeFs.realpath(filePath),
  ) {}

  readonly lsp: IIDECapabilities['lsp'] = {
    getDefinition: async (file, line, col) =>
      locationsOf(await this.definitionLookup(file, line, col)),

    getReferences: async (file, line, col) =>
      locationsOf(await this.referenceLookup(file, line, col)),

    getDefinitionReport: async (file, line, col) =>
      reportOf(await this.definitionLookup(file, line, col)),

    getReferencesReport: async (file, line, col) =>
      reportOf(await this.referenceLookup(file, line, col)),

    getHover: async (file, line, col): Promise<HoverInfo | null> => {
      const identifier = await this.identifierAt(file, line, col);
      if (!identifier || !this.symbolReader) return null;
      const wsRoot = this.normalize(this.workspaceProvider.getWorkspaceRoot());
      const page = await this.symbolReader.searchSymbols(
        identifier,
        DEFINITION_TOP_K,
        wsRoot,
      );
      const contents = page.hits
        .filter((h) => h.symbolName === identifier)
        .map((h) => h.text)
        .slice(0, 5);
      return contents.length > 0 ? { contents } : null;
    },

    getTypeDefinition: async (file, line, col) =>
      locationsOf(await this.definitionLookup(file, line, col)),

    getSignatureHelp: async (): Promise<SignatureHelp | null> => null,
  };

  readonly editor: IIDECapabilities['editor'] = {
    getActive: async (): Promise<ActiveEditorInfo | null> => {
      const active = this.editorProvider.getActiveEditorPath();
      if (!active) return null;
      return { file: this.normalize(active) as string, line: 0, column: 0 };
    },

    getOpenFiles: async (): Promise<string[]> => {
      const active = this.editorProvider.getActiveEditorPath();
      return active ? [this.normalize(active) as string] : [];
    },

    // Dirty-buffer state is not tracked in the main process (Monaco owns it in
    // the renderer); report none rather than guess.
    getDirtyFiles: async (): Promise<string[]> => [],

    getRecentFiles: async (): Promise<string[]> => {
      const active = this.editorProvider.getActiveEditorPath();
      return active ? [this.normalize(active) as string] : [];
    },

    getVisibleRange: async (): Promise<VisibleRange | null> => null,
  };

  // Code actions/refactors require a language server — graceful no-ops.
  readonly actions: IIDECapabilities['actions'] = {
    getAvailable: async (): Promise<CodeAction[]> => [],
    apply: async (): Promise<boolean> => false,
    rename: async (): Promise<boolean> => false,
    organizeImports: async (): Promise<boolean> => false,
    fixAll: async (): Promise<boolean> => false,
  };

  /**
   * The identifier under a 0-based cursor, with the cursor file's path and
   * content (read once), or why the lookup cannot run.
   */
  private async cursorIdentifier(
    file: string,
    line: number,
    col: number,
  ): Promise<
    | { cursorPath: string; content: string; identifier: string }
    | LookupUnavailable
  > {
    const cursorPath = this.resolveAbsolutePath(file);
    if (!cursorPath) {
      return { unavailable: `no workspace root to resolve ${file}` };
    }
    const content = await this.safeReadFile(cursorPath);
    if (content === null) {
      return { unavailable: `could not read ${cursorPath}` };
    }
    const identifier = extractIdentifier(content, line, col);
    if (!identifier) {
      return {
        unavailable: `no identifier at ${cursorPath}:${line}:${col} (zero-based)`,
      };
    }
    return { cursorPath, content, identifier };
  }

  /**
   * Resolve the identifier under the cursor to its declaration location(s):
   * the symbol index first (`symbol-index`); with zero index candidates,
   * declarationsWithoutIndex() answers instead (`declaration-scan`).
   */
  private async definitionLookup(
    file: string,
    line: number,
    col: number,
  ): Promise<LookupResult> {
    const cursor = await this.cursorIdentifier(file, line, col);
    if ('unavailable' in cursor) return cursor;
    const { cursorPath, content, identifier } = cursor;
    const indexed = await this.indexedDeclarations(
      cursorPath,
      content,
      identifier,
    );
    if (indexed.locations.length > 0) {
      return lspReport(
        cursorPath,
        indexed.locations,
        'symbol-index',
        indexed.saturated,
      );
    }
    const fallback = await this.declarationsWithoutIndex(
      cursorPath,
      content,
      identifier,
    );
    switch (fallback.kind) {
      case 'failed':
        return { unavailable: fallback.reason };
      case 'found':
        return lspReport(cursorPath, fallback.locations, 'declaration-scan');
      case 'not-found':
        // Bounded read set (cursor file + one import target): qualified.
        return lspReport(cursorPath, [], 'declaration-scan', true);
      case 'unsupported':
        return lspReport(cursorPath, [], 'declaration-scan');
    }
  }

  /**
   * Look the identifier up in the symbol index and disambiguate multiple
   * same-named declarations using the cursor file's imports:
   *   - a declaration in the cursor file itself wins;
   *   - otherwise the declaration in the module the cursor file imports the
   *     identifier from wins;
   *   - otherwise all exact-name candidates are returned (no pick).
   * `saturated` (the index page was full, more may exist) is carried through
   * EVERY path: a local or imported-file pick narrows by file, not by unique
   * binding, and a full page may have cut off more same-named declarations
   * in that very file (closing review R26B-C-M1). Empty when the index has no
   * candidate (or no reader).
   */
  private async indexedDeclarations(
    cursorPath: string,
    cursorContent: string,
    identifier: string,
  ): Promise<IndexCandidates> {
    const all = await this.indexCandidates(identifier);
    const { locations: candidates, saturated } = all;
    if (candidates.length === 0) return all;

    const cursorNorm = this.normalize(cursorPath) as string;
    const local = candidates.filter((c) => c.file === cursorNorm);
    if (local.length > 0) return { locations: local, saturated };
    if (candidates.length === 1) return all;

    const importedModule = await this.resolveImportedModule(
      cursorPath,
      cursorContent,
      identifier,
    );
    if (importedModule) {
      const matched = candidates.filter((c) =>
        fileMatchesModule(c.file, importedModule),
      );
      if (matched.length > 0) return { locations: matched, saturated };
    }

    return all;
  }

  /** Exact-name declaration candidates from the symbol index (none without one). */
  private async indexCandidates(identifier: string): Promise<IndexCandidates> {
    if (!this.symbolReader) return { locations: [], saturated: false };
    const wsRoot = this.normalize(this.workspaceProvider.getWorkspaceRoot());
    const page = await this.symbolReader.searchSymbols(
      identifier,
      DEFINITION_TOP_K,
      wsRoot,
    );

    const seen = new Set<string>();
    const candidates: Location[] = [];
    for (const hit of page.hits) {
      if (hit.symbolName !== identifier) continue;
      const startLine = parseDeclarationLine(hit.text);
      if (startLine === null) continue;
      const filePath = this.normalize(hit.filePath) as string;
      const key = `${filePath}:${startLine}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ file: filePath, line: startLine, column: 0 });
    }
    // The port has no "has more" signal: a full raw page (before exact-name
    // filtering) may have cut off further same-named declarations.
    return {
      locations: candidates,
      saturated: page.hits.length >= DEFINITION_TOP_K,
    };
  }

  /**
   * Index-independent resolution, used when the index has no candidate:
   *   1. a top-level declaration of the identifier in the cursor file itself;
   *   2. otherwise the top-level declaration in the ONE workspace file the
   *      cursor file's relative import of the identifier resolves to (a single
   *      file read).
   * See {@link FallbackOutcome}: a file that does not parse cleanly, or an
   * import target that cannot be read, is `failed`; a package, alias
   * (tsconfig paths), re-exported (barrel), out-of-workspace or .tsx target
   * leaves the bounded scan `not-found`, never an authoritative empty answer.
   */
  private async declarationsWithoutIndex(
    cursorPath: string,
    cursorContent: string,
    identifier: string,
  ): Promise<FallbackOutcome> {
    const cursorNorm = this.normalize(cursorPath) as string;
    const local = await this.findDeclaration(
      cursorContent,
      identifier,
      declarationLanguage(cursorNorm),
    );
    if (local === 'unsupported') return { kind: 'unsupported' };
    if (local === 'uncertain') {
      return {
        kind: 'failed',
        reason: `${cursorNorm} could not be parsed reliably (parse error or query failure)`,
      };
    }
    if (local) {
      return { kind: 'found', locations: [{ file: cursorNorm, ...local }] };
    }

    const modulePath = await this.resolveImportedModule(
      cursorPath,
      cursorContent,
      identifier,
    );
    if (!modulePath) return { kind: 'not-found' };
    const target = await this.findModuleFile(modulePath);
    if (!target) return { kind: 'not-found' };
    const targetLanguage = declarationLanguage(target.file);
    if (!targetLanguage) return { kind: 'not-found' };
    const content = await this.safeReadFile(target.readPath);
    if (content === null) {
      return {
        kind: 'failed',
        reason: `the import target ${target.file} could not be read`,
      };
    }
    const found = await this.findDeclaration(
      content,
      identifier,
      targetLanguage,
    );
    if (found === 'uncertain' || found === 'unsupported') {
      return {
        kind: 'failed',
        reason: `the import target ${target.file} could not be parsed reliably`,
      };
    }
    return found
      ? { kind: 'found', locations: [{ file: target.file, ...found }] }
      : { kind: 'not-found' };
  }

  /**
   * First top-level declaration of `identifier` in `content`, found by parsing
   * the content with Tree-sitter (see DECLARATION_QUERIES).
   */
  private async findDeclaration(
    content: string,
    identifier: string,
    language: SupportedLanguage | null,
  ): Promise<DeclarationScan> {
    const query = language ? DECLARATION_QUERIES[language] : undefined;
    if (!language || !query) return 'unsupported';
    const result = await this.treeSitter.query(content, language, query);
    if (!result.isOk() || !result.value) return 'uncertain';

    let first: { row: number; column: number } | null = null;
    for (const match of result.value) {
      for (const capture of match.captures) {
        if (capture.name === 'error') return 'uncertain';
        if (capture.name !== 'name' || capture.text !== identifier) continue;
        const pos = capture.startPosition;
        if (
          !first ||
          pos.row < first.row ||
          (pos.row === first.row && pos.column < first.column)
        ) {
          first = pos;
        }
      }
    }
    return first ? { line: first.row, column: first.column } : null;
  }

  /**
   * First existing file for an extensionless module path, probing the module
   * file suffixes in order. Returns null when no candidate exists, or when the
   * module lies outside the workspace root either lexically (a `../../..`
   * import) or physically (a junction or symlink inside the workspace that
   * points outside it) — checked BEFORE the file is read.
   */
  private async findModuleFile(modulePath: string): Promise<ModuleFile | null> {
    const wsRoot = this.normalize(this.workspaceProvider.getWorkspaceRoot());
    if (!wsRoot || !isInsideDirectory(modulePath, wsRoot)) return null;
    for (const suffix of MODULE_FILE_SUFFIXES) {
      const candidate = `${modulePath}${suffix}`;
      if (!(await this.fs.exists(candidate))) continue;
      const readPath = await this.canonicalPathInside(candidate, wsRoot);
      return readPath ? { file: candidate, readPath } : null;
    }
    return null;
  }

  /**
   * The canonical path of `filePath` when it lies inside the canonical
   * `root`, else null. Both sides are resolved through every junction and
   * symlink, so containment is judged on where the bytes physically live.
   */
  private async canonicalPathInside(
    filePath: string,
    root: string,
  ): Promise<string | null> {
    const [realFile, realRoot] = await Promise.all([
      this.canonicalPath(filePath),
      this.canonicalPath(root),
    ]);
    if (!realFile || !realRoot) return null;
    return isInsideDirectory(realFile, realRoot) ? realFile : null;
  }

  private async canonicalPath(filePath: string): Promise<string | null> {
    try {
      return toForwardSlashes(await this.realpath(filePath));
    } catch {
      // degradation-audit: optional-capability - a path that cannot be
      // canonicalised cannot be shown to lie inside the workspace; null
      // leaves the import unresolved (fail closed) instead of reading it.
      this.logger.debug(
        '[ElectronIDECapabilities] Import target could not be canonicalised',
      );
      return null;
    }
  }

  /**
   * If the cursor file imports `identifier` from a relative module, return the
   * resolved absolute module path (without extension). Returns null for
   * package/alias imports (not resolvable without tsconfig) or when not found.
   */
  private async resolveImportedModule(
    cursorPath: string,
    cursorContent: string,
    identifier: string,
  ): Promise<string | null> {
    const language = extToLanguage(cursorPath);
    if (!language) return null;
    let result;
    try {
      result = await this.astAnalysis.analyzeSource(
        cursorContent,
        language,
        this.normalize(cursorPath) as string,
      );
    } catch {
      // degradation-audit: optional-capability - AST analysis is an enrichment
      // over the cursor file; null means "no relative import resolved", the
      // same answer a package or alias import gives, and lookup continues.
      return null;
    }
    if (!result.isOk() || !result.value) return null;

    const imp = result.value.imports.find(
      (i) => !i.isNamespace && (i.importedSymbols ?? []).includes(identifier),
    );
    if (!imp || !imp.source.startsWith('.')) return null;

    return stripExtension(
      resolveRelative(this.normalize(cursorPath) as string, imp.source),
    );
  }

  /**
   * Name-based reference search. Scopes the scan to the declaration file(s) +
   * their transitive dependents only when the narrowing gate holds
   * (`graph-scoped-scan`, see narrowedReferenceScope); otherwise scans every
   * recognised source file (`text-scan`). Matches inside string/comment nodes
   * are dropped via Tree-sitter. Bounded by MAX_REFERENCE_MATCHES and, for the
   * text scan, MAX_FILES_SCANNED; a hit cap is reported as `truncated`.
   */
  private async referenceLookup(
    file: string,
    line: number,
    col: number,
  ): Promise<LookupResult> {
    const cursor = await this.cursorIdentifier(file, line, col);
    if ('unavailable' in cursor) return cursor;
    const { cursorPath, content, identifier } = cursor;

    const workspaceFolder = this.normalize(
      this.workspaceProvider.getWorkspaceRoot(),
    );
    if (!workspaceFolder) {
      return { unavailable: 'no workspace root is open' };
    }

    const scope = await this.narrowedReferenceScope(
      cursorPath,
      content,
      identifier,
      workspaceFolder,
    );
    if (scope) {
      const scoped = await this.scanFiles(scope.files, identifier);
      // The reads awaited: the graph may have been invalidated or rebuilt
      // meanwhile. Publish the narrowed answer only if the exact coverage it
      // was certified against is still the root's (Batch 26b r1 B3).
      if (this.certificateHolds(workspaceFolder, scope.certified)) {
        return lspReport(
          cursorPath,
          scoped.locations,
          'graph-scoped-scan',
          scoped.truncated,
        );
      }
      this.logger.info(
        '[ElectronIDECapabilities] Graph changed during a scoped reference scan; answering with a text scan',
        { identifier },
      );
    }

    const scan = await this.textScan(workspaceFolder, identifier);
    return lspReport(cursorPath, scan.locations, 'text-scan', scan.truncated);
  }

  /**
   * The narrowing gate, evaluated per query. Returns the scoped file set
   * (declaration files + transitive dependents + the cursor file) only when
   * ALL of these hold, else null (a text scan):
   *   - the symbol index names the declaration(s) from a page that was not
   *     full (every same-named declaration is known, r1 M1);
   *   - this workspace's graph is built and publishes its language coverage;
   *   - every language in that graph's census has `referenceScopeComplete`
   *     (graphReferenceScopeIsComplete). TS/JS do not claim it: their graph
   *     has no edge for global scripts, re-exports, `require`, dynamic
   *     `import()` or unmapped path aliases (r1 B2, `language-registry.ts`);
   *   - the coverage passes the clean-answer rule, including `resolution`;
   *   - each declaration file, and every node the walk visits, is answered by
   *     the SAME graph whose coverage was certified (r1 B4: a nested root's
   *     graph must not stand in for the parent's).
   * The index lookup (the only await) runs first; the certificate and the
   * walk then run synchronously, so the graph cannot change between them
   * (r1 B3). The index-free declaration fallback is deliberately NOT used: a
   * guessed declaration says nothing about scope completeness.
   */
  private async narrowedReferenceScope(
    cursorPath: string,
    cursorContent: string,
    identifier: string,
    workspaceFolder: string,
  ): Promise<NarrowedScope | null> {
    if (!this.dependencyGraph.isBuilt(workspaceFolder)) return null;
    const declarations = await this.indexedDeclarations(
      cursorPath,
      cursorContent,
      identifier,
    );
    if (declarations.saturated || declarations.locations.length === 0) {
      return null;
    }
    return this.certifiedScope(
      workspaceFolder,
      declarations.locations,
      this.normalize(cursorPath) as string,
    );
  }

  /** Synchronous part of the gate: certificate, then the walk on that graph. */
  private certifiedScope(
    workspaceFolder: string,
    declarations: readonly Location[],
    cursorFile: string,
  ): NarrowedScope | null {
    if (!this.dependencyGraph.isBuilt(workspaceFolder)) return null;
    const certified =
      this.dependencyGraph.getCoverageReport(workspaceFolder)?.languages;
    if (!certified || !graphReferenceScopeIsComplete(certified)) return null;
    // A graph publishes one coverage object per build (and a new one on each
    // invalidation), so identity names the graph that answers a file.
    const answeredByCertified = (file: string): boolean =>
      this.dependencyGraph.getCoverageReportForFile(file)?.languages ===
      certified;

    const declFiles = new Set(declarations.map((d) => d.file));
    const graphNodes: string[] = [];
    for (const declFile of declFiles) {
      if (!answeredByCertified(declFile)) return null;
      const node = this.dependencyGraph.resolveNodePath(declFile);
      if (node === undefined) return null;
      graphNodes.push(node);
    }

    // Breadth-first walk of reverse-import edges from the declarations' graph
    // nodes; the declaration files keep the index's spelling in the scope.
    const scope = new Set<string>(declFiles);
    const visited = new Set<string>(graphNodes);
    const queue = [...graphNodes];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      if (!answeredByCertified(current)) return null;
      for (const dependent of this.dependencyGraph.getDependents(current)) {
        const normalized = this.normalize(dependent) as string;
        if (visited.has(normalized)) continue;
        visited.add(normalized);
        scope.add(normalized);
        queue.push(normalized);
      }
    }
    scope.add(cursorFile);
    return { files: [...scope], certified };
  }

  /** Whether the root still publishes the exact coverage a scope was certified on. */
  private certificateHolds(
    workspaceFolder: string,
    certified: LanguageCoverage,
  ): boolean {
    return (
      this.dependencyGraph.getCoverageReport(workspaceFolder)?.languages ===
      certified
    );
  }

  /**
   * Bounded scan of every recognised source file, used whenever the
   * narrowing gate does not hold. Discovery is itself bounded (one past
   * MAX_FILES_SCANNED, r1 M3) and applies the default vendor and build
   * excludes plus the workspace ignore files (closing review R26B-C-M2), so
   * an ignored generated tree cannot use up the caps before source. A file
   * skipped by ignore rules is out of scope, not a truncation. `truncated`
   * when discovery stopped at the bound, could not read part of the tree, or
   * failed, or when the scan left files unread.
   */
  private async textScan(
    workspaceFolder: string,
    identifier: string,
  ): Promise<{ locations: Location[]; truncated: boolean }> {
    const pattern = `{${SCAN_EXTENSIONS.map((ext) => `**/*${ext}`).join(',')}}`;
    const ignore = await this.workspaceIgnore(workspaceFolder);
    let found: readonly string[];
    let discoveryIncomplete = false;
    try {
      found = await this.fs.findFiles(
        pattern,
        [...DEFAULT_WORKSPACE_EXCLUDES, ...ignore.walkExcludes],
        MAX_FILES_SCANNED + 1,
        workspaceFolder,
      );
    } catch (error: unknown) {
      if (!(error instanceof IncompleteFileSearchError)) {
        // Discovery failed outright: nothing could be scanned, which the
        // report discloses as `truncated` (never a clean "Found: 0").
        this.logger.warn('[ElectronIDECapabilities] Reference discovery failed', {
          identifier,
          error: error instanceof Error ? error.message : String(error),
        });
        return { locations: [], truncated: true };
      }
      // Part of the tree could not be read: scan what was found, disclosed.
      found = error.matches;
      discoveryIncomplete = true;
    }
    const files = found
      .slice(0, MAX_FILES_SCANNED)
      .map((file) => this.toAbsolute(workspaceFolder, file))
      .filter((file) => !ignore.isIgnored(file));
    const scan = await this.scanFiles(files, identifier);
    return {
      locations: scan.locations,
      truncated:
        scan.truncated ||
        discoveryIncomplete ||
        found.length > MAX_FILES_SCANNED,
    };
  }

  /**
   * The workspace ignore rules, the same ones the indexer stream applied
   * before the fix round (`IgnorePatternResolverService`):
   *   - `isIgnored`: the exact decision (last match wins, negations), applied
   *     to every discovered file;
   *   - `walkExcludes`: the ignore patterns passed into the bounded walk
   *     itself (the `ContextService.getEffectiveExcludes` precedent), so an
   *     ignored tree never spends the discovery bound. Left empty when any
   *     pattern is a negation: a walk exclude cannot re-include a file, and
   *     dropping a re-included source file would be a silent omission.
   * Unreadable ignore files mean no ignore rules (more files scanned, never
   * fewer).
   */
  private async workspaceIgnore(workspaceFolder: string): Promise<{
    isIgnored: (file: string) => boolean;
    walkExcludes: string[];
  }> {
    let ignoreFiles: Awaited<
      ReturnType<IgnorePatternResolverService['parseWorkspaceIgnoreFiles']>
    >;
    try {
      ignoreFiles =
        await this.ignoreResolver.parseWorkspaceIgnoreFiles(workspaceFolder);
    } catch (error: unknown) {
      this.logger.warn(
        '[ElectronIDECapabilities] Workspace ignore files could not be read; scanning without them',
        { error: error instanceof Error ? error.message : String(error) },
      );
      return { isIgnored: () => false, walkExcludes: [] };
    }
    const patterns = ignoreFiles.flatMap((file) => file.patterns);
    return {
      isIgnored: this.ignoreResolver.compileMatcher(
        ignoreFiles,
        workspaceFolder,
      ),
      walkExcludes: patterns.some((p) => p.isNegation)
        ? []
        : patterns.map((p) => p.pattern),
    };
  }

  /**
   * Scan `files` in order. `truncated` when the match cap stopped the scan
   * with matches or files left, or any file was skipped (unreadable, too
   * large, or an unexpected failure) — r1 B5: a skipped file is an omission
   * the report must disclose.
   */
  private async scanFiles(
    files: readonly string[],
    identifier: string,
  ): Promise<{ locations: Location[]; truncated: boolean }> {
    const locations: Location[] = [];
    const matcher = identifierMatcher(identifier);
    let truncated = false;
    for (let i = 0; i < files.length; i++) {
      if (locations.length >= MAX_REFERENCE_MATCHES) {
        truncated = true;
        break;
      }
      try {
        const scan = await this.collectMatchesInFile(
          files[i],
          matcher,
          locations,
        );
        if (scan.status !== 'scanned' || scan.capped) truncated = true;
        if (scan.capped) break;
      } catch (error: unknown) {
        truncated = true;
        this.logger.warn('[ElectronIDECapabilities] Reference scan failed', {
          identifier,
          file: files[i],
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (truncated) {
      this.logger.info(
        `[ElectronIDECapabilities] Reference scan for "${identifier}" is incomplete (cap or skipped file)`,
      );
    }
    return { locations, truncated };
  }

  /**
   * Read a file (at most MAX_SCAN_FILE_BYTES), then append matches of the
   * identifier outside string/comment nodes to `out`, stopping at the match
   * cap. Matches are streamed, never collected in full first (r1 M3); the
   * file is only parsed when it has at least one raw match.
   */
  private async collectMatchesInFile(
    filePath: string,
    matcher: RegExp,
    out: Location[],
  ): Promise<{ status: FileScanStatus; capped: boolean }> {
    let size: number;
    try {
      size = (await this.fs.stat(filePath)).size;
    } catch (error: unknown) {
      this.logger.warn('[ElectronIDECapabilities] Could not stat file', {
        file: filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return { status: 'unreadable', capped: false };
    }
    if (size > MAX_SCAN_FILE_BYTES) {
      return { status: 'too-large', capped: false };
    }
    const content = await this.safeReadFile(filePath);
    if (content === null) return { status: 'unreadable', capped: false };

    matcher.lastIndex = 0;
    if (!matcher.test(content)) return { status: 'scanned', capped: false };

    const excluded = await this.findExcludedRanges(content, filePath);
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      matcher.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = matcher.exec(lines[i])) !== null) {
        if (isInExcludedRange(i, match.index, excluded)) continue;
        if (out.length >= MAX_REFERENCE_MATCHES) {
          return { status: 'scanned', capped: true };
        }
        out.push({ file: filePath, line: i, column: match.index });
      }
    }
    return { status: 'scanned', capped: false };
  }

  /** A discovered path as an absolute forward-slash path under the root. */
  private toAbsolute(workspaceFolder: string, file: string): string {
    const normalized = toForwardSlashes(file);
    return /^[a-zA-Z]:/.test(normalized) || normalized.startsWith('/')
      ? normalized
      : `${workspaceFolder}/${normalized}`;
  }

  /**
   * Tree-sitter ranges of comment/string nodes to exclude. Returns [] when the
   * language is unsupported or parsing fails (so matches are kept rather than
   * silently dropped).
   */
  private async findExcludedRanges(
    content: string,
    filePath: string,
  ): Promise<ExcludedRange[]> {
    const language = extToLanguage(filePath);
    if (!language) return [];
    const query = COMMENT_STRING_QUERIES[language];
    if (!query) return [];
    try {
      const result = await this.treeSitter.query(content, language, query);
      if (!result.isOk() || !result.value) return [];
      return result.value.flatMap((m) =>
        m.captures.map((c) => ({
          startRow: c.startPosition.row,
          startColumn: c.startPosition.column,
          endRow: c.endPosition.row,
          endColumn: c.endPosition.column,
        })),
      );
    } catch {
      // degradation-audit: optional-capability - excluding comment and string
      // ranges is an optional filter; an empty list KEEPS every match rather
      // than dropping one, which is the documented safe direction above.
      return [];
    }
  }

  /**
   * Read the file and extract the identifier spanning the given 0-based
   * line/column position. Returns null on read failure or non-identifier.
   */
  private async identifierAt(
    file: string,
    line: number,
    col: number,
  ): Promise<string | null> {
    const filePath = this.resolveAbsolutePath(file);
    if (!filePath) return null;
    const content = await this.safeReadFile(filePath);
    if (content === null) return null;
    return extractIdentifier(content, line, col);
  }

  private async safeReadFile(filePath: string): Promise<string | null> {
    try {
      return await this.fs.readFile(filePath);
    } catch (error: unknown) {
      // degradation-audit: optional-capability - every caller treats a file it
      // cannot read as one with no symbol in it; null skips that candidate and
      // the surrounding search still reports whatever the other files gave.
      this.logger.warn('[ElectronIDECapabilities] Could not read file', {
        file: filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Resolve a possibly-relative path to a normalized absolute path using the
   * workspace root. Returns null when a relative path cannot be resolved.
   */
  private resolveAbsolutePath(file: string): string | null {
    const normalized = this.normalize(file);
    if (!normalized) return null;
    const isAbsolute =
      /^[a-zA-Z]:/.test(normalized) || normalized.startsWith('/');
    if (isAbsolute) return normalized;
    const wsRoot = this.normalize(this.workspaceProvider.getWorkspaceRoot());
    if (!wsRoot) return null;
    return `${wsRoot}/${normalized}`;
  }

  private normalize(p: string | undefined): string | undefined {
    return p ? p.replace(/\\/g, '/') : p;
  }
}

/** Extract the identifier spanning the 0-based line/column, or null. */
function extractIdentifier(
  content: string,
  line: number,
  col: number,
): string | null {
  const lines = content.split(/\r?\n/);
  if (line < 0 || line >= lines.length) return null;
  const text = lines[line];
  if (col < 0 || col > text.length) return null;

  let start = col;
  while (start > 0 && IDENTIFIER_RE.test(text[start - 1])) start--;
  let end = col;
  while (end < text.length && IDENTIFIER_RE.test(text[end])) end++;

  const identifier = text.slice(start, end);
  return identifier.length > 0 && /[A-Za-z_$]/.test(identifier[0])
    ? identifier
    : null;
}

/** True when the 0-based position falls within any excluded range. */
function isInExcludedRange(
  row: number,
  column: number,
  ranges: ExcludedRange[],
): boolean {
  for (const r of ranges) {
    const afterStart =
      row > r.startRow || (row === r.startRow && column >= r.startColumn);
    const beforeEnd =
      row < r.endRow || (row === r.endRow && column < r.endColumn);
    if (afterStart && beforeEnd) return true;
  }
  return false;
}

/**
 * Parse the 0-based declaration start line from a symbol index entry's text,
 * formatted as "<kind> <name> in <relPath>:<startLine>-<endLine>".
 */
function parseDeclarationLine(text: string): number | null {
  const matches = [...text.matchAll(/:(\d+)-(\d+)/g)];
  if (matches.length === 0) return null;
  const last = matches[matches.length - 1];
  const value = Number.parseInt(last[1], 10);
  return Number.isNaN(value) ? null : value;
}

/**
 * Language for the index-free declaration scan, or null (an unresolved
 * answer) when no grammar can parse the file reliably. The packaged
 * TypeScript grammar has no JSX, so valid JSX in a .tsx file parses as ERROR;
 * .tsx is therefore always unresolved here rather than resolved only when the
 * file happens to contain no JSX. Resolving .tsx needs a packaged TSX grammar.
 */
function declarationLanguage(filePath: string): SupportedLanguage | null {
  return path.posix.extname(filePath).toLowerCase() === '.tsx'
    ? null
    : extToLanguage(filePath);
}

/**
 * Map a file path to a Tree-sitter SupportedLanguage, or null when the language
 * has no grammar wired (matches the symbol indexer's coverage).
 */
function extToLanguage(filePath: string): SupportedLanguage | null {
  const ext = path.posix.extname(filePath).toLowerCase();
  switch (ext) {
    case '.ts':
    case '.tsx':
    case '.mts':
    case '.cts':
      return 'typescript';
    case '.js':
    case '.jsx':
    case '.mjs':
    case '.cjs':
      return 'javascript';
    case '.py':
      return 'python';
    case '.go':
      return 'go';
    case '.cs':
    case '.csx':
      return 'csharp';
    default:
      return null;
  }
}

/** Lower-case extension (leading dot) of a forward-slash path. */
function extensionOfPath(filePath: string): string {
  return path.posix.extname(filePath).toLowerCase();
}

/**
 * The report for a lookup that ran: the registry language of the queried
 * file, whether `mechanism` covers it, and `text-scan` disclosed as the
 * approximation of a name scan that no graph narrowed.
 */
function lspReport(
  cursorPath: string,
  locations: Location[],
  mechanism: Exclude<LspMechanism, 'none' | 'provider-defined'>,
  truncated = false,
): LspLocationReport {
  return {
    locations,
    mechanism,
    language: languageForExtension(extensionOfPath(cursorPath)),
    languageSupported: mechanismCoversFile(mechanism, cursorPath),
    approximations: mechanism === 'text-scan' ? ['text-scan'] : [],
    ...(truncated ? { truncated: true } : {}),
  };
}

/** Whether `mechanism` can answer for the queried file's language. */
function mechanismCoversFile(
  mechanism: Exclude<LspMechanism, 'none' | 'provider-defined'>,
  cursorPath: string,
): boolean {
  const extension = extensionOfPath(cursorPath);
  switch (mechanism) {
    case 'symbol-index':
      return extensionHasCapability(extension, 'codeIndex');
    case 'declaration-scan': {
      // The registry claim and the query that implements it must both hold;
      // `.tsx` has the claim through TypeScript but no reliable grammar here.
      const language = declarationLanguage(cursorPath);
      return (
        extensionHasCapability(extension, 'definitionFallback') &&
        language !== null &&
        DECLARATION_QUERIES[language] !== undefined
      );
    }
    case 'graph-scoped-scan':
      // Reached only through the narrowing gate, which proved the scope.
      return true;
    case 'text-scan':
      return SCAN_EXTENSIONS.includes(extension);
  }
}

function isLanguageId(id: string): id is LanguageId {
  return (LANGUAGE_IDS as readonly string[]).includes(id);
}

/**
 * First two conditions of the narrowing gate, on the graph's published
 * coverage:
 *   - every language in the census has `referenceScopeComplete`. The census
 *     languages are the graphed ones (bounded above by the graph's
 *     `supportedLanguages` claim, all checked) and the unsupported ones (any
 *     `unsupportedByLanguage` entry; `other` is never scope-complete);
 *   - the coverage is clean, `resolution` included and required.
 */
function graphReferenceScopeIsComplete(coverage: LanguageCoverage): boolean {
  if (coverage.resolution === undefined || !isCleanAnswer(coverage)) {
    return false;
  }
  const census = new Set<string>(coverage.supportedLanguages);
  for (const [language, count] of Object.entries(
    coverage.unsupportedByLanguage ?? {},
  )) {
    if (count !== undefined && count !== 0) census.add(language);
  }
  return [...census].every(
    (language) =>
      isLanguageId(language) &&
      LANGUAGE_REGISTRY[language].capabilities.graphEdges
        ?.referenceScopeComplete === true,
  );
}

/**
 * Strip a trailing script-module extension from a forward-slash path. Other
 * dotted suffixes stay (`./foo.service` is the module `foo.service`, not `foo`).
 */
function stripExtension(p: string): string {
  const ext = path.posix.extname(p).toLowerCase();
  return MODULE_EXTENSIONS.includes(ext) ? p.slice(0, -ext.length) : p;
}

function toForwardSlashes(p: string): string {
  return p.replace(/\\/g, '/');
}

/** A drive-letter (`C:/…`) or UNC (`//server/share/…`) forward-slash path. */
function isWindowsPath(p: string): boolean {
  return /^[a-zA-Z]:\//.test(p) || p.startsWith('//');
}

/**
 * Resolve a relative specifier against the directory of a forward-slash file
 * path. Windows paths use win32 semantics, which keep a UNC `//server/share`
 * root intact (POSIX normalisation would collapse it to `/server/share`).
 */
function resolveRelative(fromFile: string, specifier: string): string {
  if (isWindowsPath(fromFile)) {
    return toForwardSlashes(
      path.win32.resolve(path.win32.dirname(fromFile), specifier),
    );
  }
  return path.posix.normalize(
    path.posix.join(path.posix.dirname(fromFile), specifier),
  );
}

/**
 * Comparable form of an absolute path: forward slashes, no `\\?\` long-path
 * prefix, normalised with the path's own semantics (UNC roots preserved), no
 * trailing slash, and case-folded where the filesystem is case-insensitive
 * (a Windows host, or a Windows-shaped path).
 */
function comparablePath(p: string): string {
  const plain = toForwardSlashes(p)
    .replace(/^\/\/\?\/UNC\//i, '//')
    .replace(/^\/\/\?\//, '');
  const windows = isWindowsPath(plain);
  const normalized = (
    windows
      ? toForwardSlashes(path.win32.normalize(plain))
      : path.posix.normalize(plain)
  ).replace(/\/+$/, '');
  return windows || process.platform === 'win32'
    ? normalized.toLowerCase()
    : normalized;
}

/** Whether an absolute path lies strictly inside `dir`. */
function isInsideDirectory(filePath: string, dir: string): boolean {
  return comparablePath(filePath).startsWith(`${comparablePath(dir)}/`);
}

/**
 * Whether a candidate declaration file path resolves to the given
 * extensionless module path (direct file or its index file).
 */
function fileMatchesModule(candidateFile: string, modulePath: string): boolean {
  const stripped = stripExtension(candidateFile);
  return stripped === modulePath || stripped === `${modulePath}/index`;
}

/**
 * Global matcher for an identifier as a whole token. Boundaries use the same
 * identifier character set as extraction (`$` included), not `\b`, which
 * treats `$` as a non-word character (r1 M2: `$Foo` never matched).
 */
function identifierMatcher(identifier: string): RegExp {
  return new RegExp(
    `(?<![A-Za-z0-9_$])${escapeRegExp(identifier)}(?![A-Za-z0-9_$])`,
    'g',
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
