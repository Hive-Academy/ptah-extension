/**
 * Electron Editor RPC Handlers
 *
 * Handles Monaco editor and file explorer methods specific to Electron:
 * - editor:openFile - Read file content for Monaco editor
 * - editor:saveFile - Save file content from Monaco editor
 * - editor:getFileTree - Build recursive file tree from workspace root
 */

import { injectable, inject } from 'tsyringe';
import * as nodePath from 'path';
import * as nodeFs from 'fs/promises';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  IFileSystemProvider,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';

interface EditorOpenedNotifier {
  notifyFileOpened(filePath: string): void;
}
import type {
  FileOpenParams,
  EditorRevertFilesParams,
  EditorRevertFilesResult,
} from '@ptah-extension/shared';
import {
  MESSAGE_TYPES,
  TREE_HIDDEN_DIRS,
  isExcludedWorkspacePath,
} from '@ptah-extension/shared';
import { isFileBasedSettingKey } from '@ptah-extension/platform-core';

/** Extends FileOpenParams with legacy 'filePath' for backward compatibility. */
type FileOpenCompatParams = FileOpenParams & { filePath?: string };

interface WebviewBroadcaster {
  broadcastMessage(type: string, payload: unknown): Promise<void>;
}

interface FileTreeEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeEntry[];
  /** True when children were not loaded (directory at depth boundary) */
  needsLoad?: boolean;
}

/** A single match within a file for search results. */
interface SearchMatchInternal {
  line: number;
  column: number;
  lineText: string;
  matchLength: number;
}

/** A file containing search matches. */
interface SearchFileResultInternal {
  filePath: string;
  fileName: string;
  relativePath: string;
  matches: SearchMatchInternal[];
}

/** Escape special regex characters for literal string search. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Directory-exclusion glob handed to `findFiles` by `editor:searchInFiles`
 * and `editor:listAllFiles`, derived from `TREE_HIDDEN_DIRS` instead of
 * written out by hand.
 *
 * The two hand-written literals this replaces named 5 of the shared set's 11
 * members, so search and quick-open surfaced matches from `.hg`, `.svn`,
 * `.DS_Store`, `.Trash`, `.tmp` and `.temp` that the file tree itself hides.
 * Deriving the pattern means a name added to `TREE_HIDDEN_DIRS` reaches both
 * methods without a third manual edit, so the drift cannot recur.
 */
export const EXCLUDED_DIRS_GLOB = `**/{${[...TREE_HIDDEN_DIRS].join(',')}}/**`;

/** File extensions considered binary (skip during text search). */
const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.ico',
  '.svg',
  '.webp',
  '.avif',
  '.mp3',
  '.mp4',
  '.wav',
  '.ogg',
  '.webm',
  '.flac',
  '.aac',
  '.avi',
  '.mov',
  '.zip',
  '.gz',
  '.tar',
  '.rar',
  '.7z',
  '.bz2',
  '.xz',
  '.zst',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.bin',
  '.obj',
  '.o',
  '.a',
  '.lib',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  '.wasm',
  '.node',
  '.pyc',
  '.class',
  '.jar',
  '.sqlite',
  '.db',
  '.mdb',
  '.DS_Store',
  '.lock',
]);

