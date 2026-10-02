import { inject, injectable } from 'tsyringe';
import {
  EDITOR_DESCRIPTORS,
  PLATFORM_TOKENS,
  isPathWithinRoots,
  type EditorTarget,
  type IEditorLauncher,
  type IFileSystemProvider,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import {
  TOKENS,
  type GitConflictStagesResult,
  type GitInfoService,
  type Logger,
  type RpcHandler,
} from '@ptah-extension/vscode-core';
import type {
  EditorDetectTargetsResult,
  EditorOpenFileParams,
  EditorOpenMergeFailureReason,
  EditorOpenMergeResult,
  EditorOpenResult,
  EditorTargetId,
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
  EditorOpenMergeParamsSchema,
  EditorOpenWorkspaceParamsSchema,
} from './editor-rpc.schema';
import { resolveWorkspaceFilePath } from './workspace-file-path';
import { FileLinkRootPolicy } from './file-link-root-policy';
import { isRegisteredWorkspaceFolder } from './git-workspace-root';

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

/**
 * Fixed copy per `editor:openMerge` failure. Stage paths are absolute host
 * paths and git's own messages may name them, so none of that crosses over.
 */
const MERGE_MESSAGE: Readonly<Record<EditorOpenMergeFailureReason, string>> = {
  'invalid-params': 'Invalid editor:openMerge params.',
  'invalid-path': 'That path is not inside the repository.',
  'not-installed': 'Editor target is not installed',
  'no-operation': 'No merge, rebase or cherry-pick is in progress.',
  'not-conflicted': 'That file has no conflict left to resolve.',
  'not-mergeable':
    'This conflict has no three-way merge view. Open the folder instead.',
  failed: 'Could not open the merge view.',
};

function mergeFailure(
  reason: EditorOpenMergeFailureReason,
): EditorOpenMergeResult {
  return { status: 'failed', reason, error: MERGE_MESSAGE[reason] };
}

/**
 * A11: only a target whose descriptor declares `mergeArgs` has a merge view
 * this app knows how to launch; every other target opens the file instead.
 */
function declaresMergeArgs(targetId: EditorTargetId): boolean {
  return EDITOR_DESCRIPTORS.some(
    (descriptor) => descriptor.id === targetId && 'mergeArgs' in descriptor,
  );
}

@injectable()
export class EditorRpcHandlers {
  static readonly METHODS = [
    'editor:detectTargets',
    'editor:openFile',
    'editor:openWorkspace',
    'editor:openMerge',
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
    @inject(TOKENS.GIT_INFO_SERVICE)
    private readonly gitInfo: GitInfoService,
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
    this.rpcHandler.registerMethod('editor:openMerge', (params) =>
      this.openMerge(params),
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
    if (parsed.data.target === 'terminal')
      return { success: false, error: 'A terminal cannot open a file.' };
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

  /**
   * Launch the detected target. Detection yields at most ONE target per id,
   * so there is nothing to retry here — the terminal candidate fallback lives
   * in `spawnTerminalProcess` (platform-core), where the candidate order is.
   */
  private async openDetected(
    targetId: EditorTarget['id'],
    open: (target: EditorTarget) => Promise<void>,
  ): Promise<EditorOpenResult> {
    try {
      const [target] = (await this.launcher.detect()).filter(
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

  /**
   * editor:openMerge - open one conflicted path in the target's three-way
   * merge view.
   *
   * Support is checked first (A11): a target without `mergeArgs`, or a host
   * launcher without `openMergeTool`, answers `unsupported` before any stage
   * file is written, and the renderer opens the file instead. Only then are
   * the stages materialized and the editor launched. The absolute stage paths
   * go to the launcher, never into the result.
   */
  private async openMerge(raw: unknown): Promise<EditorOpenMergeResult> {
    const parsed = EditorOpenMergeParamsSchema.safeParse(raw);
    if (!parsed.success) return mergeFailure('invalid-params');
    const { target: targetId, path: relativePath } = parsed.data;

    const openMergeTool = this.launcher.openMergeTool?.bind(this.launcher);
    if (!openMergeTool || !declaresMergeArgs(targetId)) {
      return { status: 'unsupported' };
    }

    const root = this.resolveMergeRoot(parsed.data.workspaceRoot);
    if (!root) return mergeFailure('failed');

    try {
      const [target] = (await this.launcher.detect()).filter(
        ({ id }) => id === targetId,
      );
      if (!target) return mergeFailure('not-installed');

      const stages = await this.gitInfo.materializeConflictStages(
        root,
        relativePath,
      );
      if (stages.status !== 'ok') return this.stagesFailure(stages);

      const launch = await openMergeTool(target, {
        local: stages.local,
        remote: stages.remote,
        base: stages.base,
        result: stages.result,
      });
      if (launch.status === 'launched') return { status: 'ok' };
      if (launch.status === 'unsupported') return { status: 'unsupported' };
      this.warn('[editor RPC] merge launch failed', launch.error);
      return mergeFailure('failed');
    } catch (error: unknown) {
      this.warn('[editor RPC] merge launch failed', error);
      return mergeFailure('failed');
    }
  }

  private stagesFailure(
    stages: Exclude<GitConflictStagesResult, { status: 'ok' }>,
  ): EditorOpenMergeResult {
    if (stages.status === 'failed') {
      // Already sanitized by the service, but still host-side detail.
      this.logger.warn('[editor RPC] merge stages could not be written', {
        error: stages.error,
      });
      return mergeFailure('failed');
    }
    return mergeFailure(stages.status);
  }

  /**
   * Same rule as the `git:*` handlers: a named folder must be registered,
   * and an unregistered one never falls back to the active folder.
   */
  private resolveMergeRoot(requested: string | undefined): string | undefined {
    if (!requested) return this.workspace.getWorkspaceRoot();
    if (isRegisteredWorkspaceFolder(this.workspace, requested)) {
      return requested;
    }
    this.logger.warn(
      '[editor RPC] editor:openMerge called with unregistered workspaceRoot',
      { workspaceRoot: requested },
    );
    return undefined;
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
