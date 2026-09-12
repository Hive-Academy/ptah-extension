import { inject, injectable } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  type IEditorLauncher,
  type IFileSystemProvider,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  TOKENS,
  type Logger,
  type RpcHandler,
} from '@ptah-extension/vscode-core';
import type { FileOpenParams, FileOpenResult } from '@ptah-extension/shared';
import { parseFileOpenParams } from './file-open-rpc.schema';
import { resolveWorkspaceFilePath } from './workspace-file-path';

interface EditorOpenedNotifier {
  notifyFileOpened(filePath: string): void;
}

const LAST_EDITOR_SETTING_KEY = 'editorLauncher.lastTarget';

/** Electron's legacy `file:open` surface, now routed through IEditorLauncher. */
@injectable()
export class ElectronFileOpenRpcHandlers {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(PLATFORM_TOKENS.EDITOR_PROVIDER)
    private readonly editorProvider: EditorOpenedNotifier,
    @inject(PLATFORM_TOKENS.EDITOR_LAUNCHER)
    private readonly launcher: IEditorLauncher,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fileSystem: IFileSystemProvider,
  ) {}

  register(): void {
    this.rpcHandler.registerMethod<FileOpenParams, FileOpenResult>(
      'file:open',
      (params) => this.handleFileOpen(params),
    );
  }

  private async handleFileOpen(
    params: FileOpenParams | undefined,
  ): Promise<FileOpenResult> {
    const parsed = parseFileOpenParams(params);
    if (!parsed.success) return { success: false, error: parsed.error };

    const resolved = await resolveWorkspaceFilePath(
      parsed.data,
      this.workspace.getWorkspaceFolders(),
      this.fileSystem,
    );
    if (!resolved.success) return resolved;

    try {
      const targets = await this.launcher.detect();
      const remembered = this.workspace.getConfiguration<string>(
        'ptah',
        LAST_EDITOR_SETTING_KEY,
      );
      const target =
        targets.find(({ id }) => id === remembered) ??
        targets.find(({ id }) => id === 'vscode') ??
        targets[0];
      if (!target) {
        return { success: false, error: 'No supported editor found' };
      }
      await this.launcher.openFile(target, resolved.path, parsed.data.line);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        '[file:open] failed to launch the external editor',
        error instanceof Error ? error : new Error(message),
      );
      return { success: false, error: message };
    }

    this.editorProvider.notifyFileOpened(resolved.path);
    return { success: true };
  }
}
