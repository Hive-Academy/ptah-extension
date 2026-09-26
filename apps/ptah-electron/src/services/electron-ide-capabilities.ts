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
 *   - getReferences: word-boundary scan of indexed workspace files for the
 *     identifier, with two precision passes:
 *       (1) when THIS workspace's dependency graph is built and the symbol
 *           index names the declaration, scope the scan to the declaration
 *           file(s) + their transitive dependents instead of the whole
 *           workspace. The index-free fallback above never scopes the scan:
 *           global-script references have no import edge to follow;
 *       (2) drop matches that fall inside string/comment nodes via Tree-sitter.
 *     Otherwise it runs a bounded full-workspace scan.
 *   - getHover: surface the matched symbol's index entry text.
 *   - getSignatureHelp: unsupported name-based — returns null.
 *
 * Editor state is sourced from the renderer-backed ElectronEditorProvider
 * (active file only). Code actions/refactors require a language server and are
 * therefore graceful no-ops here.
 */

import { promises as nodeFs } from 'node:fs';
import * as path from 'node:path';
import type {
  IEditorProvider,
  IFileSystemProvider,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';
import type { ICodeSymbolReader } from '@ptah-extension/memory-contracts';
import type {
  WorkspaceIndexerService,
  DependencyGraphService,
  AstAnalysisService,
  TreeSitterParserService,
  SupportedLanguage,
} from '@ptah-extension/workspace-intelligence';
import type {
  IIDECapabilities,
  Location,
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
/** Hard cap on files read during an unscoped (brute) reference scan. */
const MAX_FILES_SCANNED = 8000;
/** Code file extensions scanned for references — mirrors the symbol indexer. */
const SCAN_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mts',
  '.cts',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.rb',
  '.php',
  '.c',
  '.cc',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
];

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
};

/**
 * Outcome of a declaration scan: the 0-based position of the declared name,
 * `null` when the file parses cleanly and declares nothing by that name, or
 * `'uncertain'` when the file cannot be parsed reliably (no query for the
 * language, a failed parse, or a parse error in the file).
 */
type DeclarationScan = { line: number; column: number } | null | 'uncertain';

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
 */
const COMMENT_STRING_QUERIES: Partial<Record<SupportedLanguage, string>> = {
  typescript: '[(comment) @x (string) @x (template_string) @x]',
  javascript: '[(comment) @x (string) @x (template_string) @x]',
  python: '[(comment) @x (string) @x]',
  go: '[(comment) @x (interpreted_string_literal) @x (raw_string_literal) @x]',
};

/** Excluded node range (0-based rows/columns), end-exclusive on column. */
interface ExcludedRange {
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
}