@injectable()
export class EditorRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fs: IFileSystemProvider,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(PLATFORM_TOKENS.EDITOR_PROVIDER)
    private readonly editorProvider: EditorOpenedNotifier,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewBroadcaster,
  ) {}

  register(): void {
    this.registerFileOpen(); // file:open (registry standard name)
    this.registerOpenFile(); // editor:openFile (Electron-specific)
    this.registerRevertFiles(); // editor:revertFiles (Electron Monaco equivalent)
    this.registerSaveFile();
    this.registerGetFileTree();
    this.registerGetDirectoryChildren();
    this.registerGetSetting();
    this.registerUpdateSetting();
    this.registerSearchInFiles();
    this.registerCreateFile();
    this.registerCreateFolder();
    this.registerRenameItem();
    this.registerDeleteItem();
    this.registerListAllFiles();
  }

  /** Validate that a file path is within any workspace folder. Returns error message or null. */
  private validatePathInWorkspace(filePath: string): string | null {
    const folders = this.workspace.getWorkspaceFolders();
    if (folders.length === 0) return 'No workspace folder open';
    const normalize = (p: string) =>
      nodePath.resolve(p).replace(/\\/g, '/').toLowerCase();
    const target = normalize(filePath);
    const ok = folders.some((folder) => {
      const root = normalize(folder);
      return target === root || target.startsWith(root + '/');
    });
    return ok ? null : 'Path is outside the workspace';
  }

  /**
   * Register file:open (standard registry name used by the frontend)
   * and editor:openFile (Electron-specific alias). Both delegate to handleFileOpen.
   */
  private registerFileOpen(): void {
    this.rpcHandler.registerMethod(
      'file:open',
      (params: FileOpenCompatParams | undefined) =>
        this.handleFileOpen(params, 'file:open'),
    );
  }

  private registerOpenFile(): void {
    this.rpcHandler.registerMethod(
      'editor:openFile',
      (params: FileOpenCompatParams | undefined) =>
        this.handleFileOpen(params, 'editor:openFile'),
    );
  }

  /**
   * Shared implementation for file:open and editor:openFile.
   * Reads file content and notifies the editor provider.
   * Accepts both 'path' (FileOpenParams standard) and 'filePath' (legacy).
   *
   * NOTE, and it is deliberate: no `TREE_HIDDEN_DIRS` test happens here. A
   * path inside `node_modules` opens, even though the tree can never navigate
   * to one. Naming an exact path is an explicit intent that a default-hiding
   * rule does not override — opening a file from a stack frame is the case
   * that matters. `validatePathInWorkspace` below is the ONLY containment
   * boundary on this method. Full rationale in the header of
   * `workspace-scan.constants.ts` (@ptah-extension/shared); both halves of the
   * asymmetry are pinned in this file's spec (TASK_2026_208).
   */
  private async handleFileOpen(
    params: FileOpenCompatParams | undefined,
    methodName: string,
  ): Promise<{
    success: boolean;
    content?: string;
    filePath?: string;
    error?: string;
  }> {
    const filePath = params?.path ?? params?.filePath;
    if (!filePath) {
      return { success: false, error: 'filePath is required' };
    }
    const pathError = this.validatePathInWorkspace(filePath);
    if (pathError) {
      return { success: false, error: pathError };
    }
    try {
      const content = await this.fs.readFile(filePath);

      this.editorProvider.notifyFileOpened(filePath);
      return { success: true, content, filePath };
    } catch (error) {
      this.logger.error(`[Electron RPC] ${methodName} failed`, {
        filePath,
        error: error instanceof Error ? error.message : String(error),
      } as unknown as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private registerSaveFile(): void {
    this.rpcHandler.registerMethod(
      'editor:saveFile',
      async (params: { filePath: string; content: string } | undefined) => {
        if (!params?.filePath || typeof params.content !== 'string') {
          return {
            success: false,
            error: 'filePath and content are required',
          };
        }
        const pathError = this.validatePathInWorkspace(params.filePath);
        if (pathError) {
          return { success: false, error: pathError };
        }
        try {
          await this.fs.writeFile(params.filePath, params.content);
          return { success: true };
        } catch (error) {
          this.logger.error('[Electron RPC] editor:saveFile failed', {
            filePath: params.filePath,
            error: error instanceof Error ? error.message : String(error),
          } as unknown as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );
  }

  /**
   * `rootPath` is the explicit-access half of the exclusion asymmetry.
   *
   * Omitted, this walks the workspace root and `buildFileTree` filters every
   * entry against `TREE_HIDDEN_DIRS` — so navigation cannot reach an excluded
   * directory. Supplied, the given root is enumerated as-is: `buildFileTree`
   * filters a directory's CHILDREN, never the directory it was handed, so
   * `{ rootPath: '<workspace>/node_modules' }` returns its contents. Intended;
   * see `workspace-scan.constants.ts` (@ptah-extension/shared) for why, and
   * this file's spec for the pin (TASK_2026_208).
   */
  private registerGetFileTree(): void {
    this.rpcHandler.registerMethod(
      'editor:getFileTree',
      async (params: { rootPath?: string } | undefined) => {
        const root = params?.rootPath ?? this.workspace.getWorkspaceRoot();
        if (!root) {
          return { success: true, tree: [] };
        }
        if (params?.rootPath) {
          const pathError = this.validatePathInWorkspace(params.rootPath);
          if (pathError) {
            return { success: false, tree: [], error: pathError };
          }
        }
        try {
          const tree = await this.buildFileTree(root, 6);
          return { success: true, tree };
        } catch (error) {
          this.logger.error('[Electron RPC] editor:getFileTree failed', {
            root,
            error: error instanceof Error ? error.message : String(error),
          } as unknown as Error);
          return {
            success: false,
            tree: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );
  }

  /**
   * Lazy-load children of a directory that was at the initial depth boundary.
   * Returns immediate children (1 level) for the given directory path.
   *
   * Same explicit-access shape as `editor:getFileTree` above: `dirPath` is
   * enumerated as given, only its children are filtered (TASK_2026_208).
   */
  private registerGetDirectoryChildren(): void {
    this.rpcHandler.registerMethod(
      'editor:getDirectoryChildren',
      async (params: { dirPath: string } | undefined) => {
        if (!params?.dirPath) {
          return { success: false, error: 'dirPath is required' };
        }
        const pathError = this.validatePathInWorkspace(params.dirPath);
        if (pathError) {
          return { success: false, error: pathError };
        }
        try {
          const children = await this.buildFileTree(params.dirPath, 2, 0);
          return { success: true, children };
        } catch (error) {
          this.logger.error(
            '[Electron RPC] editor:getDirectoryChildren failed',
            {
              dirPath: params.dirPath,
              error: error instanceof Error ? error.message : String(error),
            } as unknown as Error,
          );
          return {
            success: false,
            children: [],
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );
  }

  /**
   * Read a configuration setting value.
   * Uses IWorkspaceProvider.getConfiguration which transparently routes
   * file-based keys to ~/.ptah/settings.json.
   */
  private registerGetSetting(): void {
    this.rpcHandler.registerMethod(
      'editor:getSetting',
      async (params: { key: string } | undefined) => {
        if (!params?.key) {
          return { success: false, error: 'key is required' };
        }
        try {
          const value = this.workspace.getConfiguration('ptah', params.key);
          return { success: true, value };
        } catch (error) {
          this.logger.error('[Electron RPC] editor:getSetting failed', {
            key: params.key,
            error: error instanceof Error ? error.message : String(error),
          } as unknown as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );
  }

  /**
   * Update a configuration setting value.
   * Uses IWorkspaceProvider.setConfiguration which transparently routes
   * file-based keys to ~/.ptah/settings.json.
   */
  private registerUpdateSetting(): void {
    this.rpcHandler.registerMethod(
      'editor:updateSetting',
      async (params: { key: string; value: unknown } | undefined) => {
        if (!params?.key) {
          return { success: false, error: 'key is required' };
        }
        if (!isFileBasedSettingKey(params.key)) {
          return {
            success: false,
            error: `Setting key '${params.key}' is not writable`,
          };
        }
        try {
          await this.workspace.setConfiguration(
            'ptah',
            params.key,
            params.value,
          );
          return { success: true };
        } catch (error) {
          this.logger.error('[Electron RPC] editor:updateSetting failed', {
            key: params.key,
            error: error instanceof Error ? error.message : String(error),
          } as unknown as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );
  }

  /**
   * Search for text or regex matches across workspace files.
   * Caps results to prevent memory/performance issues on large workspaces.
   */
  private registerSearchInFiles(): void {
    this.rpcHandler.registerMethod(
      'editor:searchInFiles',
      async (
        params:
          | {
              query: string;
              isRegex: boolean;
              caseSensitive: boolean;
              maxFileResults?: number;
              maxMatchesPerFile?: number;
            }
          | undefined,
      ) => {
        if (!params?.query || params.query.trim().length === 0) {
          return {
            success: true,
            files: [],
            truncated: false,
            totalMatches: 0,
          };
        }
        if (params.isRegex && params.query.length > 500) {
          return {
            success: false,
            error: 'Regex pattern too long (max 500 characters)',
            files: [],
            truncated: false,
            totalMatches: 0,
          };
        }

        const maxFileResults = params.maxFileResults ?? 2000;
        const maxMatchesPerFile = params.maxMatchesPerFile ?? 200;
        const wsRoot = this.workspace.getWorkspaceRoot();

        if (!wsRoot) {
          return {
            success: false,
            error: 'No workspace folder open',
            files: [],
            truncated: false,
            totalMatches: 0,
          };
        }
        let searchRegex: RegExp;
        try {
          const flags = params.caseSensitive ? 'g' : 'gi';
          const pattern = params.isRegex
            ? params.query
            : escapeRegex(params.query);
          searchRegex = new RegExp(pattern, flags);
          if (params.isRegex) {
            const canary = 'a'.repeat(50);
            const start = Date.now();
            searchRegex.exec(canary);
            if (Date.now() - start > 100) {
              return {
                success: false,
                error: 'Regex pattern is too complex (potential backtracking)',
                files: [],
                truncated: false,
                totalMatches: 0,
              };
            }
          }
        } catch {
          return {
            success: false,
            error: `Invalid regex: ${params.query}`,
            files: [],
            truncated: false,
            totalMatches: 0,
          };
        }

        try {
          const excludePattern = [EXCLUDED_DIRS_GLOB];
          const filePaths = await this.fs.findFiles(
            wsRoot.replace(/\\/g, '/') + '/**/*',
            excludePattern,
          );

          const resultFiles: SearchFileResultInternal[] = [];
          let totalMatches = 0;
          let truncated = false;

          for (const filePath of filePaths) {
            if (resultFiles.length >= maxFileResults) {
              truncated = true;
              break;
            }
            const ext = nodePath.extname(filePath).toLowerCase();
            if (BINARY_EXTENSIONS.has(ext)) {
              continue;
            }
            try {
              const stat = await this.fs.stat(filePath);
              if (stat.size > 1_048_576) {
                continue;
              }
            } catch {
              continue;
            }

            let content: string;
            try {
              content = await this.fs.readFile(filePath);
            } catch {
              continue;
            }

            const lines = content.split('\n');
            const matches: SearchMatchInternal[] = [];

            for (let i = 0; i < lines.length; i++) {
              if (matches.length >= maxMatchesPerFile) {
                break;
              }

              const line = lines[i];
              const linePreview =
                line.length > 200 ? line.substring(0, 200) : line;
              searchRegex.lastIndex = 0;
              let match: RegExpExecArray | null;
              while ((match = searchRegex.exec(line)) !== null) {
                matches.push({
                  line: i + 1,
                  column: match.index + 1,
                  lineText: linePreview,
                  matchLength: match[0].length,
                });
                if (matches.length >= maxMatchesPerFile) {
                  break;
                }
                if (match[0].length === 0) {
                  searchRegex.lastIndex++;
                }
              }
            }

            if (matches.length > 0) {
              resultFiles.push({
                filePath,
                fileName: nodePath.basename(filePath),
                relativePath: nodePath
                  .relative(wsRoot, filePath)
                  .replace(/\\/g, '/'),
                matches,
              });
              totalMatches += matches.length;
            }
          }

          return {
            success: true,
            files: resultFiles,
            truncated,
            totalMatches,
          };
        } catch (error) {
          this.logger.error('[Electron RPC] editor:searchInFiles failed', {
            query: params.query,
            error: error instanceof Error ? error.message : String(error),
          } as unknown as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
            files: [],
            truncated: false,
            totalMatches: 0,
          };
        }
      },
    );
  }

  private registerCreateFile(): void {
    this.rpcHandler.registerMethod(
      'editor:createFile',
      async (params: { filePath: string; content?: string } | undefined) => {
        if (!params?.filePath) {
          return { success: false, error: 'filePath is required' };
        }
        const pathError = this.validatePathInWorkspace(params.filePath);
        if (pathError) {
          return { success: false, error: pathError };
        }
        try {
          const exists = await this.fs.exists(params.filePath);
          if (exists) {
            return { success: false, error: 'File already exists' };
          }
          await this.fs.writeFile(params.filePath, params.content ?? '');
          return { success: true };
        } catch (error) {
          this.logger.error('[Electron RPC] editor:createFile failed', {
            filePath: params.filePath,
            error: error instanceof Error ? error.message : String(error),
          } as unknown as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );
  }

  private registerCreateFolder(): void {
    this.rpcHandler.registerMethod(
      'editor:createFolder',
      async (params: { folderPath: string } | undefined) => {
        if (!params?.folderPath) {
          return { success: false, error: 'folderPath is required' };
        }
        const pathError = this.validatePathInWorkspace(params.folderPath);
        if (pathError) {
          return { success: false, error: pathError };
        }
        try {
          const exists = await this.fs.exists(params.folderPath);
          if (exists) {
            return { success: false, error: 'Folder already exists' };
          }
          await this.fs.createDirectory(params.folderPath);
          return { success: true };
        } catch (error) {
          this.logger.error('[Electron RPC] editor:createFolder failed', {
            folderPath: params.folderPath,
            error: error instanceof Error ? error.message : String(error),
          } as unknown as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );
  }

  private registerRenameItem(): void {
    this.rpcHandler.registerMethod(
      'editor:renameItem',
      async (params: { oldPath: string; newPath: string } | undefined) => {
        if (!params?.oldPath || !params?.newPath) {
          return { success: false, error: 'oldPath and newPath are required' };
        }
        const oldPathError = this.validatePathInWorkspace(params.oldPath);
        if (oldPathError) {
          return { success: false, error: oldPathError };
        }
        const newPathError = this.validatePathInWorkspace(params.newPath);
        if (newPathError) {
          return { success: false, error: newPathError };
        }
        try {
          const oldExists = await this.fs.exists(params.oldPath);
          if (!oldExists) {
            return { success: false, error: 'Source path does not exist' };
          }
          const newExists = await this.fs.exists(params.newPath);
          if (newExists) {
            return { success: false, error: 'Destination path already exists' };
          }
          await nodeFs.rename(params.oldPath, params.newPath);
          return { success: true };
        } catch (error) {
          this.logger.error('[Electron RPC] editor:renameItem failed', {
            oldPath: params.oldPath,
            newPath: params.newPath,
            error: error instanceof Error ? error.message : String(error),
          } as unknown as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );
  }

  private registerDeleteItem(): void {
    this.rpcHandler.registerMethod(
      'editor:deleteItem',
      async (
        params: { itemPath: string; isDirectory: boolean } | undefined,
      ) => {
        if (!params?.itemPath) {
          return { success: false, error: 'itemPath is required' };
        }
        const pathError = this.validatePathInWorkspace(params.itemPath);
        if (pathError) {
          return { success: false, error: pathError };
        }
        try {
          await this.fs.delete(params.itemPath, {
            recursive: params.isDirectory,
          });
          return { success: true };
        } catch (error) {
          this.logger.error('[Electron RPC] editor:deleteItem failed', {
            itemPath: params.itemPath,
            error: error instanceof Error ? error.message : String(error),
          } as unknown as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    );
  }

  /**
   * Return a flat, sorted list of all workspace file paths (relative to root).
   * Used by the Quick Open file picker for fast, unbounded file listing.
   */
  private registerListAllFiles(): void {
    this.rpcHandler.registerMethod('editor:listAllFiles', async () => {
      const wsRoot = this.workspace.getWorkspaceRoot();
      if (!wsRoot) {
        return { success: false, error: 'No workspace folder open', files: [] };
      }

      try {
        const excludePattern = [EXCLUDED_DIRS_GLOB];
        const filePaths = await this.fs.findFiles(
          wsRoot.replace(/\\/g, '/') + '/**/*',
          excludePattern,
        );

        const relativePaths: string[] = [];
        for (const filePath of filePaths) {
          const ext = nodePath.extname(filePath).toLowerCase();
          if (BINARY_EXTENSIONS.has(ext)) {
            continue;
          }
          relativePaths.push(
            nodePath.relative(wsRoot, filePath).replace(/\\/g, '/'),
          );
        }

        relativePaths.sort();

        return { success: true, files: relativePaths };
      } catch (error) {
        this.logger.error('[Electron RPC] editor:listAllFiles failed', {
          error: error instanceof Error ? error.message : String(error),
        } as unknown as Error);
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
          files: [],
        };
      }
    });
  }

  /**
   * `editor:revertFiles` — Electron equivalent of VS Code's buffer revert.
   *
   * For each requested file path, reads the current on-disk content and
   * broadcasts an `editor:tabContentReverted` push event to the renderer.
   * The Angular EditorService handles the push and updates the Monaco tab
   * models (content + isDirty reset to false).
   *
   * Files that no longer exist on disk (e.g. deleted by the rewind) are
   * skipped silently — the frontend will detect the missing tab on the
   * next user interaction.
   */
  private registerRevertFiles(): void {
    this.rpcHandler.registerMethod<
      EditorRevertFilesParams,
      EditorRevertFilesResult
    >('editor:revertFiles', async (params) => {
      const requested = params?.files ?? [];
      this.logger.debug('[Electron RPC] editor:revertFiles called', {
        count: requested.length,
      });

      const revertedFiles: Array<{ filePath: string; content: string }> = [];

      for (const filePath of requested) {
        try {
          const content = await nodeFs.readFile(filePath, 'utf8');
          revertedFiles.push({ filePath, content });
        } catch {
          this.logger.debug(
            '[Electron RPC] editor:revertFiles — skipping missing file',
            { filePath } as unknown as Error,
          );
        }
      }

      if (revertedFiles.length > 0) {
        await this.webviewManager.broadcastMessage(
          MESSAGE_TYPES.EDITOR_TAB_CONTENT_REVERTED,
          { files: revertedFiles },
        );
      }

      this.logger.debug('[Electron RPC] editor:revertFiles completed', {
        requested: requested.length,
        revertedCount: revertedFiles.length,
      });

      return { revertedCount: revertedFiles.length };
    });
  }

  /**
   * Recursively build a file tree structure from a directory.
   * Limits depth to prevent excessive I/O on deep directory structures.
   */
  private async buildFileTree(
    dirPath: string,
    maxDepth: number,
    currentDepth = 0,
  ): Promise<FileTreeEntry[]> {
    if (currentDepth >= maxDepth) return [];

    try {
      const entries = await this.fs.readDirectory(dirPath);
      const result: FileTreeEntry[] = [];
      const sorted = entries.sort(
        (
          a: { name: string; type: number },
          b: { name: string; type: number },
        ) => {
          if (a.type !== b.type) return a.type === 2 ? -1 : 1;
          return a.name.localeCompare(b.name);
        },
      );

      for (const entry of sorted) {
        // `TREE_HIDDEN_DIRS` (@ptah-extension/shared) is the single source of
        // truth this shares with the workspace watcher. It is the exact union
        // of the two checks that stood here before — the `node_modules`/`dist`
        // test and the dot-gated `HIDDEN_SKIP` test — so tree visibility is
        // unchanged. The dot gate is intentionally NOT reproduced: every name
        // it guarded already begins with '.', which made it a no-op, and
        // keeping it would let `node_modules` and `dist` back into the tree.
        if (isExcludedWorkspacePath(entry.name, TREE_HIDDEN_DIRS)) {
          continue;
        }

        const fullPath = dirPath.replace(/\\/g, '/') + '/' + entry.name;
        const isDir = (entry.type & 2) !== 0;

        if (isDir) {
          if (currentDepth + 1 >= maxDepth) {
            result.push({
              name: entry.name,
              path: fullPath,
              type: 'directory',
              children: [],
              needsLoad: true,
            });
          } else {
            const children = await this.buildFileTree(
              fullPath,
              maxDepth,
              currentDepth + 1,
            );
            result.push({
              name: entry.name,
              path: fullPath,
              type: 'directory',
              children,
            });
          }
        } else {
          result.push({
            name: entry.name,
            path: fullPath,
            type: 'file',
          });
        }
      }

      return result;
    } catch {
      return [];
    }
  }
}
