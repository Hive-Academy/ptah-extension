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
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  IFileSystemProvider,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';

interface FileTreeEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeEntry[];
}

@injectable()
export class ElectronEditorRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fs: IFileSystemProvider,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    private readonly container: DependencyContainer
  ) {}

  register(): void {
    this.registerOpenFile();
    this.registerSaveFile();
    this.registerGetFileTree();
  }

  /** Validate that a file path is within the workspace root. Returns error message or null. */
  private validatePathInWorkspace(filePath: string): string | null {
    const wsRoot = this.workspace.getWorkspaceRoot();
    if (!wsRoot) return 'No workspace folder open';
    const resolved = nodePath.resolve(filePath);
    const resolvedRoot = nodePath.resolve(wsRoot);
    if (
      !resolved.startsWith(resolvedRoot + nodePath.sep) &&
      resolved !== resolvedRoot
    ) {
      return 'Path is outside the workspace';
    }
    return null;
  }

  private registerOpenFile(): void {
    this.rpcHandler.registerMethod(
      'editor:openFile',
      async (params: { filePath: string } | undefined) => {
        if (!params?.filePath) {
          return { success: false, error: 'filePath is required' };
        }
        const pathError = this.validatePathInWorkspace(params.filePath);
        if (pathError) {
          return { success: false, error: pathError };
        }
        try {
          const content = await this.fs.readFile(params.filePath);

          // Notify editor provider of file open (best-effort)
          try {
            const editorProvider = this.container.resolve<{
              notifyFileOpened(filePath: string): void;
            }>(PLATFORM_TOKENS.EDITOR_PROVIDER);
            editorProvider.notifyFileOpened(params.filePath);
          } catch {
            // Editor provider may not be registered
          }

          return { success: true, content, filePath: params.filePath };
        } catch (error) {
          this.logger.error('[Electron RPC] editor:openFile failed', {
            filePath: params.filePath,
            error: error instanceof Error ? error.message : String(error),
          } as unknown as Error);
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          };
        }
      }
    );
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
      }
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
        try {
          const tree = await this.buildFileTree(root, 3);
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
      }
    );
  }

  /**
   * Recursively build a file tree structure from a directory.
   * Limits depth to prevent excessive I/O on deep directory structures.
   */
  private async buildFileTree(
    dirPath: string,
    maxDepth: number,
    currentDepth = 0
  ): Promise<FileTreeEntry[]> {
    if (currentDepth >= maxDepth) return [];

    try {
      const entries = await this.fs.readDirectory(dirPath);
      const result: FileTreeEntry[] = [];

      // Sort: directories first, then alphabetically
      const sorted = entries.sort(
        (
          a: { name: string; type: number },
          b: { name: string; type: number }
        ) => {
          if (a.type !== b.type) return a.type === 2 ? -1 : 1;
          return a.name.localeCompare(b.name);
        }
      );

      for (const entry of sorted) {
        // Skip hidden files/dirs and node_modules
        if (
          entry.name.startsWith('.') ||
          entry.name === 'node_modules' ||
          entry.name === 'dist'
        ) {
          continue;
        }

        const fullPath = dirPath.replace(/\\/g, '/') + '/' + entry.name;
        const isDir = (entry.type & 2) !== 0;

        if (isDir) {
          const children = await this.buildFileTree(
            fullPath,
            maxDepth,
            currentDepth + 1
          );
          result.push({
            name: entry.name,
            path: fullPath,
            type: 'directory',
            children,
          });
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
