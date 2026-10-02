import * as os from 'node:os';
import {
  createExecutableEditorDefinitions,
  detectEditorTargets,
  prepareEditorFileLaunch,
  prepareEditorMergeLaunch,
  prepareEditorWorkspaceLaunch,
  spawnEditorProcess,
  spawnTerminalProcess,
  type EditorDetectionDefinition,
  type EditorDetectionOptions,
  type EditorMergeLaunchResult,
  type EditorMergeRequest,
  type EditorTarget,
  type IEditorLauncher,
  type IProcessSpawner,
} from '@ptah-extension/platform-core';

export interface ElectronEditorLauncherOptions extends EditorDetectionOptions {
  readonly definitions?: readonly EditorDetectionDefinition[];
  readonly homeDir?: string;
}

export class ElectronEditorLauncher implements IEditorLauncher {
  constructor(
    private readonly spawner: IProcessSpawner,
    private readonly options: ElectronEditorLauncherOptions = {},
  ) {}

  detect(): Promise<EditorTarget[]> {
    return detectEditorTargets(this.definitions(), this.options);
  }

  async openFile(
    target: EditorTarget,
    filePath: string,
    line?: number,
  ): Promise<void> {
    const launch = prepareEditorFileLaunch(target, filePath, line);
    await spawnEditorProcess(this.spawner, target, launch.args, launch.cwd);
  }

  async openWorkspace(
    target: EditorTarget,
    workspaceRoot: string,
  ): Promise<void> {
    if (target.id === 'terminal') {
      await spawnTerminalProcess(
        this.spawner,
        target,
        workspaceRoot,
        this.options.platform ?? process.platform,
      );
      return;
    }
    const launch = prepareEditorWorkspaceLaunch(workspaceRoot);
    await spawnEditorProcess(this.spawner, target, launch.args, launch.cwd);
  }

  /**
   * Launch the target's three-way merge view through the same argv spawn as
   * `openFile` — no shell; a Windows `.cmd` shim is resolved by the spawner.
   * Only a target whose definition declares `mergeArgs` is launched (A11).
   */
  async openMergeTool(
    target: EditorTarget,
    request: EditorMergeRequest,
  ): Promise<EditorMergeLaunchResult> {
    const mergeArgs = this.definitions().find(
      ({ id }) => id === target.id,
    )?.mergeArgs;
    if (mergeArgs === undefined) return { status: 'unsupported' };
    try {
      const launch = prepareEditorMergeLaunch(mergeArgs, request);
      await spawnEditorProcess(this.spawner, target, launch.args, launch.cwd);
      return { status: 'launched' };
    } catch (error: unknown) {
      return {
        status: 'failed',
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  private definitions(): readonly EditorDetectionDefinition[] {
    return (
      this.options.definitions ??
      createExecutableEditorDefinitions(
        this.options.platform ?? process.platform,
        this.options.env ?? process.env,
        this.options.homeDir ?? os.homedir(),
      )
    );
  }
}
