/**
 * Electron IDE Capabilities
 *
 * Implements IIDECapabilities for the Electron desktop runtime using the
 * existing Tree-sitter symbol index (workspace-intelligence + memory-curator)
 * instead of a language server. Registering this under IDE_CAPABILITIES_TOKEN
 * unlocks the ptah_lsp_references / ptah_lsp_definitions / ptah_get_dirty_files
 * MCP tools (gated on hasIDECapabilities in protocol-dispatcher.ts).
 *
 * Resolution is NAME-BASED, not type-aware:
 *   - getDefinition / getTypeDefinition: resolve the identifier under the cursor
 *     to its declaration(s) via the SQLite symbol index (ICodeSymbolReader).
 *   - getReferences: word-boundary scan of indexed workspace files for the
 *     identifier (bounded by MAX_REFERENCE_MATCHES / MAX_FILES_SCANNED).
 *   - getHover: surface the matched symbol's index entry text.
 *   - getSignatureHelp: unsupported name-based — returns null.
 *
 * Editor state is sourced from the renderer-backed ElectronEditorProvider
 * (active file only). Code actions/refactors require a language server and are
 * therefore graceful no-ops here.
 */

import type {
  IEditorProvider,
  IFileSystemProvider,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';
import type { ICodeSymbolReader } from '@ptah-extension/memory-contracts';
import type { WorkspaceIndexerService } from '@ptah-extension/workspace-intelligence';
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
/** Hard cap on files read during a reference scan. */
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

export class ElectronIDECapabilities implements IIDECapabilities {
  constructor(
    private readonly symbolReader: ICodeSymbolReader | undefined,
    private readonly indexer: WorkspaceIndexerService,
    private readonly fs: IFileSystemProvider,
    private readonly workspaceProvider: IWorkspaceProvider,
    private readonly editorProvider: IEditorProvider,
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
   * Resolve the identifier under the cursor to its declaration location(s)
   * via the symbol index. Returns [] when no symbol layer is available, no
   * identifier is found, or no exact-name match exists.
   */
  private async resolveDeclaration(
    file: string,
    line: number,
    col: number,
  ): Promise<Location[]> {
    if (!this.symbolReader) return [];
    const identifier = await this.identifierAt(file, line, col);
    if (!identifier) return [];

    const wsRoot = this.normalize(this.workspaceProvider.getWorkspaceRoot());
    const page = await this.symbolReader.searchSymbols(
      identifier,
      DEFINITION_TOP_K,
      wsRoot,
    );

    const seen = new Set<string>();
    const locations: Location[] = [];
    for (const hit of page.hits) {
      if (hit.symbolName !== identifier) continue;
      const startLine = parseDeclarationLine(hit.text);
      if (startLine === null) continue;
      const filePath = this.normalize(hit.filePath) as string;
      const key = `${filePath}:${startLine}`;
      if (seen.has(key)) continue;
      seen.add(key);
      locations.push({ file: filePath, line: startLine, column: 0 });
    }
    return locations;
  }

  /**
   * Name-based reference search: word-boundary scan of indexed workspace files
   * for the identifier under the cursor. Bounded by MAX_FILES_SCANNED and
   * MAX_REFERENCE_MATCHES to keep latency predictable on large repos.
   */
  private async scanReferences(
    file: string,
    line: number,
    col: number,
  ): Promise<Location[]> {
    const identifier = await this.identifierAt(file, line, col);
    if (!identifier) return [];

    const workspaceFolder = this.normalize(
      this.workspaceProvider.getWorkspaceRoot(),
    );
    if (!workspaceFolder) return [];

    const wordRe = new RegExp(`\\b${escapeRegExp(identifier)}\\b`, 'g');
    const includePatterns = SCAN_EXTENSIONS.map((ext) => `**/*${ext}`);
    const locations: Location[] = [];
    let filesScanned = 0;

    try {
      const stream = this.indexer.indexWorkspaceStream({
        includePatterns,
        respectIgnoreFiles: true,
        workspaceFolder,
      });

      for await (const indexed of stream) {
        if (filesScanned >= MAX_FILES_SCANNED) break;
        if (locations.length >= MAX_REFERENCE_MATCHES) break;
        filesScanned++;

        const filePath = this.normalize(indexed.path) as string;
        let content: string;
        try {
          content = await this.fs.readFile(filePath);
        } catch {
          continue;
        }

        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i++) {
          wordRe.lastIndex = 0;
          let match: RegExpExecArray | null;
          while ((match = wordRe.exec(lines[i])) !== null) {
            locations.push({ file: filePath, line: i, column: match.index });
            if (locations.length >= MAX_REFERENCE_MATCHES) break;
          }
          if (locations.length >= MAX_REFERENCE_MATCHES) break;
        }
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
   * Read the file and extract the identifier spanning the given 0-based
   * line/column position. Returns null if the position is out of range or
   * not on an identifier character.
   */
  private async identifierAt(
    file: string,
    line: number,
    col: number,
  ): Promise<string | null> {
    const filePath = this.resolveAbsolutePath(file);
    if (!filePath) return null;
    let content: string;
    try {
      content = await this.fs.readFile(filePath);
    } catch (error: unknown) {
      this.logger.warn('[ElectronIDECapabilities] Could not read file', {
        file: filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }

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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