export class ElectronIDECapabilities implements IIDECapabilities {
  constructor(
    private readonly symbolReader: ICodeSymbolReader | undefined,
    private readonly indexer: WorkspaceIndexerService,
    private readonly fs: IFileSystemProvider,
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
    getDefinition: (file, line, col) =>
      this.resolveDeclaration(file, line, col),

    getReferences: (file, line, col) => this.scanReferences(file, line, col),

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

    getTypeDefinition: (file, line, col) =>
      this.resolveDeclaration(file, line, col),

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
   * Resolve the identifier under the cursor to its declaration location(s).
   * Reads the cursor file once and delegates to declarationsFor().
   */
  private async resolveDeclaration(
    file: string,
    line: number,
    col: number,
  ): Promise<Location[]> {
    const cursorPath = this.resolveAbsolutePath(file);
    if (!cursorPath) return [];
    const content = await this.safeReadFile(cursorPath);
    if (content === null) return [];
    const identifier = extractIdentifier(content, line, col);
    if (!identifier) return [];
    return this.declarationsFor(cursorPath, content, identifier);
  }

  /**
   * Declarations named by the symbol index; with zero index candidates,
   * declarationsWithoutIndex() answers instead.
   */
  private async declarationsFor(
    cursorPath: string,
    cursorContent: string,
    identifier: string,
  ): Promise<Location[]> {
    const indexed = await this.indexedDeclarations(
      cursorPath,
      cursorContent,
      identifier,
    );
    if (indexed.length > 0) return indexed;
    return this.declarationsWithoutIndex(cursorPath, cursorContent, identifier);
  }

  /**
   * Look the identifier up in the symbol index and disambiguate multiple
   * same-named declarations using the cursor file's imports:
   *   - a declaration in the cursor file itself wins;
   *   - otherwise the declaration in the module the cursor file imports the
   *     identifier from wins;
   *   - otherwise all exact-name candidates are returned (no confident pick).
   * Returns [] when the index has no candidate (or there is no reader).
   */
  private async indexedDeclarations(
    cursorPath: string,
    cursorContent: string,
    identifier: string,
  ): Promise<Location[]> {
    const candidates = await this.indexCandidates(identifier);
    if (candidates.length <= 1) return candidates;

    const cursorNorm = this.normalize(cursorPath) as string;
    const local = candidates.filter((c) => c.file === cursorNorm);
    if (local.length > 0) return local;

    const importedModule = await this.resolveImportedModule(
      cursorPath,
      cursorContent,
      identifier,
    );
    if (importedModule) {
      const matched = candidates.filter((c) =>
        fileMatchesModule(c.file, importedModule),
      );
      if (matched.length > 0) return matched;
    }

    return candidates;
  }

  /** Exact-name declaration candidates from the symbol index ([] without one). */
  private async indexCandidates(identifier: string): Promise<Location[]> {
    if (!this.symbolReader) return [];
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
    return candidates;
  }

  /**
   * Index-independent resolution, used when the index has no candidate:
   *   1. a top-level declaration of the identifier in the cursor file itself;
   *   2. otherwise the top-level declaration in the ONE workspace file the
   *      cursor file's relative import of the identifier resolves to (a single
   *      file read).
   * A file that does not parse cleanly makes the answer unresolved ([]), as do
   * package, alias (tsconfig paths) and re-exported (barrel) symbols, and a
   * .tsx cursor or target file (see declarationLanguage).
   */
  private async declarationsWithoutIndex(
    cursorPath: string,
    cursorContent: string,
    identifier: string,
  ): Promise<Location[]> {
    const cursorNorm = this.normalize(cursorPath) as string;
    const local = await this.findDeclaration(
      cursorContent,
      identifier,
      declarationLanguage(cursorNorm),
    );
    if (local === 'uncertain') return [];
    if (local) return [{ file: cursorNorm, ...local }];

    const modulePath = await this.resolveImportedModule(
      cursorPath,
      cursorContent,
      identifier,
    );
    if (!modulePath) return [];
    const target = await this.findModuleFile(modulePath);
    if (!target) return [];
    const targetLanguage = declarationLanguage(target.file);
    if (!targetLanguage) return [];
    const content = await this.safeReadFile(target.readPath);
    if (content === null) return [];
    const found = await this.findDeclaration(
      content,
      identifier,
      targetLanguage,
    );
    return found && found !== 'uncertain'
      ? [{ file: target.file, ...found }]
      : [];
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
    if (!language || !query) return 'uncertain';
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
   * Name-based reference search. When the dependency graph is built, scopes the
   * scan to the declaration file(s) + their transitive dependents; otherwise
   * falls back to a bounded full-workspace scan. Matches inside string/comment
   * nodes are dropped via Tree-sitter. Bounded by MAX_REFERENCE_MATCHES.
   */
  private async scanReferences(
    file: string,
    line: number,
    col: number,
  ): Promise<Location[]> {
    const cursorPath = this.resolveAbsolutePath(file);
    if (!cursorPath) return [];
    const cursorContent = await this.safeReadFile(cursorPath);
    if (cursorContent === null) return [];
    const identifier = extractIdentifier(cursorContent, line, col);
    if (!identifier) return [];

    const workspaceFolder = this.normalize(
      this.workspaceProvider.getWorkspaceRoot(),
    );
    if (!workspaceFolder) return [];

    const scopeFiles = await this.computeReferenceScope(
      cursorPath,
      cursorContent,
      identifier,
      workspaceFolder,
    );
    const locations: Location[] = [];

    try {
      if (scopeFiles) {
        for (const filePath of scopeFiles) {
          if (locations.length >= MAX_REFERENCE_MATCHES) break;
          await this.collectMatchesInFile(filePath, identifier, locations);
        }
      } else {
        await this.bruteScan(workspaceFolder, identifier, locations);
      }
    } catch (error: unknown) {
      this.logger.warn('[ElectronIDECapabilities] Reference scan failed', {
        identifier,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (locations.length >= MAX_REFERENCE_MATCHES) {
      this.logger.info(
        `[ElectronIDECapabilities] Reference scan capped at ${MAX_REFERENCE_MATCHES} matches for "${identifier}"`,
      );
    }
    return locations;
  }

  /**
   * Returns the scoped file set (declaration files + transitive dependents +
   * the cursor file) when this workspace's dependency graph is built and the
   * symbol index names the declaration, or null to signal a full-workspace
   * brute scan. The index-free declaration fallback is deliberately NOT used
   * here: a guessed declaration says nothing about scope completeness, and
   * global-script references have no import edge in the graph.
   */
  private async computeReferenceScope(
    cursorPath: string,
    cursorContent: string,
    identifier: string,
    workspaceFolder: string,
  ): Promise<string[] | null> {
    if (!this.dependencyGraph.isBuilt(workspaceFolder)) return null;
    const declarations = await this.indexedDeclarations(
      cursorPath,
      cursorContent,
      identifier,
    );
    if (declarations.length === 0) return null;

    const declFiles = new Set(declarations.map((d) => d.file));
    const scope = this.collectTransitiveDependents(declFiles);
    scope.add(this.normalize(cursorPath) as string);
    return [...scope];
  }

  /** Breadth-first walk of reverse-import edges from the declaration files. */
  private collectTransitiveDependents(declFiles: Set<string>): Set<string> {
    const scope = new Set<string>(declFiles);
    const queue = [...declFiles];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      for (const dependent of this.dependencyGraph.getDependents(current)) {
        const normalized = this.normalize(dependent) as string;
        if (!scope.has(normalized)) {
          scope.add(normalized);
          queue.push(normalized);
        }
      }
    }
    return scope;
  }

  /** Bounded full-workspace scan used when the dependency graph is unbuilt. */
  private async bruteScan(
    workspaceFolder: string,
    identifier: string,
    out: Location[],
  ): Promise<void> {
    const includePatterns = SCAN_EXTENSIONS.map((ext) => `**/*${ext}`);
    const stream = this.indexer.indexWorkspaceStream({
      includePatterns,
      respectIgnoreFiles: true,
      workspaceFolder,
    });

    let filesScanned = 0;
    for await (const indexed of stream) {
      if (filesScanned >= MAX_FILES_SCANNED) break;
      if (out.length >= MAX_REFERENCE_MATCHES) break;
      filesScanned++;
      await this.collectMatchesInFile(
        this.normalize(indexed.path) as string,
        identifier,
        out,
      );
    }
  }

  /**
   * Read a file, collect word-boundary matches for the identifier, then drop
   * matches inside string/comment nodes (only parsing the file when it has at
   * least one raw match). Appends surviving matches to `out` up to the cap.
   */
  private async collectMatchesInFile(
    filePath: string,
    identifier: string,
    out: Location[],
  ): Promise<void> {
    const content = await this.safeReadFile(filePath);
    if (content === null) return;

    const wordRe = new RegExp(`\\b${escapeRegExp(identifier)}\\b`, 'g');
    const lines = content.split(/\r?\n/);
    const raw: Array<{ line: number; column: number }> = [];
    for (let i = 0; i < lines.length; i++) {
      wordRe.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = wordRe.exec(lines[i])) !== null) {
        raw.push({ line: i, column: match.index });
      }
    }
    if (raw.length === 0) return;

    const excluded = await this.findExcludedRanges(content, filePath);
    for (const r of raw) {
      if (out.length >= MAX_REFERENCE_MATCHES) return;
      if (isInExcludedRange(r.line, r.column, excluded)) continue;
      out.push({ file: filePath, line: r.line, column: r.column });
    }
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
    default:
      return null;
  }
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
