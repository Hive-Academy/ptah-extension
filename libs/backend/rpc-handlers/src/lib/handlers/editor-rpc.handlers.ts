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
  EditorOpenFileParams,
  EditorOpenResult,
  RpcMethodName,
} from '@ptah-extension/shared';

/** The validated `editor:openFile` payload. */
type EditorOpenFileInput = Pick<
  EditorOpenFileParams,
  'path' | 'line' | 'workspaceRoot' | 'scope'
>;
import {
  EditorDetectTargetsParamsSchema,
  EditorOpenFileParamsSchema,
  EditorOpenWorkspaceParamsSchema,
} from './editor-rpc.schema';
import { resolveWorkspaceFilePath } from './workspace-file-path';
import { FileLinkRootPolicy } from './file-link-root-policy';

/**
 * Fixed copy for every failure that originates in a thrown error.
 *
 * A spawn failure carries the resolved executable path and an OS errno string
 * (`spawn C:\Users\me\AppData\Local\Programs\...\Cursor.exe ENOENT`). That is
 * host state, and the renderer is the side an injected link arrives on, so it
 * never crosses the boundary — `this.warn` keeps the real error in the log.
 */
const MESSAGE = {
  launchFailed: 'Could not launch the requested editor.',
  detectFailed: 'Could not detect installed editors.',
} as const;

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
    @inject(FileLinkRootPolicy)
    private readonly linkPolicy: FileLinkRootPolicy,
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
    const resolved = await this.resolveForScope(parsed.data);
    if (!resolved.success) return resolved;
    return this.openDetected(parsed.data.target, (target) =>
      this.launcher.openFile(target, resolved.path, parsed.data.line),
    );
  }

  /**
   * Pick the path policy the caller asked for.
   *
   * `'workspace'` (the default, and every pre-existing caller) keeps the
   * unchanged behaviour: the path must sit inside a registered folder.
   *
   * `'external-link'` is the agent-link case the in-app viewer already
   * refused. It widens to home and temp MINUS the credential deny-list, and
   * accepts a regular file only — never a directory, and never a path whose
   * realpath escaped the authorized set. Nothing is read here; the path
   * becomes argv for the user's own editor.
   */
  private async resolveForScope(
    params: EditorOpenFileInput,
  ): Promise<
    { success: true; path: string } | { success: false; error: string }
  > {
    if (params.scope !== 'external-link') {
      return resolveWorkspaceFilePath(
        params,
        this.workspace.getWorkspaceFolders(),
        this.fileSystem,
      );
    }

    const resolution = await this.linkPolicy.resolveForExternalOpen({
      path: params.path,
      workspaceRoot: params.workspaceRoot,
    });
    if (resolution.kind !== 'file') {
      return {
        success: false,
        error: 'That file cannot be opened from a link.',
      };
    }
    return { success: true, path: resolution.lexicalPath };
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
      this.warn('[editor RPC] launch failed', error);
      return { success: false, error: MESSAGE.launchFailed };
    }
  }

  private detectFailure(error: unknown): EditorDetectTargetsResult {
    this.warn('[editor RPC] detection failed', error);
    return { success: false, targets: [], error: MESSAGE.detectFailed };
  }

  /** The ONE place a raw error is allowed to go: the host log. */
  private warn(label: string, error: unknown): void {
    this.logger.warn(
      label,
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}
