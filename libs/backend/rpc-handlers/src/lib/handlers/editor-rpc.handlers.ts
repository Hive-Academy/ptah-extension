import { inject, injectable } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  isPathWithinRoots,
  type EditorTarget,
  type IEditorLauncher,
  type IFileSystemProvider,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  TOKENS,
  type Logger,
  type RpcHandler,
} from '@ptah-extension/vscode-core';
import type {
  EditorDetectTargetsResult,
  EditorOpenResult,
  RpcMethodName,
} from '@ptah-extension/shared';
import {
  EditorDetectTargetsParamsSchema,
  EditorOpenFileParamsSchema,
  EditorOpenWorkspaceParamsSchema,
} from './editor-rpc.schema';
import { resolveWorkspaceFilePath } from './workspace-file-path';

@injectable()
export class EditorRpcHandlers {
  static readonly METHODS = [
    'editor:detectTargets',
    'editor:openFile',
    'editor:openWorkspace',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(PLATFORM_TOKENS.EDITOR_LAUNCHER)
    private readonly launcher: IEditorLauncher,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fileSystem: IFileSystemProvider,
  ) {}

  register(): void {
    this.rpcHandler.registerMethod('editor:detectTargets', (params) =>
      this.detectTargets(params),
    );
    this.rpcHandler.registerMethod('editor:openFile', (params) =>
      this.openFile(params),
    );
    this.rpcHandler.registerMethod('editor:openWorkspace', (params) =>
      this.openWorkspace(params),
    );
  }

  private async detectTargets(
    raw: unknown,
  ): Promise<EditorDetectTargetsResult> {
    if (!EditorDetectTargetsParamsSchema.safeParse(raw).success) {
      return {
        success: false,
        targets: [],
        error: 'Invalid editor:detectTargets params',
      };
    }
    try {
      return { success: true, targets: await this.launcher.detect() };
    } catch (error: unknown) {
      return this.detectFailure(error);
    }
  }

  private async openFile(raw: unknown): Promise<EditorOpenResult> {
    const parsed = EditorOpenFileParamsSchema.safeParse(raw);
    if (!parsed.success)
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ?? 'Invalid editor:openFile params',
      };
    const resolved = await resolveWorkspaceFilePath(
      parsed.data,
      this.workspace.getWorkspaceFolders(),
      this.fileSystem,
    );
    if (!resolved.success) return resolved;
    return this.openDetected(parsed.data.target, (target) =>
      this.launcher.openFile(target, resolved.path, parsed.data.line),
    );
  }

  private async openWorkspace(raw: unknown): Promise<EditorOpenResult> {
    const parsed = EditorOpenWorkspaceParamsSchema.safeParse(raw);
    if (!parsed.success)
      return {
        success: false,
        error:
          parsed.error.issues[0]?.message ??
          'Invalid editor:openWorkspace params',
      };
    const root = parsed.data.root;
    if (!isPathWithinRoots(root, this.workspace.getWorkspaceFolders())) {
      return {
        success: false,
        error: 'Workspace root is outside the workspace',
      };
    }
    return this.openDetected(parsed.data.target, (target) =>
      this.launcher.openWorkspace(target, root),
    );
  }

  private async openDetected(
    targetId: EditorTarget['id'],
    open: (target: EditorTarget) => Promise<void>,
  ): Promise<EditorOpenResult> {
    try {
      const target = (await this.launcher.detect()).find(
        ({ id }) => id === targetId,
      );
      if (!target)
        return { success: false, error: 'Editor target is not installed' };
      await open(target);
      return { success: true };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        '[editor RPC] launch failed',
        error instanceof Error ? error : new Error(message),
      );
      return { success: false, error: message };
    }
  }

  private detectFailure(error: unknown): EditorDetectTargetsResult {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn(
      '[editor RPC] detection failed',
      error instanceof Error ? error : new Error(message),
    );
    return { success: false, targets: [], error: message };
  }
}
