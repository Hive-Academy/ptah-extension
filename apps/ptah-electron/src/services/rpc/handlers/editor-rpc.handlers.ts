/**
 * Electron Editor RPC Handlers
 *
 * Handles Monaco editor and file explorer methods specific to Electron:
 * - editor:openFile - Read file content for Monaco editor
 * - editor:saveFile - Save file content from Monaco editor
 * - editor:getFileTree - Build recursive file tree from workspace root
 *
 * TASK_2025_203 Batch 5: Extracted from inline registrations
 */

import { injectable, inject, DependencyContainer } from 'tsyringe';
import * as nodePath from 'path';
import * as nodeFs from 'fs/promises';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  IFileSystemProvider,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type {
  FileOpenParams,
  EditorRevertFilesParams,
  EditorRevertFilesResult,
} from '@ptah-extension/shared';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
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

/** Hidden directory names to skip when building the file tree. */
const HIDDEN_SKIP = new Set([
  '.git',
  '.hg',
  '.svn',
  '.DS_Store',
  '.Trash',
  '.cache',
  '.tmp',
  '.temp',
  '.nx',
]);

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
    @inject('DependencyContainer')
    private readonly container: DependencyContainer,
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
      try {
        const editorProvider = this.container.resolve<{
          notifyFileOpened(filePath: string): void;
        }>(PLATFORM_TOKENS.EDITOR_PROVIDER);
        editorProvider.notifyFileOpened(filePath);
      } catch {
        // Editor provider may not be registered
      }
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

  private registerGetFileTree(): void {
    this.rpcHandler.registerMethod(
      'editor:getFileTree',
      async (params: { rootPath?: string } | undefined) => {
        const root = params?.rootPath ?? this.workspace.getWorkspaceRoot();
        if (!root) {
          return { success: true, tree: [] };
        }
        // Validate that the requested root is within the workspace
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
        // Only allow updating keys registered in the file-based settings allowlist
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

        // ReDoS protection: limit regex pattern length
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

        // Build the search regex, handling both literal and regex modes
        let searchRegex: RegExp;
        try {
          const flags = params.caseSensitive ? 'g' : 'gi';
          const pattern = params.isRegex
            ? params.query
            : escapeRegex(params.query);
          searchRegex = new RegExp(pattern, flags);

          // ReDoS canary test: run the regex against a short adversarial string
          // to detect catastrophic backtracking before processing files
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
          // Discover files, excluding generated/binary directories.
          // Uses brace expansion syntax supported by fast-glob's ignore option.
          const excludePattern = '**/{node_modules,dist,.git,.nx,.cache}/**';
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

            // Skip binary files by extension
            const ext = nodePath.extname(filePath).toLowerCase();
            if (BINARY_EXTENSIONS.has(ext)) {
              continue;
            }

            // Skip files larger than 1MB
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
              // Reset regex state for each line and find all matches
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
                // Prevent infinite loop on zero-length matches
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
        const excludePattern = '**/{node_modules,dist,.git,.nx,.cache}/**';
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

      // Sort: directories first, then alphabetically
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
        // Skip truly hidden/noisy directories while allowing config dirs
        // (.claude, .agent, .vscode, .github, .husky, etc.)
        if (entry.name === 'node_modules' || entry.name === 'dist') {
          continue;
        }
        if (entry.name.startsWith('.') && HIDDEN_SKIP.has(entry.name)) {
          continue;
        }

        const fullPath = dirPath.replace(/\\/g, '/') + '/' + entry.name;
        const isDir = (entry.type & 2) !== 0;

        if (isDir) {
          // At the depth boundary, mark directories as needing lazy load
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
