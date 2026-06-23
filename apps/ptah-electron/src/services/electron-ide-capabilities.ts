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
 *   - getReferences: word-boundary scan of indexed workspace files for the
 *     identifier, with two precision passes:
 *       (1) when the dependency graph is built, scope the scan to the
 *           declaration file(s) + their transitive dependents (references to a
 *           symbol can only appear in modules that import it) instead of the
 *           whole workspace;
 *       (2) drop matches that fall inside string/comment nodes via Tree-sitter.
 *     Falls back to a bounded full-workspace scan when the graph is unbuilt.
 *   - getHover: surface the matched symbol's index entry text.
 *   - getSignatureHelp: unsupported name-based — returns null.
 *
 * Editor state is sourced from the renderer-backed ElectronEditorProvider
 * (active file only). Code actions/refactors require a language server and are
 * therefore graceful no-ops here.
 */

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
    if (!this.symbolReader) return [];
    const cursorPath = this.resolveAbsolutePath(file);
    if (!cursorPath) return [];
    const content = await this.safeReadFile(cursorPath);
    if (content === null) return [];
    const identifier = extractIdentifier(content, line, col);
    if (!identifier) return [];
    return this.declarationsFor(cursorPath, content, identifier);
  }

  /**
   * Look the identifier up in the symbol index and disambiguate multiple
   * same-named declarations using the cursor file's imports:
   *   - a declaration in the cursor file itself wins;
   *   - otherwise the declaration in the module the cursor file imports the
   *     identifier from wins;
   *   - otherwise all exact-name candidates are returned (no confident pick).
   */
  private async declarationsFor(
    cursorPath: string,
    cursorContent: string,
    identifier: string,
  ): Promise<Location[]> {
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
      return null;
    }
    if (!result.isOk() || !result.value) return null;

    const imp = result.value.imports.find(
      (i) => !i.isNamespace && (i.importedSymbols ?? []).includes(identifier),
    );
    if (!imp || !imp.source.startsWith('.')) return null;

    const dir = path.posix.dirname(this.normalize(cursorPath) as string);
    return stripExtension(
      path.posix.normalize(path.posix.join(dir, imp.source)),
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
   * the cursor file) when the dependency graph is built and the declaration is
   * known, or null to signal a full-workspace brute scan.
   */
  private async computeReferenceScope(
    cursorPath: string,
    cursorContent: string,
    identifier: string,
  ): Promise<string[] | null> {
    if (!this.dependencyGraph.isBuilt()) return null;
    const declarations = await this.declarationsFor(
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

/** Strip a trailing file extension from a forward-slash path. */
function stripExtension(p: string): string {
  const ext = path.posix.extname(p);
  return ext ? p.slice(0, -ext.length) : p;
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
